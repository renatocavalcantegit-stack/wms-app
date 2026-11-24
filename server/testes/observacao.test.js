// v76: observação do pedido no servidor. O texto do vendedor vem do Sankhya (pedidos.observacao_pedido);
// separador e conferente respondem pela fila (ação "observacao.ciente") e as respostas voltam junto com o pedido.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prepararBancoDeTeste } from "./banco-de-teste.js";
import { criarServidor } from "../src/servidor.js";
import { USERS } from "../../js/sessao.js";
import { MSG_SEM_OBSERVACAO, MSG_RESPOSTA_INVALIDA, MSG_PERFIL_SEM_OBSERVACAO } from "../../compartilhado/regras/observacao.js";

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
const get = async (login, url) => (await app.inject({ url, headers: { authorization: `Bearer ${await entrar(login)}` } })).json();
let relogio = Date.now() - 3_600_000;
const ciente = (pedido, momento, resposta) =>
  ({ id: randomUUID(), tipo: "observacao.ciente", dados: { pedido, momento, resposta }, feitaEm: new Date((relogio += 1000)).toISOString() });
const sincronizar = async (login, acoes) =>
  (await app.inject({ method: "POST", url: "/api/sincronizar", headers: { authorization: `Bearer ${await entrar(login)}` }, payload: { acoes } })).json();

test("o pedido traz a observação do Sankhya; o quadro marca quem tem", async () => {
  const p = await get("coordenador", "/api/pedidos/PV-10421");
  assert.match(p.observacao_pedido, /\S/);
  assert.deepEqual(p.ciencias, []);
  const q = await get("coordenador", "/api/quadro/separacao?setor=exp");
  assert.equal(q.pedidos.find((x) => x.id === "PV-10427").tem_observacao, true);
  assert.equal(q.pedidos.find((x) => x.id === "PV-10428").tem_observacao, false);
  const v = await get("coordenador", "/api/pedidos/PV-10424");
  assert.deepEqual(v.observacao_para, ["embarque"]);
});

test("separador numa parte do dividido: a resposta fica no pedido original, com a parte", async () => {
  const r = await sincronizar("separador", [ciente("PV-10426/1", "inicio", "li"), ciente("PV-10426/1", "fim", "nao_era")]);
  assert.deepEqual(r.recusadas, []);
  const lista = (await get("separador", "/api/separacao?setor=exp")).pedidos;
  const parte = lista.find((x) => x.id === "PV-10426/1");
  assert.ok(parte, "a parte está na lista do separador");
  assert.deepEqual(parte.ciencias.map((c) => [c.parte, c.login, c.papel, c.momento, c.resposta]), [
    ["PV-10426/1", "separador", "separador", "inicio", "li"],
    ["PV-10426/1", "separador", "separador", "fim", "nao_era"],
  ]);
  assert.ok(parte.ciencias[0].nome);
  // respondeu de novo: vale a última
  await sincronizar("separador", [ciente("PV-10426/1", "fim", "apliquei")]);
  const { rows } = await pool.query("SELECT momento, resposta FROM observacao_ciencias WHERE pedido = 'PV-10426' ORDER BY momento");
  assert.deepEqual(rows.map((x) => [x.momento, x.resposta]), [["fim", "apliquei"], ["inicio", "li"]]);
});

test("conferente: a resposta aparece na lista do posto e no quadro da conferência", async () => {
  const r = await sincronizar("conferente", [ciente("PV-10401", "inicio", "li")]);
  assert.deepEqual(r.recusadas, []);
  const c = (await get("conferente", "/api/conferencia?setor=exp")).pedidos.find((x) => x.pedido === "PV-10401");
  assert.match(c.observacao_pedido, /pedais/);
  assert.deepEqual(c.ciencias.map((x) => [x.papel, x.momento, x.resposta]), [["conferente", "inicio", "li"]]);
  const q = await get("coordenador", "/api/quadro/conferencia?setor=exp");
  const k = q.pedidos.find((x) => x.pedido === "PV-10401");
  assert.equal(k.ciencias.length, 1);
});

test("recusada: pedido sem observação, resposta fora do momento e perfil sem observação", async () => {
  const r = await sincronizar("separador", [
    ciente("PV-10428", "inicio", "li"),
    ciente("PV-10421", "inicio", "apliquei"),
    ciente("PV-10421", "meio", "li"),
    ciente("PV-99999", "inicio", "li"),
  ]);
  assert.deepEqual(r.recusadas.map((x) => x.motivo), [MSG_SEM_OBSERVACAO, MSG_RESPOSTA_INVALIDA, MSG_RESPOSTA_INVALIDA, "PEDIDO PV-99999 NÃO ENCONTRADO."]);
  const g = await sincronizar("coordenador", [ciente("PV-10421", "inicio", "li")]);
  assert.deepEqual(g.recusadas.map((x) => x.motivo), [MSG_PERFIL_SEM_OBSERVACAO]);
  const { rows } = await pool.query("SELECT count(*)::int AS n FROM observacao_ciencias WHERE pedido IN ('PV-10421', 'PV-10428')");
  assert.equal(rows[0].n, 0);
});
