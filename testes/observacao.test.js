// Regras da observação do pedido (compartilhado/regras/observacao.js)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  obrigatoriaPara, ehObrigatoria, faltaResponder, validarCiencia, descreverCiencia, naoEraPara, temObservacao,
  MSG_SEM_OBSERVACAO, MSG_RESPOSTA_INVALIDA, MSG_PERFIL_SEM_OBSERVACAO,
} from "../compartilhado/regras/observacao.js";

const TEXTO = "10 do Homem-Aranha, 6 do Batman";

test("sem texto não há observação para ninguém", () => {
  assert.equal(temObservacao("   "), false);
  assert.deepEqual(obrigatoriaPara("", null), []);
  assert.deepEqual(obrigatoriaPara(null, ["separador"]), []);
});

test("sem marcação do Sankhya: obrigatória para separador e conferente, não para o embarque", () => {
  assert.deepEqual(obrigatoriaPara(TEXTO, null), ["separador", "conferente"]);
  assert.equal(ehObrigatoria(TEXTO, undefined, "embarque"), false);
});

test("com marcação: só para quem o analista marcou (nenhum marcado = ninguém)", () => {
  assert.deepEqual(obrigatoriaPara(TEXTO, ["embarque"]), ["embarque"]);
  assert.deepEqual(obrigatoriaPara(TEXTO, ["conferente", "separador"]), ["separador", "conferente"]);
  assert.deepEqual(obrigatoriaPara(TEXTO, []), []);
  assert.equal(ehObrigatoria(TEXTO, ["conferente"], "separador"), false);
});

test("falta responder: até a própria pessoa responder naquele momento (cada parte do dividido conta à parte)", () => {
  const base = { texto: TEXTO, para: null, login: "davi", papel: "separador", momento: "inicio" };
  assert.equal(faltaResponder(base), true);
  const ciencias = [{ login: "davi", papel: "separador", momento: "inicio", parte: null }];
  assert.equal(faltaResponder({ ...base, ciencias }), false);
  assert.equal(faltaResponder({ ...base, ciencias, momento: "fim" }), true);
  assert.equal(faltaResponder({ ...base, ciencias, login: "helder" }), true); // outra pessoa
  assert.equal(faltaResponder({ ...base, ciencias, parte: "PV-1/2" }), true); // outra parte
  assert.equal(faltaResponder({ ...base, para: ["embarque"] }), false); // não é para ele
});

test("resposta do aparelho: papel pelo perfil, momento e resposta combinando", () => {
  assert.deepEqual(validarCiencia({ momento: "inicio", resposta: "li" }, "sep", TEXTO), { momento: "inicio", resposta: "li", papel: "separador" });
  assert.deepEqual(validarCiencia({ momento: "fim", resposta: "nao_era" }, "conf", TEXTO), { momento: "fim", resposta: "nao_era", papel: "conferente" });
  assert.deepEqual(validarCiencia({ momento: "fim", resposta: "apliquei" }, "emb", TEXTO).papel, "embarque");
  assert.deepEqual(validarCiencia({ momento: "inicio", resposta: "apliquei" }, "sep", TEXTO), { erro: MSG_RESPOSTA_INVALIDA });
  assert.deepEqual(validarCiencia({ momento: "meio", resposta: "li" }, "sep", TEXTO), { erro: MSG_RESPOSTA_INVALIDA });
  assert.deepEqual(validarCiencia({ momento: "inicio", resposta: "li" }, "sep", ""), { erro: MSG_SEM_OBSERVACAO });
  assert.deepEqual(validarCiencia({ momento: "inicio", resposta: "li" }, "coord", TEXTO), { erro: MSG_PERFIL_SEM_OBSERVACAO });
});

test("texto da gaveta e quem respondeu 'Não era para mim'", () => {
  const c = [
    { login: "davi", nome: "Davi", papel: "separador", momento: "fim", resposta: "apliquei" },
    { login: "diego", nome: "Diego", papel: "conferente", momento: "fim", resposta: "nao_era" },
  ];
  assert.equal(descreverCiencia(c[0]), "Davi (separador) · Li e apliquei · antes da doca");
  assert.equal(descreverCiencia(c[1]), "Diego (conferente) · Não era para mim · antes de finalizar");
  assert.deepEqual(naoEraPara(c).map((x) => x.login), ["diego"]);
});
