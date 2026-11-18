// Quadro da Separação na Gestão de demonstração: marcar para o lote, achar o "Dividir" e arrastar até a última coluna.
import { test, expect } from "@playwright/test";
import { entrar } from "./ajuda.js";

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("index.html");
  await page.evaluate(() => localStorage.setItem("wms-bb-gx-sim", "off"));
  await entrar(page, "coordenador", "gestao.html");
});

test("marcar um pedido para o lote mostra o ✓ (antes ficava branco no branco)", async ({ page }) => {
  await page.locator('.col.inbox [data-selsep="PV-10432"]').click();
  await expect(page.locator(".lib-bar")).toContainText("1 marcado(s)");
  const cb = page.locator('.col.inbox [data-selsep="PV-10432"]');
  await expect(cb.locator("svg")).toBeVisible();
  expect(await cb.evaluate((e) => getComputedStyle(e).backgroundColor)).not.toBe("rgb(255, 255, 255)");
});

test("na gaveta do pedido, as ações (Dividir) aparecem sem precisar rolar até o fim", async ({ page }) => {
  await page.locator('.col.inbox .card[data-id="PV-10434"]').click();
  await expect(page.locator("#drDiv")).toBeInViewport();
  await page.locator("#drDiv").click();
  await expect(page.locator("#modal h2")).toContainText("Dividir a separação de PV-10434");
});

test("arrastando um card até perto da borda direita, o quadro rola sozinho", async ({ page }) => {
  // o Playwright não gera os eventos de arrastar com o botão apertado: o teste dispara os mesmos eventos do navegador
  const board = page.locator("#board");
  const antes = await board.evaluate((b) => b.scrollLeft);
  await page.evaluate(() => {
    const dt = new DataTransfer();
    const card = document.querySelector('.col.inbox .card[data-id="PV-10434"]');
    card.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: dt }));
    // a uns 60 px da borda direita (o navegador sozinho só rola colado nela)
    const alvo = document.elementFromPoint(window.innerWidth - 60, 450);
    alvo.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt, clientX: window.innerWidth - 60, clientY: 450 }));
  });
  await page.waitForTimeout(800);
  const durante = await board.evaluate((b) => b.scrollLeft);
  await page.evaluate(() => document.querySelector('.col.inbox .card[data-id="PV-10434"]').dispatchEvent(new DragEvent("dragend", { bubbles: true })));
  expect(durante).toBeGreaterThan(antes + 100);
  // soltou: para de rolar
  const parado = await board.evaluate((b) => b.scrollLeft);
  await page.waitForTimeout(300);
  expect(await board.evaluate((b) => b.scrollLeft)).toBe(parado);
});
