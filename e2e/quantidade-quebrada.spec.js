// Quantidade quebrada (ex.: 101,5 UN de raios): o separador digita com vírgula, o picking baixa o valor
// quebrado e a conferência a granel lança o mesmo valor. O bipe de produto com checkout continua 1 por 1.
import { test, expect } from "@playwright/test";
import {
  entrar, estoque, separacao, conferencia, saldo, abrirPedidoNoColetor, ler, digitarQuantidade, separarItem, lerDoca,
  abrirNaConferencia, bipar,
} from "./ajuda.js";

test("separa 1,5 com falta, o picking baixa 1,5 e a conferência a granel lança 1,5", async ({ page }) => {
  // granel: o gestor desliga o checkout do 536 (é como entra quantidade digitada na conferência)
  await entrar(page, "gestorEstoque", "gestao-estoque.html");
  await page.locator('[data-aba="produtos"]').click();
  await page.locator('input[data-f="busca"]').fill("536");
  await page.locator('tr[data-produto="536"]').click();
  await page.locator('[data-checkout="0"]').click();

  await entrar(page, "separador");
  await abrirPedidoNoColetor(page, "PV-10421");
  const pedido = (await separacao(page)).find((o) => o.id === "PV-10421");
  const i536 = pedido.itens.find((i) => i.sku === "536");
  expect(i536.qtd, "o item precisa pedir mais que 1,5 para a falta acontecer").toBeGreaterThan(1.5);
  const antes = saldo(await estoque(page), i536.end, "536");

  for (const item of pedido.itens) {
    if (item.sku !== "536") { await separarItem(page, item); continue; }
    if (!(await page.locator("#addrStatus").innerText()).includes("confirmado")) await ler(page, item.end);
    await ler(page, item.sku);
    // "1,5" tem vírgula: é quantidade, não código de barras
    await page.locator("#qtyInput").fill("1,5");
    await expect(page.locator("#btnConfirm")).toContainText(`Confirmar 1,5 de ${item.qtd}`);
    // mais de 3 casas é recusado na hora
    await page.locator("#qtyInput").fill("1,2345");
    await expect(page.locator("#scanMsg")).toContainText("Quantidade inválida");
    await expect(page.locator("#btnConfirm")).toBeDisabled();
    await digitarQuantidade(page, "1,5");
    await expect(page.locator("#sheetShort")).toBeVisible();
    await expect(page.locator("#shortQty")).toHaveValue("1,5");
    await page.locator("#shortReasons .chip").first().click();
    await page.locator("#shortGo").click();
  }
  await lerDoca(page, "R9002-P1-A100-AP101");

  const separado = (await separacao(page)).find((o) => o.id === "PV-10421").itens.find((i) => i.sku === "536");
  expect([separado.sep, separado.status]).toEqual([1.5, "falta"]);
  expect(saldo(await estoque(page), i536.end, "536")).toBeCloseTo(antes - 1.5, 3);

  // conferência: o granel abre com o que falta (1,5) e o Enter lança 1,5
  await entrar(page, "conferente", "conferencia.html");
  await abrirNaConferencia(page, "PV-10421");
  await bipar(page, i536.ean || "536");
  await expect(page.locator("#mult")).toHaveValue("1,5");
  await page.locator("#mult").fill("1,5");
  await page.locator("#mult").press("Enter");
  await expect(page.locator('#order tr[data-sku="536"] td.conf')).toHaveText("1,5");
  const o = (await conferencia(page)).find((x) => x.id === "PV-10421");
  expect(o.conf.itens["536"]).toBe(1.5);
});
