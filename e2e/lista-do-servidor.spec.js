// Fases 1d e 1e de ponta a ponta, com o SERVIDOR DE VERDADE (Fastify + banco de teste wms_teste):
// o coordenador distribui os pedidos no quadro da Gestão e cada coletor mostra só a fila do seu separador.
// Também o login único (um aparelho por separador) e o coordenador desconectando o coletor perdido.
//
// Precisa do PostgreSQL e do server/.env (o mesmo dos testes do servidor). Sem o .env, o teste é pulado.
import { test, expect } from "@playwright/test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { abrirPedidoNoColetor, ler, digitarQuantidade } from "./ajuda.js";

const ENV = resolve(import.meta.dirname, "..", "server", ".env");
test.skip(!existsSync(ENV), "sem server/.env: este teste precisa do banco");

let pool, servidor, endereco, USERS;
test.beforeAll(async () => {
  process.loadEnvFile(ENV);
  const { prepararBancoDeTeste } = await import("../server/testes/banco-de-teste.js");
  const { criarServidor } = await import("../server/src/servidor.js");
  ({ USERS } = await import("../js/sessao.js"));
  pool = await prepararBancoDeTeste();
  servidor = criarServidor({ pool });
  endereco = await servidor.listen({ port: 0, host: "127.0.0.1" });
});
// cada teste abre navegadores novos (aparelhos novos): as sessões do teste anterior terminam,
// senão o login único recusaria a entrada
test.afterEach(async () => { await pool.query("UPDATE sessoes SET encerrada_em = now() WHERE encerrada_em IS NULL"); });
test.afterAll(async () => {
  await servidor?.close();
  await pool?.end();
});

const usuario = (login) => USERS.find((u) => u.login === login);
async function abrir(browser, viewport) {
  return (await browser.newContext({ viewport })).newPage();
}
async function entrar(page, login) {
  await page.goto(`${endereco}/`);
  await page.locator("#loginName").fill(login);
  await page.locator("#loginPin").fill(usuario(login).pin);
  await page.locator("#loginForm button[type=submit]").click();
}
async function coletor(browser, login) {
  const page = await abrir(browser, { width: 412, height: 860 });
  await entrar(page, login);
  await page.locator('[data-setor="exp"]').click();
  return page;
}
async function gestao(browser) {
  const page = await abrir(browser, { width: 1600, height: 900 });
  await entrar(page, "coordenador");
  await expect(page).toHaveURL(/gestao\.html/);
  await page.evaluate(() => localStorage.setItem("wms-bb-gx-sim", "off"));
  // espera a Gestão perceber o servidor e trocar a aba Separação pelo quadro de verdade
  await expect(page.locator('#board .gx-list[data-col="separador"]')).toBeVisible();
  return page;
}
// "Atualizar a lista do servidor", no menu (o mesmo que acontece sozinho a cada 30 s)
async function atualizarLista(page) {
  await page.locator("#viewHome .menu-btn").click();
  await expect(page.locator("#menuReset")).toHaveText("Atualizar a lista do servidor");
  await page.locator("#menuReset").click();
}
const idsDaLista = (page) => page.locator("#orderList button.order").evaluateAll((bs) => bs.map((b) => b.dataset.id || b.dataset.lote));
const designado = async (id) => (await pool.query("SELECT designado_para, rota FROM pedidos WHERE id = $1", [id])).rows[0];

// o Playwright não gera os eventos de arrastar do navegador: o teste dispara os mesmos eventos
async function arrastar(page, id, coluna, posicao = "fim") {
  await page.evaluate(({ id, coluna, posicao }) => {
    const dt = new DataTransfer();
    const card = document.querySelector(`#board .card[data-id="${id}"]`);
    const lista = document.querySelector(`#board .gx-list[data-col="${coluna}"]`);
    card.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: dt }));
    const r = lista.getBoundingClientRect();
    const y = posicao === "inicio" ? r.top + 2 : r.bottom - 2;
    lista.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + 20, clientY: y }));
    lista.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + 20, clientY: y }));
    card.dispatchEvent(new DragEvent("dragend", { bubbles: true }));
  }, { id, coluna, posicao });
}

