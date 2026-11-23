// Ocorrências do pedido de ponta a ponta (v75): o gestor corta ou cancela na aba Ocorrências e quem está com a
// mercadoria na mão devolve (separador, conferente ou o próprio gestor). Toda devolução vira uma entrada
// pendente no estoque ("DEV PV-…"), que o estoquista confere como uma nota.
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
// a mesma coisa, mas "de outro aparelho" (outra aba): a tela aberta recebe o aviso na hora
async function ocorrenciaEmOutraAba(context, pedido, dados) {
  const gestor = await context.newPage();
  await gestor.goto("index.html");
  const r = await gestor.evaluate(async ({ pedido, dados }) => {
    const { registrarOcorrencia } = await import("/js/dados/ocorrencias.js");
    return registrarOcorrencia("exp", pedido, { motivo: "desistencia", referencia: "ALT-9", usuario: "Gestor", ...dados });
  }, { pedido, dados });
  expect(r.ok).toBe(true);
  await gestor.close();
}
const docaDevolucao = async (page) => (await estoque(page)).enderecos.find((e) => e.tipo === "devolucao");
const devolucoes = async (page) => (await estoque(page)).notas.filter((n) => n.tipo === "Devolução");

test("em conferência: o conferente tira da caixa (F9), entrega ao estoque e o estoquista confere a entrada", async ({ page }) => {
  await entrar(page, "separador");
  await separarPedido(page, "PV-10421", "R9002-P1-A100-AP101");
  await entrar(page, "conferente", "conferencia.html");
  await abrirNaConferencia(page, "PV-10421"); // a conferência começou

  await ocorrencia(page, "PV-10421", { cortes: { 176: 12 } });
  await expect(page.locator(".oc-msg.ok")).toContainText("o conferente tira da caixa no posto (F9)");
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
  await expect(page.locator("#scanMsg")).toContainText("entregue ao estoque");
  await expect(page.locator("#cfDev")).toContainText("Entregue ao estoque");
  await finalizarConferencia(page, 1);
  expect((await conferencia(page)).find((o) => o.id === "PV-10421").conf.status).toBe("conferido");
  const [dev] = await devolucoes(page);
  expect([dev.numero, dev.fornecedor.nome, dev.itens]).toEqual(["PV-10421", "Entregue por Usuário Conferente", [{ produto: "176", qtd: 8 }]]);

  // estoquista: a devolução aparece na Recepção como uma nota e é conferida na doca de devolução
  await entrar(page, "estoquista", "estoque.html");
  await page.locator('[data-ir="viewRecConf"]').click();
  await expect(page.locator(`[data-nota="${dev.id}"]`)).toContainText("DEV PV-10421");
  await page.locator(`[data-nota="${dev.id}"]`).click();
  await page.locator("#rcInput").fill("176"); await page.locator("#rcInput").press("Enter");
  await page.locator("#rcQtdForm input[name=qtd]").fill("8");
  await page.locator("#rcQtdForm input[name=volumes]").fill("1");
  await page.locator("#rcQtdForm input[name=volumes]").press("Enter");
  const doca = await docaDevolucao(page);
  await page.locator("#rcInput").fill(String(doca.id)); await page.locator("#rcInput").press("Enter");
  await expect(page.locator("#rcMsg")).toContainText("+8 176");
  expect(saldo(await estoque(page), doca.codigo, "176")).toBe(8);
});

test("corte em pedido conferido: o gestor devolve na hora e o pedido volta para refazer volumes e etiquetas", async ({ page }) => {
  await entrar(page, "separador");
  await separarPedido(page, "PV-10428", "R9002-P1-A100-AP105");
  await entrar(page, "conferente", "conferencia.html");
  await abrirNaConferencia(page, "PV-10428");
  await conferirTudo(page, "PV-10428");
  await finalizarConferencia(page, 1);
  const item = (await conferencia(page)).find((o) => o.id === "PV-10428").itens.find((i) => i.sep > 1);

  await ocorrencia(page, "PV-10428", { cortes: { [item.sku]: item.sep - 1 } });
  await expect(page.locator(".oc-msg.ok")).toContainText("entrada DEV PV-10428 criada");
  await expect(page.locator(".oc-msg.ok")).toContainText("refazer volumes e etiquetas");
  expect((await devolucoes(page))[0].fornecedor.nome).toBe("Entregue por Usuário Coordenador");

  await entrar(page, "conferente", "conferencia.html");
  await expect(page.locator('#queueBody tr[data-id="PV-10428"]')).toContainText("Reaberto pelo gestor");
  await abrirNaConferencia(page, "PV-10428");
  await expect(page.locator("#cfDev")).toBeHidden(); // nada a tirar: o gestor já tirou
  await finalizarConferencia(page, 2);
  const c = (await conferencia(page)).find((o) => o.id === "PV-10428");
  expect([c.conf.status, c.conf.volumes, c.conf.itens[item.sku]]).toEqual(["conferido", 2, item.sep - 1]);
});

