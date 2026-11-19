// Fase 2 (v67): o quadro da Conferência na Gestão. O coordenador distribui os pedidos separados entre os
// conferentes; em conferência não muda de fila; na Montagem, "Pular conferência" entrega direto à montagem.
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

const pin = (login) => USERS.find((u) => u.login === login).pin;
const tokens = {};
async function entrar(login) {
  tokens[login] ||= (await app.inject({ method: "POST", url: "/api/login", payload: { login, pin: pin(login) } })).json().token;
  return tokens[login];
}
const chamar = async (login, method, url, payload) =>
  app.inject({ method, url, payload, headers: { authorization: `Bearer ${await entrar(login)}` } });
const quadro = async (setor = "exp", login = setor === "mont" ? "montagem" : "coordenador") =>
  (await chamar(login, "GET", `/api/quadro/conferencia?setor=${setor}`)).json();
const mover = (pedido, para, ordem = [], setor = "exp") =>
  chamar(setor === "mont" ? "montagem" : "coordenador", "POST", "/api/quadro/conferencia/mover", { setor, pedido, para, ordem });
const conf = async (id) => (await pool.query("SELECT status, designado_para, ordem_fila FROM conferencias WHERE pedido = $1", [id])).rows[0];
const sincronizar = async (login, acoes) =>
  (await chamar(login, "POST", "/api/sincronizar", { acoes: acoes.map(([tipo, dados]) => ({ id: randomUUID(), tipo, dados, feitaEm: new Date().toISOString() })) })).json();

test("o quadro traz a caixa de entrada, as filas e os conferentes; só o coordenador do setor vê", async () => {
  const q = await quadro();
  const ids = (f) => q.pedidos.filter(f).map((p) => p.pedido);
  assert.deepEqual(ids((p) => !p.designado_para), ["PV-10404"]);
  assert.deepEqual(ids((p) => p.designado_para === "conferente"), ["PV-10401", "PV-10402"]);
  assert.deepEqual(q.conferentes.map((c) => c.login).sort(), ["conferente", "conferente2"]);
  const p = q.pedidos.find((x) => x.pedido === "PV-10401");
  assert.ok(p.andamento.itens > 0 && p.andamento.unidades > 0);
  assert.equal(p.andamento.pc, 0);
  assert.equal((await chamar("montagem", "GET", "/api/quadro/conferencia?setor=exp")).statusCode, 403);
  assert.equal((await chamar("conferente", "GET", "/api/quadro/conferencia?setor=exp")).statusCode, 403);
});

test("mover: da caixa para o conferente, na ordem que ficou na tela; de volta para a caixa", async () => {
  assert.equal((await mover("PV-10404", "conferente", ["PV-10404", "PV-10401", "PV-10402"])).statusCode, 200);
  assert.deepEqual(await conf("PV-10404"), { status: "aguardando", designado_para: "conferente", ordem_fila: 1 });
  assert.equal((await conf("PV-10401")).ordem_fila, 2);
  // o posto da Ana mostra na mesma ordem
  const posto = (await chamar("conferente", "GET", "/api/conferencia?setor=exp")).json().pedidos.map((x) => x.pedido);
  assert.deepEqual(posto, ["PV-10404", "PV-10401", "PV-10402"]);
  assert.equal((await mover("PV-10404", null)).statusCode, 200);
  assert.equal((await conf("PV-10404")).designado_para, null);
  assert.equal((await mover("PV-10404", "separador")).statusCode, 404); // não é conferente
});

test("em conferência não muda de fila; o andamento aparece no quadro", async () => {
  const q = await quadro();
  const p = q.pedidos.find((x) => x.pedido === "PV-10403");
  const [primeiro] = p.itens;
  const r = await sincronizar("conferente2", [
    ["conferencia.iniciar", { pedido: "PV-10403" }],
    ["conferencia.contagem", { pedido: "PV-10403", produto: primeiro.produto, qtd: primeiro.qtd_separada }],
  ]);
  assert.deepEqual(r.recusadas, []);
  const m = await mover("PV-10403", "conferente");
  assert.equal(m.statusCode, 409);
  assert.match(m.json().erro, /já está em conferência/);
  const vivo = (await quadro()).pedidos.find((x) => x.pedido === "PV-10403");
  assert.equal(vivo.status, "andamento");
  assert.ok(vivo.andamento.itensFeitos >= 1 && vivo.andamento.pc > 0);
});

test("Montagem: pular conferência entrega à montagem; o posto que estava com o pedido é avisado", async () => {
  // a expedição não pode pular
  assert.equal((await chamar("coordenador", "POST", "/api/quadro/conferencia/pular", { setor: "exp", pedidos: ["PV-10404"] })).statusCode, 409);
  const r = await chamar("montagem", "POST", "/api/quadro/conferencia/pular", { setor: "mont", pedidos: ["OP-3209", "OP-3208"] });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.json().feitos, ["OP-3209", "OP-3208"]);
  assert.equal((await conf("OP-3208")).status, "dispensada");
  // aparece nos entregues à montagem de hoje; sai da fila do posto
  const q = await quadro("mont");
  assert.equal(q.pedidos.find((x) => x.pedido === "OP-3209").status, "dispensada");
  assert.ok(!(await chamar("conferente", "GET", "/api/conferencia?setor=mont")).json().pedidos.some((x) => x.pedido === "OP-3208"));
  // o posto tenta iniciar sem saber (estava sem rede): recusado com o aviso do coordenador
  const s = await sincronizar("conferente", [["conferencia.iniciar", { pedido: "OP-3208" }]]);
  assert.match(s.recusadas[0].motivo, /^O COORDENADOR DISPENSOU/);
  // já entregue: não pula de novo, nem muda de fila
  assert.equal((await chamar("montagem", "POST", "/api/quadro/conferencia/pular", { setor: "mont", pedidos: ["OP-3209"] })).statusCode, 409);
  assert.equal((await mover("OP-3209", "conferente", [], "mont")).statusCode, 409);
});
