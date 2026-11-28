// Recebimento: status da nota, conferência (soma e bloqueio do excedente), volumes e armazenamento.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resumoDoItem, statusDaNota, validarDoca, quantidadeEmUnidades, pendenteDeConferir, validarConferencia,
  codigoDoVolume, pendentesPorData, pendenteNaDoca, validarArmazenamento, distribuirArmazenamento, separarNotasImportadas,
  MSG_NOTA_FINALIZADA, MSG_PRODUTO_FORA_DA_NOTA, MSG_NAO_E_DOCA, MSG_SALDO_ORIGEM, MSG_ACIMA_DO_PENDENTE, MSG_DESTINO_IGUAL,
  MSG_NOTA_JA_IMPORTADA, MAXIMO_VOLUMES,
} from "../compartilhado/regras/recebimento.js";
import { MSG_ENDERECO_INATIVO, MSG_ENDERECO_NAO_ENCONTRADO } from "../compartilhado/regras/enderecos.js";

const nota = (extra = {}) => ({ id: 1, numero: "48213", fornecedor: { codigo: 8558, nome: "Pedal Sul" }, finalizada: false,
  itens: [{ produto: "PN-29-225", qtd: 40 }, { produto: "CM-29-PRESTA", qtd: 100 }], ...extra });
const conf = (id, produto, qtd, extra = {}) => ({ id, notaId: 1, produto, qtd, docaId: 9, dia: "2026-11-16", armazenado: 0, cancelado: 0, volumes: ["V1"], ...extra });

test("status: aguardando → em aberto → conferida; divergência só depois de finalizar", () => {
  assert.deepEqual(statusDaNota(nota(), []), { conferencia: "aguardando", divergencia: null, armazenamento: "pendente" });
  const cs = [conf(1, "PN-29-225", 24)];
  assert.deepEqual(statusDaNota(nota(), cs), { conferencia: "aberta", divergencia: null, armazenamento: "pendente" });
  assert.equal(statusDaNota(nota({ finalizada: true }), cs).divergencia, "com"); // faltou conferir
  const tudo = [conf(1, "PN-29-225", 40), conf(2, "CM-29-PRESTA", 100)];
  assert.equal(statusDaNota(nota({ finalizada: true }), tudo).divergencia, "sem");
});

test("status do armazenamento: pendente, parcial e armazenado (independente da conferência)", () => {
  assert.equal(statusDaNota(nota(), [conf(1, "PN-29-225", 40, { armazenado: 10 })]).armazenamento, "parcial");
  assert.equal(statusDaNota(nota(), [conf(1, "PN-29-225", 40, { armazenado: 40 })]).armazenamento, "armazenado");
  // o que o gestor cancelou deixa de ser pendente (o saldo continua na doca)
  assert.equal(statusDaNota(nota(), [conf(1, "PN-29-225", 40, { armazenado: 30, cancelado: 10 })]).armazenamento, "armazenado");
});

test("resumo do item: nota, conferido, divergência, armazenado, pendente e volumes", () => {
  const cs = [conf(1, "PN-29-225", 24, { armazenado: 12, volumes: ["V1", "V2"] }), conf(2, "PN-29-225", 6), conf(3, "CM-29-PRESTA", 50)];
  assert.deepEqual(resumoDoItem(nota(), nota().itens[0], cs),
    { produto: "PN-29-225", qtdNota: 40, conferido: 30, divergencia: -10, armazenado: 12, pendenteArmazenar: 18, volumes: 3 });
});

test("doca: tem que existir, estar ativa e ser do tipo doca", () => {
  assert.equal(validarDoca(null), MSG_ENDERECO_NAO_ENCONTRADO);
  assert.equal(validarDoca({ ativo: false, tipo: "doca" }), MSG_ENDERECO_INATIVO);
  assert.equal(validarDoca({ ativo: true, tipo: "picking" }), MSG_NAO_E_DOCA);
  assert.equal(validarDoca({ ativo: true, tipo: "doca" }), null);
});

test("conferência: bipar a caixa conta a quantidade dela; cada confirmação soma e o excedente é bloqueado", () => {
  assert.equal(quantidadeEmUnidades({ qtd: 50 }, 2), 100);
  assert.equal(quantidadeEmUnidades(null, 7), 7); // achou pelo código interno: conta em unidades
  const cs = [conf(1, "PN-29-225", 24)];
  assert.equal(pendenteDeConferir(nota(), "PN-29-225", cs), 16);
  assert.equal(validarConferencia(nota(), { produto: "PN-29-225", qtd: 16, volumes: 1 }, cs), null);
  assert.equal(validarConferencia(nota(), { produto: "PN-29-225", qtd: 17, volumes: 1 }, cs), "QUANTIDADE ACIMA DO PENDENTE DA NOTA. PENDENTE: 16.");
  assert.equal(validarConferencia(nota(), { produto: "GF-SQ-750", qtd: 1, volumes: 1 }, cs), MSG_PRODUTO_FORA_DA_NOTA);
  assert.equal(validarConferencia(nota({ finalizada: true }), { produto: "PN-29-225", qtd: 1, volumes: 1 }, cs), MSG_NOTA_FINALIZADA);
  assert.match(validarConferencia(nota(), { produto: "PN-29-225", qtd: 0, volumes: 1 }, cs), /quantidade/);
  assert.equal(validarConferencia(nota(), { produto: "PN-29-225", qtd: 2, volumes: 0 }, cs), null); // v79: por produto, sem volume
  assert.equal(validarConferencia(nota(), { produto: "PN-29-225", qtd: 2 }, cs), null);
  assert.match(validarConferencia(nota(), { produto: "PN-29-225", qtd: 2, volumes: -1 }, cs), /volumes/);
  assert.match(validarConferencia(nota(), { produto: "PN-29-225", qtd: 2, volumes: MAXIMO_VOLUMES + 1 }, cs), /máximo/);
});

