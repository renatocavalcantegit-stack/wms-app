// Ocorrências do pedido de ponta a ponta: o gestor corta ou cancela na aba Ocorrências e a mercadoria
// que sobrou volta ao estoque pela conferência (bipando) → doca de devolução → armazenamento.
import { test, expect } from "@playwright/test";
import {
  entrar, estoque, separacao, conferencia, saldo, separarPedido, abrirPedidoNoColetor, separarItem, lerDoca,
  abrirNaConferencia, bipar, finalizarConferencia, conferirTudo,
} from "./ajuda.js";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { window.print = () => {}; });
  page.on("dialog", (d) => d.accept()); // confirmações do navegador
});

// o gestor de expedição registra a ocorrência pela aba Ocorrências
async function ocorrencia(page, pedido, { cortes = {}, cancelar = false, referencia = "ALT-77" }) {
  await entrar(page, "coordenador", "gestao.html");
  await page.locator('.gx-tab[data-board="ocorr"]').click();
  await page.locator('[data-oc-busca] input[name="pedido"]').fill(pedido);
  await page.locator("[data-oc-busca] button").click();
  await expect(page.locator(".oc-id")).toHaveText(pedido);
  for (const [sku, q] of Object.entries(cortes)) await page.locator(`.oc-qtd[name="q-${sku}"]`).fill(String(q));
  await page.locator('select[name="motivo"]').selectOption("desistencia");
  await page.locator('input[name="referencia"]').fill(referencia);
  if (cancelar) {
    await page.locator("[data-oc-cancelar]").click();
    await page.locator("[data-oc-cancelar-sim]").click();
  } else {
    await page.locator("[data-oc-form] button.primary").click();
  }
  await expect(page.locator(".oc-msg.ok")).toBeVisible();
}
const docaDevolucao = async (page) => (await estoque(page)).enderecos.find((e) => e.tipo === "devolucao");

test("corte depois de separado: conferente tira da caixa, doca de devolução e o estoquista armazena", async ({ page }) => {
  await entrar(page, "separador");
  await separarPedido(page, "PV-10421", "R9002-P1-A100-AP101");
  const pick176 = saldo(await estoque(page), "R501-P2-A0-AP2", "176");

  await ocorrencia(page, "PV-10421", { cortes: { 176: 12 } });
  await expect(page.locator(".oc-msg.ok")).toContainText("8 un. voltam");
  await expect(page.locator(".oc-hist")).toContainText("176: 20→12 (devolver 8)");

  // conferência: o aviso aparece e finalizar fica bloqueado até devolver
  await entrar(page, "conferente", "conferencia.html");
  await abrirNaConferencia(page, "PV-10421");
  await expect(page.locator("#cfDev")).toContainText("tirar 8");
  await conferirTudo(page, "PV-10421"); // confere os 12 que ficam (e o resto do pedido)
  await page.keyboard.press("F10");
  await expect(page.locator("#scanMsg")).toContainText("Faça a devolução");
  await page.keyboard.press("F9");
  const ean = (await conferencia(page)).find((o) => o.id === "PV-10421").itens.find((i) => i.sku === "176").ean;
  for (let k = 0; k < 8; k++) await bipar(page, ean);
  await expect(page.locator("#scanMsg")).toContainText("leia o QR da doca de devolução");
  const doca = await docaDevolucao(page);
  await bipar(page, String(doca.id));
  await expect(page.locator("#cfDev")).toContainText("Devolução registrada");
  await finalizarConferencia(page, 1);
  expect((await conferencia(page)).find((o) => o.id === "PV-10421").conf.status).toBe("conferido");
  expect(saldo(await estoque(page), doca.codigo, "176")).toBe(8);

  // estoquista: a doca de devolução entra no Armazenamento como uma doca de recebimento
  await entrar(page, "estoquista", "estoque.html");
  await page.locator('[data-ir="viewRecArm"]').click();
  await page.locator("#raInput").fill(String(doca.id)); await page.locator("#raInput").press("Enter");
  await expect(page.locator("#raMsg")).toContainText("Doca validada");
  await page.locator("#raInput").fill("176"); await page.locator("#raInput").press("Enter");
  await expect(page.locator("#raQtd")).toBeFocused();
  await page.locator("#raQtd").fill("8");
  await page.locator("#raInput").fill("R501-P2-A0-AP2"); await page.locator("#raInput").press("Enter");
  await expect(page.locator("#raMsg")).toContainText("armazenado");
  const db = await estoque(page);
  expect(saldo(db, "R501-P2-A0-AP2", "176")).toBe(pick176 + 8);
  expect(saldo(db, doca.codigo, "176")).toBe(0);
});

