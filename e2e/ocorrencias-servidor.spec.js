// Ocorrências do pedido (v75) de ponta a ponta, com o SERVIDOR DE VERDADE (Fastify + banco de teste wms_teste):
// o gestor corta item de um pedido que está com alguém, o aparelho dessa pessoa fica sabendo sozinho (a cada 15 s)
// e, quando ela confirma, a devolução nasce no servidor como entrada pendente do estoque.
//
// Precisa do PostgreSQL e do server/.env (o mesmo dos testes do servidor). Sem o .env, o teste é pulado.
import { test, expect } from "@playwright/test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { abrirPedidoNoColetor, separarItem, bipar } from "./ajuda.js";

const ENV = resolve(import.meta.dirname, "..", "server", ".env");
test.skip(!existsSync(ENV), "sem server/.env: este teste precisa do banco");

let pool, servidor, endereco, USERS, registrarOcorrencia;
test.beforeAll(async () => {
  process.loadEnvFile(ENV);
  const { prepararBancoDeTeste } = await import("../server/testes/banco-de-teste.js");
  const { criarServidor } = await import("../server/src/servidor.js");
  ({ registrarOcorrencia } = await import("../server/src/consultas/ocorrencias.js"));
  ({ USERS } = await import("../js/sessao.js"));
  pool = await prepararBancoDeTeste();
  servidor = criarServidor({ pool });
  endereco = await servidor.listen({ port: 0, host: "127.0.0.1" });
});
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
async function aparelho(browser, login, viewport) {
  const context = await browser.newContext({ viewport });
  abertos.push(context);
  const page = await context.newPage();
  await page.addInitScript(() => { window.print = () => {}; });
  await page.goto(`${endereco}/`);
  await page.locator("#loginName").fill(login);
  await page.locator("#loginPin").fill(usuario(login).pin);
  await page.locator("#loginForm button[type=submit]").click();
  return page;
}
// o gestor de expedição registra na aba Ocorrências (a mesma função que a rota POST /api/ocorrencias chama)
const gestorCorta = (pedido, cortes) => registrarOcorrencia(pool,
  { setor: "exp", pedido, tipo: "corte", cortes, motivo: "desistencia", referencia: "ALT-1" }, { login: "coordenador", nome: "Gestor" });
const devolucoes = async (pedido) => (await pool.query(
  `SELECT d.origem, d.entregue_por, json_agg(json_build_object('produto', i.produto, 'qtd', i.qtd::float)) AS itens
     FROM devolucoes d JOIN devolucao_itens i ON i.devolucao_id = d.id WHERE d.pedido = $1 GROUP BY d.id ORDER BY d.id`, [pedido])).rows;
const item = async (pedido, produto) => (await pool.query(
  `SELECT qtd::float, qtd_separada::float AS sep, qtd_devolver::float AS devolver FROM itens_pedido WHERE pedido_id = $1 AND produto = $2`,
  [pedido, produto])).rows[0];

test("corte com o separador no meio: o coletor avisa sozinho e a confirmação vira entrada no servidor", async ({ browser }) => {
  const ana = await aparelho(browser, "separador", { width: 412, height: 860 });
  await ana.locator('[data-setor="exp"]').click();
  await abrirPedidoNoColetor(ana, "PV-10421");
  await separarItem(ana, { end: "R0-P0-A100-AP101", sku: "536", qtd: 6 });
  await expect.poll(() => item("PV-10421", "536")).toEqual({ qtd: 6, sep: 6, devolver: 0 });

  await gestorCorta("PV-10421", { 536: 4 });
  expect(await item("PV-10421", "536")).toEqual({ qtd: 4, sep: 6, devolver: 2 });
  // o coletor confere o pedido aberto a cada 15 s
  await expect(ana.locator("#sheetGestor")).toBeVisible({ timeout: 25_000 });
  await expect(ana.locator("#sgItens")).toContainText("devolver 2");
  await ana.locator("#sgOk").click();
  await expect.poll(() => item("PV-10421", "536")).toEqual({ qtd: 4, sep: 4, devolver: 0 });
  expect(await devolucoes("PV-10421")).toEqual([{ origem: "separador", entregue_por: "separador", itens: [{ produto: "536", qtd: 2 }] }]);
  expect((await pool.query("SELECT ocorrencia_pendente FROM pedidos WHERE id = 'PV-10421'")).rows[0].ocorrencia_pendente).toBe(false);
});

