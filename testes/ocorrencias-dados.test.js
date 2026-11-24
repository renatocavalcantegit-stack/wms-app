// Ocorrências do pedido nos dados: corte e cancelamento atravessando Separação, Conferência e Embarque,
// devolução na doca de devolução e a divergência de saldo da separação (js/dados/…)
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { limparArmazenamento } from "./armazenamento-falso.js";
import { carregarPedidos, salvarPedidos } from "../js/dados/separacao.js";
import { carregarConferencia, salvarConferencia } from "../js/dados/conferencia.js";
import { abrirPedido, registrarOcorrencia, lerOcorrencias, confirmarNaSeparacao, devolverNaConferencia, marcarEntregue } from "../js/dados/ocorrencias.js";
import { registrarDevolucao, baixarPorSeparacao } from "../js/dados/movimentacao.js";
import { inventariarDivergencia, encerrarDivergencia } from "../js/dados/inventario.js";
import { lerEstoque, saldoNoEndereco } from "../js/dados/estoque.js";
import { pendenteNaDoca } from "../compartilhado/regras/recebimento.js";
import { MSG_SEM_REFERENCIA, MSG_EM_CARREGAMENTO, MSG_PEDIDO_CANCELADO } from "../compartilhado/regras/ocorrencias.js";

beforeEach(limparArmazenamento);
const ok = { motivo: "desistencia", referencia: "ALT-1", usuario: "Gestor" };

// marca o pedido como separado por completo (como se o separador tivesse terminado)
function separarTudo(id) {
  const ps = carregarPedidos("exp");
  const o = ps.find((x) => x.id === id);
  o.itens.forEach((i) => Object.assign(i, { sep: i.qtd, status: "ok" }));
  Object.assign(o, { status: "concluido", fim: Date.now(), doca: { id: 608008, codigo: "R9002-P1-A100-AP101" } });
  salvarPedidos("exp", ps);
}

test("corte antes de separar só diminui; cancelar sem nada separado tira o pedido da separação", () => {
  assert.equal(abrirPedido("exp", "pv-10422").etapa, "aguardando-separacao");
  assert.equal(registrarOcorrencia("exp", "PV-10422", { ...ok, referencia: " ", tipo: "corte", cortes: { 1797: 20 } }).msg, MSG_SEM_REFERENCIA);
  const r = registrarOcorrencia("exp", "PV-10422", { ...ok, tipo: "corte", cortes: { 1797: 20, 3243: "" } });
  assert.equal(r.ok, true);
  const i = carregarPedidos("exp").find((o) => o.id === "PV-10422").itens.find((x) => x.sku === "1797");
  assert.deepEqual([i.qtd, i.devolver, i.status], [20, 0, "pendente"]);
  assert.deepEqual(lerOcorrencias("exp")[0].itens, [{ sku: "1797", desc: i.desc, de: 50, para: 20, devolver: 0 }]);

  assert.equal(registrarOcorrencia("exp", "PV-10422", { ...ok, tipo: "cancelamento" }).ok, true);
  const o = carregarPedidos("exp").find((x) => x.id === "PV-10422");
  assert.equal(o.status, "cancelado");
  assert.ok(o.itens.every((x) => x.qtd === 0 && x.status === "cortado"));
  assert.equal(abrirPedido("exp", "PV-10422").bloqueio, MSG_PEDIDO_CANCELADO);
  assert.equal(lerOcorrencias("exp").length, 2);
});

// as entradas de devolução que o estoque recebe (como notas)
const devolucoes = () => lerEstoque().notas.filter((n) => n.tipo === "Devolução");

test("separado aguardando conferência: o conferente tira da caixa (F9); nada nasce antes disso", () => {
  separarTudo("PV-10421");
  assert.equal(abrirPedido("exp", "PV-10421").etapa, "aguardando-conferencia");
  const r = registrarOcorrencia("exp", "PV-10421", { ...ok, tipo: "corte", cortes: { 176: 12 } });
  assert.deepEqual(r.ocorrencia.avisar, ["conferente"]);
  const c = carregarConferencia("exp").orders.find((o) => o.id === "PV-10421");
  const i = c.itens.find((x) => x.sku === "176");
  assert.deepEqual([c.conf.status, i.qtd, i.sep, i.devolver], ["aguardando", 12, 12, 8]);
  const s = carregarPedidos("exp").find((o) => o.id === "PV-10421").itens.find((x) => x.sku === "176");
  assert.deepEqual([s.qtd, s.sep, s.devolver, s.qtdPedida], [12, 20, 8, 20]);
  // o histórico guarda o antes e o depois
  assert.deepEqual(lerOcorrencias("exp")[0].itens.map((i) => [i.de, i.para, i.devolver]), [[20, 12, 8]]);
  assert.deepEqual([devolucoes(), lerOcorrencias("exp")[0].entradas], [[], []]);
  devolverNaConferencia("exp", "PV-10421", [{ produto: "176", qtd: 8 }], "Diego");
  assert.deepEqual(devolucoes().map((d) => [d.numero, d.fornecedor.nome]), [["PV-10421", "Entregue por Diego"]]);
  // o histórico do corte passa a mostrar a DEV e quem entregou
  assert.deepEqual(lerOcorrencias("exp")[0].entregas, [{ numero: "PV-10421", aguardando: false, quem: "Diego" }]);
});

