// v77 · Estoque no servidor, entrega A: as notas de entrada (aba Entrada da Gestão de Estoque).
// A lista filtra e pagina no banco; a devolução entregue ao estoque vira nota; o saldo bate com o histórico.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prepararBancoDeTeste } from "./banco-de-teste.js";
import { criarServidor } from "../src/servidor.js";
import { emTransacao } from "../src/banco.js";
import { USERS } from "../../js/sessao.js";
import { saldosForaDoHistorico, MSG_NADA_PENDENTE } from "../src/consultas/notas-entrada.js";
import { criarDevolucao, marcarEntregue } from "../src/consultas/devolucoes.js";
import { MSG_NOTA_JA_IMPORTADA } from "../../compartilhado/regras/recebimento.js";

let pool, app;
before(async () => {
  pool = await prepararBancoDeTeste();
  app = criarServidor({ pool });
});
after(async () => {
  await app.close();
  await pool.end();
});

const pin = (login) => USERS.find((u) => u.login === login).pin;
const tokens = {};
async function entrar(login) {
  tokens[login] ||= (await app.inject({ method: "POST", url: "/api/login", payload: { login, pin: pin(login) } })).json().token;
  return tokens[login];
}
const chamar = async (login, url, payload) => app.inject({
  method: payload ? "POST" : "GET", url, payload, headers: { authorization: `Bearer ${await entrar(login)}` },
});
const lista = async (consulta = "") => (await chamar("gestorestoque", `/api/estoque/notas${consulta}`)).json();
const idDaNota = async (numero) => (await pool.query("SELECT id FROM notas_entrada WHERE numero = $1", [numero])).rows[0].id;

test("semear: as notas da demonstração, com os três status, e o saldo igual ao histórico", async () => {
  const r = await lista();
  assert.equal(r.total, 6);
  assert.deepEqual(r.contagens, { total: 6, aguardando: 2, aberta: 1, conferida: 3, com: 1, parcial: 1, armazenado: 2 });
  const n = r.notas.find((x) => x.numero === "48190");
  assert.deepEqual(n.status, { conferencia: "conferida", divergencia: "com", armazenamento: "armazenado" });
  assert.equal(n.produtos, 2);
  assert.deepEqual(await saldosForaDoHistorico(pool), []);
});

test("lista: filtros e paginação no banco", async () => {
  assert.deepEqual((await lista("?conferencia=aguardando")).notas.map((n) => n.numero).sort(), ["48177", "48201"]);
  assert.deepEqual((await lista("?nf=4819")).notas.map((n) => n.numero), ["48190"]);
  assert.equal((await lista("?fornecedor=8603")).total, 2);
  assert.equal((await lista("?fornecedor=pedal")).total, 2);
  const p = await lista("?porPagina=10&pagina=9");
  assert.equal(p.pagina, 1, "página além do fim volta para a última");
  const hoje = new Date().toLocaleDateString("sv");
  assert.ok((await lista(`?de=${hoje}&ate=${hoje}`)).notas.every((n) => n.data === hoje));
  assert.equal((await chamar("gestorestoque", "/api/estoque/notas?porPagina=7")).statusCode, 400);
});

test("detalhe: itens, conferências com os volumes, produtos e docas", async () => {
  const d = (await chamar("gestorestoque", `/api/estoque/notas/${await idDaNota("48213")}`)).json();
  assert.deepEqual(d.nota.itens.map((i) => i.produto), ["167", "4084", "536"]);
  assert.equal(d.conferencias.length, 2);
  assert.equal(d.conferencias.find((c) => c.produto === "536").volumes.length, 2);
  assert.equal(d.volumes.length, 3);
  assert.ok(d.produtos.find((p) => p.codigo === "536").descricao);
  assert.match(d.docas[0].codigo, /^R9001-/);
  assert.equal((await chamar("gestorestoque", "/api/estoque/notas/9999")).statusCode, 404);
});

test("cancelar pendente: sai da lista de armazenamento e o saldo continua na doca", async () => {
  const id = await idDaNota("48155");
  const r = await chamar("gestorestoque", `/api/estoque/notas/${id}/cancelar-pendente`, { produto: "176" });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().status.armazenamento, "armazenado");
  const { rows } = await pool.query("SELECT cancelado, cancelado_por FROM recebimentos WHERE nota_id = $1 AND produto = '176'", [id]);
  assert.deepEqual(rows, [{ cancelado: 50, cancelado_por: "gestorestoque" }]);
  const de_novo = await chamar("gestorestoque", `/api/estoque/notas/${id}/cancelar-pendente`, { produto: "176" });
  assert.equal(de_novo.statusCode, 409);
  assert.equal(de_novo.json().erro, MSG_NADA_PENDENTE);
  assert.deepEqual(await saldosForaDoHistorico(pool), []);
});

