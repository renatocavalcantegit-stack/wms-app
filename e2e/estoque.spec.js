// Cenários do Estoque que atravessam telas: abastecimento automático, recebimento até a separação
// e inventário até a separação. O coletor do estoquista é o estoque.html; o gestor usa a web.
import { test, expect } from "@playwright/test";
import { entrar, estoque, saldo, separarPedido } from "./ajuda.js";

// a etiqueta de volume do recebimento chama a impressão; no teste ela não faz nada
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { window.print = () => {}; });
  page.on("pageerror", (e) => console.log("ERRO NA PÁGINA:", page.url(), e.message, e.stack));
});

test.afterEach(async ({ page }, info) => {
  if (info.status === info.expectedStatus) return;
  console.log("FALHOU EM", page.url(), await page.evaluate(() => [...document.querySelectorAll(".view")].filter((v) => !v.hidden).map((v) => v.id).join(",")
    + " | sheets: " + [...document.querySelectorAll(".sheet.open,.sheet.on,[class*=sheet][class*=open]")].map((x) => x.id).join(",")
    + " | " + document.body.innerText.slice(0, 300).replace(/\s+/g, " ")));
});

// lê no campo de um passo do coletor do estoque (como o leitor faz: digita e dá Enter)
async function lerNo(page, campo, valor) {
  await page.locator(campo).fill(String(valor));
  await page.locator(campo).press("Enter");
}
// muda o saldo de um produto num endereço direto nos dados (preparo do cenário)
async function prepararSaldo(page, codigoEndereco, produto, qtd) {
  await page.evaluate(async ([codigo, produto, qtd]) => {
    const m = await import("/js/dados/estoque.js");
    const db = m.lerEstoque(), e = db.enderecos.find((x) => x.codigo === codigo && x.ativo);
    m.somarSaldo(db, e.id, produto, qtd - m.saldoNoEndereco(db, e.id, produto));
    m.gravarEstoque(db);
  }, [codigoEndereco, produto, qtd]);
}
const idDo = (db, codigo) => db.enderecos.find((e) => e.codigo === codigo && e.ativo).id;

test("separação leva o picking ao mínimo: a tarefa aparece na web e no coletor, e o abastecimento enche o picking", async ({ page }) => {
  // PV-10423 tira 4 un. do 4084 no picking R620-P1-A1-AP101 (mínimo 10, máximo 60, com saldo no aéreo)
  const PICK = "R620-P1-A1-AP101";
  await entrar(page, "separador");
  await prepararSaldo(page, PICK, "4084", 13); // 13 - 4 = 9: fica abaixo do mínimo
  await separarPedido(page, "PV-10423", "R9002-P1-A100-AP101");

  let db = await estoque(page);
  const pk = idDo(db, PICK);
  const tarefa = db.tarefas.find((t) => t.produto === "4084" && t.pickingId === pk && t.status === "aberta");
  expect(tarefa, "a separação criou a tarefa automática").toBeTruthy();
  expect(tarefa.quem).toBe("sistema");
  expect(tarefa.necessidade).toBe(60 - 9); // até o máximo

  // web: o gestor vê a tarefa na Movimentação
  await entrar(page, "gestorEstoque", "gestao-estoque.html");
  await page.locator('[data-aba="movimentacao"]').click();
  await expect(page.locator("tbody tr", { hasText: PICK }).first()).toContainText("4084");

  // coletor: o estoquista executa (origem → produto → quantidade → picking → confirmar)
  await entrar(page, "estoquista", "estoque.html");
  await page.locator('[data-ir="viewAbast"]').click();
  await page.locator(`[data-tarefa="${tarefa.id}"]`).click();
  const antes = await estoque(page);
  for (const o of tarefa.origens) {
    await lerNo(page, "#abInput", o.enderecoId);
    await expect(page.locator("#abMsg")).toContainText("Origem validada");
    await lerNo(page, "#abInput", "4084");
    await expect(page.locator("#abQtdForm input[name=qtd]")).toBeFocused();
    await page.locator("#abQtdForm input[name=qtd]").fill(String(o.qtd));
    await page.locator("#abQtdForm input[name=qtd]").press("Enter");
    await lerNo(page, "#abInput", pk);
    await page.locator("[data-confabast]").click();
    await expect(page.locator("#abMsg")).toContainText("abastecido");
  }

  db = await estoque(page);
  expect(saldo(db, PICK, "4084")).toBe(60);
  for (const o of tarefa.origens) {
    const e = db.enderecos.find((x) => x.id === o.enderecoId);
    expect(saldo(db, e.codigo, "4084"), `aéreo ${e.codigo}`).toBe(saldo(antes, e.codigo, "4084") - o.qtd);
  }
  expect(db.tarefas.find((t) => t.id === tarefa.id).status).toBe("concluida");
});

