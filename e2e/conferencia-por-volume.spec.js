// v80: conferência da nota POR VOLUME (palete ou caixa) no coletor do estoquista (demonstração, sem servidor).
// Cria os volumes (as etiquetas saem na hora), abre um volume pela lista, vincula os produtos e endereça o volume
// inteiro na doca. A Gestão mostra o volume no detalhe da nota.
import { test, expect } from "@playwright/test";
import { entrar, estoque, saldo } from "./ajuda.js";

test.beforeEach(async ({ page }) => {
  // conta as impressões em vez de abrir a janela de impressão
  await page.addInitScript(() => { window.impressoes = []; window.print = () => window.impressoes.push(document.querySelector("#printArea").innerText); });
  page.on("pageerror", (e) => console.log("ERRO NA PÁGINA:", page.url(), e.message));
});

async function lerNo(page, campo, valor) {
  await page.locator(campo).fill(String(valor));
  await page.locator(campo).press("Enter");
}

test("por volume: cria e imprime, vincula os produtos, endereça o palete inteiro e a Gestão mostra o volume", async ({ page }) => {
  const DOCA = "608004";
  await entrar(page, "estoquista", "estoque.html");
  const inicio = await estoque(page);
  const nota = inicio.notas.find((n) => String(n.numero) === "48213");
  const docaCodigo = inicio.enderecos.find((e) => e.id === +DOCA).codigo;
  const antes167 = saldo(inicio, docaCodigo, "167"), antes536 = saldo(inicio, docaCodigo, "536");

  await page.locator('[data-ir="viewRecConf"]').click();
  await page.locator(`[data-nota="${nota.id}"]`).click();
  await page.locator('[data-rcmodo="volume"]').click();
  await expect(page.locator("#rcPasso")).toHaveText("2 · Bipe ou toque no volume");

  // cria 2 paletes: as 2 etiquetas saem na hora
  await page.locator("[data-rccriar]").click();
  await page.locator("#rcVolForm input[name=quantos]").fill("2");
  await page.locator("#rcVolForm button.primary").click();
  await expect(page.locator("#rcMsg")).toContainText("2 volume(s)");
  expect(await page.evaluate(() => window.impressoes.length)).toBe(1);
  expect(await page.evaluate(() => window.impressoes[0])).toContain("PALETE");
  await expect(page.locator("[data-rcvol]")).toHaveCount(2);
  await expect(page.locator("[data-rcvol]").first()).toContainText("Gerado");

  // abre o primeiro tocando na lista e vincula dois produtos
  const codigo = await page.locator("[data-rcvol]").first().getAttribute("data-rcvol");
  await page.locator("[data-rcvol]").first().click();
  await expect(page.locator("#rcEnderecarVol")).toBeDisabled(); // vazio não endereça
  await lerNo(page, "#rcInput", "167");
  await page.locator("#rcQtdForm input[name=qtd]").fill("20");
  await page.locator("#rcQtdForm input[name=qtd]").press("Enter");
  await expect(page.locator("#rcMsg")).toContainText("+20 167 no volume");
  await lerNo(page, "#rcInput", "536");
  await page.locator("#rcQtdForm input[name=qtd]").fill("41"); // a nota tem 40
  await page.locator("#rcQtdForm input[name=qtd]").press("Enter");
  await expect(page.locator("#rcMsg")).toContainText("PENDENTE");
  await page.locator("#rcQtdForm input[name=qtd]").fill("4");
  await page.locator("#rcQtdForm input[name=qtd]").press("Enter");
  await expect(page.locator(".rc-lista")).toContainText("Produtos no volume (2)");

  // reimprime a etiqueta do volume aberto
  await page.locator("#rcImprimir").click();
  expect(await page.evaluate(() => window.impressoes.length)).toBe(2);

  // finalizar com volume montando é bloqueado (volta para a lista de volumes primeiro)
  await page.locator("#viewRecConf [data-rcvoltar]").click();
  await page.locator("#rcFinalizar").click();
  await expect(page.locator("#rcMsg")).toContainText("VOLUMES COM PRODUTOS SEM DOCA");

  // abre de novo bipando a etiqueta e endereça o volume inteiro
  await lerNo(page, "#rcInput", codigo);
  await page.locator("#rcEnderecarVol").click();
  await lerNo(page, "#rcInput", DOCA);
  await expect(page.locator("#rcMsg")).toContainText(`${codigo} (palete) na ${docaCodigo}`);
  await expect(page.locator(`[data-rcvol="${codigo}"]`)).toContainText("Endereçado");
  const db = await estoque(page);
  expect(saldo(db, docaCodigo, "167")).toBe(antes167 + 20);
  expect(saldo(db, docaCodigo, "536")).toBe(antes536 + 4);

  // endereçado, o volume fecha: abre só para consultar e reimprimir
  await page.locator(`[data-rcvol="${codigo}"]`).click();
  await expect(page.locator("#rcForm")).toBeHidden();
  await expect(page.locator("#rcEnderecarVol")).toBeHidden();

  // a Gestão mostra o volume com os produtos
  await entrar(page, "gestorEstoque", "gestao-estoque.html");
  await page.locator('[data-aba="entrada"]').click();
  await page.locator(`[data-nota="${nota.id}"]`).first().click();
  await expect(page.locator(".ge-vol-h")).toContainText("Volumes (palete ou caixa) · 1");
  await expect(page.locator(`[data-reimprimirvol="${codigo}"]`)).toBeVisible();
});
