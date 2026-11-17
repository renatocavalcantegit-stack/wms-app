// Coletor de tela pequena (Chainway C6000: 4", 480×800 → cerca de 320×453 no Chrome).
// Na separação tudo tem que caber sem rolar, o campo de bipe já vem focado, o erro aparece
// numa faixa no topo e o teclado travado no modo Fn é avisado (o app não usa teclas F no coletor).
import { test, expect } from "@playwright/test";
import { entrar, separacao, abrirPedidoNoColetor, ler } from "./ajuda.js";

test.use({ viewport: { width: 320, height: 453 } });

// o elemento está inteiro dentro da tela (sem precisar rolar)?
async function visivelSemRolar(page, seletor) {
  const caixa = await page.locator(seletor).boundingBox();
  expect(caixa, seletor).not.toBeNull();
  expect(caixa.y, `${seletor} começa dentro da tela`).toBeGreaterThanOrEqual(0);
  expect(caixa.y + caixa.height, `${seletor} termina dentro da tela`).toBeLessThanOrEqual(453);
}

test("separação no coletor pequeno: tudo à vista, campo focado, erro no topo e aviso de Fn travado", async ({ page }) => {
  await entrar(page, "separador");
  await abrirPedidoNoColetor(page, "PV-10421");
  const item = (await separacao(page)).find((o) => o.id === "PV-10421").itens[0];

  // o campo de bipe já vem focado: o gatilho do leitor "digita" direto nele
  await expect(page.locator("#scanInput")).toBeFocused();
  for (const s of ["#addrCard", ".product", "#qtyForm", "#scanForm", "#btnShort", "#btnConfirm"]) await visivelSemRolar(page, s);

  // o gatilho SCAN do C6000 envia F9 antes de cada código: não é o Fn travado, o bipe segue normal
  await page.keyboard.press("F9");
  await expect(page.locator("#toast")).toBeHidden();

  // endereço errado: faixa vermelha no topo com o endereço certo
  await ler(page, "R999-P1-A0-AP1");
  await expect(page.locator("#pickAlerta")).toContainText(`VÁ PARA ${item.end}`);
  await visivelSemRolar(page, "#pickAlerta");

  // endereço certo: o alerta some e o campo continua focado para o produto
  await ler(page, item.end);
  await expect(page.locator("#pickAlerta")).toBeHidden();
  await expect(page.locator("#scanInput")).toBeFocused();

  // a lista de itens abre pelo botão; fechando, o foco volta para o campo de bipe
  await page.locator("#pickListBtn").click();
  await expect(page.locator("#sheetList")).toBeVisible();
  await page.locator("#scrim").click({ position: { x: 10, y: 10 } });
  await expect(page.locator("#scanInput")).toBeFocused();

  // foco automático NÃO sobe o teclado da tela; tocar no campo sobe (com teclado de texto)
  await expect(page.locator("#scanInput")).toHaveAttribute("inputmode", "none");
  await page.locator("#scanInput").click();
  await expect(page.locator("#scanInput")).toBeFocused();
  await expect(page.locator("#scanInput")).toHaveAttribute("inputmode", "text");
  // o próximo foco automático (quantidade, depois de bipar o produto) volta a ser sem teclado
  await ler(page, item.ean || item.sku);
  await expect(page.locator("#qtyInput")).toBeFocused();
  await expect(page.locator("#qtyInput")).toHaveAttribute("inputmode", "none");

  // teclado travado no modo Fn: o "1" do código chega como F1. O app avisa, não abre nada e descarta o bipe estragado.
  await page.keyboard.press("F1");
  await expect(page.locator("#toast")).toContainText("MODO Fn");
  await expect(page.locator("#sheetShort")).toBeHidden();
  await page.locator("#qtyInput").press("Enter");
  await expect(page.locator("#viewPick")).toBeVisible(); // o Enter do bipe estragado não confirmou o item
  await expect(page.locator("#pickStep")).toContainText("Item 1");
});