test("volume: código único com 6 dígitos", () => {
  assert.equal(codigoDoVolume(1), "V000001");
  assert.equal(codigoDoVolume(123456), "V123456");
});

test("armazenamento: pendentes por data, agrupados por produto mesmo de notas diferentes", () => {
  const cs = [
    conf(1, "PN-29-225", 40, { dia: "2026-11-16", armazenado: 10 }),
    conf(2, "PN-29-225", 12, { notaId: 2, dia: "2026-11-16" }),
    conf(3, "CM-29-PRESTA", 50, { dia: "2026-11-15" }),
    conf(4, "GF-SQ-750", 24, { dia: "2026-11-15", armazenado: 24 }), // já armazenado: some da lista
  ];
  assert.deepEqual(pendentesPorData(cs), [
    { dia: "2026-11-15", produtos: [{ produto: "CM-29-PRESTA", pendente: 50 }] },
    { dia: "2026-11-16", produtos: [{ produto: "PN-29-225", pendente: 42 }] },
  ]);
  assert.equal(pendenteNaDoca(cs, "PN-29-225", 9), 42);
  assert.equal(pendenteNaDoca(cs, "PN-29-225", 10), 0);
});

test("armazenamento: bloqueia acima do saldo da origem, acima do pendente, destino inativo e a própria doca", () => {
  const destino = { id: 5, ativo: true };
  const base = { qtd: 10, saldoOrigem: 20, pendente: 15, origemId: 9, destino };
  assert.equal(validarArmazenamento(base), null);
  assert.equal(validarArmazenamento({ ...base, qtd: 21 }), MSG_SALDO_ORIGEM);
  assert.equal(validarArmazenamento({ ...base, qtd: 16 }), MSG_ACIMA_DO_PENDENTE);
  assert.equal(validarArmazenamento({ ...base, destino: null }), MSG_ENDERECO_NAO_ENCONTRADO);
  assert.equal(validarArmazenamento({ ...base, destino: { id: 5, ativo: false } }), MSG_ENDERECO_INATIVO);
  assert.equal(validarArmazenamento({ ...base, destino: { id: 9, ativo: true } }), MSG_DESTINO_IGUAL);
});

test("armazenamento: a quantidade é abatida das conferências mais antigas primeiro", () => {
  const cs = [conf(2, "PN-29-225", 12, { dia: "2026-11-16" }), conf(1, "PN-29-225", 10, { dia: "2026-11-15", armazenado: 4 })];
  assert.deepEqual(distribuirArmazenamento(cs, 10), [{ id: 1, qtd: 6 }, { id: 2, qtd: 4 }]);
});

test("notas do ERP: a mesma nota (número + fornecedor) não entra duas vezes", () => {
  const r = separarNotasImportadas([nota()], [nota({ id: 9 }), nota({ id: 10, numero: "50000" })]);
  assert.equal(r.importadas.length, 1);
  assert.deepEqual(r.bloqueadas.map((b) => b.msg), [MSG_NOTA_JA_IMPORTADA]);
});

test("quantidade quebrada no recebimento: conferência, pendente e armazenamento", () => {
  const n = nota({ itens: [{ produto: "RAIO", qtd: 101.5 }] });
  const cs = [conf(1, "RAIO", 0.1), conf(2, "RAIO", 0.2)];
  assert.equal(pendenteDeConferir(n, "RAIO", cs), 101.2);
  assert.equal(validarConferencia(n, { produto: "RAIO", qtd: "101,2", volumes: 1 }, cs), null);
  assert.equal(validarConferencia(n, { produto: "RAIO", qtd: "101,21", volumes: 1 }, cs), "QUANTIDADE ACIMA DO PENDENTE DA NOTA. PENDENTE: 101,2.");
  assert.match(validarConferencia(n, { produto: "RAIO", qtd: 1, volumes: 1.5 }, cs), /volumes/); // volumes continuam inteiros
  assert.equal(resumoDoItem(n, n.itens[0], cs).conferido, 0.3);
  assert.equal(pendenteNaDoca(cs, "RAIO", 9), 0.3);
  assert.deepEqual(distribuirArmazenamento(cs, "0,25"), [{ id: 1, qtd: 0.1 }, { id: 2, qtd: 0.15 }]);
  const destino = { id: 5, ativo: true };
  assert.equal(validarArmazenamento({ qtd: "0,3", saldoOrigem: 0.3, pendente: 0.3, origemId: 9, destino }), null);
  assert.equal(validarArmazenamento({ qtd: "0,31", saldoOrigem: 0.3, pendente: 1, origemId: 9, destino }), MSG_SALDO_ORIGEM);
});
