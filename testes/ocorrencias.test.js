// Regras das ocorrências do pedido: corte, cancelamento e devolução (compartilhado/regras/ocorrencias.js)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  etapaDoPedido, bloqueioDaOcorrencia, validarOcorrencia, validarCorte, aplicarCorte, faltaTirar, faltaPostar,
  devolucaoPendente, lerDevolucao, validarDocaDevolucao, quemEstaComAParte, planejarOcorrencia, confirmarDevolucaoDaLinha, itensCortados,
  MSG_PEDIDO_CANCELADO, MSG_EM_CARREGAMENTO, MSG_SEM_MOTIVO, MSG_SEM_REFERENCIA, MSG_NADA_A_DEVOLVER, MSG_NAO_E_DOCA_DEVOLUCAO,
} from "../compartilhado/regras/ocorrencias.js";

test("etapa do pedido: da separação até o embarque", () => {
  assert.equal(etapaDoPedido({ partes: [{ status: "pendente" }] }), "aguardando-separacao");
  assert.equal(etapaDoPedido({ partes: [{ status: "andamento" }] }), "separacao");
  // dividido: uma parte pronta e outra não = ainda em separação
  assert.equal(etapaDoPedido({ partes: [{ status: "concluido" }, { status: "pendente" }] }), "separacao");
  assert.equal(etapaDoPedido({ partes: [{ status: "concluido" }] }), "aguardando-conferencia");
  assert.equal(etapaDoPedido({ partes: [{ status: "concluido" }], statusConferencia: "andamento" }), "conferencia");
  assert.equal(etapaDoPedido({ statusConferencia: "divergente" }), "conferido");
  assert.equal(etapaDoPedido({ statusConferencia: "conferido", carregando: true }), "carregamento");
  assert.equal(etapaDoPedido({ partes: [{ status: "cancelado" }] }), "cancelado");
  assert.equal(etapaDoPedido({ statusConferencia: "cancelado" }), "cancelado");
});

test("o gestor age em qualquer etapa, menos cancelado e em carregamento", () => {
  for (const e of ["aguardando-separacao", "separacao", "aguardando-conferencia", "conferencia", "conferido"]) assert.equal(bloqueioDaOcorrencia(e), null);
  assert.equal(bloqueioDaOcorrencia("cancelado"), MSG_PEDIDO_CANCELADO);
  assert.equal(bloqueioDaOcorrencia("carregamento"), MSG_EM_CARREGAMENTO);
});

test("ocorrência exige motivo e referência do Sankhya", () => {
  assert.equal(validarOcorrencia({ motivo: "", referencia: "123" }), MSG_SEM_MOTIVO);
  assert.equal(validarOcorrencia({ motivo: "desistencia", referencia: "  " }), MSG_SEM_REFERENCIA);
  assert.equal(validarOcorrencia({ motivo: "desistencia", referencia: "ALT-88" }), null);
});

test("nova quantidade: de zero (pode ser quebrada) até menos do que o pedido", () => {
  const item = { sku: "176", qtd: 20 };
  assert.equal(validarCorte(item, 0), null);
  assert.equal(validarCorte(item, 19), null);
  assert.match(validarCorte(item, 20), /menor que 20/);
  assert.equal(validarCorte(item, 2.5), null); // quantidade quebrada vale
  assert.equal(validarCorte(item, "19,5"), null);
  assert.match(validarCorte(item, -1), /quantidade/);
  assert.match(validarCorte(item, 1.2345), /quantidade/);
  assert.match(validarCorte(item, ""), /quantidade/);
});

test("corte: o que não foi separado só diminui; o que sobrou na caixa vira a devolver", () => {
  // nada separado ainda: não há o que devolver
  assert.deepEqual(aplicarCorte({ qtd: 20, mantido: 0 }, 5), { qtd: 5, mantido: 0, devolver: 0 });
  // 20 separados, cliente quer 12: 8 saem da caixa
  assert.deepEqual(aplicarCorte({ qtd: 20, mantido: 20 }, 12), { qtd: 12, mantido: 12, devolver: 8 });
  // separou só 6 (faltou), cliente quer 10: os 6 ficam
  assert.deepEqual(aplicarCorte({ qtd: 20, mantido: 6 }, 10), { qtd: 10, mantido: 6, devolver: 0 });
  // segundo corte soma ao que já estava a devolver; cancelamento = corte para zero
  assert.deepEqual(aplicarCorte({ qtd: 12, mantido: 12, devolver: 8 }, 0), { qtd: 0, mantido: 0, devolver: 20 });
});

test("devolução na conferência: tirar da caixa e depois entrar na doca de devolução", () => {
  const item = { sku: "176", devolver: 8 };
  assert.equal(faltaTirar(item, 3), 5);
  assert.equal(faltaTirar(item, 9), 0);
  assert.equal(faltaPostar(5, 2), 3);
  assert.equal(devolucaoPendente([item, { sku: "122" }], { 176: 7 }), true);
  assert.equal(devolucaoPendente([item, { sku: "122" }], { 176: 8 }), false);
  assert.equal(devolucaoPendente([{ sku: "122", devolver: 0 }]), false);
  // bipe: conta no máximo o que falta tirar
  assert.deepEqual(lerDevolucao(item, 6, 5), { ok: true, qtd: 2 });
  assert.deepEqual(lerDevolucao(item, 0, 1), { ok: true, qtd: 1 });
  assert.deepEqual(lerDevolucao(item, 8, 1), { ok: false, msg: MSG_NADA_A_DEVOLVER });
  assert.deepEqual(lerDevolucao(undefined, 0, 1), { ok: false, msg: MSG_NADA_A_DEVOLVER });
});