test("corte com o pedido em conferência: o posto pede para tirar da caixa (F9) e a entrega vira entrada", async ({ browser }) => {
  const bia = await aparelho(browser, "conferente", { width: 1366, height: 768 });
  await expect(bia).toHaveURL(/conferencia\.html/);
  await bia.locator('#mSetor [data-setor="exp"]').click();
  await bia.locator('#queueBody tr[data-id="PV-10401"]').click();
  await bia.keyboard.press("Enter");
  await expect(bia.locator("#order")).toBeVisible();
  await expect.poll(async () => (await pool.query("SELECT status FROM conferencias WHERE pedido = 'PV-10401'")).rows[0].status).toBe("andamento");

  const i = (await pool.query(
    `SELECT i.produto, i.qtd_separada::float AS sep FROM itens_pedido i
      WHERE i.pedido_id = 'PV-10401' AND i.qtd_separada > 1 ORDER BY i.sequencia LIMIT 1`)).rows[0];
  await gestorCorta("PV-10401", { [i.produto]: i.sep - 1 });
  // o posto confere o pedido aberto a cada 15 s
  await expect(bia.locator("#cfDev")).toContainText("tirar 1", { timeout: 25_000 });
  await bia.keyboard.press("F10");
  await expect(bia.locator("#scanMsg")).toContainText("Faça a devolução");
  await bia.keyboard.press("F9");
  await bipar(bia, i.produto);
  await expect(bia.locator("#cfDev")).toContainText("Entregue ao estoque");
  await expect.poll(() => devolucoes("PV-10401")).toEqual([{ origem: "conferente", entregue_por: "conferente", itens: [{ produto: i.produto, qtd: 1 }] }]);
  expect(await item("PV-10401", i.produto)).toMatchObject({ sep: i.sep - 1, devolver: 0 });
});

test("o pedido aberto na aba Ocorrências se atualiza sozinho, sem perder o que o gestor digitou", async ({ browser }) => {
  const g = await aparelho(browser, "coordenador", { width: 1366, height: 768 });
  await expect(g).toHaveURL(/gestao\.html/);
  await g.locator('.gx-tab[data-board="ocorr"]').click();
  await g.locator('[data-oc-busca] input[name="pedido"]').fill("PV-10422");
  await g.locator("[data-oc-busca] button").click();
  await expect(g.locator(".oc-etapa")).toHaveText("Aguardando separação");
  await g.locator('input[name="referencia"]').fill("ALT-55");

  const ana = await aparelho(browser, "separador", { width: 412, height: 860 });
  await ana.locator('[data-setor="exp"]').click();
  await abrirPedidoNoColetor(ana, "PV-10422");
  await expect(g.locator(".oc-etapa")).toHaveText("Em separação", { timeout: 20_000 });
  await expect(g.locator('input[name="referencia"]')).toHaveValue("ALT-55");
});

// cancelamento (ajuste de 23/11/2026 à tarde): ninguém bipa; quem está com a caixa só marca "Entregue ao estoque"
const gestorCancela = (pedido) => registrarOcorrencia(pool,
  { setor: "exp", pedido, tipo: "cancelamento", motivo: "desistencia", referencia: "CAN-1" }, { login: "coordenador", nome: "Gestor" });
const situacao = async (pedido) => (await pool.query(
  "SELECT origem, status, responsavel, entregue_por FROM devolucoes WHERE pedido = $1 ORDER BY id", [pedido])).rows;

test("cancelado com o separador no meio: o coletor pede a entrega e ela fica registrada no servidor", async ({ browser }) => {
  const i = (await pool.query(
    `SELECT endereco_codigo AS "end", produto AS sku, qtd::float FROM itens_pedido WHERE pedido_id = 'PV-10423' ORDER BY sequencia LIMIT 1`)).rows[0];
  await pool.query("UPDATE pedidos SET designado_para = 'separador', ordem_fila = 9 WHERE id = 'PV-10423'");
  const ana = await aparelho(browser, "separador", { width: 412, height: 860 });
  await ana.locator('[data-setor="exp"]').click();
  await abrirPedidoNoColetor(ana, "PV-10423");
  await separarItem(ana, i);
  await expect.poll(async () => (await item("PV-10423", i.sku)).sep).toBe(i.qtd);

  await gestorCancela("PV-10423");
  expect(await situacao("PV-10423")).toEqual([{ origem: "separador", status: "a_entregar", responsavel: "separador", entregue_por: null }]);
  // o coletor confere o pedido aberto a cada 15 s
  await expect(ana.locator("#sgOk")).toHaveText("Entregue ao estoque", { timeout: 25_000 });
  await ana.locator("#sgOk").click();
  await expect(ana.locator("#toast")).toContainText("Entrega registrada");
  await expect.poll(() => situacao("PV-10423")).toEqual([{ origem: "separador", status: "pendente", responsavel: "separador", entregue_por: "separador" }]);
});

test("cancelado na fila do conferente: o posto mostra \"Cancelado · entregar ao estoque\" e registra a entrega", async ({ browser }) => {
  await pool.query("UPDATE conferencias SET designado_para = 'conferente' WHERE pedido = 'PV-10402'");
  await gestorCancela("PV-10402");
  expect(await situacao("PV-10402")).toEqual([{ origem: "conferente", status: "a_entregar", responsavel: "conferente", entregue_por: null }]);
  const bia = await aparelho(browser, "conferente", { width: 1366, height: 768 });
  await expect(bia).toHaveURL(/conferencia\.html/);
  await bia.locator('#mSetor [data-setor="exp"]').click();
  const linha = bia.locator('#queueBody tr[data-id="PV-10402"]');
  await expect(linha).toContainText("Cancelado · entregar ao estoque");
  await linha.click();
  await expect(bia.locator("#sGo")).toContainText("Entregue ao estoque");
  await bia.keyboard.press("Enter");
  await expect(bia.locator("#toast")).toContainText("Entrega registrada");
  await expect(linha).toHaveCount(0);
  await expect.poll(() => situacao("PV-10402")).toEqual([{ origem: "conferente", status: "pendente", responsavel: "conferente", entregue_por: "conferente" }]);
});
