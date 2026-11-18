// Fase 1e: o quadro da Separação na Gestão vale de verdade. O coordenador distribui os pedidos
// e o coletor de cada separador mostra só a fila dele, na ordem do quadro.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prepararBancoDeTeste } from "./banco-de-teste.js";
import { criarServidor } from "../src/servidor.js";
import { USERS } from "../../js/sessao.js";

let pool, app, coord, sep, sep2;
before(async () => {
  pool = await prepararBancoDeTeste();
  app = criarServidor({ pool });
  coord = await entrar("coordenador"); sep = await entrar("separador"); sep2 = await entrar("separador2");
});
after(async () => {
  await app.close();
  await pool.end();
});

const usuario = (login) => USERS.find((u) => u.login === login);
// cada usuário num aparelho diferente (o login único não atrapalha: um aparelho por pessoa)
const entrar = async (login) =>
  (await app.inject({ method: "POST", url: "/api/login", payload: { login, pin: usuario(login).pin, aparelho: `teste-${login}` } })).json().token;
const auth = (token) => ({ authorization: `Bearer ${token}` });
const quadro = async (token, setor = "exp") => app.inject({ url: `/api/quadro/separacao?setor=${setor}`, headers: auth(token) });
const post = (token, url, payload) => app.inject({ method: "POST", url, headers: auth(token), payload });
const mover = (token, unidade, para, ordem = []) => post(token, "/api/quadro/mover", { setor: "exp", unidade, para, ordem });
const filaDoColetor = async (token, setor = "exp") =>
  (await app.inject({ url: `/api/separacao?setor=${setor}`, headers: auth(token) })).json().pedidos.map((p) => p.id);
let relogio = Date.now() - 60_000;
const acao = (tipo, dados) => ({ id: randomUUID(), tipo, dados, feitaEm: new Date((relogio += 1000)).toISOString() });


test("só o coordenador do setor abre e mexe no quadro", async () => {
  assert.equal((await quadro(sep)).statusCode, 403);
  assert.equal((await quadro(coord, "mont")).statusCode, 403, "o de expedição não mexe na montagem");
  assert.equal((await quadro(await entrar("montagem"), "mont")).statusCode, 200);
  assert.equal((await mover(sep, "PV-10427", "separador")).statusCode, 403);
});

test("o quadro mostra a caixa de entrada, as filas e todos os separadores", async () => {
  const q = (await quadro(coord)).json();
  assert.ok(Date.parse(q.agora));
  const caixa = q.pedidos.filter((p) => !p.designado_para).map((p) => p.id);
  assert.deepEqual(caixa.sort(), ["PV-10423", "PV-10427", "PV-10428"]);
  const ag = q.pedidos.find((p) => p.id === "PV-10423");
  assert.deepEqual([ag.aguardando, ag.rota], [true, null]);
  assert.equal(q.pedidos.find((p) => p.id === "PV-10428").rota, null, "chegou sem rota");
  assert.equal(q.pedidos.find((p) => p.id === "PV-10427").rota, "centro");
  const p = q.pedidos.find((x) => x.id === "PV-10421");
  assert.deepEqual([p.designado_para, p.ordem_fila, p.itens, p.itens_feitos], ["separador", 1, 4, 0]);
  assert.ok(p.item_atual.endereco && p.item_atual.descricao);
  assert.deepEqual(q.separadores.map((s) => s.login).sort(), ["separador", "separador2"]);
  assert.ok(q.separadores.every((s) => s.conectado && s.ultimo_contato && s.separados_hoje === 0));
});

test("pedido sem rota não vai para separador: primeiro a rota, depois a fila, na posição em que foi solto", async () => {
  const r = await mover(coord, "PV-10428", "separador");
  assert.equal(r.statusCode, 409);
  assert.equal(r.json().erro, "Defina a rota do PV-10428 antes de mandar para um separador.");
  assert.equal((await post(coord, "/api/quadro/rota", { setor: "exp", pedido: "PV-10428", rota: "naoexiste" })).statusCode, 400);
  assert.equal((await post(coord, "/api/quadro/rota", { setor: "exp", pedido: "PV-10428", rota: "centro" })).statusCode, 200);
  // soltou entre o PV-10421 e o PV-10422
  assert.equal((await mover(coord, "PV-10428", "separador", ["PV-10421", "PV-10428", "PV-10422", "L-1", "PV-10426/1"])).statusCode, 200);
  assert.deepEqual(await filaDoColetor(sep), ["PV-10421", "PV-10428", "PV-10422", "PV-10424", "PV-10425", "PV-10426/1"]);
});