test("buscar notas do ERP (simulado): importa as novas e bloqueia a repetida", async () => {
  const r = (await chamar("gestorestoque", "/api/estoque/notas/importar", {})).json();
  assert.deepEqual(r.importadas.map((n) => n.numero), ["48230", "48231", "48232", "48233"]);
  assert.deepEqual(r.bloqueadas.map((b) => [b.nota.numero, b.msg]), [["48177", MSG_NOTA_JA_IMPORTADA]]);
  const de_novo = (await chamar("gestorestoque", "/api/estoque/notas/importar", {})).json();
  assert.equal(de_novo.importadas.length, 0);
  assert.equal(de_novo.bloqueadas.length, 5);
  assert.equal((await lista()).total, 10);
});

test("produto novo pela nota: cadastrado com as embalagens; código de barras de outro produto vira aviso", async () => {
  const id = await idDaNota("48232");
  const p = (await pool.query("SELECT descricao, un, checkout, cadastrado_por_nota, cadastrado_em FROM produtos WHERE codigo = '99001'")).rows[0];
  assert.equal(p.descricao, "BICICLETA ARO 29 BEACH TRAIL 21V");
  assert.equal(p.checkout, true);
  assert.equal(p.cadastrado_por_nota, id);
  assert.ok(p.cadastrado_em);
  const emb = async (produto) => (await pool.query("SELECT codigo, qtd FROM embalagens WHERE produto = $1 ORDER BY qtd", [produto])).rows.map((e) => [e.codigo, e.qtd]);
  assert.deepEqual(await emb("99001"), [["7899990000011", 1], ["17899990000018", 2]]);
  assert.deepEqual(await emb("99002"), [[null, 1], ["17899990000025", 10]]);
  // o pneu 536 (que já existia) não mudou
  assert.deepEqual(await emb("536"), [["4717294987981", 1], ["14717294987988", 10]]);
  const d = (await chamar("gestorestoque", `/api/estoque/notas/${await idDaNota("48233")}`)).json();
  assert.equal(d.nota.avisos.length, 1);
  assert.match(d.nota.avisos[0], /4717294987981.*536/);
  assert.equal(d.produtos.find((x) => x.codigo === "99002").cadastrado_por_nota, d.nota.id);
  // o produto novo já é encontrado pelo código de barras (a consulta do coletor)
  const achado = (await chamar("gestorestoque", "/api/produtos/7899990000011")).json();
  assert.equal(achado.codigo, "99001");
});

test("devolução entregue ao estoque vira nota; a que espera a entrega, só depois de entregue", async () => {
  await emTransacao(pool, (c) => criarDevolucao(c, { pedido: "PV-10421", setor: "exp", origem: "gestor", entreguePor: "coordenador", itens: [{ produto: "536", qtd: 2 }] }));
  const n = (await lista("?nf=PV-10421")).notas;
  assert.equal(n.length, 1);
  assert.equal(n[0].tipo, "Devolução");
  assert.match(n[0].fornecedor.nome, /^Entregue por /);
  assert.equal(n[0].pedido, "PV-10421");

  await emTransacao(pool, (c) => criarDevolucao(c, { pedido: "PV-10422", setor: "exp", origem: "separador", itens: [{ produto: "176", qtd: 1 }], aEntregar: true, responsavel: "separador" }));
  assert.equal((await lista("?nf=PV-10422")).total, 0, "ainda está com o separador");
  await emTransacao(pool, (c) => marcarEntregue(c, { pedido: "PV-10422", origem: "separador", login: "separador" }));
  await emTransacao(pool, (c) => marcarEntregue(c, { pedido: "PV-10422", origem: "separador", login: "separador" }));
  const d = (await lista("?nf=PV-10422")).notas;
  assert.equal(d.length, 1, "entregar duas vezes não duplica");
  const det = (await chamar("gestorestoque", `/api/estoque/notas/${d[0].id}`)).json();
  assert.deepEqual(det.nota.itens, [{ produto: "176", qtd: 1 }]);
});

test("só o gestor de estoque", async () => {
  assert.equal((await chamar("coordenador", "/api/estoque/notas")).statusCode, 403);
  assert.equal((await chamar("estoquista", "/api/estoque/notas/importar", {})).statusCode, 403);
});
