// API do servidor contra o banco de teste. `app.inject` simula uma chamada HTTP sem abrir porta.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prepararBancoDeTeste } from "./banco-de-teste.js";
import { criarServidor } from "../src/servidor.js";
import { USERS } from "../../js/sessao.js";

let pool, app;
before(async () => {
  pool = await prepararBancoDeTeste();
  app = criarServidor({ pool });
});
after(async () => {
  await app.close();
  await pool.end();
});

const separador = USERS.find((u) => u.perfil === "sep");
async function entrar(usuario = separador) {
  const r = await app.inject({ method: "POST", url: "/api/login", payload: { login: usuario.login, pin: usuario.pin } });
  return r.json().token;
}
const chamar = async (url, token, opcoes = {}) =>
  app.inject({ url, headers: token ? { authorization: `Bearer ${token}` } : {}, ...opcoes });

// ---------- saúde e login ----------

test("saúde: servidor e banco no ar", async () => {
  const r = await app.inject({ url: "/api/saude" });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().ok, true);
});

test("login certo devolve token, nome e perfil", async () => {
  const r = await app.inject({ method: "POST", url: "/api/login", payload: { login: ` ${separador.login.toUpperCase()} `, pin: separador.pin } });
  assert.equal(r.statusCode, 200);
  const corpo = r.json();
  assert.equal(corpo.perfil, "sep");
  assert.equal(corpo.nome, separador.nome);
  assert.ok(corpo.token.length >= 40);
  assert.ok(new Date(corpo.expiraEm) > new Date());
});

test("PIN errado e usuário inexistente recebem a mesma resposta", async () => {
  const errado = await app.inject({ method: "POST", url: "/api/login", payload: { login: separador.login, pin: "PIN-ERRADO" } });
  const inexistente = await app.inject({ method: "POST", url: "/api/login", payload: { login: "fantasma", pin: "1" } });
  assert.equal(errado.statusCode, 401);
  assert.equal(inexistente.statusCode, 401);
  assert.deepEqual(errado.json(), inexistente.json());
});

test("login sem PIN é recusado antes de consultar o banco", async () => {
  const r = await app.inject({ method: "POST", url: "/api/login", payload: { login: separador.login } });
  assert.equal(r.statusCode, 400);
});

test("rota protegida sem token, com token inventado ou com sessão vencida: 401", async () => {
  assert.equal((await chamar("/api/pedidos?setor=exp")).statusCode, 401);
  assert.equal((await chamar("/api/pedidos?setor=exp", "inventado")).statusCode, 401);
  const token = await entrar();
  await pool.query("UPDATE sessoes SET expira_em = now() - interval '1 minute' WHERE token = $1", [token]);
  assert.equal((await chamar("/api/pedidos?setor=exp", token)).statusCode, 401);
});

test("usuário desativado perde o acesso na hora", async () => {
  const token = await entrar();
  await pool.query("UPDATE usuarios SET ativo = false WHERE login = $1", [separador.login]);
  try {
    assert.equal((await chamar("/api/pedidos?setor=exp", token)).statusCode, 401);
  } finally {
    await pool.query("UPDATE usuarios SET ativo = true WHERE login = $1", [separador.login]);
  }
});

// ---------- catálogo ----------

test("produto pelo código de barras, com embalagens e endereços com saldo", async () => {
  const token = await entrar();
  const r = await chamar("/api/produtos/7908005911280", token);
  assert.equal(r.statusCode, 200);
  const p = r.json();
  assert.equal(p.codigo, "122");
  assert.ok(p.embalagens.some((e) => e.codigo === "7908005911280"));
  assert.ok(Array.isArray(p.saldos));
});

test("produto pelo código interno, com espaços e minúsculas", async () => {
  const token = await entrar();
  assert.equal((await chamar("/api/produtos/%20122%20", token)).json().codigo, "122");
});

test("produto desconhecido: 404", async () => {
  const token = await entrar();
  assert.equal((await chamar("/api/produtos/0000000000000", token)).statusCode, 404);
});

// ---------- pedidos ----------

test("lista de pedidos por setor: prioridade alta primeiro", async () => {
  const token = await entrar();
  const exp = (await chamar("/api/pedidos?setor=exp", token)).json();
  const mont = (await chamar("/api/pedidos?setor=mont", token)).json();
  assert.equal(exp.length, 13); // 9 para separar + 4 já separados (na conferência, Fase 2)
  assert.equal(mont.length, 7);
  assert.ok(mont.every((p) => p.id.startsWith("OP-")));
  const primeiraNormal = exp.findIndex((p) => p.prioridade === "normal");
  assert.ok(exp.slice(primeiraNormal).every((p) => p.prioridade === "normal"));
  assert.ok(exp.every((p) => p.itens > 0 && p.unidades >= p.itens));
});

