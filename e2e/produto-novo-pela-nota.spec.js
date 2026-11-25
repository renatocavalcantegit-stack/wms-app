// v77 — o produto novo nasce da nota do ERP: "Buscar notas do ERP" cadastra o produto que o WMS não tem,
// mostra quantos foram cadastrados e avisa quando um código de barras já era de outro produto (demonstração).
import { test, expect } from "@playwright/test";
import { entrar } from "./ajuda.js";

test("buscar notas do ERP cadastra o produto novo e avisa o código de barras repetido", async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("ge-aba", "entrada"));
  await entrar(page, "gestorEstoque", "gestao-estoque.html");
  await page.locator("#btNotasErp").click();
  const modal = page.locator("#modal");
  await expect(modal).toContainText("NF 48232");
  await expect(modal).toContainText("1 produto(s) novo(s) cadastrado(s): 99001");
  await expect(modal.locator(".ge-imp.err", { hasText: "4717294987981" })).toBeVisible();
  await modal.locator("[data-fechar]").click();

  // no detalhe da nota: a etiqueta "Produto novo" e o aviso
  await page.locator("tr[data-nota]", { hasText: "48233" }).click();
  await expect(page.locator("#tela .ge-msg")).toContainText("já pertence ao produto 536");
  await expect(page.locator("#tela tr", { hasText: "99002" }).locator(".ge-st", { hasText: "Produto novo" })).toBeVisible();
  // o pneu 536 da 48232 já existia: não é "novo"
  await page.locator("[data-voltarlista]").click();
  await page.locator("tr[data-nota]", { hasText: "48232" }).click();
  await expect(page.locator("#tela tr", { hasText: "BICICLETA ARO 29" }).locator(".ge-st")).toHaveText("Produto novo");
  await expect(page.locator("#tela tr", { hasText: "PNEU 26" }).locator(".ge-st")).toHaveCount(0);
});