test("doca de devolução: só endereço ativo do tipo devolução", () => {
  assert.equal(validarDocaDevolucao({ ativo: true, tipo: "devolucao" }), null);
  assert.equal(validarDocaDevolucao({ ativo: false, tipo: "devolucao" }), MSG_NAO_E_DOCA_DEVOLUCAO);
  assert.equal(validarDocaDevolucao({ ativo: true, tipo: "expedicao" }), MSG_NAO_E_DOCA_DEVOLUCAO);
  assert.equal(validarDocaDevolucao(null), MSG_NAO_E_DOCA_DEVOLUCAO);
});

// ---------- quem devolve (v75) ----------
test("quem está com a mercadoria: separador, conferente ou o próprio gestor", () => {
  assert.equal(quemEstaComAParte({ statusSeparacao: "pendente" }), "gestor");
  assert.equal(quemEstaComAParte({ statusSeparacao: "andamento" }), "separador");
  assert.equal(quemEstaComAParte({ statusSeparacao: "concluido", statusConferencia: null }), "gestor");
  assert.equal(quemEstaComAParte({ statusSeparacao: "concluido", statusConferencia: "aguardando" }), "gestor");
  assert.equal(quemEstaComAParte({ statusSeparacao: "concluido", statusConferencia: "andamento" }), "conferente");
  assert.equal(quemEstaComAParte({ statusSeparacao: "concluido", statusConferencia: "conferido" }), "gestor");
});

const linha = (x) => ({ chave: x.sku, devolver: 0, status: "ok", motivo: "", ...x });

test("corte com o gestor: o que sobra na caixa vira entrada na hora; não separado só diminui", () => {
  const r = planejarOcorrencia({ tipo: "corte", novas: { A: 3, B: 0, C: 1 }, linhas: [
    linha({ sku: "A", qtd: 5, sep: 5, quem: "gestor" }),
    linha({ sku: "B", qtd: 2, sep: 0, status: "pendente", quem: "gestor" }),
    linha({ sku: "C", qtd: 4, sep: 2, status: "falta", motivo: "avaria", quem: "gestor" }),
  ] });
  assert.deepEqual(r.linhas, [
    { chave: "A", qtd: 3, sep: 3, devolver: 0, status: "ok", motivo: "" },
    { chave: "B", qtd: 0, sep: 0, devolver: 0, status: "cortado", motivo: "" },
    { chave: "C", qtd: 1, sep: 1, devolver: 0, status: "ok", motivo: "" },
  ]);
  assert.deepEqual(r.devolucoes, { gestor: [{ sku: "A", qtd: 2 }, { sku: "C", qtd: 1 }] });
  assert.deepEqual(r.avisar, []);
  assert.deepEqual(r.resumo.map((x) => [x.sku, x.de, x.para, x.devolver]), [["A", 5, 3, 2], ["B", 2, 0, 0], ["C", 4, 1, 1]]);
});

test("corte com o separador ou o conferente: fica a devolver até ele confirmar", () => {
  const r = planejarOcorrencia({ tipo: "corte", novas: { A: 3, B: 0 }, linhas: [
    linha({ sku: "A", qtd: 5, sep: 5, quem: "separador" }),
    linha({ sku: "B", qtd: 2, sep: 2, quem: "conferente" }),
  ] });
  assert.deepEqual(r.linhas, [
    { chave: "A", qtd: 3, sep: 5, devolver: 2, status: "ok", motivo: "" },
    { chave: "B", qtd: 0, sep: 2, devolver: 2, status: "ok", motivo: "" },
  ]);
  assert.deepEqual(r.devolucoes, {});
  assert.deepEqual(r.avisar.sort(), ["conferente", "separador"]);
  // confirmar: sai da caixa
  assert.deepEqual(confirmarDevolucaoDaLinha({ qtd: 3, sep: 5, devolver: 2, status: "ok" }), { sep: 3, devolver: 0, status: "ok", motivo: "" });
  assert.deepEqual(confirmarDevolucaoDaLinha({ qtd: 0, sep: 2, devolver: 2, status: "ok" }), { sep: 0, devolver: 0, status: "cortado", motivo: "" });
});

test("cancelamento: tudo zera e o que está na caixa vira entrada, entregue por quem está com ela", () => {
  const r = planejarOcorrencia({ tipo: "cancelamento", linhas: [
    linha({ chave: "1/1", sku: "A", qtd: 5, sep: 5, devolver: 1, quem: "separador" }),
    linha({ chave: "1/2", sku: "B", qtd: 2, sep: 0, status: "pendente", quem: "separador" }),
    linha({ chave: "2/1", sku: "C", qtd: 3, sep: 3, quem: "conferente" }),
  ] });
  assert.ok(r.linhas.every((l) => l.qtd === 0 && l.sep === 0 && l.devolver === 0 && l.status === "cortado"));
  assert.deepEqual(r.devolucoes, { separador: [{ sku: "A", qtd: 5 }], conferente: [{ sku: "C", qtd: 3 }] });
});

test("o aviso do separador mostra os itens com menos do que o pedido original", () => {
  assert.deepEqual(itensCortados([{ sku: "A", qtd: 3, qtdPedida: 5 }, { sku: "B", qtd: 2, qtdPedida: 2 }, { sku: "C", qtd: 1 }]).map((i) => i.sku), ["A"]);
});