test("cancelar pedido já conferido: volta para a conferência, tudo é devolvido e ele não embarca", async ({ page }) => {
  await entrar(page, "separador");
  await separarPedido(page, "PV-10428", "R9002-P1-A100-AP105");
  await entrar(page, "conferente", "conferencia.html");
  await abrirNaConferencia(page, "PV-10428");
  await conferirTudo(page, "PV-10428");
  await finalizarConferencia(page, 1);

  await ocorrencia(page, "PV-10428", { cancelar: true });
  await expect(page.locator(".oc-etapa")).toContainText("aguardando conferência");

  await entrar(page, "conferente", "conferencia.html");
  await expect(page.locator('#queueBody tr[data-id="PV-10428"]')).toContainText("Cancelado");
  await abrirNaConferencia(page, "PV-10428");
  await page.keyboard.press("F9");
  const o = (await conferencia(page)).find((x) => x.id === "PV-10428");
  for (const i of o.itens) await bipar(page, `${i.devolver}*${i.ean || i.sku}`);
  const doca = await docaDevolucao(page);
  await bipar(page, String(doca.id));
  await page.keyboard.press("F10");
  await expect(page.locator("#toast")).toContainText("encerrado como cancelado");
  expect((await conferencia(page)).find((x) => x.id === "PV-10428").conf.status).toBe("cancelado");
  const db = await estoque(page);
  for (const i of o.itens) expect(saldo(db, doca.codigo, i.sku), `${i.sku} na doca de devolução`).toBe(i.devolver);

  await entrar(page, "embarque");
  await expect(page.locator(".carga").first()).toBeVisible();
  await expect(page.locator("body")).not.toContainText("PV-10428");
});

test("antes de separar: item cortado é pulado e pedido cancelado some da lista", async ({ page }) => {
  await ocorrencia(page, "PV-10422", { cortes: { 1797: 0 } });
  await ocorrencia(page, "PV-10427", { cancelar: true });

  await entrar(page, "separador");
  await expect(page.locator('button.order[data-id="PV-10427"]')).toHaveCount(0);
  await abrirPedidoNoColetor(page, "PV-10422");
  const p = (await separacao(page)).find((o) => o.id === "PV-10422");
  expect(p.itens.find((i) => i.sku === "1797").status).toBe("cortado");
  // o coletor começa direto no primeiro item que sobrou
  await expect(page.locator("#prodSku")).not.toHaveText("1797");
  for (const i of p.itens.filter((x) => x.status !== "cortado")) await separarItem(page, i);
  await lerDoca(page, "R9002-P1-A100-AP102");
  await expect(page.locator("#doneDoca")).toBeVisible();
  expect(saldo(await estoque(page), "R502-P9-A3-AP303", "1797")).toBe(234); // nada saiu do 1797
});

test("cancelado com o separador no meio: ele é avisado na hora e leva o que já separou para a doca", async ({ page, context }) => {
  await entrar(page, "separador");
  await abrirPedidoNoColetor(page, "PV-10423");
  const p = (await separacao(page)).find((o) => o.id === "PV-10423");
  await separarItem(page, p.itens[0]);

  // o gestor cancela em outra janela (outro aparelho, na vida real)
  const gestor = await context.newPage();
  await gestor.goto("index.html");
  const r = await gestor.evaluate(async () => {
    const { registrarOcorrencia } = await import("/js/dados/ocorrencias.js");
    return registrarOcorrencia("exp", "PV-10423", { tipo: "cancelamento", motivo: "desistencia", referencia: "CANC-9", usuario: "Gestor" });
  });
  expect(r.ok).toBe(true);

  await expect(page.locator("#toast")).toContainText("CANCELADO PELO GESTOR");
  await expect(page.locator("#viewDoca")).toBeVisible(); // o resto foi cortado: vai direto para a doca
  await lerDoca(page, "R9002-P1-A100-AP103");
  await entrar(page, "conferente", "conferencia.html");
  await expect(page.locator('#queueBody tr[data-id="PV-10423"]')).toContainText("Cancelado");
  const c = (await conferencia(page)).find((o) => o.id === "PV-10423");
  expect(c.itens.filter((i) => i.devolver > 0).map((i) => i.sku)).toEqual([p.itens[0].sku]);
});

test("divergência de saldo: aparece para o gestor de estoque, que abre um inventário rotativo", async ({ page }) => {
  await entrar(page, "separador");
  await separarPedido(page, "PV-10421", "R9002-P1-A100-AP101"); // o 176 tem 4 no picking e o pedido pede 20
  await entrar(page, "gestorEstoque", "gestao-estoque.html");
  await page.locator('[data-aba="movimentacao"]').click();
  await page.locator('[data-sub="divergencias"]').click();
  const linha = page.locator("tr[data-divergencia]", { hasText: "R501-P2-A0-AP2" });
  await expect(linha).toContainText("16");
  await linha.locator("[data-invdiverg]").click();
  await expect(linha).toContainText("Em inventário");
  expect((await estoque(page)).inventarios.at(-1).itens.map((i) => i.produto)).toEqual(["176"]);
});