test("aguardando vai para o separador sem rota; o lote anda inteiro (mesmo arrastando um pedido dele)", async () => {
  assert.equal((await mover(coord, "PV-10423", "separador2", ["PV-10423", "PV-10426/2"])).statusCode, 200);
  assert.equal((await mover(coord, "PV-10424", "separador2", ["PV-10423", "L-1", "PV-10426/2"])).statusCode, 200);
  assert.deepEqual(await filaDoColetor(sep2), ["PV-10423", "PV-10424", "PV-10425", "PV-10426/2"]);
  assert.ok(!(await filaDoColetor(sep)).includes("PV-10424"), "saiu da fila do outro");
});

test("pedido em separação não muda de fila", async () => {
  await post(sep, "/api/sincronizar", { acoes: [acao("separacao.iniciar", { pedido: "PV-10421" })] });
  const r = await mover(coord, "PV-10421", null);
  assert.equal(r.statusCode, 409);
  assert.equal(r.json().erro, "PV-10421 já está em separação: não dá para mudar de fila.");
  // devolver para a caixa um que não começou: some do coletor
  assert.equal((await mover(coord, "PV-10422", null)).statusCode, 200);
  assert.ok(!(await filaDoColetor(sep)).includes("PV-10422"));
});

test("a tela desatualizada (outro coordenador mexeu ao mesmo tempo) não perde nem repete pedido", async () => {
  // a tela manda uma ordem com pedido que nem está mais lá e sem o PV-10426/1
  assert.equal((await mover(coord, "PV-10422", "separador", ["PV-10422", "PV-99999", "PV-10428", "PV-10422"])).statusCode, 200);
  const fila = await filaDoColetor(sep);
  assert.deepEqual(fila, ["PV-10421", "PV-10422", "PV-10428", "PV-10426/1"].filter((id) => fila.includes(id)));
  assert.equal(new Set(fila).size, fila.length);
  assert.ok(fila.includes("PV-10426/1"));
});

test("lote do coordenador: só da caixa de entrada; desfaz antes de começar", async () => {
  // a caixa tem só o PV-10427 agora: devolve o PV-10428 para ter dois
  await mover(coord, "PV-10428", null);
  const noSeparador = await post(coord, "/api/quadro/lotes", { setor: "exp", pedidos: ["PV-10427", "PV-10422"] });
  assert.equal(noSeparador.statusCode, 409);
  assert.equal(noSeparador.json().erro, "Só pedidos da caixa de entrada entram no lote.");

  const r = await post(coord, "/api/quadro/lotes", { setor: "exp", pedidos: ["PV-10427", "PV-10428"] });
  assert.equal(r.statusCode, 200);
  const { id, posicoes } = r.json();
  assert.match(id, /^L-[0-9A-F]{4}$/);
  assert.deepEqual(Object.values(posicoes).sort(), ["A", "B"]);
  assert.equal((await mover(coord, id, "separador")).statusCode, 200);
  assert.deepEqual((await filaDoColetor(sep)).slice(-2).sort(), ["PV-10427", "PV-10428"]);

  assert.equal((await post(coord, `/api/quadro/lotes/${id}/desfazer`, { setor: "exp" })).statusCode, 200);
  const lote = (await pool.query("SELECT count(*)::int AS n FROM pedidos WHERE lote = $1", [id])).rows[0].n;
  assert.equal(lote, 0);
  assert.equal((await post(coord, `/api/quadro/lotes/${id}/desfazer`, { setor: "exp" })).statusCode, 404);
});

test("cada mudança no quadro avisa as outras telas pelo tempo real", async () => {
  const avisos = [];
  const original = app.tempoReal.avisar;
  app.tempoReal.avisar = (evento, dados) => { avisos.push(evento); original(evento, dados); };
  try {
    await mover(coord, "PV-10427", null);
    await mover(coord, "PV-10421", null); // recusado: não avisa
    assert.deepEqual(avisos, ["quadro"]);
  } finally {
    app.tempoReal.avisar = original;
  }
});
