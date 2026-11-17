// Coletor de tela pequena (Chainway C6000: 4", 480×800 → cerca de 320×453 no Chrome).
// Na separação tudo tem que caber sem rolar, o campo de bipe já vem focado, o erro aparece
// numa faixa no topo e as teclas físicas F1 (falta) e F2 (lista) funcionam.
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

test("separação no coletor pequeno: tudo à vista, campo focado, erro no topo e teclas F1/F2", async ({ page }) => {
  await entrar(page, "separador");
  await abrirPedidoNoColetor(page, "PV-10421");
  const item = (await separacao(page)).find((o) => o.id === "PV-10421").itens[0];

  // o campo de bipe já vem focado: o gatilho do leitor "digita" direto nele
  await expect(page.locator("#scanInput")).toBeFocused();
  for (const s of ["#addrCard", ".product", "#qtyForm", "#scanForm", "#btnShort", "#btnConfirm"]) await visivelSemRolar(page, s);

  // F1 antes de ler o endereço: não abre a falta, avisa no topo
  await page.keyboard.press("F1");
  await expect(page.locator("#sheetShort")).toBeHidden();
  await expect(page.locator("#pickAlerta")).toBeVisible();

  // endereço errado: faixa vermelha no topo com o endereço certo
  await ler(page, "R999-P1-A0-AP1");
  await expect(page.locator("#pickAlerta")).toContainText(`VÁ PARA ${item.end}`);
  await visivelSemRolar(page, "#pickAlerta");

  // endereço certo: o alerta some e o campo continua focado para o produto
  await ler(page, item.end);
  await expect(page.locator("#pickAlerta")).toBeHidden();
  await expect(page.locator("#scanInput")).toBeFocused();

  // F2 abre a lista de itens; fechando, o foco volta para o campo de bipe
  await page.keyboard.press("F2");
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

  // F1 depois do endereço: abre o registro de falta
  await page.keyboard.press("F1");
  await expect(page.locator("#sheetShort")).toBeVisible();
});
