// v77: memória do aparelho cheia. Antes, o erro do navegador escapava e podia travar o coletor no meio de um item.
// Agora quem grava recebe false, a tela recebe o aviso e a fila de envio abre espaço apagando a cópia do Estoque
// da demonstração (que não vale nada quando há servidor).
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { limparArmazenamento } from "./armazenamento-falso.js";
import { gravarNoAparelho, aoEncherMemoria, CHAVE_ESTOQUE, EVENTO_MEMORIA_CHEIA } from "../js/dados/armazenamento.js";
import { enfileirar, acoesPendentes } from "../js/dados/fila.js";

// o Node não tem os eventos da janela: um EventTarget faz o papel
if (!globalThis.addEventListener) {
  const alvo = new EventTarget();
  for (const f of ["addEventListener", "removeEventListener", "dispatchEvent"]) globalThis[f] = alvo[f].bind(alvo);
}

// limite de mentira: o total guardado (chaves + valores) não pode passar de LIMITE caracteres
const LIMITE = 1000;
let setItemOriginal;
beforeEach(() => {
  limparArmazenamento();
  setItemOriginal = localStorage.setItem;
  localStorage.setItem = (chave, valor) => {
    const atual = localStorage.getItem(chave);
    let total = 0;
    for (const k of [CHAVE_ESTOQUE, "wms-bb-fila-v1", "x"]) { const v = localStorage.getItem(k); if (v != null) total += k.length + v.length; }
    total += chave.length + String(valor).length - (atual != null ? chave.length + atual.length : 0);
    if (total > LIMITE) { const e = new Error("cheio"); e.name = "QuotaExceededError"; throw e; }
    setItemOriginal(chave, valor);
  };
});
afterEach(() => { localStorage.setItem = setItemOriginal; });

test("cabe: grava e devolve true", () => {
  assert.equal(gravarNoAparelho("x", "abc"), true);
  assert.equal(localStorage.getItem("x"), "abc");
});

test("não cabe: devolve false, não derruba a tela e avisa", () => {
  let avisos = 0;
  const contar = () => avisos++;
  aoEncherMemoria(contar);
  assert.equal(gravarNoAparelho("x", "a".repeat(2000)), false);
  assert.equal(localStorage.getItem("x"), null);
  assert.equal(avisos, 1);
  globalThis.removeEventListener?.(EVENTO_MEMORIA_CHEIA, contar);
});

test("a fila de envio abre espaço apagando a cópia do Estoque da demonstração", () => {
  setItemOriginal(CHAVE_ESTOQUE, "e".repeat(LIMITE - 100));
  const acao = enfileirar("separador", "separacao.item", { pedido: "PV-1", sequencia: 1, qtdSeparada: 1, status: "ok" });
  assert.deepEqual(acoesPendentes("separador").map((a) => a.id), [acao.id]);
  assert.equal(localStorage.getItem(CHAVE_ESTOQUE), null);
});
