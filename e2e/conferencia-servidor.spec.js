// Fase 2 de ponta a ponta, com o SERVIDOR DE VERDADE (Fastify + banco de teste wms_teste):
// o posto da conferência mostra só a fila do conferente, abre o resumo "Iniciar conferência",
// manda as ações pela fila de envio (também sem rede) e o servidor decide conferido ou divergente.
//
// Precisa do PostgreSQL e do server/.env (o mesmo dos testes do servidor). Sem o .env, o teste é pulado.
import { test, expect } from "@playwright/test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { bipar, finalizarConferencia, estoque, responderObservacao } from "./ajuda.js";

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
// cada teste abre aparelhos novos: fecha os do teste anterior e encerra as sessões (senão o login único recusaria)
const abertos = [];
test.afterEach(async () => {
  await Promise.all(abertos.splice(0).map((c) => c.close()));
  await pool.query("UPDATE sessoes SET encerrada_em = now() WHERE encerrada_em IS NULL");
});
test.afterAll(async () => {
  await servidor?.close();
  await pool?.end();
});

const usuario = (login) => USERS.find((u) => u.login === login);
async function posto(browser, login) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  abertos.push(context);
  const page = await context.newPage();
  await page.goto(`${endereco}/`);
  await page.locator("#loginName").fill(login);
  await page.locator("#loginPin").fill(usuario(login).pin);
  await page.locator("#loginForm button[type=submit]").click();
  await expect(page).toHaveURL(/conferencia\.html/);
  await page.locator('#mSetor [data-setor="exp"]').click();
  await expect(page.locator("#queue")).toBeVisible();
  return { page, context };
}
const idsDaFila = (page) => page.locator("#queueBody tr").evaluateAll((trs) => trs.map((t) => t.dataset.id));
const conferencia = async (id) => (await pool.query("SELECT status, conferente, volumes, posto FROM conferencias WHERE pedido = $1", [id])).rows[0];
const contagem = async (id) => (await pool.query("SELECT produto, qtd_conferida::float AS qtd FROM conferencia_itens WHERE pedido = $1 ORDER BY produto", [id])).rows;

// confere tudo o que foi separado: checkout = um bipe por unidade; granel = bipe + quantidade
async function conferirTudo(page, id) {
  const o = await page.evaluate(async (id) =>
    (await import("/js/dados/conferencia.js")).carregarConferencia("exp", { servidor: true }).orders.find((x) => x.id === id), id);
  const db = await estoque(page);
  for (const i of o.itens) {
    if (!i.sep) continue;
    if (db.produtos.find((p) => p.codigo === i.sku)?.checkout === false) {
      await bipar(page, i.sku);
      await page.locator("#mult").fill(String(i.sep));
      await page.locator("#mult").press("Enter");
    } else for (let k = 0; k < i.sep; k++) await bipar(page, i.ean || i.sku);
  }
  return o;
}

test("o posto mostra a fila do conferente, inicia pelo resumo e o servidor recebe a conferência", async ({ browser }) => {
  const { page: ana } = await posto(browser, "conferente");
  // só a fila da Ana, na ordem do quadro (nada da caixa de entrada, nada da Bruna)
  await expect.poll(() => idsDaFila(ana)).toEqual(["PV-10401", "PV-10402"]);

  // clicar na linha abre o resumo: quem separou, onde pegar e os itens
  await ana.locator('#queueBody tr[data-id="PV-10401"]').click();
  const resumo = ana.locator("#mStart");
  await expect(resumo).toBeVisible();
  await expect(resumo.locator("#sId")).toHaveText("PV-10401");
  await expect(resumo.locator("#sTag")).toHaveText("Na fila");
  await expect(resumo.locator("#sSub")).toContainText("Separado por Davi");
  await expect(resumo.locator("#sSub .doca-chip")).toBeVisible();
  await expect(resumo.locator("#sItens .f-row").first()).toBeVisible();
  // Esc volta para a fila sem começar
  await ana.keyboard.press("Escape");
  await expect(resumo).toBeHidden();
  expect((await conferencia("PV-10401")).status).toBe("aguardando");

  // Enter inicia: o servidor fica sabendo
  await ana.locator('#queueBody tr[data-id="PV-10401"]').click();
  await ana.keyboard.press("Enter");
  await expect(ana.locator("#order")).toBeVisible();
  await responderObservacao(ana); // v76: a observação do pedido, antes de começar
  await expect.poll(async () => (await conferencia("PV-10401")).status).toBe("andamento");
  const o = await conferirTudo(ana, "PV-10401");
  await finalizarConferencia(ana, 2);
  await expect.poll(() => conferencia("PV-10401")).toEqual({ status: "conferido", conferente: "conferente", volumes: 2, posto: "01" });
  expect((await contagem("PV-10401")).length).toBe(o.itens.length);

  // bipar o pedido de outra fila: recusado na hora
  await bipar(ana, "PV-10403");
  await expect(ana.locator("#scanMsg")).toHaveText("PEDIDO PV-10403 NÃO ESTÁ NA SUA FILA.");
});

