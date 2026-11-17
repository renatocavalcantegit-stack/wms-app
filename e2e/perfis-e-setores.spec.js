// Cenários que cruzam perfis e setores: o checkout que o gestor desliga na web muda a Conferência,
// a Montagem (OP) anda separada da Expedição e cada perfil só chega na sua tela.
import { test, expect } from "@playwright/test";
import {
  entrar, estoque, separacao, conferencia, separarPedido, abrirNaConferencia, bipar, finalizarConferencia,
} from "./ajuda.js";

test("checkout desligado na web: a conferência pede a quantidade; ligado, conta um por bipe", async ({ page }) => {
  // o gestor desliga o checkout do 536 na gaveta do produto
  await entrar(page, "gestorEstoque", "gestao-estoque.html");
  await page.locator('[data-aba="produtos"]').click();
  await page.locator('input[data-f="busca"]').fill("536");
  await page.locator('tr[data-produto="536"]').click();
  await page.locator('[data-checkout="0"]').click();
  expect((await estoque(page)).produtos.find((p) => p.codigo === "536").checkout).toBe(false);

  await entrar(page, "separador");
  await separarPedido(page, "PV-10421", "R9002-P1-A100-AP101");

  await entrar(page, "conferente", "conferencia.html");
  await abrirNaConferencia(page, "PV-10421");
  const o = (await conferencia(page)).find((x) => x.id === "PV-10421");
  const i536 = o.itens.find((i) => i.sku === "536"), i176 = o.itens.find((i) => i.sku === "176");
  await expect(page.locator('#order tr[data-sku="536"]')).toContainText("Granel");
  await expect(page.locator('#order tr[data-sku="176"]')).toContainText("Checkout");

  // granel: um bipe abre a quantidade já com o que falta; Enter lança tudo
  await bipar(page, i536.ean || "536");
  await expect(page.locator(".pos-mult")).toHaveClass(/granel/);
  await expect(page.locator("#mult")).toHaveValue(String(i536.sep));
  await page.locator("#mult").press("Enter");
  await expect(page.locator('#order tr[data-sku="536"] td.conf')).toHaveText(String(i536.sep));

  // checkout: cada bipe conta uma unidade
  await bipar(page, i176.ean);
  await expect(page.locator('#order tr[data-sku="176"] td.conf')).toHaveText("1");
});

test("Montagem: a OP separada vai só para a conferência da Montagem e termina sem volumes nem embarque", async ({ page }) => {
  await entrar(page, "separadorMont");
  await separarPedido(page, "OP-3214", "R9002-P1-A100-AP106", "mont");
  expect((await separacao(page, "mont")).find((o) => o.id === "OP-3214").status).toBe("concluido");

  // a Expedição não vê a OP
  await entrar(page, "conferente", "conferencia.html");
  await expect(page.locator("#queueBody")).not.toContainText("OP-3214");

  // a Montagem confere e finaliza direto (sem volumes, observação e etiquetas)
  await entrar(page, "conferenteMont", "conferencia.html");
  await abrirNaConferencia(page, "OP-3214");
  const o = (await conferencia(page, "mont")).find((x) => x.id === "OP-3214");
  const db = await estoque(page);
  for (const i of o.itens) {
    if (db.produtos.find((p) => p.codigo === i.sku)?.checkout === false) {
      await bipar(page, i.sku); await page.locator("#mult").fill(String(i.sep)); await page.locator("#mult").press("Enter");
    } else for (let k = 0; k < i.sep; k++) await bipar(page, i.ean || i.sku);
  }
  await page.locator("#btnFinish").click();
  await expect(page.locator("#fVolF")).toBeHidden();
  await page.locator("#fGo").click();
  await expect(page.locator("#mDone")).toBeVisible();
  await expect(page.locator("#dSub")).toContainText("liberado para a montagem");
  const conf = (await conferencia(page, "mont")).find((x) => x.id === "OP-3214").conf;
  expect([conf.status, conf.volumes]).toEqual(["conferido", 0]);

  // o Embarque não recebe OP
  await entrar(page, "embarque");
  await expect(page.locator(".carga").first()).toBeVisible();
  const cargas = await page.evaluate(async () => {
    const chave = Object.keys(localStorage).find((k) => /^wms-bb-emb-v\d+$/.test(k));
    return chave ? JSON.parse(localStorage.getItem(chave)) : [];
  });
  expect(JSON.stringify(cargas)).not.toContain("OP-3214");
  await expect(page.locator("body")).not.toContainText("OP-3214");
});

// cada perfil: a tela dele abre; qualquer outra devolve para a dele
const TELAS = ["index.html", "conferencia.html", "gestao.html", "montagem.html", "estoque.html", "gestao-estoque.html"];
const CASA = {
  separador: { tela: "index.html", view: "#viewHome" },
  embarque: { tela: "index.html", view: "#viewEmbHome" },
  conferente: { tela: "conferencia.html" },
  coordenador: { tela: "gestao.html" },
  montagem: { tela: "montagem.html" },
  estoquista: { tela: "estoque.html", view: "#viewEstHome" },
  gestorEstoque: { tela: "gestao-estoque.html" },
};
for (const [perfil, casa] of Object.entries(CASA)) {
  test(`perfil ${perfil}: só chega na própria tela`, async ({ page }) => {
    for (const tela of TELAS) {
      await entrar(page, perfil, tela);
      await page.waitForURL((u) => u.pathname.endsWith(`/${casa.tela}`) || (casa.tela === "index.html" && u.pathname.endsWith("/")));
      await page.waitForLoadState("load");
      expect(new URL(page.url()).pathname, `${perfil} abrindo ${tela}`).toMatch(casa.tela === "index.html" ? /\/(index\.html)?$/ : new RegExp(`/${casa.tela}$`));
      if (casa.view) await expect(page.locator(casa.view), `${perfil} abrindo ${tela}`).toBeVisible();
    }
    // sem sessão, tudo volta para o login
    await page.evaluate(() => localStorage.removeItem("wms-bb-session"));
    for (const tela of TELAS) {
      await page.goto(tela);
      await expect(page.locator("#viewLogin")).toBeVisible();
    }
  });
}
