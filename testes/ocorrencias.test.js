// Regras das ocorrências do pedido: corte, cancelamento e devolução (compartilhado/regras/ocorrencias.js)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  etapaDoPedido, bloqueioDaOcorrencia, validarOcorrencia, validarCorte, aplicarCorte, faltaTirar, faltaPostar,
  devolucaoPendente, lerDevolucao, validarDocaDevolucao,
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

test("nova quantidade: inteiro, de zero até menos do que o pedido", () => {
  const item = { sku: "176", qtd: 20 };
  assert.equal(validarCorte(item, 0), null);
  assert.equal(validarCorte(item, 19), null);
  assert.match(validarCorte(item, 20), /menor que 20/);
  assert.match(validarCorte(item, -1), /inteiro/);
  assert.match(validarCorte(item, 2.5), /inteiro/);
  assert.match(validarCorte(item, ""), /inteiro/);
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
