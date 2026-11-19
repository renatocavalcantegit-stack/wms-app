// Fase 2 de ponta a ponta, com o SERVIDOR DE VERDADE (Fastify + banco de teste wms_teste):
// o posto da conferência mostra só a fila do conferente, abre o resumo "Iniciar conferência",
// manda as ações pela fila de envio (também sem rede) e o servidor decide conferido ou divergente.
//
// Precisa do PostgreSQL e do server/.env (o mesmo dos testes do servidor). Sem o .env, o teste é pulado.
import { test, expect } from "@playwright/test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { bipar, finalizarConferencia, estoque } from "./ajuda.js";

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
