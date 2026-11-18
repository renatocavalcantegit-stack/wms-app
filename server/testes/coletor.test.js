// Fase 1d: a lista do coletor vem do servidor (GET /api/separacao?setor=exp).
// Todos os aparelhos veem a mesma coisa: quem está com cada pedido, o que já foi feito e o que foi concluído hoje.
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

const sep = USERS.find((u) => u.perfil === "sep");
const entrar = async () => (await app.inject({ method: "POST", url: "/api/login", payload: { login: sep.login, pin: sep.pin } })).json().token;
const lista = (token, setor = "exp") =>
  app.inject({ method: "GET", url: `/api/separacao?setor=${setor}`, headers: token ? { authorization: `Bearer ${token}` } : {} });
let relogio = Date.now() - 60_000;
const acao = (tipo, dados) => ({ id: randomUUID(), tipo, dados, feitaEm: new Date((relogio += 1000)).toISOString() });
const sincronizar = (token, acoes) =>
  app.inject({ method: "POST", url: "/api/sincronizar", headers: { authorization: `Bearer ${token}` }, payload: { acoes } });

test("sem login: 401; setor inválido: 400", async () => {
  assert.equal((await lista(null)).statusCode, 401);
  assert.equal((await lista(await entrar(), "xyz")).statusCode, 400);
});

test("só a fila do separador, na ordem do coordenador, cada pedido com os itens e os códigos de barras", async () => {
  const r = (await lista(await entrar())).json();
  assert.ok(Date.parse(r.agora));
  // a caixa de entrada (PV-10423, PV-10427, PV-10428) e a fila do separador2 (PV-10426/2) não aparecem
  assert.deepEqual(r.pedidos.map((p) => p.id), ["PV-10421", "PV-10422", "PV-10424", "PV-10425", "PV-10426/1"]);
  assert.deepEqual(r.pedidos.map((p) => p.ordem_fila), [1, 2, 3, 3, 4]);
  const p = r.pedidos.find((x) => x.id === "PV-10421");
  assert.deepEqual(p.itens.map((i) => i.sequencia), p.itens.map((_, n) => n + 1));
  assert.ok(p.itens.every((i) => i.descricao && i.endereco_codigo && Array.isArray(i.codigos_de_barras)));
  assert.equal(typeof p.itens[0].qtd, "number");
  // o lote do coordenador vem nos pedidos
  const lote = r.pedidos.filter((x) => x.lote === "L-1").map((x) => `${x.posicao_lote}:${x.id}`).sort();
  assert.deepEqual(lote, ["A:PV-10424", "B:PV-10425"]);
  assert.deepEqual((await lista(await entrar(), "mont")).json().pedidos.map((p) => p.id), ["OP-3212", "OP-3213"]);
});

test("mostra quem está com o pedido e, concluído hoje, continua na lista com a doca", async () => {
  const token = await entrar();
  const itens = (await lista(token)).json().pedidos.find((x) => x.id === "PV-10421").itens;
  await sincronizar(token, [acao("separacao.iniciar", { pedido: "PV-10421" })]);
  let p = (await lista(token)).json().pedidos.find((x) => x.id === "PV-10421");
  assert.equal(p.status, "andamento");
  assert.equal(p.separador, sep.login);
  assert.equal(p.separador_nome, sep.nome);

  await sincronizar(token, [
    ...itens.map((i) => acao("separacao.item", { pedido: "PV-10421", sequencia: i.sequencia, qtdSeparada: i.qtd, status: "ok" })),
    acao("separacao.concluir", { pedido: "PV-10421", doca: "R9002-P1-A100-AP101" }),
  ]);
  p = (await lista(token)).json().pedidos.find((x) => x.id === "PV-10421");
  assert.equal(p.status, "concluido");
  assert.equal(p.doca, "R9002-P1-A100-AP101");
  assert.equal(p.doca_id, 608008);
  assert.ok(p.itens.every((i) => i.status === "ok" && i.qtd_separada === i.qtd));
});
