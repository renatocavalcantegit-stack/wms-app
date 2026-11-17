// Movimentação: mínimo/máximo, escolha das origens no aéreo, passos do abastecimento e transferência.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validarLimite, necessidade, precisaAbastecer, escolherOrigens, tarefaDuplicada, ordenarTarefas, planejadoDaTarefa,
  abastecidoDaTarefa, proximaOrigem, tarefasNoEndereco, validarAbastecimento, statusDepoisDoPasso, quantidadePermitida, validarTransferencia,
  MSG_ORIGEM_FORA_DA_TAREFA, MSG_PRODUTO_DA_TAREFA, MSG_ACIMA_DO_PLANEJADO, MSG_SALDO_ORIGEM, MSG_DESTINO_DA_TAREFA,
  MSG_DESTINO_IGUAL, MSG_SEM_SALDO_NA_ORIGEM, baixadoPorPedido,
} from "../compartilhado/regras/movimentacao.js";
import { MSG_ENDERECO_INATIVO, MSG_ENDERECO_NAO_ENCONTRADO } from "../compartilhado/regras/enderecos.js";

const end = (id, rua, predio, andar, apto, extra = {}) => ({ id, rua, predio, andar, apto, ativo: true, ...extra });
const picking = end(1, 3001, 1, 100, 103, { tipo: "picking" });

test("mínimo e máximo: até 3 casas, mínimo menor que o máximo", () => {
  assert.equal(validarLimite({ minimo: 5, maximo: 20 }), null);
  assert.equal(validarLimite({ minimo: 0, maximo: 1 }), null);
  assert.match(validarLimite({ minimo: 20, maximo: 20 }), /menor/);
  assert.match(validarLimite({ minimo: -1, maximo: 20 }), /mínimo/);
  assert.match(validarLimite({ minimo: 2, maximo: 0 }), /máximo/);
  assert.equal(validarLimite({ minimo: 1.5, maximo: 10.25 }), null); // quantidade quebrada vale
  assert.equal(validarLimite({ minimo: "0,5", maximo: "2,5" }), null);
  assert.match(validarLimite({ minimo: 1.2345, maximo: 10 }), /mínimo/);
});

test("necessidade = máximo − saldo; dispara no mínimo ou abaixo", () => {
  assert.equal(necessidade(2, 20), 18);
  assert.equal(necessidade(25, 20), 0);
  assert.equal(precisaAbastecer(5, 5), true);
  assert.equal(precisaAbastecer(6, 5), false);
});

test("origens: menor saldo primeiro, empate pelo mais perto; usa várias e para quando completa", () => {
  const perto = end(10, 3001, 1, 500, 501), longe = end(11, 3002, 4, 500, 501), outra = end(12, 3001, 2, 500, 502);
  const aereos = [{ endereco: longe, saldo: 12 }, { endereco: perto, saldo: 12 }, { endereco: outra, saldo: 6 }];
  assert.deepEqual(escolherOrigens(aereos, 15, picking), [{ enderecoId: 12, qtd: 6 }, { enderecoId: 10, qtd: 9 }]);
  // aéreo insuficiente: usa tudo o que tem
  assert.deepEqual(escolherOrigens(aereos, 100, picking), [{ enderecoId: 12, qtd: 6 }, { enderecoId: 10, qtd: 12 }, { enderecoId: 11, qtd: 12 }]);
  // sem saldo ou inativo não entra
  assert.deepEqual(escolherOrigens([{ endereco: perto, saldo: 0 }, { endereco: { ...outra, ativo: false }, saldo: 9 }], 5, picking), []);
});

test("tarefa duplicada só conta as abertas/em andamento; urgentes primeiro na fila", () => {
  const ts = [{ id: 1, produto: "176", pickingId: 1, status: "concluida", prioridade: "normal" },
    { id: 2, produto: "176", pickingId: 1, status: "andamento", prioridade: "normal" },
    { id: 3, produto: "536", pickingId: 2, status: "aberta", prioridade: "urgente" }];
  assert.equal(tarefaDuplicada(ts, "176", 1), true);
  assert.equal(tarefaDuplicada(ts, "176", 9), false);
  assert.equal(tarefaDuplicada([ts[0]], "176", 1), false);
  assert.deepEqual(ordenarTarefas(ts).map((t) => t.id), [3, 1, 2]);
});

test("passo do abastecimento: origem da tarefa, mesmo produto, até o planejado e o saldo, destino = picking", () => {
  const t = { produto: "176", pickingId: 1, origens: [{ enderecoId: 10, qtd: 12, feito: 4 }, { enderecoId: 11, qtd: 6, feito: 0 }] };
  const ok = { origemId: 10, produto: "176", qtd: 8, destino: picking, saldoOrigem: 50 };
  assert.equal(validarAbastecimento(t, ok), null);
  assert.equal(validarAbastecimento(t, { ...ok, origemId: 99 }), MSG_ORIGEM_FORA_DA_TAREFA);
  assert.equal(validarAbastecimento(t, { ...ok, produto: "536" }), MSG_PRODUTO_DA_TAREFA);
  assert.equal(validarAbastecimento(t, { ...ok, qtd: 9 }), MSG_ACIMA_DO_PLANEJADO);
  assert.equal(validarAbastecimento(t, { ...ok, saldoOrigem: 5 }), MSG_SALDO_ORIGEM);
  assert.equal(validarAbastecimento(t, { ...ok, destino: end(2, 3001, 1, 100, 104) }), MSG_DESTINO_DA_TAREFA);
  assert.equal(validarAbastecimento(t, { ...ok, destino: { ...picking, ativo: false } }), MSG_ENDERECO_INATIVO);
  assert.equal(planejadoDaTarefa(t), 18);
  assert.equal(abastecidoDaTarefa(t), 4);
  assert.equal(proximaOrigem(t).enderecoId, 10);
  assert.equal(statusDepoisDoPasso(t), "andamento");
  t.origens.forEach((o) => (o.feito = o.qtd));
  assert.equal(proximaOrigem(t), null);
  assert.equal(statusDepoisDoPasso(t), "concluida");
});

