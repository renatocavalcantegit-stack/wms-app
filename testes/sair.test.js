// Sair do aparelho com o servidor (Fase 1e, login único). O "fetch" é de mentira.
import "./armazenamento-falso.js";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { limparArmazenamento } from "./armazenamento-falso.js";
import { enfileirar, totalPendente, lerEstadoDaSincronizacao } from "../js/dados/fila.js";
import { session } from "../js/sessao.js";
import { sairDoAparelho, MSG_SAIR_SEM_REDE, msgAcoesNaoEnviadas } from "../js/sair.js";
import { sincronizarAgora } from "../js/sincronizacao.js";

const sessao = { login: "separador", nome: "Usuário Separador", perfil: "sep", token: "tok-1" };
beforeEach(() => { limparArmazenamento(); localStorage.setItem("wms-bb-session", JSON.stringify(sessao)); });

const semRede = async () => { throw new TypeError("Failed to fetch"); };
// servidor de mentira: o /api/sincronizar confirma tudo (ou nada) e o /api/logout responde ok
function servidor({ confirmaAcoes = true } = {}) {
  const urls = [];
  const buscar = async (url, opcoes) => {
    urls.push(url);
    if (url === "api/logout") return { ok: true, status: 200, json: async () => ({ ok: true }) };
    const ids = JSON.parse(opcoes.body).acoes.map((a) => a.id);
    return { ok: confirmaAcoes, status: confirmaAcoes ? 200 : 500, json: async () => ({ novas: ids, repetidas: [], recusadas: [] }) };
  };
  return { buscar, urls };
}
const naoPergunte = () => assert.fail("não devia perguntar");

test("fila vazia: avisa o servidor e sai", async () => {
  const s = servidor();
  assert.deepEqual(await sairDoAparelho({ sessao, confirmar: naoPergunte, buscar: s.buscar }), { ok: true });
  assert.deepEqual(s.urls, ["api/logout"]);
  assert.equal(session(), null);
});

test("com ações na fila: manda antes de sair", async () => {
  enfileirar("separador", "separacao.iniciar", { pedido: "PV-1" });
  const s = servidor();
  assert.deepEqual(await sairDoAparelho({ sessao, confirmar: naoPergunte, buscar: s.buscar }), { ok: true });
  assert.deepEqual(s.urls, ["api/sincronizar", "api/logout"]);
  assert.equal(totalPendente("separador"), 0);
});

test("ações que o servidor não aceitou agora: pergunta; elas ficam no aparelho", async () => {
  enfileirar("separador", "separacao.iniciar", { pedido: "PV-1" });
  enfileirar("separador", "separacao.iniciar", { pedido: "PV-2" });
  const s = servidor({ confirmaAcoes: false });
  let pergunta = null;
  assert.deepEqual(await sairDoAparelho({ sessao, confirmar: (m) => { pergunta = m; return false; }, buscar: s.buscar }), { ok: false, cancelado: true });
  assert.equal(pergunta, msgAcoesNaoEnviadas(2));
  assert.match(pergunta, /2 ações que ainda não chegaram ao servidor/);
  assert.ok(session(), "não saiu");

  assert.deepEqual(await sairDoAparelho({ sessao, confirmar: () => true, buscar: s.buscar }), { ok: true });
  assert.equal(totalPendente("separador"), 2, "a fila continua guardada no aparelho");
});

test("sem rede: não sai (o servidor ainda acha que a pessoa está aqui)", async () => {
  assert.deepEqual(await sairDoAparelho({ sessao, confirmar: naoPergunte, buscar: semRede }), { ok: false, mensagem: MSG_SAIR_SEM_REDE });
  enfileirar("separador", "separacao.iniciar", { pedido: "PV-1" });
  assert.deepEqual(await sairDoAparelho({ sessao, confirmar: naoPergunte, buscar: semRede }), { ok: false, mensagem: MSG_SAIR_SEM_REDE });
  assert.ok(session());
});

test("sem rede o aviso vem na hora (v71): o aparelho já sabe, ou o servidor não responde no prazo", async () => {
  const nuncaResponde = () => new Promise(() => {});
  // o aparelho sabe que está sem rede: nem tenta falar com o servidor
  assert.deepEqual(await sairDoAparelho({ sessao, confirmar: naoPergunte, buscar: () => assert.fail("não devia tentar"), semRede: () => true }),
    { ok: false, mensagem: MSG_SAIR_SEM_REDE });
  // o pedido fica parado (Wi-Fi desligado): desiste no prazo, com e sem ações na fila
  const inicio = Date.now();
  assert.deepEqual(await sairDoAparelho({ sessao, confirmar: naoPergunte, buscar: nuncaResponde, semRede: () => false, prazo: 50 }),
    { ok: false, mensagem: MSG_SAIR_SEM_REDE });
  enfileirar("separador", "separacao.iniciar", { pedido: "PV-1" });
  assert.deepEqual(await sairDoAparelho({ sessao, confirmar: naoPergunte, buscar: nuncaResponde, semRede: () => false, prazo: 50 }),
    { ok: false, mensagem: MSG_SAIR_SEM_REDE });
  assert.ok(Date.now() - inicio < 2000);
  assert.ok(session());
});

test("demonstração (sem token): só apaga a sessão do aparelho", async () => {
  assert.deepEqual(await sairDoAparelho({ sessao: { login: "separador" }, buscar: semRede }), { ok: true });
  assert.equal(session(), null);
});

test("o coordenador desconectou o aparelho: o envio volta com o motivo", async () => {
  enfileirar("separador", "separacao.iniciar", { pedido: "PV-1" });
  const buscar = async () => ({ ok: false, status: 401, json: async () => ({ erro: "O coordenador desconectou este aparelho.", motivo: "coordenador" }) });
  const r = await sincronizarAgora({ sessao, buscar });
  assert.deepEqual([r.situacao, r.motivo], ["sessao-vencida", "coordenador"]);
  assert.equal(lerEstadoDaSincronizacao().motivoDoFim, "coordenador");
  assert.equal(totalPendente("separador"), 1, "a fila fica guardada");
});
