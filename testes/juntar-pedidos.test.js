// Junção da lista do coletor com a do servidor (Fase 1d).
import { test } from "node:test";
import assert from "node:assert/strict";
import { juntarComServidor, lotesDosPedidos, statusDoLote, comOutroSeparador } from "../compartilhado/regras/juntar-pedidos.js";

const ped = (id, extra = {}) => ({ id, status: "pendente", inicio: null, fim: null, operador: null, lote: null, pos: null, itens: [], ...extra });

test("sem nada na fila: vale o servidor (o concluído por outro aparelho aparece concluído)", () => {
  const locais = [ped("PV-1"), ped("PV-2")];
  const doServidor = [ped("PV-1", { status: "concluido", fim: 5 }), ped("PV-2")];
  const { pedidos } = juntarComServidor({ locais, doServidor });
  assert.equal(pedidos.find((o) => o.id === "PV-1").status, "concluido");
});

test("com ação na fila: fica a versão do aparelho (o feito sem rede não se perde)", () => {
  const meu = ped("PV-1", { status: "andamento", itens: [{ status: "ok" }] });
  const { pedidos } = juntarComServidor({ locais: [meu], doServidor: [ped("PV-1")], comFila: new Set(["PV-1"]) });
  assert.equal(pedidos[0], meu);
});

test("vale o servidor, mas o andamento de tela do aparelho fica (em que item parou, endereço e produto)", () => {
  const locais = [ped("PV-1", { status: "andamento", atual: 3, endOk: "R1", prodOk: "R1|176" })];
  const doServidor = [ped("PV-1", { status: "andamento", operador: "Ana" })];
  const [o] = juntarComServidor({ locais, doServidor }).pedidos;
  assert.deepEqual([o.atual, o.endOk, o.prodOk, o.operador], [3, "R1", "R1|176", "Ana"]);
});

test("só no aparelho: sai, a não ser que tenha ação na fila", () => {
  const locais = [ped("PV-VELHO"), ped("PV-OFFLINE")];
  const { pedidos } = juntarComServidor({ locais, doServidor: [ped("PV-1")], comFila: new Set(["PV-OFFLINE"]) });
  assert.deepEqual(pedidos.map((o) => o.id), ["PV-1", "PV-OFFLINE"]);
});

test("pedido novo no servidor entra na lista, na ordem do servidor", () => {
  const { pedidos } = juntarComServidor({ locais: [ped("PV-2")], doServidor: [ped("PV-3"), ped("PV-2")] });
  assert.deepEqual(pedidos.map((o) => o.id), ["PV-3", "PV-2"]);
});

test("lotes saem dos pedidos: caixas, status e quem montou", () => {
  const ps = [
    ped("PV-5", { lote: "L-1", pos: "B" }),
    ped("PV-4", { lote: "L-1", pos: "A" }),
    ped("PV-6"),
  ];
  const [l] = lotesDosPedidos(ps);
  assert.equal(l.id, "L-1");
  assert.deepEqual(l.pedidos, ["PV-4", "PV-5"]);
  assert.deepEqual(l.posicoes, { "PV-4": "A", "PV-5": "B" });
  assert.equal(l.status, "pendente");
  assert.equal(l.criadoPor.tipo, "coordenador");
  assert.equal(l.atual, 0);
});

test("lote do aparelho: guarda quem montou e a parada em que parou; com pedido na fila, fica inteiro do aparelho", () => {
  const meuLote = { id: "L-K3F9", pedidos: ["PV-1", "PV-2"], posicoes: { "PV-1": "A", "PV-2": "B" }, status: "andamento",
    criadoPor: { tipo: "separador", login: "ana", nome: "Ana" }, criado: 1, atual: 4, endOk: "R1" };
  const doServidor = [ped("PV-1", { lote: "L-K3F9", pos: "A", status: "andamento", inicio: 10 }), ped("PV-2", { lote: "L-K3F9", pos: "B", status: "andamento", inicio: 10 })];
  const locais = doServidor.map((o) => ({ ...o }));

  const semFila = juntarComServidor({ locais, lotesLocais: [meuLote], doServidor }).lotes[0];
  assert.notEqual(semFila, meuLote);
  assert.deepEqual([semFila.criadoPor.tipo, semFila.atual, semFila.endOk, semFila.inicio], ["separador", 4, "R1", 10]);

  const comFila = juntarComServidor({ locais, lotesLocais: [meuLote], doServidor, comFila: new Set(["PV-2"]) }).lotes[0];
  assert.equal(comFila, meuLote);
});

test("status do lote", () => {
  assert.equal(statusDoLote([ped("a"), ped("b")]), "pendente");
  assert.equal(statusDoLote([ped("a", { status: "andamento" }), ped("b")]), "andamento");
  assert.equal(statusDoLote([ped("a", { status: "concluido" }), ped("b")]), "andamento");
  assert.equal(statusDoLote([ped("a", { status: "concluido" }), ped("b", { status: "concluido" })]), "concluido");
});

test("com outro separador: só em andamento e com o login de outra pessoa", () => {
  assert.equal(comOutroSeparador(ped("a", { status: "andamento", separadorLogin: "bia" }), "ana"), true);
  assert.equal(comOutroSeparador(ped("a", { status: "andamento", separadorLogin: "ana" }), "ana"), false);
  assert.equal(comOutroSeparador(ped("a", { status: "andamento" }), "ana"), false, "começado neste aparelho");
  assert.equal(comOutroSeparador(ped("a", { status: "concluido", separadorLogin: "bia" }), "ana"), false, "concluído pode separar novamente");
});

test("conferência: com ação na fila fica a do posto; senão a do servidor, com o histórico se as contagens batem", async () => {
  const { juntarConferencia } = await import("../compartilhado/regras/juntar-pedidos.js");
  const ped = (id, conf) => ({ id, conf: { status: "andamento", itens: { a: 1 }, fora: [], log: [], ...conf } });
  const local = [ped("P1", { itens: { a: 2 }, log: [{ sku: "a", q: 1 }] }), ped("P2", { log: [{ sku: "a", q: 1 }] }), ped("P3", {}), ped("P9", {})];
  const servidor = [ped("P1", {}), ped("P2", {}), ped("P3", { itens: { a: 5 } }), ped("P4", {})];
  const r = juntarConferencia({ locais: local, doServidor: servidor, comFila: new Set(["P1", "P9"]) });
  assert.deepEqual(r.map((o) => o.id), ["P1", "P2", "P3", "P4", "P9"]);
  assert.equal(r[0].conf.itens.a, 2);             // P1: na fila, a do posto
  assert.notEqual(r[0], local[0]); // …mas o pedido é o do servidor (v72: parte nova entra)
  assert.deepEqual(r[1].conf.log, [{ sku: "a", q: 1 }]); // P2: mesmas contagens, fica o histórico
  assert.equal(r[2].conf.itens.a, 5);             // P3: mudou por fora, a do servidor
});