test("setor inválido é recusado", async () => {
  const token = await entrar();
  assert.equal((await chamar("/api/pedidos?setor=xyz", token)).statusCode, 400);
});

test("pedido com os itens na ordem de separação e os códigos de barras", async () => {
  const token = await entrar();
  const p = (await chamar("/api/pedidos/PV-10421", token)).json();
  assert.equal(p.id, "PV-10421");
  assert.deepEqual(p.itens.map((i) => i.sequencia), p.itens.map((_, n) => n + 1));
  const cabo = p.itens.find((i) => i.produto === "122");
  assert.equal(cabo.descricao, "CABO FREIO BICICLETA LIMPO TRAS ACO CECY 1.800MM IMPORTADO");
  assert.ok(cabo.codigos_de_barras.includes("7908005911280"));
});

test("pedido que não existe: 404", async () => {
  const token = await entrar();
  assert.equal((await chamar("/api/pedidos/PV-0", token)).statusCode, 404);
});

// ---------- sincronização ----------

const acao = (tipo = "separacao.leitura") => ({ id: randomUUID(), tipo, dados: { pedido: "PV-10421", codigo: "7908005911280" }, feitaEm: new Date().toISOString() });

test("sincronizar grava as ações e diz quais entraram", async () => {
  const token = await entrar();
  const lote = [acao(), acao()];
  const r = await chamar("/api/sincronizar", token, { method: "POST", payload: { acoes: lote } });
  assert.equal(r.statusCode, 200);
  const { novas, repetidas } = r.json();
  assert.deepEqual({ novas, repetidas }, { novas: lote.map((a) => a.id), repetidas: [] });
  const { rows } = await pool.query("SELECT login, tipo, dados FROM acoes_recebidas WHERE id = $1", [lote[0].id]);
  assert.equal(rows[0].login, separador.login);
  assert.deepEqual(rows[0].dados, lote[0].dados);
});

test("reenviar o mesmo lote (a rede caiu antes da resposta) não duplica nada", async () => {
  const token = await entrar();
  const lote = [acao(), acao()];
  await chamar("/api/sincronizar", token, { method: "POST", payload: { acoes: lote } });
  const novaAcao = acao();
  const r = await chamar("/api/sincronizar", token, { method: "POST", payload: { acoes: [...lote, novaAcao] } });
  const { novas, repetidas } = r.json();
  assert.deepEqual({ novas, repetidas }, { novas: [novaAcao.id], repetidas: lote.map((a) => a.id) });
  const { rows } = await pool.query("SELECT count(*)::int AS n FROM acoes_recebidas WHERE id = ANY($1)", [lote.map((a) => a.id)]);
  assert.equal(rows[0].n, 2);
});

test("ação mal formada é recusada inteira e nada é gravado", async () => {
  const token = await entrar();
  const antes = (await pool.query("SELECT count(*)::int AS n FROM acoes_recebidas")).rows[0].n;
  const ruim = { ...acao(), id: "nao-e-uuid" };
  const r = await chamar("/api/sincronizar", token, { method: "POST", payload: { acoes: [acao(), ruim] } });
  assert.equal(r.statusCode, 400);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM acoes_recebidas")).rows[0].n, antes);
});

test("sincronizar exige login", async () => {
  const r = await chamar("/api/sincronizar", null, { method: "POST", payload: { acoes: [acao()] } });
  assert.equal(r.statusCode, 401);
});

// ---------- tempo real ----------

test("tempo real: quem está conectado recebe o aviso quando chegam ações", async () => {
  const servidor = criarServidor({ pool });
  const endereco = await servidor.listen({ port: 0, host: "127.0.0.1" });
  try {
    const token = await entrar();
    // tela da Gestão abrindo o canal (como o EventSource do navegador)
    const canal = await fetch(`${endereco}/api/tempo-real?token=${token}`);
    assert.equal(canal.headers.get("content-type"), "text/event-stream; charset=utf-8");
    const leitor = canal.body.getReader();
    const decodificar = new TextDecoder();
    await leitor.read(); // ": conectado"

    // coletor sincronizando
    const lote = [acao(), acao(), acao()];
    await fetch(`${endereco}/api/sincronizar`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ acoes: lote }),
    });

    const { value } = await leitor.read();
    assert.equal(decodificar.decode(value), `event: acoes\ndata: ${JSON.stringify({ login: separador.login, quantidade: 3 })}\n\n`);
    await leitor.cancel();
  } finally {
    await servidor.close();
  }
});

test("tempo real sem token: 401", async () => {
  assert.equal((await app.inject({ url: "/api/tempo-real" })).statusCode, 401);
});