test("o coordenador distribui no quadro e cada coletor mostra só a fila do seu separador", async ({ browser }) => {
  const g = await gestao(browser);
  // o quadro de verdade: a caixa de entrada do banco, com o aguardando e o que chegou sem rota
  const caixa = g.locator("#board .col.inbox");
  await expect(caixa.locator('.card[data-id="PV-10423"] .rt.aguard')).toBeVisible();
  await expect(caixa.locator('.card[data-id="PV-10428"] .rt.none')).toHaveText("SEM ROTA");
  await expect(g.locator('#board .gx-list[data-col="separador2"] .card[data-id="PV-10426/2"]')).toBeVisible();
  // as outras abas continuam simulação, e avisam
  await g.locator('.gx-tab[data-board="conf"]').click();
  await expect(g.locator("#actions .gx-sim-aviso")).toHaveText("Simulação");
  await g.locator('.gx-tab[data-board="sep"]').click();
  await expect(g.locator("#actions .gx-sim-aviso")).toHaveCount(0);

  const ana = await coletor(browser, "separador");
  const bruna = await coletor(browser, "separador2");
  // cada um vê só a sua fila, na ordem do quadro (nada da caixa de entrada, nada do outro)
  await expect.poll(() => idsDaLista(ana)).toEqual(["PV-10421", "PV-10422", "L-1", "PV-10426/1"]);
  await expect.poll(() => idsDaLista(bruna)).toEqual(["PV-10426/2"]);

  // o coordenador manda o aguardando para o INÍCIO da fila da Bruna
  await arrastar(g, "PV-10423", "separador2", "inicio");
  await expect.poll(async () => (await designado("PV-10423")).designado_para).toBe("separador2");
  // conta os toques de "pedido novo" (o som em si o teste não ouve)
  await bruna.evaluate(() => { window.__toques = 0; const v = navigator.vibrate?.bind(navigator); navigator.vibrate = (p) => { if (Array.isArray(p) && p.join() === "120,80,240") window.__toques++; return v ? v(p) : true; }; });
  await atualizarLista(bruna);
  await expect.poll(() => idsDaLista(bruna)).toEqual(["PV-10423", "PV-10426/2"]);
  await expect(bruna.locator("#toast")).toContainText("Pedido novo na sua fila: PV-10423");
  expect(await bruna.evaluate(() => window.__toques)).toBe(1);
  await expect(bruna.locator('button.order[data-id="PV-10423"]')).toContainText("Aguardando");

  // pedido sem rota: o quadro pede a rota antes de mandar para o separador
  await arrastar(g, "PV-10428", "separador");
  await expect(g.locator("#modal h2")).toHaveText("Defina a rota de PV-10428");
  await g.locator("#gqRota").selectOption("centro");
  await g.locator("#gqRotaOk").click();
  await expect.poll(() => designado("PV-10428")).toEqual({ designado_para: "separador", rota: "centro" });
  await atualizarLista(ana);
  await expect.poll(() => idsDaLista(ana)).toEqual(["PV-10421", "PV-10422", "L-1", "PV-10426/1", "PV-10428"]);

  // a Ana começa o PV-10421: a Gestão vê sem recarregar, e o card não sai mais da fila dela
  await abrirPedidoNoColetor(ana, "PV-10421");
  const vivo = g.locator('#board .gx-list[data-col="separador"] .card[data-id="PV-10421"]');
  await expect(vivo).toHaveClass(/live/);
  await expect(vivo).toContainText("Separando agora");
  await expect(vivo).toHaveAttribute("draggable", "false");
  await expect(g.locator('#board .col:has(.gx-list[data-col="separador"]) .st')).toHaveText("Separando");

  // a gaveta do pedido é a mesma da demonstração: andamento ao vivo, itens e histórico
  await vivo.click();
  const gav = g.locator("#drawer");
  await expect(gav).toBeVisible();
  await expect(gav.locator(".dr-head h2")).toHaveText("PV-10421");
  await expect(gav.locator(".dr-head .stage")).toHaveText(/Em separação/);
  await expect(gav.locator(".dr-live")).toContainText("Separando agora");
  await expect(gav.locator(".dr-items tbody tr").first()).toBeVisible();
  await expect(gav.locator(".timeline")).toContainText("Separação iniciada por");
  await expect(gav.locator("#gqMover")).toHaveCount(0); // em separação não muda de fila
  // a bolinha do item da vez enche pelos passos do coletor (v63): endereço 1/3, produto 2/3, quantidade cheia
  const primeiro = (await pool.query("SELECT endereco_codigo, produto, qtd FROM itens_pedido WHERE pedido_id = 'PV-10421' ORDER BY sequencia LIMIT 1")).rows[0];
  const bolinha = gav.locator(".dr-items tbody tr").first().locator(".sdot");
  await expect(bolinha).not.toHaveClass(/part|ok/);
  await ler(ana, primeiro.endereco_codigo);
  await expect(bolinha).toHaveAttribute("style", "--p:33%", { timeout: 15_000 });
  await ler(ana, primeiro.produto);
  await expect(bolinha).toHaveAttribute("style", "--p:67%", { timeout: 15_000 });
  await digitarQuantidade(ana, primeiro.qtd);
  await expect(bolinha).toHaveClass(/ok/, { timeout: 15_000 });
  await gav.locator("[data-gqfechar]").click();
  await expect(gav).toBeHidden();

  // "Mover para…" pela gaveta: o PV-10428 sai da Ana e volta para a caixa de entrada
  await g.locator('#board .card[data-id="PV-10428"]').click();
  await expect(gav.locator(".dr-head h2")).toHaveText("PV-10428");
  await expect(gav.locator(".dr-head .stage")).toHaveText(/Aguardando início da separação · \d+º na fila/);
  await gav.locator("#gqMover").selectOption("inbox");
  await gav.locator("#gqMoverOk").click();
  await expect.poll(async () => (await designado("PV-10428")).designado_para).toBeNull();
  await expect(gav.locator(".dr-head .stage")).toHaveText(/Aguardando designar separador/);
  // e da caixa para a Bruna, no fim da fila (a rota já foi definida)
  await gav.locator("#gqMover").selectOption("separador2");
  await gav.locator("#gqMoverOk").click();
  await expect.poll(async () => (await designado("PV-10428")).designado_para).toBe("separador2");
  await g.keyboard.press("Escape");
  await expect(gav).toBeHidden();

  // a gaveta do lote: pedidos e paradas
  await g.locator('#board .card[data-id="L-1"]').click();
  await expect(gav.locator(".dr-k")).toHaveText("Lote · uma viagem só");
  await expect(gav.locator("tr[data-gqgoto]")).toHaveCount(2);
  await gav.locator("tr[data-gqgoto]").first().click();
  await expect(gav.locator(".dr-head h2")).toHaveText(/PV-/);

  for (const p of [g, ana, bruna]) await p.context().close();
});

