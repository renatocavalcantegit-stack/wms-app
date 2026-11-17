// Separação: doca de expedição, lote (vários pedidos numa viagem) e pedido dividido entre separadores.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validarDocaExpedicao, MSG_NAO_E_DOCA_EXPEDICAO, compararAtendimento, validarLote, posicoesDoLote, montarParadas, paradaConcluida,
  destinoDaLeitura, distribuirAchado, validarDivisao, sugerirDivisao, validarPartes, ruasDaParte, partesCompletas, juntarPartes,
} from "../compartilhado/regras/separacao.js";
import { MSG_ENDERECO_INATIVO, MSG_ENDERECO_NAO_ENCONTRADO } from "../compartilhado/regras/enderecos.js";

const it = (sku, end, qtd, extra = {}) => ({ sku, end, qtd, sep: 0, status: "pendente", ...extra });
const ped = (id, prio, hora, itens, extra = {}) => ({ id, prio, hora, status: "pendente", itens, ...extra });

test("doca de expedição: só endereço ativo do tipo expedição", () => {
  assert.equal(validarDocaExpedicao({ ativo: true, tipo: "expedicao" }), null);
  assert.equal(validarDocaExpedicao({ ativo: true, tipo: "doca" }), MSG_NAO_E_DOCA_EXPEDICAO); // doca de recebimento não vale
  assert.equal(validarDocaExpedicao({ ativo: false, tipo: "expedicao" }), MSG_ENDERECO_INATIVO);
  assert.equal(validarDocaExpedicao(null), MSG_ENDERECO_NAO_ENCONTRADO);
});

test("lote: 2 a 6 pedidos, só os que não começaram; prioridade fica na posição A", () => {
  const a = ped("PV-1", "normal", "07:00", []), b = ped("PV-2", "alta", "08:00", []), c = ped("PV-3", "normal", "06:00", []);
  assert.match(validarLote([a]), /pelo menos 2/);
  assert.match(validarLote([a, b, c, a, b, c, a]), /no máximo 6/);
  assert.match(validarLote([a, { ...b, status: "andamento" }]), /PV-2/);
  assert.match(validarLote([a, { ...b, parte: { pai: "PV-9", n: 1, de: 2 } }]), /PV-2/);
  assert.equal(validarLote([a, b, c]), null);
  assert.deepEqual(posicoesDoLote([a, b, c]), { "PV-2": "A", "PV-3": "B", "PV-1": "C" });
  assert.equal([a, b, c].sort(compararAtendimento)[0].id, "PV-2");
});

test("paradas: ordem do endereço, mesmo produto no mesmo endereço vira uma parada só", () => {
  const a = ped("PV-1", "normal", "07:00", [it("176", "R3001-P2-A100-AP101", 5), it("122", "R3001-P1-A100-AP102", 3)]);
  const b = ped("PV-2", "alta", "08:00", [it("176", "R3001-P2-A100-AP101", 7), it("536", "R3001-P10-A100-AP101", 1)]);
  const pos = posicoesDoLote([a, b]);
  const ps = montarParadas([a, b], pos);
  assert.deepEqual(ps.map((p) => p.sku), ["122", "176", "536"]); // P1 < P2 < P10
  assert.equal(ps[1].total, 12);
  assert.deepEqual(ps[1].linhas.map((l) => `${l.pos}:${l.pedido}:${l.qtd}`), ["A:PV-2:7", "B:PV-1:5"]);
  assert.equal(destinoDaLeitura(ps[1]).pos, "A");
  ps[1].linhas[0].sep = 7;
  assert.equal(destinoDaLeitura(ps[1]).pos, "B");
  assert.equal(paradaConcluida(ps[1]), false);
});

test("falta no lote: o achado vai primeiro para a posição A", () => {
  const linhas = [{ pedido: "PV-2", idx: 0, qtd: 7 }, { pedido: "PV-1", idx: 0, qtd: 5 }];
  assert.deepEqual(distribuirAchado(linhas, 9), [{ pedido: "PV-2", idx: 0, sep: 7, falta: false }, { pedido: "PV-1", idx: 0, sep: 2, falta: true }]);
  assert.deepEqual(distribuirAchado(linhas, 0).map((x) => x.sep), [0, 0]);
});

