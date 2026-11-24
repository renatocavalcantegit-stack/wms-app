// Ajudantes dos testes de ponta a ponta: entrar com um perfil, ler o que está guardado e os passos
// repetidos de cada tela (separar, conferir, embarcar). Cada teste começa com o navegador limpo,
// ou seja, com a demonstração do zero.
import { expect } from "@playwright/test";

// perfis de demonstração (js/sessao.js); a sessão é gravada direto, sem digitar o PIN
const PERFIS = {
  separador: { login: "separador", nome: "Usuário Separador", perfil: "sep", setor: "exp" },
  separadorMont: { login: "separador", nome: "Usuário Separador", perfil: "sep", setor: "mont" },
  conferente: { login: "conferente", nome: "Usuário Conferente", perfil: "conf", setor: "exp" },
  conferenteMont: { login: "conferente", nome: "Usuário Conferente", perfil: "conf", setor: "mont" },
  embarque: { login: "embarque", nome: "Usuário de Embarque", perfil: "emb" },
  estoquista: { login: "estoquista", nome: "Usuário Estoquista", perfil: "estq" },
  gestorEstoque: { login: "gestorestoque", nome: "Gestor de Estoque", perfil: "gest" },
  coordenador: { login: "coordenador", nome: "Usuário Coordenador", perfil: "coord" },
  montagem: { login: "montagem", nome: "Coordenador de Montagem", perfil: "coordmont" },
};

// abre uma tela já logado com o perfil
export async function entrar(page, perfil, tela = "index.html") {
  const s = PERFIS[perfil];
  if (!s) throw new Error(`perfil desconhecido: ${perfil}`);
  if (page.url() === "about:blank") await page.goto("index.html");
  await page.evaluate((s) => {
    const agora = Date.now();
    localStorage.setItem("wms-bb-session", JSON.stringify({ ...s, desde: agora, ...(s.setor ? { setorDesde: agora } : {}) }));
  }, s);
  await page.goto(tela);
}

// dado guardado pelo prefixo da chave (a versão no fim da chave muda a cada publicação)
export async function dado(page, prefixo) {
  return page.evaluate((prefixo) => {
    const re = new RegExp(`^${prefixo}\\d+$`);
    const chave = Object.keys(localStorage).find((k) => re.test(k));
    return chave ? JSON.parse(localStorage.getItem(chave)) : null;
  }, prefixo);
}
// estoque pela própria camada de dados (antes da 1ª gravação, ele ainda é a demonstração montada na hora)
export const estoque = (page) => page.evaluate(async () => (await import("/js/dados/estoque.js")).lerEstoque());
export const separacao = async (page, setor = "exp") => (await dado(page, setor === "mont" ? "wms-bb-sep-mont-v" : "wms-bb-sep-v")) || [];
// fila da conferência pela camada de dados (traz junto os pedidos que a Separação concluiu)
export const conferencia = (page, setor = "exp") =>
  page.evaluate(async (setor) => (await import("/js/dados/conferencia.js")).carregarConferencia(setor).orders, setor);

// saldo de um produto num endereço (pelo código da prateleira)
export function saldo(db, codigoEndereco, produto) {
  const e = db.enderecos.find((x) => x.codigo === codigoEndereco && x.ativo);
  return db.saldos.filter((s) => s.enderecoId === e.id && s.produto === produto).reduce((t, s) => t + s.qtd, 0);
}

// ---------- observação do pedido (v76) ----------
// se a observação obrigatória abriu (coletor: folha; posto: janela), responde. No lote, vem uma depois da outra.
// Devolve quantas respondeu.
export async function responderObservacao(page, botao = "#obpOk") {
  let n = 0;
  while (n < 10 && (await page.locator("#sheetObsPedido:visible, #mObsPedido:visible").count())) {
    await page.locator(`${botao}:visible`).click();
    n++;
  }
  return n;
}

