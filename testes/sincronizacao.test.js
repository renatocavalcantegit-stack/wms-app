// Envio da fila ao servidor. O "fetch" é de mentira: cada teste diz o que o servidor responde
// (ou que a rede caiu), sem precisar de servidor nem de rede.
import "./armazenamento-falso.js";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { limparArmazenamento } from "./armazenamento-falso.js";
import { enfileirar, acoesPendentes, lerEstadoDaSincronizacao } from "../js/dados/fila.js";
import { sincronizarAgora, TAMANHO_DO_LOTE } from "../js/sincronizacao.js";

beforeEach(() => limparArmazenamento());

const sessao = { login: "separador", token: "tok-123" };
const AGORA = new Date("2026-11-17T10:00:00Z");
const agora = () => AGORA;
// servidor de mentira: guarda o que recebeu e responde como o /api/sincronizar
function servidor({ status = 200, recusar = {} } = {}) {
  const chamadas = [];
  const buscar = async (url, opcoes) => {
    const corpo = JSON.parse(opcoes.body);
    chamadas.push({ url, opcoes, corpo });
    const ids = corpo.acoes.map((a) => a.id);
    const resposta = { novas: ids, repetidas: [], recusadas: ids.filter((id) => recusar[id]).map((id) => ({ id, ...recusar[id] })) };
    return { ok: status === 200, status, json: async () => resposta };
  };
  return { buscar, chamadas };
}
const semRede = async () => { throw new TypeError("Failed to fetch"); };

test("sem sessão do servidor (demonstração): não envia nada", async () => {
  enfileirar("separador", "separacao.iniciar", { pedido: "PV-1" });
  const s = servidor();
  assert.equal((await sincronizarAgora({ sessao: { login: "separador" }, buscar: s.buscar, agora })).situacao, "sem-servidor");
  assert.equal(s.chamadas.length, 0);
});

test("fila vazia: não chama o servidor", async () => {
  const s = servidor();
  assert.equal((await sincronizarAgora({ sessao, buscar: s.buscar, agora })).situacao, "vazia");
  assert.equal(s.chamadas.length, 0);
});

test("batimento com a fila vazia: manda a lista vazia uma vez e o servidor fica sabendo do contato", async () => {
  const s = servidor();
  const r = await sincronizarAgora({ sessao, buscar: s.buscar, agora, batimento: true });
  assert.equal(r.situacao, "contato");
  assert.equal(s.chamadas.length, 1);
  assert.deepEqual(s.chamadas[0].corpo, { acoes: [], pendentes: 0 }); // pendentes: a tela de Dispositivos mostra
  assert.equal(s.chamadas[0].opcoes.headers.authorization, "Bearer tok-123");
  assert.equal(lerEstadoDaSincronizacao().ultimaSincronizacao, AGORA.toISOString());
});

test("batimento com ações na fila: as ações já servem de contato (uma chamada só)", async () => {
  enfileirar("separador", "separacao.iniciar", { pedido: "PV-1" });
  const s = servidor();
  const r = await sincronizarAgora({ sessao, buscar: s.buscar, agora, batimento: true });
  assert.equal(r.situacao, "ok");
  assert.equal(s.chamadas.length, 1);
  assert.equal(s.chamadas[0].corpo.acoes.length, 1);
});

test("batimento sem rede: anota desde quando está sem rede", async () => {
  assert.equal((await sincronizarAgora({ sessao, buscar: semRede, agora, batimento: true })).situacao, "sem-rede");
  assert.equal(lerEstadoDaSincronizacao().semRedeDesde, AGORA.toISOString());
});

