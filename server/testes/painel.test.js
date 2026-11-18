// Fase 1c: o painel "Ao vivo" da Gestão (GET /api/painel/separacao) e o batimento do coletor.
// O coletor manda um sinal a cada 30 s (o mesmo /api/sincronizar com a lista vazia); o servidor guarda
// a hora do último contato de cada separador. As ações não aplicadas ficam na lista até o coordenador marcar "visto".
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

const usuario = (perfil) => USERS.find((u) => u.perfil === perfil);
async function entrar(login, pin) {
  return (await app.inject({ method: "POST", url: "/api/login", payload: { login, pin } })).json().token;
}
const entrarComo = (perfil) => entrar(usuario(perfil).login, usuario(perfil).pin);
let relogio = Date.now() - 60_000;
const acao = (tipo, dados) => ({ id: randomUUID(), tipo, dados, feitaEm: new Date((relogio += 1000)).toISOString() });
const sincronizar = (token, acoes) =>
  app.inject({ method: "POST", url: "/api/sincronizar", headers: { authorization: `Bearer ${token}` }, payload: { acoes } });
const painel = (token, setor = "exp") =>
  app.inject({ method: "GET", url: `/api/painel/separacao?setor=${setor}`, headers: { authorization: `Bearer ${token}` } });
const contatoDe = async (token) => (await pool.query("SELECT ultimo_contato FROM sessoes WHERE token = $1", [token])).rows[0].ultimo_contato;

test("o painel é só do coordenador: sem login 401, separador 403", async () => {
  assert.equal((await app.inject({ method: "GET", url: "/api/painel/separacao?setor=exp" })).statusCode, 401);
  const r = await painel(await entrarComo("sep"));
  assert.equal(r.statusCode, 403);
  assert.equal((await painel(await entrarComo("coord"))).statusCode, 200);
  assert.equal((await painel(await entrarComo("coordmont"), "mont")).statusCode, 200);
});

test("o login já conta como contato; o batimento (lista vazia) atualiza a hora", async () => {
  const token = await entrarComo("sep");
  const noLogin = await contatoDe(token);
  assert.ok(noLogin, "o login grava o primeiro contato");

  await new Promise((r) => setTimeout(r, 20));
  const r = await sincronizar(token, []);
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.json(), { novas: [], repetidas: [], recusadas: [] });
  assert.ok((await contatoDe(token)) > noLogin, "o batimento atualiza o último contato");
});

test("o painel mostra o andamento do pedido e o contato do separador", async () => {
  const sep = await entrarComo("sep");
  const itens = (await pool.query("SELECT sequencia, qtd FROM itens_pedido WHERE pedido_id = 'PV-10422' ORDER BY sequencia")).rows;
  await sincronizar(sep, [
    acao("separacao.iniciar", { pedido: "PV-10422" }),
    acao("separacao.item", { pedido: "PV-10422", sequencia: itens[0].sequencia, qtdSeparada: itens[0].qtd, status: "ok" }),
  ]);

  const r = await painel(await entrarComo("coord"));
  const dados = r.json();
  assert.ok(Date.parse(dados.agora), "manda a hora do servidor (a tela calcula o 'há X min' com ela)");

  const p = dados.pedidos.find((x) => x.id === "PV-10422");
  assert.equal(p.status, "andamento");
  assert.equal(p.separador, usuario("sep").login);
  assert.equal(p.itens, itens.length);
  assert.equal(p.itens_feitos, 1);
  assert.equal(dados.pedidos[0].status, "andamento", "em andamento vem primeiro");

  const s = dados.separadores.find((x) => x.login === usuario("sep").login);
  assert.equal(s.nome, usuario("sep").nome);
  assert.ok(s.ultimo_contato);
  assert.ok(s.ultima_acao);
  assert.ok(dados.separadores.find((x) => x.login === "separador2"), "lista todos os separadores ativos");
  assert.ok(!dados.separadores.find((x) => x.login === usuario("coord").login), "só separadores");
});

test("conflito entra em 'não aplicadas' até o coordenador marcar visto", async () => {
  const sep2 = await entrar("separador2", USERS.find((u) => u.login === "separador2").pin);
  const tentativa = acao("separacao.iniciar", { pedido: "PV-10422" }); // o PV-10422 já está com o separador
  assert.equal((await sincronizar(sep2, [tentativa])).json().recusadas[0].resultado, "conflito");

  const coord = await entrarComo("coord");
  const lista = (await painel(coord)).json().naoAplicadas;
  const x = lista.find((a) => a.id === tentativa.id);
  assert.equal(x.pedido, "PV-10422");
  assert.equal(x.login, "separador2");
  assert.equal(x.nome, "Segundo Separador");
  assert.equal(x.resultado, "conflito");
  assert.match(x.motivo, /JÁ ESTÁ COM/);

  // o separador não pode marcar visto
  const naoPode = await app.inject({ method: "POST", url: `/api/painel/nao-aplicadas/${tentativa.id}/vista`, headers: { authorization: `Bearer ${sep2}` } });
  assert.equal(naoPode.statusCode, 403);

  const ok = await app.inject({ method: "POST", url: `/api/painel/nao-aplicadas/${tentativa.id}/vista`, headers: { authorization: `Bearer ${coord}` } });
  assert.equal(ok.statusCode, 200);
  assert.ok(!(await painel(coord)).json().naoAplicadas.find((a) => a.id === tentativa.id), "saiu da lista");
  const gravada = (await pool.query("SELECT vista_em, vista_por FROM acoes_recebidas WHERE id = $1", [tentativa.id])).rows[0];
  assert.ok(gravada.vista_em);
  assert.equal(gravada.vista_por, usuario("coord").login);

  // de novo, ou um ID que não existe: 404
  const deNovo = await app.inject({ method: "POST", url: `/api/painel/nao-aplicadas/${tentativa.id}/vista`, headers: { authorization: `Bearer ${coord}` } });
  assert.equal(deNovo.statusCode, 404);
});

test("o canal de tempo real avisa a Gestão do contato e das ações", async () => {
  const avisos = [];
  const original = app.tempoReal.avisar;
  app.tempoReal.avisar = (evento, dados) => { avisos.push({ evento, dados }); original(evento, dados); };
  try {
    const sep = await entrarComo("sep");
    await sincronizar(sep, []);
    // o login avisa a tela de Dispositivos; o batimento avisa o contato
    assert.deepEqual(avisos.map((a) => a.evento), ["dispositivos", "contato"]);
    assert.equal(avisos[1].dados.login, usuario("sep").login);
  } finally {
    app.tempoReal.avisar = original;
  }
});
