// Pedido aguardando (o cliente retira na empresa) e distribuição inteligente, na Gestão de demonstração.
import { test, expect } from "@playwright/test";
import { entrar } from "./ajuda.js";

test.beforeEach(async ({ page }) => {
  // simulação pausada: o quadro só muda pelo que o teste faz
  await page.goto("index.html");
  await page.evaluate(() => localStorage.setItem("wms-bb-gx-sim", "off"));
  await entrar(page, "coordenador", "gestao.html");
});

const caixa = (page) => page.locator(".col.inbox");

test("aguardando: entra como prioridade, sem rota; a distribuição inteligente manda direto e deixa o sem rota na caixa", async ({ page }) => {
  await expect(caixa(page).locator('.gchip[data-filter="aguardando"]')).toBeVisible();
  const ag = caixa(page).locator(".card", { has: page.locator(".rt.aguard") });
  await expect(ag).toHaveCount(1);
  await expect(ag).toContainText("PRIORIDADE");

  await page.locator('[data-act="intel"]').click();
  await expect(page.locator('[data-act="intel"]')).toContainText("ligada");
  await expect(caixa(page).locator(".gx-intel-sub")).toBeVisible();
  // o aguardando saiu da caixa e foi para um separador; o sem rota ficou para o coordenador
  await expect(ag).toHaveCount(0);
  await expect(page.locator(".col:not(.inbox) .rt.aguard").first()).toBeVisible();
  await expect(caixa(page).locator(".card.no-route").first()).toBeVisible();

  // desligar volta ao normal
  await page.locator('[data-act="intel"]').click();
  await expect(page.locator('[data-act="intel"]')).not.toContainText("ligada");
});

test("aguardando: depois do faturamento fica aguardando retirada, e o Acompanhamento tem a aba Aguardando", async ({ page }) => {
  await page.locator('.gx-tab[data-board="emb"]').click();
  const ret = page.locator(".col.ret-col");
  await expect(ret.locator(".count")).toHaveText("2");
  const id = await ret.locator(".card").first().getAttribute("data-id");
  await ret.locator(`[data-retirar="${id}"]`).click();
  await expect(page.locator("#toast")).toContainText(`${id} retirado pelo cliente`);
  await expect(ret.locator(".count")).toHaveText("1");

  await page.locator('.gx-tab[data-board="rota"]').click();
  await page.locator('[data-rota="aguardando"]').click();
  await expect(page.locator(".ac-rule")).toContainText("O cliente retira na empresa");
  await page.locator('[data-acf="fim"]').click();
  await expect(page.locator(`.ac-row[data-id="${id}"]`)).toContainText("Retirado pelo cliente");
});
