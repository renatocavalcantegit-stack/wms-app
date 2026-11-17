// Cenários da Separação que atravessam telas: lote com falta, pedido dividido, endereço desativado
// na web e "separar novamente".
import { test, expect } from "@playwright/test";
import {
  entrar, estoque, separacao, conferencia, saldo, abrirPedidoNoColetor, ler, digitarQuantidade, separarItem, lerDoca, separarPedido,
  abrirNaConferencia, bipar,
} from "./ajuda.js";

test("lote com falta: o achado vai para a caixa A e cada pedido chega sozinho na conferência", async ({ page }) => {
  await entrar(page, "separador");
  // as paradas do lote L-1 (PV-10424 = A, PV-10425 = B), na ordem da rota, calculadas pela regra
  const paradas = await page.evaluate(async () => {
    const { carregarPedidos, carregarLotes } = await import("/js/dados/separacao.js");
    const { montarParadas } = await import("/compartilhado/regras/separacao.js");
    const l = carregarLotes("exp").find((x) => x.id === "L-1");
    const ps = carregarPedidos("exp").filter((o) => l.pedidos.includes(o.id));
    return montarParadas(ps, l.posicoes);
  });
  const comum = paradas.find((p) => p.linhas.length === 2); // produto dos dois pedidos: uma parada só
  expect(comum, "o lote de demonstração tem um produto em comum").toBeTruthy();

  await page.locator('[data-lote="L-1"]').click();
  await page.locator("#startGo").click();
  for (const p of paradas) {
    if (!(await page.locator("#addrStatus").innerText()).includes("confirmado")) await ler(page, p.end);
    await ler(page, p.sku);
    if (p !== comum) { await digitarQuantidade(page, p.total); continue; }
    // achou menos que o total da parada: abre a falta; o achado vai primeiro para a caixa A
    const achado = p.linhas[0].qtd - 2;
    await digitarQuantidade(page, achado);
    await expect(page.locator("#sheetShort")).toBeVisible();
    await page.locator("#shortReasons .chip").first().click();
    await page.locator("#shortGo").click();
  }
  await lerDoca(page, "R9002-P1-A100-AP102");
  await expect(page.locator("#doneDoca")).toContainText("2 pedidos");

  const [a, b] = comum.linhas; // A e B
  const sep = await separacao(page);
  const itemA = sep.find((o) => o.id === a.pedido).itens[a.idx], itemB = sep.find((o) => o.id === b.pedido).itens[b.idx];
  expect([itemA.sep, itemA.status]).toEqual([a.qtd - 2, "falta"]);
  expect([itemB.sep, itemB.status]).toEqual([0, "falta"]);

  // conferência: os dois pedidos, separados um do outro, com a mesma doca e as quantidades da sua caixa
  await entrar(page, "conferente", "conferencia.html");
  for (const id of [a.pedido, b.pedido]) await expect(page.locator(`#queueBody tr[data-id="${id}"]`)).toContainText("R9002-P1-A100-AP102");
  const conf = await conferencia(page);
  expect(conf.find((o) => o.id === a.pedido).itens[a.idx].sep).toBe(a.qtd - 2);
  expect(conf.find((o) => o.id === b.pedido).itens[b.idx].sep).toBe(0);
});

test("pedido dividido: a conferência só recebe quando todas as partes terminam, já juntas", async ({ page }) => {
  await entrar(page, "separador");
  await separarPedido(page, "PV-10426/1", "R9002-P1-A100-AP103");
  await page.locator("#doneBack").click();

  await entrar(page, "conferente", "conferencia.html");
  await expect(page.locator("#queueBody")).not.toContainText("PV-10426");

  await entrar(page, "separador");
  await separarPedido(page, "PV-10426/2", "R9002-P1-A100-AP104");

  await entrar(page, "conferente", "conferencia.html");
  const linha = page.locator('#queueBody tr[data-id="PV-10426"]');
  await expect(linha).toBeVisible();
  const partes = (await separacao(page)).filter((o) => o.parte?.pai === "PV-10426");
  const conf = (await conferencia(page)).find((o) => o.id === "PV-10426");
  expect(conf.itens.length).toBe(partes.reduce((t, p) => t + p.itens.length, 0));
  // as duas docas onde as partes ficaram
  await expect(linha).toContainText("R9002-P1-A100-AP103");
  await expect(linha).toContainText("R9002-P1-A100-AP104");
});

