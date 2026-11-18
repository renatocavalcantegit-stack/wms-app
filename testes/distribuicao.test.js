// Pedido aguardando e distribuição inteligente.
import { test } from "node:test";
import assert from "node:assert/strict";
import { AGUARDANDO, ehAguardando, precisaDeRota, destinoDoPedido } from "../compartilhado/regras/aguardando.js";
import { vaiSozinho, ordemDaDistribuicao, menorFila } from "../compartilhado/regras/distribuicao.js";

const HOJE = "2026-11-18";
const nomeDaRota = (id) => ({ centro: "Centro", caucaia: "Caucaia" }[id] || null);

test("aguardando: aceita o sim/não do Sankhya", () => {
  for (const v of [true, "S", "sim", "SIM", "1"]) assert.equal(ehAguardando({ aguardando: v }), true, String(v));
  for (const v of [false, "N", "nao", null, undefined, ""]) assert.equal(ehAguardando({ aguardando: v }), false, String(v));
});

test("aguardando: não precisa de rota e aparece como 'Aguardando', mesmo com rota no cadastro", () => {
  assert.equal(precisaDeRota({ rota: null, aguardando: true }), false);
  assert.equal(precisaDeRota({ rota: null }), true);
  assert.equal(precisaDeRota({ rota: null, op: true }), false, "montagem não tem rota");
  assert.equal(destinoDoPedido({ rota: "centro", aguardando: true }, nomeDaRota), AGUARDANDO.nome);
  assert.equal(destinoDoPedido({ rota: "centro" }, nomeDaRota), "Centro");
  assert.equal(destinoDoPedido({ rota: null }, nomeDaRota), null);
});

test("distribuição inteligente: vai sozinho o aguardando e o de hoje dentro do horário", () => {
  assert.equal(vaiSozinho({ aguardando: true }, HOJE), true);
  assert.equal(vaiSozinho({ rota: "centro", embarque: HOJE }, HOJE), true);
  assert.equal(vaiSozinho({ rota: "centro", embarque: HOJE, foraDoHorario: true }, HOJE), false, "fora do horário: o coordenador decide");
  assert.equal(vaiSozinho({ rota: "centro", embarque: "2026-11-19" }, HOJE), false, "outro dia");
  assert.equal(vaiSozinho({ rota: null, embarque: null }, HOJE), false, "sem rota");
});

test("distribuição inteligente: aguardando primeiro, depois a rota que sai primeiro, prioridade e chegada", () => {
  const ps = [
    { id: "caucaia", rota: "caucaia", prio: "normal", chegada: 1 },          // corte 11:00
    { id: "centro-tarde", rota: "centro", prio: "normal", chegada: 9 },      // corte 09:00
    { id: "centro-prio", rota: "centro", prio: "alta", chegada: 10 },
    { id: "aguardando", aguardando: true, prio: "alta", chegada: 20 },
    { id: "centro-cedo", rota: "centro", prio: "normal", chegada: 2 },
  ];
  assert.deepEqual([...ps].sort(ordemDaDistribuicao).map((p) => p.id), ["aguardando", "centro-prio", "centro-cedo", "centro-tarde", "caucaia"]);
});

test("distribuição inteligente: menor fila; empate fica com o primeiro; ninguém atuando = null", () => {
  assert.equal(menorFila([{ id: "a", pendente: 30 }, { id: "b", pendente: 5 }, { id: "c", pendente: 5 }]), "b");
  assert.equal(menorFila([]), null);
});