test("cancelar pedido já conferido: sai da conferência, a entrada nasce na hora e ele não embarca", async ({ page }) => {
  await entrar(page, "separador");
  await separarPedido(page, "PV-10428", "R9002-P1-A100-AP105");
  await entrar(page, "conferente", "conferencia.html");
  await abrirNaConferencia(page, "PV-10428");
  await conferirTudo(page, "PV-10428");
  await finalizarConferencia(page, 1);
  const o = (await conferencia(page)).find((x) => x.id === "PV-10428");

  await ocorrencia(page, "PV-10428", { cancelar: true });
  await expect(page.locator(".oc-etapa")).toContainText("Cancelado");
  await expect(page.locator(".oc-msg.ok")).toContainText("entrada DEV PV-10428 criada");

  await entrar(page, "conferente", "conferencia.html");
  await expect(page.locator('#queueBody tr[data-id="PV-10428"]')).toHaveCount(0);
  expect((await conferencia(page)).find((x) => x.id === "PV-10428").conf.status).toBe("cancelado");
  const [dev] = await devolucoes(page);
  expect(dev.itens).toEqual(o.itens.filter((i) => i.sep > 0).map((i) => ({ produto: i.sku, qtd: i.sep })));

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
  expect(await devolucoes(page)).toEqual([]); // nada tinha saído da prateleira
});

test("corte com o separador no meio: o aviso aparece e ele devolve o que já separou", async ({ page, context }) => {
  await entrar(page, "separador");
  await abrirPedidoNoColetor(page, "PV-10423");
  const p = (await separacao(page)).find((o) => o.id === "PV-10423");
  const [a, b] = p.itens;
  await separarItem(page, a);

  await ocorrenciaEmOutraAba(context, "PV-10423", { tipo: "corte", cortes: { [a.sku]: a.qtd - 1, [b.sku]: 0 } });
  await expect(page.locator("#sheetGestor")).toBeVisible();
  await expect(page.locator("#sgItens")).toContainText("devolver 1");
  await expect(page.locator("#sgItens")).toContainText("cortado");
  await expect(page.locator("#sgOk")).toHaveText("Tirei da caixa · vou entregar ao estoque");
  // enquanto não confirma, o bipe não anda
  await page.locator("#scrim").click();
  await page.locator("#scanInput").fill("QUALQUER"); await page.locator("#scanInput").press("Enter");
  await expect(page.locator("#sheetGestor")).toBeVisible();
  await page.locator("#sgOk").click();
  await expect(page.locator("#toast")).toContainText("1 un. para entregar ao estoque");
  const [dev] = await devolucoes(page);
  expect([dev.numero, dev.fornecedor.nome, dev.itens]).toEqual(["PV-10423", "Entregue por Usuário Separador", [{ produto: a.sku, qtd: 1 }]]);
  const depois = (await separacao(page)).find((o) => o.id === "PV-10423");
  expect([depois.ocorrenciaPendente, depois.itens[0].sep, depois.itens[1].status]).toEqual([false, a.qtd - 1, "cortado"]);
  await expect(page.locator("#prodSku")).not.toHaveText(b.sku); // o item cortado é pulado
});

test("cancelado com o separador no meio: ele é avisado na hora e o que já separou vira entrada", async ({ page, context }) => {
  await entrar(page, "separador");
  await abrirPedidoNoColetor(page, "PV-10423");
  const p = (await separacao(page)).find((o) => o.id === "PV-10423");
  await separarItem(page, p.itens[0]);

  await ocorrenciaEmOutraAba(context, "PV-10423", { tipo: "cancelamento" });
  await expect(page.locator("#toast")).toContainText("CANCELADO PELO GESTOR");
  await expect(page.locator("#viewHome")).toBeVisible();
  await expect(page.locator('button.order[data-id="PV-10423"]')).toHaveCount(0);
  const [dev] = await devolucoes(page);
  expect([dev.fornecedor.nome, dev.itens]).toEqual(["Entregue por Usuário Separador", [{ produto: p.itens[0].sku, qtd: p.itens[0].qtd }]]);
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
