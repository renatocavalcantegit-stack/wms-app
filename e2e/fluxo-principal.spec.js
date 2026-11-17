// Cenário 1 — o caminho principal de um pedido de venda, atravessando as telas:
// Separação (coletor) → saldo do picking baixa → Conferência (notebook) → Embarque (coletor).
import { test, expect } from "@playwright/test";
import {
  entrar, estoque, separacao, conferencia, saldo, separarPedido, abrirNaConferencia, finalizarConferencia, conferirTudo,
} from "./ajuda.js";

const PEDIDO = "PV-10421";

test("pedido separado baixa o picking, chega na conferência com a doca e embarca", async ({ page }) => {
  await entrar(page, "separador");
  const antes = await estoque(page);
  const pedido = (await separacao(page)).find((o) => o.id === PEDIDO)
    || (await page.evaluate(async (id) => (await import("/js/dados/separacao.js")).carregarPedidos("exp").find((o) => o.id === id), PEDIDO));

  // 1. Separação no coletor, deixando na doca 1
  await separarPedido(page, PEDIDO, "R9002-P1-A100-AP101");
  await expect(page.locator("#doneDoca")).toContainText("R9002-P1-A100-AP101");
  await page.locator("#doneBack").click();
  await page.locator("#homeTabs").getByText("Concluídos").click();
  await expect(page.locator(`button.order[data-id="${PEDIDO}"]`)).toContainText("Deixado na doca R9002-P1-A100-AP101");
  const sep = (await separacao(page)).find((o) => o.id === PEDIDO);
  expect(sep.status).toBe("concluido");
  expect(sep.doca.codigo).toBe("R9002-P1-A100-AP101");

  // 2. Estoque: cada item saiu do endereço onde foi separado, e o movimento ficou registrado
  const depois = await estoque(page);
  // (ACHADO 1: se o picking tem menos no sistema do que o separador confirmou, o saldo para em zero e
  //  o movimento registra só o que havia; a diferença não fica registrada em lugar nenhum. Aguarda decisão.)
  for (const i of pedido.itens) {
    const tinha = saldo(antes, i.end, i.sku), saiu = Math.min(tinha, i.qtd);
    expect(saldo(depois, i.end, i.sku), `saldo de ${i.sku} em ${i.end}`).toBe(tinha - saiu);
    expect(depois.movimentos.some((m) => m.tipo === "separacao" && m.produto === i.sku && m.pedido === PEDIDO && m.qtd === saiu)).toBe(true);
  }

  // 3. Conferência: o pedido está na fila, com a doca, e é conferido completo
  await entrar(page, "conferente", "conferencia.html");
  const linha = page.locator(`#queueBody tr[data-id="${PEDIDO}"]`);
  await expect(linha).toContainText("R9002-P1-A100-AP101");
  await abrirNaConferencia(page, PEDIDO);
  await conferirTudo(page, PEDIDO);
  await finalizarConferencia(page, 2);
  const conf = (await conferencia(page)).find((o) => o.id === PEDIDO);
  expect(conf.conf.status).toBe("conferido");
  expect(conf.conf.volumes).toBe(2);
  expect(conf.conf.erp.qtdVolumes).toBe(2); // vai para o Sankhya (simulado)

  // 4. Embarque: o pedido conferido está numa carga (a do "ERP" ou a avulsa), com os 2 volumes da conferência
  await entrar(page, "embarque");
  const lerCargas = () => page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => /^wms-bb-emb-v\d+$/.test(k)))));
  await expect(page.locator(".carga").first()).toBeVisible();
  // abre as cargas uma a uma até achar a que tem o pedido (as cargas só são gravadas quando alguém mexe)
  const ids = await page.locator(".carga").evaluateAll((els) => els.map((e) => e.dataset.id));
  let daCarga = null;
  for (const id of ids) {
    await page.locator(`.carga[data-id="${id}"]`).click();
    if ((await page.locator("#scList").innerText()).includes(PEDIDO)) { daCarga = { id }; break; }
    await page.locator("#scrim").click({ position: { x: 10, y: 10 } }); // fecha a folha e tenta a próxima
  }
  expect(daCarga, "o pedido conferido tem que estar em alguma carga").toBeTruthy();
  await expect(page.locator("#scList")).toContainText(`${PEDIDO}`);
  await expect(page.locator("#scList .line", { hasText: PEDIDO })).toContainText("0/2 vol.");
  await page.locator("#scGo").click();
  for (const v of [1, 2]) {
    await page.locator("#loadInput").fill(`${PEDIDO}|${v}/2`);
    await page.locator("#loadInput").press("Enter");
  }
  const carga = (await lerCargas()).find((c) => c.id === daCarga.id);
  expect(carga.pedidos.find((p) => p.id === PEDIDO).lidos.sort()).toEqual([1, 2]);
  // os outros pedidos da carga não foram bipados: o fim fica como embarque parcial
  await page.locator("#loadFinish").click();
  await page.locator("#sfGo").click();
  expect((await lerCargas()).find((c) => c.id === daCarga.id).status).toBe(carga.pedidos.every((p) => p.lidos.length === p.volumes) ? "embarcada" : "parcial");
});
