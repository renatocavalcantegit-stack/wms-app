// Regras do painel "Ao vivo" da Gestão (Fase 1c).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  situacaoDoSeparador, separadoresDoPainel, progressoDoPedido, haQuantoTempo, resumoDoPainel,
  SEM_CONTATO_MS, FORA_DO_TURNO_MS,
} from "../compartilhado/regras/painel.js";

const AGORA = Date.parse("2026-11-18T10:00:00Z");
const ha = (ms) => new Date(AGORA - ms).toISOString();
const pedidos = [
  { id: "PV-1", status: "andamento", separador: "ana", itens: 4, itens_feitos: 1 },
  { id: "PV-2", status: "pendente", separador: null, itens: 3, itens_feitos: 0 },
  { id: "PV-3", status: "concluido", separador: "ana", itens: 2, itens_feitos: 2 },
  { id: "PV-4", status: "andamento", separador: "bia", itens: 5, itens_feitos: 0 },
];
const sep = (login, contato) => ({ login, nome: login.toUpperCase(), ultimo_contato: contato, ultima_acao: null });

test("contato recente com pedido em andamento: separando (só os pedidos em andamento dele)", () => {
  const s = situacaoDoSeparador(sep("ana", ha(10_000)), pedidos, AGORA);
  assert.equal(s.situacao, "separando");
  assert.deepEqual(s.pedidos, ["PV-1"]);
  assert.equal(s.semContatoMs, 10_000);
});

test("contato recente sem pedido: livre", () => {
  assert.equal(situacaoDoSeparador(sep("caio", ha(5_000)), pedidos, AGORA).situacao, "livre");
});

test("três batimentos perdidos: sem contato (com ou sem pedido)", () => {
  assert.equal(situacaoDoSeparador(sep("ana", ha(SEM_CONTATO_MS)), pedidos, AGORA).situacao, "separando", "no limite ainda conta");
  assert.equal(situacaoDoSeparador(sep("ana", ha(SEM_CONTATO_MS + 1)), pedidos, AGORA).situacao, "sem-contato");
  assert.equal(situacaoDoSeparador(sep("caio", ha(5 * 60_000)), pedidos, AGORA).situacao, "sem-contato");
});

test("nunca entrou (ou só noutro turno): fora; mas se tem pedido na mão, é sem contato", () => {
  assert.equal(situacaoDoSeparador(sep("caio", null), pedidos, AGORA).situacao, "fora");
  assert.equal(situacaoDoSeparador(sep("caio", ha(FORA_DO_TURNO_MS + 1)), pedidos, AGORA).situacao, "fora");
  assert.equal(situacaoDoSeparador(sep("bia", null), pedidos, AGORA).situacao, "sem-contato");
});

test("ordem da lista: sem contato com pedido, separando, livre, sem contato sem pedido, fora", () => {
  const lista = separadoresDoPainel([
    sep("dani", null),                 // fora
    sep("caio", ha(5_000)),            // livre
    sep("eva", ha(10 * 60_000)),       // sem contato, sem pedido
    sep("ana", ha(5_000)),             // separando
    sep("bia", ha(10 * 60_000)),       // sem contato COM pedido
  ], pedidos, AGORA);
  assert.deepEqual(lista.map((s) => s.login), ["bia", "ana", "caio", "eva", "dani"]);
});

test("progresso do pedido em %", () => {
  assert.equal(progressoDoPedido(pedidos[0]), 25);
  assert.equal(progressoDoPedido(pedidos[2]), 100);
  assert.equal(progressoDoPedido({ itens: 0, itens_feitos: 0 }), 0);
  assert.equal(progressoDoPedido({ itens: 3, itens_feitos: 1 }), 33);
});

test("há quanto tempo, em texto curto", () => {
  assert.equal(haQuantoTempo(0), "agora");
  assert.equal(haQuantoTempo(59_000), "agora");
  assert.equal(haQuantoTempo(60_000), "há 1 min");
  assert.equal(haQuantoTempo(59 * 60_000), "há 59 min");
  assert.equal(haQuantoTempo(65 * 60_000), "há 1h05");
  assert.equal(haQuantoTempo(-5000), "agora", "relógio adiantado não dá tempo negativo");
});

test("resumo do topo", () => {
  const seps = separadoresDoPainel([sep("ana", ha(5_000)), sep("bia", ha(10 * 60_000))], pedidos, AGORA);
  assert.deepEqual(resumoDoPainel(pedidos, seps, [{ id: "x" }]), {
    emSeparacao: 2, pendentes: 1, concluidosHoje: 1, semContato: 1, naoAplicadas: 1,
  });
});
