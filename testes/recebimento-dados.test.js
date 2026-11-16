// Camada de dados do Recebimento: conferir põe saldo na doca, armazenar leva para o endereço.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { limparArmazenamento } from "./armazenamento-falso.js";
import { lerEstoque, saldoNoEndereco } from "../js/dados/estoque.js";
import {
  conferir, finalizarNota, armazenar, cancelarPendente, importarNotasDoErp, notaPorNumero, volumesDoItem,
} from "../js/dados/recebimento.js";
import { statusDaNota, resumoDoItem, pendentesPorData, MSG_SALDO_ORIGEM, MSG_NOTA_FINALIZADA, MSG_NAO_E_DOCA, MSG_NOTA_JA_IMPORTADA } from "../compartilhado/regras/recebimento.js";

beforeEach(limparArmazenamento);

const db = () => lerEstoque();
const end = (codigo) => db().enderecos.find((e) => e.codigo === codigo).id;
const DOCA1 = "R9001-P1-A100-AP101", DOCA2 = "R9001-P1-A100-AP102";
const item = (numero, produto) => { const d = db(), n = notaPorNumero(d, numero); return resumoDoItem(n, n.itens.find((i) => i.produto === produto), d.conferencias); };

test("demonstração: notas em todos os status, e o pendente de armazenar está no saldo da doca", () => {
  const d = db();
  const status = (numero) => statusDaNota(notaPorNumero(d, numero), d.conferencias);
  assert.deepEqual(status("48177"), { conferencia: "aguardando", divergencia: null, armazenamento: "pendente" });
  assert.deepEqual(status("48213"), { conferencia: "aberta", divergencia: null, armazenamento: "pendente" });
  assert.deepEqual(status("48190"), { conferencia: "conferida", divergencia: "com", armazenamento: "armazenado" });
  assert.deepEqual(status("48155"), { conferencia: "conferida", divergencia: "sem", armazenamento: "parcial" });
  assert.equal(saldoNoEndereco(d, end(DOCA1), "536"), 24);
  assert.equal(saldoNoEndereco(d, end(DOCA2), "176"), 50);
});

test("conferir: soma, põe o saldo na doca e gera os volumes com códigos únicos", () => {
  const nota = notaPorNumero(db(), "48213");
  const r = conferir({ notaId: nota.id, produto: "536", qtd: 12, volumes: 2, docaId: end(DOCA1) });
  assert.equal(r.ok, true);
  assert.deepEqual(r.volumes.map((v) => [v.seq, v.total]), [[1, 2], [2, 2]]);
  assert.equal(item("48213", "536").conferido, 36);
  assert.equal(saldoNoEndereco(db(), end(DOCA1), "536"), 36);
  assert.equal(volumesDoItem(db(), nota.id, "536").length, 4);
  const codigos = db().volumes.map((v) => v.codigo);
  assert.equal(new Set(codigos).size, codigos.length);
  // passar do pendente (faltam 4) é bloqueado; doca errada também
  assert.match(conferir({ notaId: nota.id, produto: "536", qtd: 5, volumes: 1, docaId: end(DOCA1) }).msg, /PENDENTE: 4/);
  assert.equal(conferir({ notaId: nota.id, produto: "536", qtd: 1, volumes: 1, docaId: end("R3001-P1-A100-AP101") }).msg, MSG_NAO_E_DOCA);
});

test("finalizar: nota não reabre; o que faltou vira divergência", () => {
  const nota = notaPorNumero(db(), "48213");
  assert.equal(finalizarNota(nota.id).ok, true);
  assert.equal(conferir({ notaId: nota.id, produto: "167", qtd: 1, volumes: 1, docaId: end(DOCA1) }).msg, MSG_NOTA_FINALIZADA);
  assert.equal(statusDaNota(notaPorNumero(db(), "48213"), db().conferencias).divergencia, "com");
});

test("armazenar: tira da doca, põe no destino; parcial continua pendente", () => {
  const destino = end("R3002-P4-A100-AP102");
  const antes = saldoNoEndereco(db(), destino, "536");
  assert.equal(armazenar({ produto: "536", docaId: end(DOCA1), qtd: 20, destinoId: destino }).ok, true);
  assert.equal(saldoNoEndereco(db(), end(DOCA1), "536"), 4);
  assert.equal(saldoNoEndereco(db(), destino, "536"), antes + 20);
  assert.equal(item("48213", "536").armazenado, 20);
  assert.ok(pendentesPorData(db().conferencias).some((d) => d.produtos.some((p) => p.produto === "536" && p.pendente === 4)));
  // mais do que tem na doca: mensagem do documento
  assert.equal(armazenar({ produto: "536", docaId: end(DOCA1), qtd: 5, destinoId: destino }).msg, MSG_SALDO_ORIGEM);
  assert.equal(db().movimentos.at(-1).tipo, "armazenamento");
});

test("cancelar pendente (WEB): sai da lista de pendentes, mas o saldo continua na doca", () => {
  const nota = notaPorNumero(db(), "48155");
  cancelarPendente(nota.id, "176");
  assert.equal(item("48155", "176").pendenteArmazenar, 0);
  assert.equal(saldoNoEndereco(db(), end(DOCA2), "176"), 50);
  assert.equal(statusDaNota(notaPorNumero(db(), "48155"), db().conferencias).armazenamento, "armazenado");
});

test("buscar notas do ERP: as novas entram; a repetida é bloqueada", () => {
  const r = importarNotasDoErp();
  assert.deepEqual(r.importadas.map((n) => n.numero), ["48230", "48231"]);
  assert.deepEqual(r.bloqueadas.map((b) => b.msg), [MSG_NOTA_JA_IMPORTADA]);
  assert.equal(statusDaNota(notaPorNumero(db(), "48230"), db().conferencias).conferencia, "aguardando");
});
