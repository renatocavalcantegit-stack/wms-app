// Fila do conferente no quadro da Conferência (v67): travas e andamento.
import { test } from "node:test";
import assert from "node:assert/strict";
import { travaParaMoverConferencia, travaParaPular, andamentoDaConferencia } from "../compartilhado/regras/fila-do-conferente.js";

test("mover: só o que ninguém começou a conferir", () => {
  assert.equal(travaParaMoverConferencia({ pedido: "PV-1", status: "aguardando" }, "conferente"), null);
  assert.match(travaParaMoverConferencia({ pedido: "PV-1", status: "andamento" }, null), /já está em conferência/);
  assert.match(travaParaMoverConferencia({ pedido: "PV-1", status: "conferido" }, null), /já foi conferido/);
  assert.match(travaParaMoverConferencia(null, null), /não encontrado/);
});

test("pular conferência: só na Montagem e antes de começar", () => {
  assert.equal(travaParaPular({ pedido: "OP-1", status: "aguardando" }, "mont"), null);
  assert.match(travaParaPular({ pedido: "PV-1", status: "aguardando" }, "exp"), /Só a Montagem/);
  assert.match(travaParaPular({ pedido: "OP-1", status: "andamento" }, "mont"), /já está em conferência/);
  assert.match(travaParaPular({ pedido: "OP-1", status: "dispensada" }, "mont"), /entregue à montagem/);
});

test("andamento: por produto, somando as partes; excesso não passa de 100%", () => {
  const itens = [{ produto: "A", qtd_separada: 2 }, { produto: "A", qtd_separada: "3.000" }, { produto: "B", qtd_separada: 5 }];
  assert.deepEqual(andamentoDaConferencia(itens), { itens: 2, itensFeitos: 0, unidades: 10, unidadesFeitas: 0, pc: 0 });
  const r = andamentoDaConferencia(itens, [{ produto: "A", qtd: "5" }, { produto: "B", qtd: 9 }, { produto: "Z", qtd: 1, fora: true }]);
  assert.deepEqual(r, { itens: 2, itensFeitos: 1, unidades: 10, unidadesFeitas: 10, pc: 100 });
});