// ---------- coletor: Separação ----------
export async function abrirPedidoNoColetor(page, id) {
  await page.locator(`button.order[data-id="${id}"]`).click();
  await page.locator("#startGo").click();
  await responderObservacao(page);
}
// lê no campo do coletor (como o leitor faz: digita e dá Enter)
export async function ler(page, codigo) {
  await page.locator("#scanInput").fill(codigo);
  await page.locator("#scanInput").press("Enter");
}
export async function digitarQuantidade(page, qtd) {
  await expect(page.locator("#qtyInput")).toBeEnabled();
  await page.locator("#qtyInput").fill(String(qtd));
  await page.locator("#qtyInput").press("Enter");
}
// separa o item da vez: endereço → produto (código interno) → quantidade
export async function separarItem(page, item, qtd = item.qtd) {
  // item seguido no MESMO endereço já vem com o endereço confirmado (o coletor não pede de novo)
  if (!(await page.locator("#addrStatus").innerText()).includes("confirmado")) {
    await ler(page, item.end);
    await expect(page.locator("#scanMsg")).toContainText("agora bipe o produto");
  }
  await ler(page, item.sku);
  await digitarQuantidade(page, qtd);
}
// lê a doca de expedição no fim da separação
export async function lerDoca(page, codigo = "R9002-P1-A100-AP101") {
  await responderObservacao(page); // antes da doca: "Li e apliquei"
  await expect(page.locator("#viewDoca")).toBeVisible();
  await page.locator("#docaInput").fill(codigo);
  await page.locator("#docaInput").press("Enter");
}
// separa o pedido inteiro, na ordem da rota, e deixa na doca
export async function separarPedido(page, id, doca, setor = "exp") {
  await abrirPedidoNoColetor(page, id);
  const pedido = (await separacao(page, setor)).find((o) => o.id === id);
  // item que o gestor cortou antes de separar é pulado pelo coletor
  for (const item of pedido.itens.filter((i) => i.status !== "cortado")) await separarItem(page, item);
  await lerDoca(page, doca);
}

// ---------- Conferência ----------
// pedido da fila abre o resumo "Iniciar conferência" (v65); pedido em conferência abre direto
export async function abrirNaConferencia(page, id) {
  await page.locator(`#queueBody tr[data-id="${id}"]`).click();
  await expect(page.locator("#order:visible, #mStart:visible")).toHaveCount(1);
  if (await page.locator("#mStart").isVisible()) await page.locator("#sGo").click();
  await expect(page.locator("#order")).toBeVisible();
  await responderObservacao(page);
}
export async function bipar(page, codigo) {
  await page.locator("#scan").fill(codigo);
  await page.locator("#scan").press("Enter");
}
// finaliza: quantidade de volumes e observação (todos como "caixa")
export async function finalizarConferencia(page, volumes = 1) {
  await page.locator("#btnFinish").click();
  await responderObservacao(page); // antes de finalizar: "Li e apliquei"
  await page.locator("#fVol").fill(String(volumes));
  await page.locator("#fGo").click();
  for (let i = 0; i < volumes; i++) await page.locator('#oTipos .o-add[data-add]').first().click();
  await page.locator("#oGo").click();
  await expect(page.locator("#mDone")).toBeVisible();
  await page.locator("#dGo").click();
}

// confere item por item: produto com checkout = um bipe por unidade; granel = bipe + quantidade
export async function conferirTudo(page, id) {
  const o = (await conferencia(page)).find((x) => x.id === id);
  const db = await estoque(page);
  for (const i of o.itens) {
    if (!i.sep) continue; // nada na caixa (ex.: cortado pelo gestor)
    const granel = db.produtos.find((p) => p.codigo === i.sku)?.checkout === false;
    if (granel) {
      await bipar(page, i.sku);
      await page.locator("#mult").fill(String(i.sep));
      await page.locator("#mult").press("Enter");
    } else {
      for (let k = 0; k < i.sep; k++) await bipar(page, i.ean || i.sku);
    }
  }
}
