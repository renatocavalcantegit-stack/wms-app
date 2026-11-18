// Fase 1c de ponta a ponta, com o SERVIDOR DE VERDADE (Fastify + banco de teste wms_teste):
// o coordenador deixa a aba "Ao vivo" aberta na Gestão; o separador começa e separa um pedido no coletor
// (outro navegador) e a Gestão mostra o andamento sozinha, sem recarregar. Um conflito aparece em
// "Não aplicadas" e sai da lista quando o coordenador marca visto.
//
// Precisa do PostgreSQL e do server/.env (o mesmo dos testes do servidor). Sem o .env, o teste é pulado.
import { test, expect } from "@playwright/test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { separacao, abrirPedidoNoColetor, separarItem } from "./ajuda.js";

const ENV = resolve(import.meta.dirname, "..", "server", ".env");
test.skip(!existsSync(ENV), "sem server/.env: este teste precisa do banco");

let pool, servidor, endereco, USERS;
test.beforeAll(async () => {
  process.loadEnvFile(ENV);
  const { prepararBancoDeTeste } = await import("../server/testes/banco-de-teste.js");
  const { criarServidor } = await import("../server/src/servidor.js");
  ({ USERS } = await import("../js/sessao.js"));
  pool = await prepararBancoDeTeste();
  servidor = criarServidor({ pool });
  endereco = await servidor.listen({ port: 0, host: "127.0.0.1" });
});
test.afterAll(async () => {
  await servidor?.close();
  await pool?.end();
});

async function entrarPeloServidor(page, perfil) {
  const u = USERS.find((x) => x.perfil === perfil);
  await page.goto(`${endereco}/`);
  await page.locator("#loginName").fill(u.login);
  await page.locator("#loginPin").fill(u.pin);
  await page.locator("#loginForm button[type=submit]").click();
  return u;
}

test("a Gestão acompanha o coletor ao vivo e o coordenador marca o conflito como visto", async ({ browser }) => {
  // coordenador: entra e abre a aba Ao vivo (só aparece com o servidor e com ?aovivo: está em standby)
  const gestao = await (await browser.newContext()).newPage();
  await entrarPeloServidor(gestao, "coord");
  await expect(gestao).toHaveURL(/gestao\.html/);
  // a aba Ao vivo está em standby: só aparece com "?aovivo" no endereço
  await expect(gestao.locator(".gx-tab", { hasText: "Separação" })).toBeVisible();
  await expect(gestao.locator("#tabVivo")).toBeHidden();
  await gestao.goto(`${endereco}/gestao.html?aovivo`);
  await expect(gestao.locator("#tabVivo")).toBeVisible();
  await expect(gestao.locator("#simBtn span")).toHaveText("Simulação");
  await gestao.locator("#tabVivo").click();
  await expect(gestao.locator(".vivo-wrap h1")).toHaveText("Separação ao vivo");
  const linhaDoPedido = gestao.locator(".vivo-ped", { hasText: "PV-10421" });
  await expect(linhaDoPedido).toHaveAttribute("data-status", "pendente");

  // separador: noutro navegador (outro aparelho), entra no coletor e começa o PV-10421
  const coletor = await (await browser.newContext({ viewport: { width: 412, height: 860 } })).newPage();
  const sep = await entrarPeloServidor(coletor, "sep");
  await coletor.locator('[data-setor="exp"]').click();
  await abrirPedidoNoColetor(coletor, "PV-10421");

  // a Gestão vê sem recarregar: o pedido em andamento com o separador, e ele "separando"
  await expect(linhaDoPedido).toHaveAttribute("data-status", "andamento");
  await expect(linhaDoPedido).toContainText(sep.nome);
  const linhaDoSeparador = gestao.locator(".vivo-sep", { hasText: sep.nome });
  await expect(linhaDoSeparador).toHaveAttribute("data-situacao", "separando");
  await expect(linhaDoSeparador).toContainText("PV-10421");

  // separa o primeiro item: o progresso anda na Gestão
  const pedido = (await separacao(coletor)).find((o) => o.id === "PV-10421");
  await separarItem(coletor, pedido.itens[0]);
  await expect(linhaDoPedido).toContainText(`1/${pedido.itens.length} itens`);

  // um segundo separador tenta pegar o mesmo pedido (direto pela API, como faria outro coletor): conflito
  const sep2 = USERS.find((x) => x.login === "separador2");
  const login2 = await (await fetch(`${endereco}/api/login`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ login: sep2.login, pin: sep2.pin }),
  })).json();
  await fetch(`${endereco}/api/sincronizar`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${login2.token}` },
    body: JSON.stringify({ acoes: [{ id: randomUUID(), tipo: "separacao.iniciar", dados: { pedido: "PV-10421" }, feitaEm: new Date().toISOString() }] }),
  });

  // aparece em "Não aplicadas" e no número vermelho da aba
  const naoAplicada = gestao.locator(".vivo-nao-linha", { hasText: "Segundo Separador" });
  await expect(naoAplicada).toContainText("PV-10421");
  await expect(naoAplicada).toContainText("JÁ ESTÁ COM");
  await expect(gestao.locator("#tbVivo")).toHaveText("1");

  // o coordenador resolve e marca visto: sai da lista (e fica gravado quem viu)
  await naoAplicada.getByRole("button", { name: "Marcar visto" }).click();
  await expect(naoAplicada).toHaveCount(0);
  await expect(gestao.locator("#tbVivo")).toBeHidden();
  const vista = (await pool.query("SELECT vista_por FROM acoes_recebidas WHERE login = 'separador2'")).rows[0];
  expect(vista.vista_por).toBe(USERS.find((x) => x.perfil === "coord").login);
  await gestao.context().close();
  await coletor.context().close();
});

test("na demonstração (sem servidor) a aba Ao vivo fica escondida", async ({ page }) => {
  const u = USERS.find((x) => x.perfil === "coord");
  await page.goto("/");
  await page.locator("#loginName").fill(u.login);
  await page.locator("#loginPin").fill(u.pin);
  await page.locator("#loginForm button[type=submit]").click();
  await expect(page).toHaveURL(/gestao\.html/);
  await expect(page.locator(".gx-tab", { hasText: "Separação" })).toBeVisible();
  await expect(page.locator("#tabVivo")).toBeHidden();
  await expect(page.locator("#simBtn span")).toHaveText("Ao vivo");
});
