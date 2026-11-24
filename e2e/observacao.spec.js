// v76 — observação do pedido (o texto do vendedor que vem do Sankhya), na demonstração:
// separador e conferente leem no início e no fim; o embarque só quando o Sankhya marcar; a Gestão vê quem respondeu.
import { test, expect } from "@playwright/test";
import { entrar, separacao, ler, separarItem, abrirNaConferencia, conferirTudo, finalizarConferencia } from "./ajuda.js";

const ciencias = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("wms-bb-obs-ciencias-v1") || "[]")
  .map((c) => [c.pedido, c.papel, c.momento, c.resposta]));

test("separador: lê antes do primeiro item (tocar fora não fecha) e de novo antes da doca", async ({ page }) => {
  await entrar(page, "separador");
  const card = page.locator('button.order[data-id="PV-10421"]');
  await expect(card.locator(".obp-faixa")).toBeVisible();
  await card.click();
  await page.locator("#startGo").click();

  const folha = page.locator("#sheetObsPedido");
  await expect(folha).toBeVisible();
  await expect(page.locator("#obpTitulo")).toHaveText("Leia a observação do pedido");
  await expect(page.locator("#obpTexto .obp-texto")).not.toBeEmpty();
  await expect(page.locator("#obpNao")).toBeHidden();
  await page.locator("#scrim").click({ position: { x: 10, y: 10 } });
  await expect(folha).toBeVisible(); // obrigatória
  await page.locator("#obpOk").click();
  await expect(folha).toBeHidden();
  expect(await ciencias(page)).toEqual([["PV-10421", "separador", "inicio", "li"]]);

  // o botão do cabeçalho mostra de novo, só para ver
  await page.locator("#pickObsBtn").click();
  await expect(page.locator("#obpOk")).toHaveText("Fechar");
  await page.locator("#obpOk").click();
  expect((await ciencias(page)).length).toBe(1);

  const pedido = (await separacao(page)).find((o) => o.id === "PV-10421");
  for (const item of pedido.itens) await separarItem(page, item);
  await expect(page.locator("#obpTitulo")).toHaveText("Verifique novamente a observação");
  await expect(page.locator("#viewDoca")).toBeHidden();
  await page.locator("#obpNao").click();
  await expect(page.locator("#viewDoca")).toBeVisible();
  expect(await ciencias(page)).toEqual([["PV-10421", "separador", "inicio", "li"], ["PV-10421", "separador", "fim", "nao_era"]]);
  await page.locator("#docaInput").fill("R9002-P1-A100-AP101");
  await page.locator("#docaInput").press("Enter");
  await expect(page.locator("#doneDoca")).toContainText("R9002-P1-A100-AP101");

  // reabrir o coletor não pergunta de novo (a resposta ficou no aparelho)
  await page.reload();
  await expect(page.locator("#sheetObsPedido")).toBeHidden();
});

test("conferente: lê ao abrir o pedido e antes de finalizar (Esc e tocar fora não fecham)", async ({ page }) => {
  await entrar(page, "conferente", "conferencia.html");
  await expect(page.locator('#queueBody tr[data-id="PV-10401"] .obp-marca')).toBeVisible();
  await page.locator('#queueBody tr[data-id="PV-10401"]').click();
  if (await page.locator("#mStart").isVisible()) await page.locator("#sGo").click();
  await expect(page.locator("#mObsPedido")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#mObsPedido")).toBeVisible(); // Esc não fecha
  await page.keyboard.press("Enter");
  await expect(page.locator("#mObsPedido")).toBeHidden();
  await expect(page.locator("#aObs")).toBeVisible();

  await conferirTudo(page, "PV-10401");
  await page.locator("#btnFinish").click();
  await expect(page.locator("#obpTitulo")).toHaveText("Verifique novamente a observação");
  await page.locator("#obpOk").click(); // Li e apliquei → segue para os volumes
  await expect(page.locator("#mFinish")).toBeVisible();
  expect(await ciencias(page)).toEqual([["PV-10401", "conferente", "inicio", "li"], ["PV-10401", "conferente", "fim", "apliquei"]]);
});

test("embarque: só pede quando o Sankhya marcar, no 1º e no último volume", async ({ page }) => {
  await entrar(page, "embarque");
  await page.locator('.carga[data-id="CG-0232"]').click();
  await page.locator("#scGo").click();
  // PV-10403 não tem observação: não pede nada
  await page.locator("#loadInput").fill("PV-10403|1/2");
  await page.locator("#loadInput").press("Enter");
  await expect(page.locator("#sheetObsPedido")).toBeHidden();

  // PV-10424: marcada para o embarque
  await page.locator("#loadInput").fill("PV-10424|1/4");
  await page.locator("#loadInput").press("Enter");
  await expect(page.locator("#sheetObsPedido")).toBeVisible();
  await expect(page.locator("#obpOk")).toHaveText("Li e entendi");
  await page.locator("#obpOk").click();
  for (const v of [2, 3]) {
    await page.locator("#loadInput").fill(`PV-10424|${v}/4`);
    await page.locator("#loadInput").press("Enter");
    await expect(page.locator("#sheetObsPedido")).toBeHidden();
  }
  await page.locator("#loadInput").fill("PV-10424|4/4");
  await page.locator("#loadInput").press("Enter");
  await expect(page.locator("#obpTitulo")).toHaveText("Verifique novamente a observação");
  await page.locator("#obpOk").click();
  expect(await ciencias(page)).toEqual([["PV-10424", "embarque", "inicio", "li"], ["PV-10424", "embarque", "fim", "apliquei"]]);

  // o botão Obs. mostra a observação do pedido junto com a dos volumes
  await page.locator('[data-obs="PV-10424"]').first().click();
  await expect(page.locator("#soPed")).toBeVisible();
  await expect(page.locator("#soPedT")).toContainText("Rua 24 de Maio");
  await expect(page.locator("#soVol")).toBeVisible();
});