test("envia com o token, na ordem, e tira da fila o que o servidor recebeu", async () => {
  const a = enfileirar("separador", "separacao.iniciar", { pedido: "PV-1" });
  const b = enfileirar("separador", "separacao.concluir", { pedido: "PV-1", doca: "D1" });
  const s = servidor();
  const r = await sincronizarAgora({ sessao, buscar: s.buscar, agora });
  assert.equal(r.situacao, "ok");
  assert.equal(r.enviadas, 2);
  const { url, opcoes, corpo } = s.chamadas[0];
  assert.equal(url, "api/sincronizar");
  assert.equal(opcoes.method, "POST");
  assert.equal(opcoes.headers.authorization, "Bearer tok-123");
  assert.deepEqual(corpo.acoes.map((x) => x.id), [a.id, b.id]);
  assert.equal("login" in corpo.acoes[0], false); // quem fez vem do token, não do aparelho
  assert.deepEqual(acoesPendentes("separador"), []);
  assert.equal(lerEstadoDaSincronizacao().ultimaSincronizacao, AGORA.toISOString());
});

test("sem rede: nada sai da fila e marca desde quando está sem rede", async () => {
  enfileirar("separador", "separacao.iniciar", { pedido: "PV-1" });
  assert.equal((await sincronizarAgora({ sessao, buscar: semRede, agora })).situacao, "sem-rede");
  assert.equal(acoesPendentes("separador").length, 1);
  assert.equal(lerEstadoDaSincronizacao().semRedeDesde, AGORA.toISOString());
  // continua sem rede depois: o "desde" não muda
  await sincronizarAgora({ sessao, buscar: semRede, agora: () => new Date("2026-11-17T10:05:00Z") });
  assert.equal(lerEstadoDaSincronizacao().semRedeDesde, AGORA.toISOString());
  // a rede voltou: envia e limpa o "sem rede"
  await sincronizarAgora({ sessao, buscar: servidor().buscar, agora });
  assert.equal(lerEstadoDaSincronizacao().semRedeDesde, null);
  assert.equal(acoesPendentes("separador").length, 0);
});

test("sessão vencida no servidor (401): guarda a fila e avisa para entrar de novo", async () => {
  enfileirar("separador", "separacao.iniciar", { pedido: "PV-1" });
  const r = await sincronizarAgora({ sessao, buscar: servidor({ status: 401 }).buscar, agora });
  assert.equal(r.situacao, "sessao-vencida");
  assert.equal(acoesPendentes("separador").length, 1);
  assert.equal(lerEstadoDaSincronizacao().sessaoVencida, true);
});

test("erro do servidor (500): guarda a fila para tentar de novo", async () => {
  enfileirar("separador", "separacao.iniciar", { pedido: "PV-1" });
  assert.equal((await sincronizarAgora({ sessao, buscar: servidor({ status: 500 }).buscar, agora })).situacao, "erro");
  assert.equal(acoesPendentes("separador").length, 1);
});

test("ação recusada (conflito): sai da fila e fica guardada para o separador ver, com o pedido", async () => {
  const a = enfileirar("separador", "separacao.iniciar", { pedido: "PV-1" });
  const s = servidor({ recusar: { [a.id]: { resultado: "conflito", motivo: "PEDIDO JÁ ESTÁ COM separador2." } } });
  const r = await sincronizarAgora({ sessao, buscar: s.buscar, agora });
  assert.deepEqual(r.recusadas.map((x) => x.motivo), ["PEDIDO JÁ ESTÁ COM separador2."]);
  assert.deepEqual(acoesPendentes("separador"), []);
  assert.deepEqual(lerEstadoDaSincronizacao().recusadas, [
    { id: a.id, tipo: "separacao.iniciar", pedido: "PV-1", resultado: "conflito", motivo: "PEDIDO JÁ ESTÁ COM separador2.", quando: AGORA.toISOString() },
  ]);
});

test("fila grande vai em lotes de até 500", async () => {
  for (let n = 0; n < TAMANHO_DO_LOTE + 20; n++) enfileirar("separador", "separacao.iniciar", { pedido: `PV-${n}` });
  const s = servidor();
  const r = await sincronizarAgora({ sessao, buscar: s.buscar, agora });
  assert.equal(r.enviadas, TAMANHO_DO_LOTE + 20);
  assert.deepEqual(s.chamadas.map((c) => c.corpo.acoes.length), [TAMANHO_DO_LOTE, 20]);
});