test("sem rede, o posto segue conferindo; quando a rede volta, o servidor recebe tudo", async ({ browser }) => {
  const { page: ana, context } = await posto(browser, "conferente");
  await expect.poll(() => idsDaFila(ana)).toContain("PV-10402");
  await context.setOffline(true);
  await ana.locator('#queueBody tr[data-id="PV-10402"]').click();
  await ana.locator("#sGo").click();
  const o = await ana.evaluate(async () =>
    (await import("/js/dados/conferencia.js")).carregarConferencia("exp", { servidor: true }).orders.find((x) => x.id === "PV-10402"));
  const i = o.itens.find((x) => x.sep > 0);
  await bipar(ana, i.ean || i.sku);
  await expect(ana.locator("#lastLabel")).not.toHaveText("Código não cadastrado");
  // nada chegou ainda
  await ana.waitForTimeout(1500);
  expect((await conferencia("PV-10402")).status).toBe("aguardando");
  // a rede volta: o iniciar e a contagem chegam, na ordem
  await context.setOffline(false);
  await ana.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(async () => (await conferencia("PV-10402")).status, { timeout: 15_000 }).toBe("andamento");
  await expect.poll(() => contagem("PV-10402"), { timeout: 15_000 }).toContainEqual({ produto: i.sku, qtd: 1 });
});

// ---------- quadro da Conferência na Gestão (v67) ----------
async function gestao(browser, login) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  abertos.push(context);
  const page = await context.newPage();
  await page.goto(`${endereco}/`);
  await page.locator("#loginName").fill(login);
  await page.locator("#loginPin").fill(usuario(login).pin);
  await page.locator("#loginForm button[type=submit]").click();
  await expect(page).toHaveURL(login === "montagem" ? /montagem\.html/ : /gestao\.html/);
  await page.evaluate(() => localStorage.setItem("wms-bb-gx-sim", "off"));
  await page.locator('.gx-tab[data-board="conf"]').click();
  // espera a Gestão trocar a simulação pelo quadro de verdade (a caixa "Separados" do servidor)
  await expect(page.locator('#board .gx-list[data-col="conferente"]')).toBeVisible();
  return page;
}
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
const designado = async (id) => (await pool.query("SELECT designado_para, ordem_fila FROM conferencias WHERE pedido = $1", [id])).rows[0];

test("Gestão: o quadro da Conferência distribui para o posto e mostra quem está conferindo", async ({ browser }) => {
  const g = await gestao(browser, "coordenador");
  await expect(g.locator("#actions .gx-sim-aviso")).toHaveCount(0);
  await expect(g.locator('#board .gx-list[data-col="inbox"] .card[data-id="PV-10404"]')).toBeVisible();
  // o PV-10402 está sendo conferido pela Ana (teste anterior): ao vivo e preso na fila dela
  const vivo = g.locator('#board .gx-list[data-col="conferente"] .card[data-id="PV-10402"]');
  await expect(vivo).toHaveClass(/live/);
  await expect(vivo).toContainText("Conferindo agora");
  await expect(vivo).toHaveAttribute("draggable", "false");

  // o coordenador manda o PV-10404 para o INÍCIO da fila da Bruna; o posto dela mostra na mesma ordem
  await arrastar(g, "PV-10404", "conferente2", "inicio");
  await expect.poll(() => designado("PV-10404")).toEqual({ designado_para: "conferente2", ordem_fila: 1 });
  const { page: bruna } = await posto(browser, "conferente2");
  await expect.poll(() => idsDaFila(bruna)).toEqual(["PV-10404", "PV-10403"]);

  // a gaveta: o andamento da conferência e o conferido de cada item
  await vivo.click();
  const gav = g.locator("#drawer");
  await expect(gav.locator(".dr-head h2")).toHaveText("PV-10402");
  await expect(gav.locator(".dr-head .stage")).toHaveText(/Em conferência/);
  await expect(gav.locator(".dr-items thead")).toContainText("Conferido");
  await expect(gav.locator(".timeline")).toContainText("Conferência iniciada por");
  await expect(gav.locator("#gcMover")).toHaveCount(0); // em conferência não muda de fila
});

