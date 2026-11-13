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
  assert.equal(carregarPedidos("exp").length, 5);
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
  localStorage.setItem("wms-bb-sep-v1", "{corrompido");
  assert.equal(carregarPedidos("exp").length, 5);
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