test("transferência: só o saldo disponível, destino ativo e diferente da origem", () => {
  const a = end(1, 3001, 1, 500, 501), b = end(2, 3001, 1, 100, 101);
  assert.equal(quantidadePermitida(30, 20), 20);
  assert.equal(quantidadePermitida(5, 20), 5);
  const ok = { origem: a, destino: b, saldoOrigem: 20, qtd: 5 };
  assert.equal(validarTransferencia(ok), null);
  assert.equal(validarTransferencia({ ...ok, saldoOrigem: 0 }), MSG_SEM_SALDO_NA_ORIGEM);
  assert.equal(validarTransferencia({ ...ok, qtd: 21 }), MSG_SALDO_ORIGEM);
  assert.equal(validarTransferencia({ ...ok, destino: a }), MSG_DESTINO_IGUAL);
  assert.equal(validarTransferencia({ ...ok, destino: { ...b, ativo: false } }), MSG_ENDERECO_INATIVO);
  assert.equal(validarTransferencia({ ...ok, origem: { ...a, ativo: false } }), MSG_ENDERECO_INATIVO);
  assert.equal(validarTransferencia({ ...ok, destino: null }), MSG_ENDERECO_NAO_ENCONTRADO);
  assert.match(validarTransferencia({ ...ok, qtd: 0 }), /quantidade/);
});

test("tarefa pendente bloqueia desativar o picking e a origem que ainda falta retirar", () => {
  const ts = [{ status: "andamento", pickingId: 1, origens: [{ enderecoId: 10, qtd: 5, feito: 5 }, { enderecoId: 11, qtd: 5, feito: 0 }] },
    { status: "concluida", pickingId: 2, origens: [{ enderecoId: 12, qtd: 5, feito: 5 }] }];
  assert.equal(tarefasNoEndereco(ts, 1), 1);
  assert.equal(tarefasNoEndereco(ts, 11), 1);
  assert.equal(tarefasNoEndereco(ts, 10), 0); // origem já retirada
  assert.equal(tarefasNoEndereco(ts, 2), 0); // tarefa encerrada não bloqueia
});

test("estorno da separação: soma o que o pedido baixou por endereço, menos o que já voltou", () => {
  const movs = [
    { tipo: "separacao", pedido: "PV-1", origem: 10, produto: "122", qtd: 10 },
    { tipo: "separacao", pedido: "PV-1", origem: 11, produto: "176", qtd: 4 },
    { tipo: "separacao", pedido: "PV-2", origem: 10, produto: "122", qtd: 7 }, // outro pedido
    { tipo: "abastecimento", origem: 99, destino: 10, produto: "122", qtd: 50 }, // não é da separação
  ];
  assert.deepEqual(baixadoPorPedido(movs, "PV-1"), [{ enderecoId: 10, produto: "122", qtd: 10 }, { enderecoId: 11, produto: "176", qtd: 4 }]);
  // depois do estorno, nada mais a devolver (separar novamente duas vezes não devolve em dobro)
  movs.push({ tipo: "estorno-separacao", pedido: "PV-1", destino: 10, produto: "122", qtd: 10 },
    { tipo: "estorno-separacao", pedido: "PV-1", destino: 11, produto: "176", qtd: 4 });
  assert.deepEqual(baixadoPorPedido(movs, "PV-1"), []);
  assert.deepEqual(baixadoPorPedido([], "PV-1"), []);
});

test("quantidade quebrada no abastecimento: origens, planejado e o passo aceitam valor quebrado", () => {
  const aereos = [{ endereco: end(10, 3001, 2, 100, 101), saldo: 0.7 }, { endereco: end(11, 3001, 3, 100, 101), saldo: 50 }];
  assert.deepEqual(escolherOrigens(aereos, 1, picking), [{ enderecoId: 10, qtd: 0.7 }, { enderecoId: 11, qtd: 0.3 }]);
  const t = { produto: "176", pickingId: 1, origens: [{ enderecoId: 10, qtd: 0.7, feito: 0.1 }, { enderecoId: 11, qtd: 0.3, feito: 0.2 }] };
  assert.equal(planejadoDaTarefa(t), 1);
  assert.equal(abastecidoDaTarefa(t), 0.3);
  const ok = { origemId: 10, produto: "176", qtd: "0,6", destino: picking, saldoOrigem: 0.7 };
  assert.equal(validarAbastecimento(t, ok), null);
  assert.equal(validarAbastecimento(t, { ...ok, qtd: "0,61" }), MSG_ACIMA_DO_PLANEJADO);
  assert.match(validarAbastecimento(t, { ...ok, qtd: "0,0001" }), /quantidade/);
});