test("Montagem: pular conferência entrega o pedido direto à montagem", async ({ browser }) => {
  const m = await gestao(browser, "montagem");
  const card = m.locator('#board .gx-list[data-col="inbox"] .card[data-id="OP-3209"]');
  await expect(card).toBeVisible();
  await card.locator("[data-gcpular]").click();
  await expect(m.locator('#board .gx-list[data-col="done"] .card[data-id="OP-3209"]')).toContainText("Sem conferência");
  expect((await conferencia("OP-3209")).status).toBe("dispensada");
  // soltar em "Entregues à montagem" também dispensa
  await arrastar(m, "OP-3208", "done");
  await expect.poll(async () => (await conferencia("OP-3208")).status).toBe("dispensada");
});

// ---------- excesso trava o pedido (v68) ----------
test("excesso: o pedido não finaliza até a peça sair do volume (F9)", async ({ browser }) => {
  const { page: bruna } = await posto(browser, "conferente2");
  await expect.poll(() => idsDaFila(bruna)).toContain("PV-10403");
  await bruna.locator('#queueBody tr[data-id="PV-10403"]').click();
  await bruna.locator("#sGo").click();
  const o = await conferirTudo(bruna, "PV-10403");
  const db = await estoque(bruna);
  const i = o.itens.find((x) => x.sep > 0 && db.produtos.find((p) => p.codigo === x.sku)?.checkout !== false);
  // uma unidade a mais: F10 não abre a finalização
  await bipar(bruna, i.ean || i.sku);
  await expect(bruna.locator("#scanMsg")).toContainText("retire do volume (F9)");
  await bruna.keyboard.press("F10");
  await expect(bruna.locator("#mFinish")).toBeHidden();
  await expect(bruna.locator("#scanMsg")).toHaveText("Retire o excesso do volume antes de finalizar (F9).");
  await expect.poll(async () => (await contagem("PV-10403")).find((x) => x.produto === i.sku)?.qtd).toBe(i.sep + 1);
  // F9: bipar o que sai do volume; o que não sobra é recusado
  await bruna.keyboard.press("F9");
  const outro = o.itens.find((x) => x.sku !== i.sku && x.sep > 0);
  if (outro && db.produtos.find((p) => p.codigo === outro.sku)?.checkout !== false) {
    await bipar(bruna, outro.ean || outro.sku);
    await expect(bruna.locator("#scanMsg")).toHaveText(`${outro.sku} não tem excesso: não tire do volume.`);
  }
  await bipar(bruna, i.ean || i.sku);
  await expect(bruna.locator("#scanMsg")).toHaveText("Excesso retirado · continue a conferência");
  await expect.poll(async () => (await contagem("PV-10403")).find((x) => x.produto === i.sku)?.qtd).toBe(i.sep);
  await bruna.locator("#btnFinish").click();
  await bruna.locator("#fVol").fill("1");
  await bruna.locator("#fGo").click();
  await bruna.locator('#oTipos .o-add[data-add]').first().click();
  await bruna.locator("#oGo").click();
  await expect.poll(async () => (await conferencia("PV-10403")).status).toBe("conferido");
  // pré-visualizar a etiqueta: o servidor entrega a biblioteca do QR (vendor/)
  await bruna.locator("#dPreview").click();
  await expect(bruna.locator("#mPrint")).toBeVisible();
  await expect(bruna.locator("#pPreview .label .lb-qr")).toHaveCount(1);
});