test("nota recebida e armazenada no picking: a separação baixa do saldo novo", async ({ page }) => {
  // NF 48213 traz 50 un. do 167; o picking dele (R502-P5-A0-AP1) é de onde o PV-10423 separa 10
  const PICK = "R502-P5-A0-AP1", DOCA = "608004";
  await entrar(page, "estoquista", "estoque.html");
  const inicio = await estoque(page);
  const nota = inicio.notas.find((n) => n.numero === "48213" || n.numero === 48213);

  // conferência do recebimento (v79): nota → produto → quantidade (entra na lista) → Endereçar → doca
  await page.locator('[data-ir="viewRecConf"]').click();
  await page.locator(`[data-nota="${nota.id}"]`).click();
  await lerNo(page, "#rcInput", "167");
  await expect(page.locator("#rcQtdForm input[name=qtd]")).toBeFocused(); // o coletor foca a quantidade sozinho
  await page.locator("#rcQtdForm input[name=qtd]").fill("50");
  await page.locator("#rcQtdForm input[name=qtd]").press("Enter");
  await expect(page.locator("#rcMsg")).toContainText("+50 167 na lista");
  await expect(page.locator("#rcInput")).toBeFocused(); // volta a bipar o próximo, sem pedir a doca
  await expect(page.locator(".rc-lista")).toContainText("50");
  let db = await estoque(page);
  expect(saldo(db, db.enderecos.find((e) => e.id === +DOCA).codigo, "167")).toBe(0); // sem doca, nada entra
  // o app fechou no meio: a lista continua lá e a nota reabre sozinha
  await page.reload();
  await page.locator('[data-ir="viewRecConf"]').click();
  await expect(page.locator("#rcEnderecar")).toHaveText("Endereçar (1)");
  await page.locator("#rcFinalizar").click();
  await expect(page.locator("#rcMsg")).toContainText("AGUARDANDO A DOCA"); // não finaliza com a lista cheia
  await page.locator("#rcEnderecar").click();
  await lerNo(page, "#rcInput", DOCA);
  await expect(page.locator("#rcMsg")).toContainText("1 produto(s) na");
  await expect(page.locator(".rc-lista")).toHaveCount(0);
  await expect(page.locator("#rcEnderecar")).toBeDisabled();
  db = await estoque(page);
  expect(saldo(db, db.enderecos.find((e) => e.id === +DOCA).codigo, "167")).toBe(50);

  // armazenamento: doca → produto → quantidade → destino (o picking)
  await entrar(page, "estoquista", "estoque.html");
  await page.locator('[data-ir="viewRecArm"]').click();
  await lerNo(page, "#raInput", DOCA);
  await lerNo(page, "#raInput", "167");
  await expect(page.locator("#raQtd")).toBeFocused(); // o coletor seleciona a quantidade sozinho
  await page.locator("#raQtd").fill("50");
  await lerNo(page, "#raInput", PICK);
  await expect(page.locator("#raMsg")).toContainText("armazenado");
  db = await estoque(page);
  expect(saldo(db, PICK, "167")).toBe(saldo(inicio, PICK, "167") + 50);
  expect(saldo(db, db.enderecos.find((e) => e.id === +DOCA).codigo, "167")).toBe(0);

  // separação: o PV-10423 tira 10 do picking já com o recebido
  await entrar(page, "separador");
  await separarPedido(page, "PV-10423", "R9002-P1-A100-AP101");
  expect(saldo(await estoque(page), PICK, "167")).toBe(saldo(inicio, PICK, "167") + 50 - 10);
});

test("inventário: contagem no coletor, aprovação na web e a separação baixa do saldo ajustado", async ({ page }) => {
  // PV-10422 separa 50 un. do 1797 no picking R502-P9-A3-AP303; o inventário acha 200 lá
  const END = "R502-P9-A3-AP303";
  await entrar(page, "gestorEstoque", "gestao-estoque.html");
  const inv = await page.evaluate(async (codigo) => {
    const { lerEstoque } = await import("/js/dados/estoque.js");
    const { criarInventario } = await import("/js/dados/inventario.js");
    const e = lerEstoque().enderecos.find((x) => x.codigo === codigo && x.ativo);
    return criarInventario({ tipo: "rotativo", descricao: "Teste 1797", pares: [{ enderecoId: e.id, produto: "1797" }], usuario: "teste" }).inventario;
  }, END);
  const endId = inv.enderecos[0];

  // coletor: duas contagens iguais encerram o item
  await entrar(page, "estoquista", "estoque.html");
  await page.locator('[data-ir="viewInv"]').click();
  await page.locator(`#ivRes [data-inv="${inv.id}"]`).click();
  for (let n = 1; n <= 2; n++) {
    await lerNo(page, "#ivInput", endId);
    await expect(page.locator("#ivMsg")).toContainText("Endereço confirmado");
    await lerNo(page, "#ivInput", "1797");
    await expect(page.locator("#ivQtdForm input[name=qtd]")).toBeFocused();
    await page.locator("#ivQtdForm input[name=qtd]").fill("200");
    await page.locator("#ivQtdForm input[name=qtd]").press("Enter");
    await page.locator("#ivFinalizar").click();
    await page.locator("#scfSim").click();
    await expect(page.locator("#ivMsg")).toContainText(END);
  }
  expect((await estoque(page)).inventarios.find((i) => i.id === inv.id).itens[0].contagens.map((c) => c.qtd)).toEqual([200, 200]);

  // web: aprova a divergência, finaliza e sincroniza
  await entrar(page, "gestorEstoque", "gestao-estoque.html");
  await page.locator('[data-aba="inventario"]').click();
  await page.locator(`tr[data-inv="${inv.id}"]`).click();
  await page.locator('[data-aprovar="0"]').click();
  await page.locator(`[data-finalizarinv="${inv.id}"]`).click();
  await page.locator(`[data-conffinalizarinv="${inv.id}"]`).click();
  await page.locator(`[data-sincinv="${inv.id}"]`).click();
  await page.locator(`[data-confsincinv="${inv.id}"]`).click();
  let db = await estoque(page);
  expect(db.inventarios.find((i) => i.id === inv.id).status).toBe("sincronizado");
  expect(saldo(db, END, "1797")).toBe(200);

  // separação: baixa do saldo do inventário
  await entrar(page, "separador");
  await separarPedido(page, "PV-10422", "R9002-P1-A100-AP101");
  expect(saldo(await estoque(page), END, "1797")).toBe(150);
});
