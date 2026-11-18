// Camada de dados da Separação e da Conferência (hoje gravando no armazenamento do aparelho).
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { limparArmazenamento } from "./armazenamento-falso.js";
import { carregarPedidos, salvarPedidos, lerPedidosSalvos, pedidosDeDemonstracao } from "../js/dados/separacao.js";
import { carregarConferencia, salvarConferencia, lerPedidosDaConferencia, lerPosto, salvarPosto } from "../js/dados/conferencia.js";

beforeEach(limparArmazenamento);

// um pedido da separação já concluído, pronto para ir para a conferência
const pedidoSeparado = (fim) => {
  const [o] = pedidosDeDemonstracao("exp");
  o.itens.forEach((i) => Object.assign(i, { sep: i.qtd, status: "ok" }));
  return Object.assign(o, { status: "concluido", fim });
};

test("separação: no primeiro acesso começa com os pedidos de demonstração do setor", () => {
  assert.equal(carregarPedidos("exp").length, 9); // 7 pedidos + 2 partes do pedido dividido
  const mont = carregarPedidos("mont");
  assert.equal(mont.length, 4);
  assert.ok(mont.every((o) => o.id.startsWith("OP-")));
  assert.deepEqual(lerPedidosSalvos("exp"), []); // nada foi gravado ainda
});

test("separação: o que foi salvo é o que volta, e cada setor tem a sua fila", () => {
  const pedidos = carregarPedidos("exp");
  pedidos[0].status = "andamento";
  salvarPedidos("exp", pedidos);
  assert.equal(carregarPedidos("exp")[0].status, "andamento");
  assert.equal(carregarPedidos("mont")[0].status, "pendente");
});

test("separação: dado corrompido no aparelho volta para a demonstração em vez de travar", () => {
  localStorage.setItem("wms-bb-sep-v7", "{corrompido");
  assert.equal(carregarPedidos("exp").length, 9);
});

test("conferência: no primeiro acesso começa com os pedidos de demonstração, prontos para conferir", () => {
  const { orders } = carregarConferencia("exp");
  assert.equal(orders.length, 4);
  for (const o of orders) {
    assert.equal(o.conf.status, "aguardando");
    assert.ok(Object.values(o.conf.itens).every((n) => n === 0));
  }
});

test("conferência: pedido concluído na separação entra no topo da fila", () => {
  salvarPedidos("exp", [pedidoSeparado(1000)]);
  const { orders } = carregarConferencia("exp");
  assert.equal(orders.length, 5);
  assert.equal(orders[0].id, "PV-10421");
  assert.equal(orders[0].conf.status, "aguardando");
});

test("conferência: pedido ainda em separação não entra", () => {
  const [o] = pedidosDeDemonstracao("exp");
  salvarPedidos("exp", [Object.assign(o, { status: "andamento" })]);
  assert.equal(carregarConferencia("exp").orders.length, 4);
});

test("conferência: o mesmo pedido não entra duas vezes; se foi separado de novo, é substituído", () => {
  salvarPedidos("exp", [pedidoSeparado(1000)]);
  const db = carregarConferencia("exp");
  db.orders[0].conf.status = "andamento";
  salvarConferencia("exp", db);

  // mesma separação: mantém o que a conferência já fez
  let { orders } = carregarConferencia("exp");
  assert.equal(orders.length, 5);
  assert.equal(orders[0].conf.status, "andamento");

  // separado de novo (outro horário de fim): volta a aguardar conferência, no mesmo lugar
  salvarPedidos("exp", [pedidoSeparado(2000)]);
  ({ orders } = carregarConferencia("exp"));
  assert.equal(orders.length, 5);
  assert.equal(orders[0].conf.status, "aguardando");
});

test("conferência: Expedição e Montagem não se misturam", () => {
  salvarPedidos("exp", [pedidoSeparado(1000)]);
  assert.ok(carregarConferencia("mont").orders.every((o) => o.id.startsWith("OP-")));
});

test("conferência: o Embarque só enxerga o que foi gravado", () => {
  assert.deepEqual(lerPedidosDaConferencia("exp"), []);
  salvarConferencia("exp", carregarConferencia("exp"));
  assert.equal(lerPedidosDaConferencia("exp").length, 4);
});

test("posto de conferência: padrão 01 e lembra o escolhido", () => {
  assert.equal(lerPosto(), "01");
  salvarPosto("03");
  assert.equal(lerPosto(), "03");
});

// ---------- lista do servidor (Fase 1d) ----------
import { baixarDoServidor, pedidoDoServidor } from "../js/dados/separacao.js";

const doBanco = {
  id: "PV-1", cliente: "Loja", cidade: "Sobral · CE", prioridade: "alta", chegada: "2026-11-18T12:10:00Z", status: "concluido",
  separador: "ana", separador_nome: "Ana Lima", inicio: "2026-11-18T13:00:00Z", fim: "2026-11-18T13:20:00Z",
  doca: "R9002-P1-A100-AP101", doca_id: 608008, lote: "L-1", posicao_lote: "B",
  pedido_pai: null, parte_numero: null, partes_total: null, parte_ruas: null, dividido_por: null,
  itens: [{ sequencia: 1, produto: "176", descricao: "BICICLETA ARO 29", un: "UN", checkout: true, endereco_codigo: "R501-P2-A0-AP2",
    qtd: 2.5, qtd_separada: 2.5, status: "ok", motivo: "", codigos_de_barras: ["789A", "789B"] }],
};

test("servidor → coletor: o pedido do banco vira o formato que a tela já usa", () => {
  const o = pedidoDoServidor(doBanco);
  assert.equal(o.prio, "alta");
  assert.match(o.hora, /^\d\d:\d\d$/);
  assert.equal(o.operador, "Ana Lima");
  assert.equal(o.separadorLogin, "ana");
  assert.equal(o.inicio, Date.parse(doBanco.inicio));
  assert.deepEqual(o.doca, { id: 608008, codigo: "R9002-P1-A100-AP101", quando: Date.parse(doBanco.fim), por: "Ana Lima" });
  assert.deepEqual([o.lote, o.pos, o.parte], ["L-1", "B", null]);
  const [i] = o.itens;
  assert.deepEqual([i.sku, i.ean, i.eans, i.end, i.qtd, i.sep, i.status, i.tipo], ["176", "789A", ["789A", "789B"], "R501-P2-A0-AP2", 2.5, 2.5, "ok", "bike"]);
  const parte = pedidoDoServidor({ ...doBanco, pedido_pai: "PV-9", parte_numero: 1, partes_total: 2, parte_ruas: "R501", dividido_por: "coordenador" });
  assert.deepEqual(parte.parte, { pai: "PV-9", n: 1, de: 2, ruas: "R501", por: "coordenador" });
});

test("baixar do servidor: com o token; sem rede e sessão vencida não quebram", async () => {
  let chamada;
  const ok = await baixarDoServidor({ token: "t1" }, "exp", async (url, op) => {
    chamada = { url, op };
    return { ok: true, status: 200, json: async () => ({ agora: "x", pedidos: [doBanco] }) };
  });
  assert.equal(chamada.url, "api/separacao?setor=exp");
  assert.equal(chamada.op.headers.authorization, "Bearer t1");
  assert.equal(ok.pedidos[0].id, "PV-1");
  assert.deepEqual(await baixarDoServidor({ token: "t" }, "exp", async () => { throw new TypeError("rede"); }), { ok: false, erro: "sem-rede" });
  assert.deepEqual(await baixarDoServidor({ token: "t" }, "exp", async () => ({ ok: false, status: 401 })), { ok: false, erro: "sessao-vencida" });
});
