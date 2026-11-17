// Fase 1b de ponta a ponta, com o SERVIDOR DE VERDADE (Fastify + banco de teste wms_teste):
// o separador entra, começa um pedido, a rede cai, ele termina tudo sem rede e, quando a rede volta,
// a fila vai sozinha para o servidor.
//
// Precisa do PostgreSQL e do server/.env (o mesmo dos testes do servidor). Sem o .env, o teste é pulado.
import { test, expect } from "@playwright/test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { separacao, abrirPedidoNoColetor, separarItem, lerDoca } from "./ajuda.js";

const ENV = resolve(import.meta.dirname, "..", "server", ".env");
test.skip(!existsSync(ENV), "sem server/.env: este teste precisa do banco");

let pool, servidor, endereco;
test.beforeAll(async () => {
  process.loadEnvFile(ENV);
  const { prepararBancoDeTeste } = await import("../server/testes/banco-de-teste.js");
  const { criarServidor } = await import("../server/src/servidor.js");
  pool = await prepararBancoDeTeste();
  servidor = criarServidor({ pool });
  endereco = await servidor.listen({ port: 0, host: "127.0.0.1" });
});
test.afterAll(async () => {
  await servidor?.close();
  await pool?.end();
});

const pedidoNoBanco = async (id) => (await pool.query("SELECT status, separador, doca FROM pedidos WHERE id = $1", [id])).rows[0];
const itensNoBanco = async (id) => (await pool.query("SELECT status FROM itens_pedido WHERE pedido_id = $1 ORDER BY sequencia", [id])).rows.map((r) => r.status);

test("sem rede no meio da separação: o coletor termina o pedido e a fila vai para o servidor quando a rede volta", async ({ page, context }) => {
  const { USERS } = await import("../js/sessao.js");
  const separador = USERS.find((u) => u.perfil === "sep");

  // login no servidor (o PIN é conferido lá) e setor Expedição
  await page.goto(`${endereco}/`);
  await page.locator("#loginName").fill(separador.login);
  await page.locator("#loginPin").fill(separador.pin);
  await page.locator("#loginForm button[type=submit]").click();
  await page.locator('[data-setor="exp"]').click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("wms-bb-session")).token)).toBeTruthy();
  await expect(page.locator("#viewHome .sinc-estado")).toBeVisible();

  // começa o pedido com rede: o servidor fica sabendo na hora
  await abrirPedidoNoColetor(page, "PV-10421");
  await expect.poll(async () => (await pedidoNoBanco("PV-10421")).status).toBe("andamento");
  expect((await pedidoNoBanco("PV-10421")).separador).toBe(separador.login);

  // a rede cai: o separador continua sem esperar nada
  await context.setOffline(true);
  const pedido = (await separacao(page)).find((o) => o.id === "PV-10421");
  for (const item of pedido.itens) await separarItem(page, item);
  await lerDoca(page, "R9002-P1-A100-AP101");
  await expect(page.locator("#doneDoca")).toContainText("R9002-P1-A100-AP101");

  // o que foi feito está na fila do aparelho; o servidor ainda não sabe
  const naFila = await page.evaluate(() => JSON.parse(localStorage.getItem("wms-bb-fila-v1")).length);
  expect(naFila).toBe(pedido.itens.length + 1); // um por item + a doca
  await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem("wms-bb-sinc-v1"))?.semRedeDesde)).toBeTruthy();
  expect((await pedidoNoBanco("PV-10421")).status).toBe("andamento");
  expect(await itensNoBanco("PV-10421")).toEqual(pedido.itens.map(() => "pendente"));

  // a rede volta: a fila vai sozinha (sem o separador fazer nada) e o pedido fica concluído no servidor
  await context.setOffline(false);
  await expect.poll(async () => (await pedidoNoBanco("PV-10421")).status, { timeout: 15_000 }).toBe("concluido");
  expect((await pedidoNoBanco("PV-10421")).doca).toBe("R9002-P1-A100-AP101");
  expect(await itensNoBanco("PV-10421")).toEqual(pedido.itens.map(() => "ok"));
  await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem("wms-bb-fila-v1")).length)).toBe(0);
});