// ---------- pedido dividido: a conferência começa com a primeira parte e só fecha com todas (v72) ----------
async function separarNoServidor(login, id) {
  const tk = (await (await fetch(`${endereco}/api/login`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ login, pin: usuario(login).pin }) })).json()).token;
  await pool.query("UPDATE pedidos SET designado_para = $2 WHERE id = $1", [id, login]);
  const itens = (await pool.query("SELECT sequencia, qtd FROM itens_pedido WHERE pedido_id = $1 ORDER BY sequencia", [id])).rows;
  let t = Date.parse("2026-11-19T10:00:00Z");
  const acao = (tipo, dados) => ({ id: crypto.randomUUID(), tipo, dados, feitaEm: new Date((t += 1000)).toISOString() });
  const r = await (await fetch(`${endereco}/api/sincronizar`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${tk}` },
    body: JSON.stringify({ acoes: [acao("separacao.iniciar", { pedido: id }),
      ...itens.map((i) => acao("separacao.item", { pedido: id, sequencia: i.sequencia, qtdSeparada: Number(i.qtd), status: "ok" })),
      acao("separacao.concluir", { pedido: id, doca: "R9002-P1-A100-AP102" })] }) })).json();
  expect(r.recusadas).toEqual([]);
  await fetch(`${endereco}/api/logout`, { method: "POST", headers: { authorization: `Bearer ${tk}` } });
}

test("pedido dividido: confere a parte que chegou, não finaliza até a outra parte terminar", async ({ browser }) => {
  // a 2/2 termina antes da 1/2
  await separarNoServidor("separador2", "PV-10426/2");
  await pool.query("UPDATE conferencias SET designado_para = 'conferente', ordem_fila = 0 WHERE pedido = 'PV-10426'");
  const { page: ana } = await posto(browser, "conferente");
  await expect.poll(() => idsDaFila(ana)).toContain("PV-10426");
  const linha = ana.locator('#queueBody tr[data-id="PV-10426"]');
  await expect(linha).toContainText("Parte 1/2 em separação");
  await expect(linha.locator(".doca-chip.cf-parte-espera")).toContainText("1/2 em separação");
  await linha.click();
  await ana.locator("#sGo").click();
  await responderObservacao(ana);

  const pedido = () => ana.evaluate(async () =>
    (await import("/js/dados/conferencia.js")).carregarConferencia("exp", { servidor: true }).orders.find((x) => x.id === "PV-10426"));
  let o = await pedido();
  const espera = o.itens.filter((i) => !i.sep && i.espera?.length);
  expect(espera.length).toBeGreaterThan(0);
  await expect(ana.locator("#itemsBody tr.cf-espera")).toHaveCount(espera.length);
  await expect(ana.locator("#cfPartes")).toBeVisible();
  // a peça da parte em separação não conta
  await bipar(ana, espera[0].ean || espera[0].sku);
  await expect(ana.locator("#scanMsg")).toContainText("ainda em separação");
  // F10 travado
  await ana.keyboard.press("F10");
  await expect(ana.locator("#mFinish")).toBeHidden();
  await expect(ana.locator("#scanMsg")).toContainText("Aguardando a parte 1/2");
  // pode voltar à fila: o pedido continua com ela, em conferência
  await ana.keyboard.press("F2");
  await expect(linha).toContainText("Em conferência · parte 1/2 em separação");
  await linha.click();
  await expect(ana.locator("#order")).toBeVisible();

  // na Gestão: o card na fila da Ana, com a faixa da parte em separação e só a doca da parte pronta
  const g = await gestao(browser, "coordenador");
  const card = g.locator('#board .gx-list[data-col="conferente"] .card[data-id="PV-10426"]');
  await expect(card.locator(".gc-parte-espera")).toHaveText(/Parte 1\/2 em separação/);
  await expect(card.locator(".c-doca")).not.toContainText("1/2");

  // a 1/2 termina: os itens dela entram na mesma tela, e agora finaliza
  await separarNoServidor("separador", "PV-10426/1");
  // o posto confere a cada 30 s; o teste avisa "rede voltou" até a parte aparecer (uma atualização pode estar no meio)
  await expect.poll(async () => {
    await ana.evaluate(() => window.dispatchEvent(new Event("online")));
    return ana.locator("#cfPartes").isHidden();
  }, { timeout: 20_000, intervals: [500, 1000, 2000] }).toBe(true);
  await expect(ana.locator("#itemsBody tr.cf-espera")).toHaveCount(0);
  await conferirTudo(ana, "PV-10426");
  await finalizarConferencia(ana, 1);
  await expect.poll(async () => (await conferencia("PV-10426")).status).toBe("conferido");
});