test("o coordenador passou o pedido para outra pessoa enquanto o coletor estava sem rede: recusado e avisado", async ({ browser }) => {
  const ana = await coletor(browser, "separador");
  await expect.poll(() => idsDaLista(ana)).toContain("PV-10422");
  await ana.context().setOffline(true);
  await abrirPedidoNoColetor(ana, "PV-10422"); // sem rede: começa no aparelho
  await expect(ana.locator("#viewPick")).toBeVisible();

  // enquanto isso, o coordenador passa o PV-10422 para a Bruna
  const coord = (await (await fetch(`${endereco}/api/login`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ login: "coordenador", pin: usuario("coordenador").pin }),
  })).json()).token;
  const r = await fetch(`${endereco}/api/quadro/mover`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${coord}` },
    body: JSON.stringify({ setor: "exp", unidade: "PV-10422", para: "separador2", ordem: [] }),
  });
  expect(r.status).toBe(200);

  // a rede volta: o servidor recusa, o coletor avisa e volta para a lista; o pedido não ficou com a Ana
  await ana.context().setOffline(false);
  await expect(ana.locator("#toast")).toContainText("O COORDENADOR PASSOU O PV-10422 PARA OUTRA PESSOA", { timeout: 15_000 });
  await expect(ana.locator("#viewHome")).toBeVisible();
  const p = (await pool.query("SELECT status, separador FROM pedidos WHERE id = 'PV-10422'")).rows[0];
  expect(p).toEqual({ status: "pendente", separador: null });
  // fica para o coordenador em "não aplicadas"
  const recusa = (await pool.query("SELECT resultado FROM acoes_recebidas WHERE login = 'separador' AND dados->>'pedido' = 'PV-10422'")).rows[0];
  expect(recusa.resultado).toBe("recusada");
  await ana.context().close();
});

test("login único: o segundo aparelho é recusado; o coordenador desconecta o perdido; Sair libera", async ({ browser }) => {
  const perdido = await coletor(browser, "separador");
  await expect(perdido.locator("#viewHome")).toBeVisible();

  // a Ana tenta entrar em outro coletor: recusado, e o primeiro continua
  const novo = await abrir(browser, { width: 412, height: 860 });
  await entrar(novo, "separador");
  await expect(novo.locator("#loginErr")).toContainText("Você já está conectado em outro aparelho");
  await expect(novo.locator("#loginErr")).toContainText("peça ao coordenador para desconectar");

  // o coordenador: menu do usuário → Dispositivos → Desconectar
  const g = await gestao(browser);
  await g.locator("#userBtn").click();
  await g.locator("#mDisp").click();
  const linha = g.locator(".gq-dsp tr", { hasText: usuario("separador").nome });
  await expect(linha).toBeVisible();
  g.once("dialog", (d) => d.accept());
  await linha.getByRole("button", { name: "Desconectar" }).click();
  await expect(g.locator("#toast")).toContainText("desconectado");
  await expect(g.locator(".gq-dsp tr", { hasText: usuario("separador").nome })).toHaveCount(0);

  // o coletor perdido, no próximo contato, volta para o login com o aviso
  await perdido.reload();
  await expect(perdido.locator("#loginErr")).toContainText("O coordenador desconectou este aparelho", { timeout: 15_000 });

  // agora entra no coletor novo; e o Sair encerra a sessão no servidor
  await entrar(novo, "separador");
  await novo.locator('[data-setor="exp"]').click();
  await expect(novo.locator("#viewHome")).toBeVisible();
  await novo.locator("#viewHome .menu-btn").click();
  await novo.locator("#menuLogout").click();
  await expect(novo.locator("#viewLogin")).toBeVisible();
  const ativas = (await pool.query("SELECT count(*)::int n FROM sessoes WHERE login = 'separador' AND encerrada_em IS NULL")).rows[0].n;
  expect(ativas).toBe(0);

  for (const p of [perdido, novo, g]) await p.context().close();
});