test("em separação: fica a devolver até o separador confirmar no coletor", () => {
  const ps = carregarPedidos("exp");
  const o = ps.find((x) => x.id === "PV-10421");
  Object.assign(o, { status: "andamento", operador: "Davi" });
  Object.assign(o.itens[0], { sep: o.itens[0].qtd, status: "ok" });
  salvarPedidos("exp", ps);
  const sku = o.itens[0].sku, total = o.itens[0].qtd, pendente = o.itens[1];
  assert.equal(registrarOcorrencia("exp", "PV-10421", { ...ok, tipo: "corte", cortes: { [sku]: total - 2, [pendente.sku]: 0 } }).ok, true);
  let x = carregarPedidos("exp").find((y) => y.id === "PV-10421");
  assert.equal(x.ocorrenciaPendente, true);
  assert.deepEqual([x.itens[0].qtd, x.itens[0].sep, x.itens[0].devolver], [total - 2, total, 2]);
  assert.deepEqual([x.itens[1].qtd, x.itens[1].status], [0, "cortado"]);
  assert.equal(devolucoes().length, 0); // ainda está na caixa do separador
  const { nota } = confirmarNaSeparacao(x, "Davi");
  assert.deepEqual([x.itens[0].sep, x.itens[0].devolver, x.ocorrenciaPendente], [total - 2, 0, false]);
  assert.deepEqual([nota.numero, nota.fornecedor.nome, nota.itens], ["PV-10421", "Entregue por Davi", [{ produto: sku, qtd: 2 }]]);
  assert.deepEqual(lerOcorrencias("exp")[0].entregas, [{ numero: "PV-10421", aguardando: false, quem: "Davi" }]);
});

test("em conferência: o conferente tira bipando e entrega; a cópia da conferência continua certa", () => {
  separarTudo("PV-10421");
  let db = carregarConferencia("exp");
  Object.assign(db.orders.find((o) => o.id === "PV-10421").conf, { status: "andamento", conferente: "Diego" });
  salvarConferencia("exp", db);
  registrarOcorrencia("exp", "PV-10421", { ...ok, tipo: "corte", cortes: { 176: 12 } });
  let c = carregarConferencia("exp").orders.find((o) => o.id === "PV-10421").itens.find((x) => x.sku === "176");
  assert.deepEqual([c.qtd, c.sep, c.devolver], [12, 12, 8]);
  assert.equal(devolucoes().length, 0);
  devolverNaConferencia("exp", "PV-10421", [{ produto: "176", qtd: 8 }], "Diego");
  const s = carregarPedidos("exp").find((o) => o.id === "PV-10421").itens.find((x) => x.sku === "176");
  assert.deepEqual([s.sep, s.devolver], [12, 0]);
  assert.equal(devolucoes()[0].fornecedor.nome, "Entregue por Diego");
});

test("pedido conferido: reaberto para o conferente tirar (F9) e refazer volumes; cancelado espera o conferente entregar", () => {
  separarTudo("PV-10421");
  const db = carregarConferencia("exp");
  Object.assign(db.orders.find((o) => o.id === "PV-10421").conf, { status: "conferido", conferente: "Diego", volumes: 2 });
  salvarConferencia("exp", db);
  assert.equal(abrirPedido("exp", "PV-10421").etapa, "conferido");
  registrarOcorrencia("exp", "PV-10421", { ...ok, tipo: "corte", cortes: { 122: 25 } });
  let c = carregarConferencia("exp").orders.find((o) => o.id === "PV-10421");
  assert.deepEqual([c.conf.status, c.conf.reaberto.referencia, c.conf.volumes], ["aguardando", "ALT-1", null]);
  assert.equal(c.itens.find((i) => i.sku === "122").devolver, 5);
  assert.ok(c.itens.every((i) => (c.conf.itens[i.sku] || 0) <= i.sep)); // a contagem não passa do que ficou na caixa
  assert.equal(devolucoes().length, 0); // só quando o conferente tirar

  const r = registrarOcorrencia("exp", "PV-10421", { ...ok, tipo: "cancelamento" });
  c = carregarConferencia("exp").orders.find((o) => o.id === "PV-10421");
  assert.equal(c.conf.status, "cancelado");
  assert.ok(c.cancelado);
  assert.ok(c.itens.every((i) => i.qtd === 0 && i.sep === 0 && i.devolver === 0));
  assert.equal(carregarPedidos("exp").find((o) => o.id === "PV-10421").status, "cancelado");
  // tudo o que estava na caixa (inclusive os 5 do corte, que ainda não tinham saído) espera o conferente
  assert.equal(c.conf.entregar.numero, "PV-10421");
  assert.equal(c.conf.entregar.itens.find((i) => i.sku === "122").qtd, 30);
  assert.deepEqual(r.ocorrencia.entregas, [{ numero: "PV-10421", aguardando: true, quem: "Diego" }]);
  assert.equal(devolucoes().length, 0); // o estoque ainda não vê
  const nota = marcarEntregue(c.conf.entregar, "Diego");
  assert.deepEqual([nota.numero, nota.fornecedor.nome], ["PV-10421", "Entregue por Diego"]);
  assert.equal(marcarEntregue(c.conf.entregar, "Diego"), null); // o mesmo toque duas vezes não duplica
  assert.deepEqual(lerOcorrencias("exp")[0].entregas, [{ numero: "PV-10421", aguardando: false, quem: "Diego" }]);
});

