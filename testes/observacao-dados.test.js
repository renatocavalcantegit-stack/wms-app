// Observação do pedido nos dados (js/dados/observacao.js): a resposta fica no aparelho, vale sem rede
// e soma com a que o servidor devolve junto com o pedido.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { limparArmazenamento } from "./armazenamento-falso.js";
import { registrarCiencia, cienciasDoPedido, precisaLer, apagarCiencias } from "../js/dados/observacao.js";

beforeEach(limparArmazenamento);
const sep = { login: "separador", papel: "separador" };
const pedido = { id: "PV-1", obsPedido: "Embalar com papelão.", obsPara: null };

test("separador: pede no início e no fim até responder; respondeu sem rede, não pergunta de novo", () => {
  assert.equal(precisaLer(pedido, { ...sep, momento: "inicio" }), true);
  registrarCiencia({ pedido: "PV-1", ...sep, nome: "Davi", momento: "inicio", resposta: "li" });
  assert.equal(precisaLer(pedido, { ...sep, momento: "inicio" }), false);
  assert.equal(precisaLer(pedido, { ...sep, momento: "fim" }), true);
  assert.equal(precisaLer(pedido, { login: "separador2", papel: "separador", momento: "inicio" }), true, "outra pessoa ainda lê");
  // respondeu de novo: vale a última
  registrarCiencia({ pedido: "PV-1", ...sep, nome: "Davi", momento: "inicio", resposta: "li" });
  assert.equal(cienciasDoPedido("PV-1").length, 1);
});

test("sem texto ou sem marcação para o papel: não pede", () => {
  assert.equal(precisaLer({ id: "PV-2", obsPedido: "  " }, { ...sep, momento: "inicio" }), false);
  const soEmbarque = { ...pedido, obsPara: ["embarque"] };
  assert.equal(precisaLer(soEmbarque, { ...sep, momento: "inicio" }), false);
  assert.equal(precisaLer(soEmbarque, { login: "embarque", papel: "embarque", momento: "fim" }), true);
  assert.equal(precisaLer(pedido, { login: "embarque", papel: "embarque", momento: "inicio" }), false, "padrão: embarque não");
});

test("parte do dividido: guarda no pedido original e cada parte responde à parte", () => {
  const p1 = { id: "PV-9/1", parte: { pai: "PV-9" }, obsPedido: "Pneus em pares." };
  const p2 = { id: "PV-9/2", parte: { pai: "PV-9" }, obsPedido: "Pneus em pares." };
  registrarCiencia({ pedido: "PV-9", parte: "PV-9/1", ...sep, nome: "Davi", momento: "inicio", resposta: "li" });
  assert.equal(precisaLer(p1, { ...sep, momento: "inicio" }), false);
  assert.equal(precisaLer(p2, { ...sep, momento: "inicio" }), true);
  assert.equal(cienciasDoPedido("PV-9")[0].parte, "PV-9/1");
});

test("as do servidor somam com as do aparelho, sem repetir", () => {
  const doServidor = [{ parte: null, login: "separador", nome: "Davi", papel: "separador", momento: "inicio", resposta: "li", feita_em: "2026-11-24T10:00:00Z" }];
  assert.equal(precisaLer({ ...pedido, ciencias: doServidor }, { ...sep, momento: "inicio" }), false);
  registrarCiencia({ pedido: "PV-1", ...sep, nome: "Davi", momento: "inicio", resposta: "li" });
  registrarCiencia({ pedido: "PV-1", ...sep, nome: "Davi", momento: "fim", resposta: "nao_era" });
  assert.deepEqual(cienciasDoPedido("PV-1", doServidor).map((c) => c.momento), ["inicio", "fim"]);
  apagarCiencias();
  assert.deepEqual(cienciasDoPedido("PV-1"), []);
});