test("endereço desativado na Gestão de Estoque é recusado na separação", async ({ page }) => {
  await entrar(page, "separador");
  const pedido = (await page.evaluate(async () => (await import("/js/dados/separacao.js")).carregarPedidos("exp"))).find((o) => o.id === "PV-10427");
  const end = pedido.itens[0].end;
  // preparo: o endereço fica vazio (só endereço vazio pode ser desativado)
  const id = await page.evaluate(async (codigo) => {
    const m = await import("/js/dados/estoque.js");
    const db = m.lerEstoque(), e = db.enderecos.find((x) => x.codigo === codigo && x.ativo);
    db.saldos = db.saldos.filter((s) => s.enderecoId !== e.id);
    db.tarefas.forEach((t) => { if (t.pickingId === e.id && ["aberta", "andamento"].includes(t.status)) t.status = "cancelada"; });
    m.gravarEstoque(db);
    return e.id;
  }, end);

  // o gestor desativa na web
  await entrar(page, "gestorEstoque", "gestao-estoque.html");
  await page.locator('input[data-f="busca"]').fill(String(id));
  await page.locator(`[data-desativar="${id}"]`).click();
  await page.locator(`[data-confdesativar="${id}"]`).click();
  expect((await estoque(page)).enderecos.find((e) => e.id === id).ativo).toBe(false);

  // o separador não consegue confirmar esse endereço
  await entrar(page, "separador");
  await abrirPedidoNoColetor(page, "PV-10427");
  await ler(page, String(id));
  await expect(page.locator("#scanMsg")).toContainText("ENDEREÇO INATIVO");
});

test("separar novamente um pedido concluído não baixa o estoque duas vezes", async ({ page }) => {
  await entrar(page, "separador");
  const antes = await estoque(page);
  await separarPedido(page, "PV-10428", "R9002-P1-A100-AP105");
  const pedido = (await separacao(page)).find((o) => o.id === "PV-10428");
  const depoisDaPrimeira = await estoque(page);
  await page.locator("#doneBack").click();
  await page.locator("#homeTabs").getByText("Concluídos").click();

  await abrirPedidoNoColetor(page, "PV-10428"); // "Separar novamente"
  for (const i of pedido.itens) await separarItem(page, i);
  await lerDoca(page, "R9002-P1-A100-AP105");

  const final = await estoque(page);
  for (const i of pedido.itens) {
    expect(saldo(final, i.end, i.sku), `saldo de ${i.sku} em ${i.end} depois de separar de novo`).toBe(saldo(depoisDaPrimeira, i.end, i.sku));
  }
  expect(antes).toBeTruthy();
  // o estorno ficou registrado e a conferência recebeu o pedido de novo
  expect(final.movimentos.filter((m) => m.tipo === "estorno-separacao" && m.pedido === "PV-10428").length).toBeGreaterThan(0);
  await entrar(page, "conferente", "conferencia.html");
  await expect(page.locator('#queueBody tr[data-id="PV-10428"]')).toBeVisible();
});

test("separar novamente é recusado depois que a conferência começou", async ({ page }) => {
  await entrar(page, "separador");
  await separarPedido(page, "PV-10428", "R9002-P1-A100-AP105");
  const pedido = (await separacao(page)).find((o) => o.id === "PV-10428");

  await entrar(page, "conferente", "conferencia.html");
  await abrirNaConferencia(page, "PV-10428");
  await bipar(page, pedido.itens[0].ean || pedido.itens[0].sku);
  expect((await conferencia(page)).find((o) => o.id === "PV-10428").conf.status).toBe("andamento");

  await entrar(page, "separador");
  const db = await estoque(page);
  await page.locator("#homeTabs").getByText("Concluídos").click();
  await abrirPedidoNoColetor(page, "PV-10428");
  await expect(page.locator("#toast")).toContainText("FALE COM O GESTOR");
  expect((await separacao(page)).find((o) => o.id === "PV-10428").status).toBe("concluido");
  expect((await estoque(page)).saldos).toEqual(db.saldos); // nada voltou para o estoque
});