test("cancelado com o separador no meio: a devolução espera ele marcar a entrega", () => {
  const ps = carregarPedidos("exp");
  const o = ps.find((x) => x.id === "PV-10421");
  Object.assign(o, { status: "andamento", operador: "Davi" });
  Object.assign(o.itens[0], { sep: o.itens[0].qtd, status: "ok" });
  salvarPedidos("exp", ps);
  registrarOcorrencia("exp", "PV-10421", { ...ok, tipo: "cancelamento" });
  const x = carregarPedidos("exp").find((y) => y.id === "PV-10421");
  assert.equal(x.status, "cancelado");
  assert.deepEqual(x.entregar.itens.map((i) => [i.sku, i.qtd]), [[o.itens[0].sku, o.itens[0].qtd]]);
  assert.equal(devolucoes().length, 0);
  marcarEntregue(x.entregar, "Davi");
  assert.equal(x.entregar.entregue.por, "Davi");
  assert.equal(devolucoes()[0].fornecedor.nome, "Entregue por Davi");
});

test("pedido com volume bipado no caminhão não aceita ocorrência; cancelado sai da carga", () => {
  localStorage.setItem("wms-bb-emb-v2", JSON.stringify([{ id: "CG-1", pedidos: [{ id: "PV-10421", lidos: [1] }, { id: "PV-10423", lidos: [] }] }]));
  assert.equal(abrirPedido("exp", "PV-10421").bloqueio, MSG_EM_CARREGAMENTO);
  assert.equal(registrarOcorrencia("exp", "PV-10421", { ...ok, tipo: "cancelamento" }).msg, MSG_EM_CARREGAMENTO);
  assert.equal(registrarOcorrencia("exp", "PV-10423", { ...ok, tipo: "cancelamento" }).ok, true);
  assert.deepEqual(JSON.parse(localStorage.getItem("wms-bb-emb-v2"))[0].pedidos.map((p) => p.id), ["PV-10421"]);
});

test("devolução entra na doca de devolução e fica pendente de armazenar", () => {
  const doca = lerEstoque().enderecos.find((e) => e.tipo === "devolucao");
  assert.ok(doca, "a demonstração tem uma doca de devolução");
  assert.equal(registrarDevolucao({ pedido: "PV-1", itens: [{ produto: "176", qtd: 8 }], docaId: 608008 }).ok, false);
  assert.equal(registrarDevolucao({ pedido: "PV-1", itens: [{ produto: "176", qtd: 8 }, { produto: "122", qtd: 0 }], docaId: doca.id, usuario: "conf" }).ok, true);
  const db = lerEstoque();
  assert.equal(saldoNoEndereco(db, doca.id, "176"), 8);
  assert.equal(pendenteNaDoca(db.conferencias, "176", doca.id), 8);
  assert.equal(db.movimentos.at(-1).tipo, "devolucao");
  assert.equal(saldoNoEndereco(db, doca.id, "122"), 0);
});

test("separação confirmando mais do que o sistema tem: saldo para em zero e nasce a divergência", () => {
  const e = lerEstoque().enderecos.find((x) => x.codigo === "R501-P2-A0-AP2" && x.ativo); // 176 tem 4 aqui
  baixarPorSeparacao({ endereco: e.codigo, produto: "176", qtd: 20, usuario: "sep", pedido: "PV-10421" });
  let db = lerEstoque();
  assert.equal(saldoNoEndereco(db, e.id, "176"), 0);
  const d = db.divergencias[0];
  assert.deepEqual([d.sistema, d.separado, d.diferenca, d.status, d.pedido], [4, 20, 16, "aberta", "PV-10421"]);
  // com saldo suficiente, nada de divergência
  baixarPorSeparacao({ endereco: "R602-P2-A6-AP601", produto: "122", qtd: 10, pedido: "PV-10421" });
  assert.equal(lerEstoque().divergencias.length, 1);
  const r = inventariarDivergencia(d.id, "Gestor");
  assert.equal(r.ok, true);
  db = lerEstoque();
  assert.deepEqual([db.divergencias[0].status, db.divergencias[0].inventario], ["inventario", r.inventario.id]);
  assert.deepEqual(r.inventario.itens.map((i) => [i.enderecoId, i.produto]), [[e.id, "176"]]);
  assert.equal(encerrarDivergencia(d.id, "Gestor").ok, false); // já tratada
});
