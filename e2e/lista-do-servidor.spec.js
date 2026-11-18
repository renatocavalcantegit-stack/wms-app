// Fase 1d de ponta a ponta, com o SERVIDOR DE VERDADE (Fastify + banco de teste wms_teste):
// dois coletores, dois separadores. A lista vem do servidor: o que um faz, o outro vê.
//
// Precisa do PostgreSQL e do server/.env (o mesmo dos testes do servidor). Sem o .env, o teste é pulado.
import { test, expect } from "@playwright/test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { separacao, abrirPedidoNoColetor, separarItem, lerDoca } from "./ajuda.js";

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
  // um segundo separador, com o mesmo PIN do separador da demonstração (só no banco de teste)
  const sep = USERS.find((u) => u.perfil === "sep");
  await pool.query("INSERT INTO usuarios (login, nome, perfil, pin_hash) SELECT 'separador2', 'Bruna Lima', 'sep', pin_hash FROM usuarios WHERE login = $1", [sep.login]);
});
test.afterAll(async () => {
  await servidor?.close();
  await pool?.end();
});

async function coletor(browser, login) {
  const sep = USERS.find((u) => u.perfil === "sep");
  const page = await (await browser.newContext({ viewport: { width: 412, height: 860 } })).newPage();
  await page.goto(`${endereco}/`);
  await page.locator("#loginName").fill(login);
  await page.locator("#loginPin").fill(sep.pin);
  await page.locator("#loginForm button[type=submit]").click();
  await page.locator('[data-setor="exp"]').click();
  return page;
}
// "Atualizar a lista do servidor", no menu (o mesmo que acontece sozinho a cada 30 s)
async function atualizarLista(page) {
  await page.locator("#viewHome .menu-btn").click();
  await expect(page.locator("#menuReset")).toHaveText("Atualizar a lista do servidor");
  await page.locator("#menuReset").click();
}
const cartao = (page, id) => page.locator(`button.order[data-id="${id}"]`);

test("dois coletores: o pedido que um pega aparece 'Com Fulano' no outro, e o concluído aparece concluído", async ({ browser }) => {
  const sep = USERS.find((u) => u.perfil === "sep");
  const ana = await coletor(browser, sep.login);
  const bruna = await coletor(browser, "separador2");

  // a lista dos dois veio do servidor: o lote do coordenador aparece nos dois
  for (const p of [ana, bruna]) await expect(p.locator('[data-lote="L-1"]')).toBeVisible();

  // Ana começa o PV-10421
  await abrirPedidoNoColetor(ana, "PV-10421");
  await expect.poll(async () => (await pool.query("SELECT status FROM pedidos WHERE id = 'PV-10421'")).rows[0].status).toBe("andamento");

  // Bruna atualiza: o pedido está "Com Usuário" (primeiro nome do separador) e não abre
  await atualizarLista(bruna);
  await expect(cartao(bruna, "PV-10421")).toContainText(`Com ${sep.nome.split(" ")[0]}`);
  await cartao(bruna, "PV-10421").click();
  await expect(bruna.locator("#toast")).toContainText(`PV-10421 está com ${sep.nome}`);
  await expect(bruna.locator("#sheetStart")).toBeHidden();

  // Ana termina e deixa na doca
  const pedido = (await separacao(ana)).find((o) => o.id === "PV-10421");
  for (const item of pedido.itens) await separarItem(ana, item);
  await lerDoca(ana, "R9002-P1-A100-AP101");
  await expect.poll(async () => (await pool.query("SELECT status FROM pedidos WHERE id = 'PV-10421'")).rows[0].status).toBe("concluido");

  // Bruna atualiza: concluído, com a doca (e não "pendente", como acontecia com a cópia antiga do aparelho)
  await atualizarLista(bruna);
  await bruna.locator('#viewHome [data-filter="concluido"]').click();
  await expect(cartao(bruna, "PV-10421")).toContainText("Concluído");
  await expect(cartao(bruna, "PV-10421")).toContainText("R9002-P1-A100-AP101");

  // o lote L-1 que a Ana começa também fica "Com Usuário" para a Bruna
  await ana.locator("#doneBack").click();
  await ana.locator('[data-lote="L-1"]').click();
  await ana.locator("#startGo").click();
  await expect.poll(async () => (await pool.query("SELECT count(*)::int n FROM pedidos WHERE lote = 'L-1' AND status = 'andamento'")).rows[0].n).toBe(2);
  await bruna.locator('#viewHome [data-filter="abertos"]').click();
  await atualizarLista(bruna);
  await expect(bruna.locator('[data-lote="L-1"]')).toContainText(`Com ${sep.nome.split(" ")[0]}`);

  await ana.context().close();
  await bruna.context().close();
});