test("divisão: 2 a 4 partes, só antes de começar, fora de lote", () => {
  const p = ped("PV-9", "normal", "07:00", [it("a", "R3001-P1-A100-AP101", 1), it("b", "R3001-P1-A100-AP102", 1), it("c", "R3001-P1-A100-AP103", 1)]);
  assert.equal(validarDivisao(p, 2), null);
  assert.match(validarDivisao(p, 5), /2 a 4/);
  assert.match(validarDivisao(p, 4), /3 item/);
  assert.match(validarDivisao({ ...p, lote: "L-1" }, 2), /LOTE/);
  assert.match(validarDivisao({ ...p, iniciado: true }, 2), /ANTES DE INICIAR/);
});

test("sugestão de divisão: blocos de endereços seguidos, unidades equilibradas, toda parte com item", () => {
  const itens = [
    it("d", "R3003-P1-A100-AP101", 10), it("a", "R3001-P1-A100-AP101", 10), it("c", "R3002-P1-A100-AP101", 10), it("b", "R3001-P5-A100-AP101", 10),
  ];
  const g = sugerirDivisao(itens, 2);
  assert.deepEqual(g, [[1, 3], [2, 0]]); // 3001 (a, b) | 3002 e 3003 (c, d)
  assert.equal(validarPartes(itens, g), null);
  assert.equal(ruasDaParte(itens, g[1]), "Rua 3002–3003");
  // muito peso no começo: ainda assim cada parte fica com pelo menos 1 item
  const pesado = [it("a", "R3001-P1-A100-AP101", 100), it("b", "R3001-P1-A100-AP102", 1), it("c", "R3001-P1-A100-AP103", 1)];
  assert.deepEqual(sugerirDivisao(pesado, 3), [[0], [1], [2]]);
  assert.match(validarPartes(itens, [[0, 1, 2, 3], []]), /pelo menos 1/);
  assert.match(validarPartes(itens, [[0, 1], [1, 2, 3]]), /exatamente/);
});

test("junção das partes: só com todas concluídas; vira um pedido com as docas de cada parte", () => {
  const p1 = { id: "PV-9-1", prio: "normal", parte: { pai: "PV-9", n: 1, de: 2 }, status: "concluido", operador: "Ana", doca: { codigo: "R9002-P1-A100-AP101" }, fim: 100, inicio: 10,
    itens: [it("b", "R3002-P1-A100-AP101", 2)] };
  const p2 = { id: "PV-9-2", prio: "normal", parte: { pai: "PV-9", n: 2, de: 2 }, status: "andamento", operador: "Bruno", doca: null, fim: null, inicio: 20,
    itens: [it("a", "R3001-P1-A100-AP101", 3)] };
  assert.equal(partesCompletas([p1, p2]), false);
  assert.equal(partesCompletas([p1]), false);
  Object.assign(p2, { status: "concluido", doca: { codigo: "R9002-P1-A100-AP102" }, fim: 200 });
  assert.equal(partesCompletas([p2, p1]), true);
  const j = juntarPartes([p2, p1]);
  assert.equal(j.id, "PV-9");
  assert.deepEqual(j.itens.map((i) => i.sku), ["a", "b"]);
  assert.equal(j.operador, "Ana + Bruno");
  assert.deepEqual(j.partes.map((x) => x.doca.codigo), ["R9002-P1-A100-AP101", "R9002-P1-A100-AP102"]);
  assert.equal(j.fim, 200); assert.equal(j.inicio, 10); assert.equal(j.parte, null);
});

test("rótulo das ruas da parte: ordem numérica e rua 0 conta", () => {
  const itens = [it("a", "R1000-P0-A100-AP101", 1), it("b", "R802-P1-A100-AP101", 1), it("c", "R0-P0-A100-AP101", 1)];
  assert.equal(ruasDaParte(itens, [0, 1]), "Rua 802–1000");
  assert.equal(ruasDaParte(itens, [0, 1, 2]), "Rua 0–1000");
  assert.equal(ruasDaParte(itens, [2]), "Rua 0");
});
