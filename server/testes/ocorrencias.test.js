// v75: ocorrências do pedido no servidor. O gestor corta ou cancela na Gestão; quem está com a mercadoria na mão
// devolve (separador, conferente ou o próprio gestor) e toda devolução vira entrada pendente no estoque.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prepararBancoDeTeste } from "./banco-de-teste.js";
import { criarServidor } from "../src/servidor.js";
import { devolucoesDoPedido } from "../src/consultas/devolucoes.js";
import { USERS } from "../../js/sessao.js";

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
const auth = async (login) => ({ authorization: `Bearer ${await entrar(login)}` });
let relogio = Date.now() - 3_600_000;
const acao = (tipo, dados) => ({ id: randomUUID(), tipo, dados, feitaEm: new Date((relogio += 1000)).toISOString() });
const sincronizar = async (login, acoes) =>
  (await app.inject({ method: "POST", url: "/api/sincronizar", headers: await auth(login), payload: { acoes } })).json();
const ocorrencia = async (dados, login = "coordenador") =>
  app.inject({ method: "POST", url: "/api/ocorrencias", headers: await auth(login),
    payload: { setor: "exp", motivo: "desistencia", referencia: "ALT-77", ...dados } });
const abrir = async (pedido) =>
  (await app.inject({ method: "GET", url: `/api/ocorrencias/pedido?setor=exp&pedido=${pedido}`, headers: await auth("coordenador") })).json().pedido;
const itens = async (pedido) =>
  (await pool.query("SELECT sequencia, produto, qtd, qtd_pedida, qtd_separada, qtd_devolver, status FROM itens_pedido WHERE pedido_id = $1 ORDER BY sequencia", [pedido])).rows;
const pedidoNoBanco = async (id) => (await pool.query("SELECT * FROM pedidos WHERE id = $1", [id])).rows[0];
const conferencia = async (id) => (await pool.query("SELECT * FROM conferencias WHERE pedido = $1", [id])).rows[0];
const OBS = { tipos: { caixa: 1 }, outro: "", atencao: "" };
const nome = async (login) => (await pool.query("SELECT nome FROM usuarios WHERE login = $1", [login])).rows[0].nome;

// põe o pedido com o separador, com o primeiro item já separado
async function emSeparacao(id, login = "separador") {
  await pool.query("UPDATE pedidos SET status = 'andamento', separador = $2, designado_para = $2, inicio = now() WHERE id = $1", [id, login]);
  await pool.query("UPDATE itens_pedido SET qtd_separada = qtd, status = 'ok' WHERE pedido_id = $1 AND sequencia = 1", [id]);
  return itens(id);
}

test("só o gestor do setor registra; motivo e referência são obrigatórios", async () => {
  assert.equal((await ocorrencia({ pedido: "PV-10428", tipo: "cancelamento" }, "conferente")).statusCode, 403);
  const r = await ocorrencia({ pedido: "PV-10428", tipo: "cancelamento", referencia: " " });
  assert.equal(r.statusCode, 400);
  assert.match(r.json().erro, /referência do Sankhya/);
  assert.equal((await ocorrencia({ pedido: "PV-99999", tipo: "cancelamento" })).statusCode, 404);
});

test("na fila, ainda não separado: o gestor corta e a quantidade só diminui", async () => {
  const [i] = await itens("PV-10428");
  assert.equal((await abrir("PV-10428")).etapa, "aguardando-separacao");
  const r = await ocorrencia({ pedido: "PV-10428", tipo: "corte", cortes: { [i.produto]: 1 } });
  assert.equal(r.statusCode, 200, r.body);
  const [depois] = await itens("PV-10428");
  assert.deepEqual([depois.qtd, depois.qtd_pedida, depois.qtd_devolver, depois.status], [1, i.qtd, 0, "pendente"]);
  assert.deepEqual(r.json().ocorrencia.entradas, []);
  // o histórico da Gestão
  const h = (await app.inject({ method: "GET", url: "/api/ocorrencias?setor=exp", headers: await auth("coordenador") })).json().ocorrencias;
  assert.deepEqual([h[0].pedido, h[0].tipo, h[0].referencia, h[0].usuario], ["PV-10428", "corte", "ALT-77", "Usuário Coordenador"]);
});

test("em separação: o separador confirma no coletor e a entrada nasce entregue por ele", async () => {
  const [a, b] = await emSeparacao("PV-10427");
  const r = await ocorrencia({ pedido: "PV-10427", tipo: "corte", cortes: { [a.produto]: a.qtd - 1, [b.produto]: 0 } });
  assert.deepEqual(r.json().ocorrencia.avisar, ["separador"]);
  assert.equal((await pedidoNoBanco("PV-10427")).ocorrencia_pendente, true);
  let [x, y] = await itens("PV-10427");
  assert.deepEqual([x.qtd, x.qtd_separada, x.qtd_devolver], [a.qtd - 1, a.qtd, 1]);
  assert.equal(y.status, "cortado");
  // o coletor recebe o aviso e o corte
  const lista = (await app.inject({ method: "GET", url: "/api/separacao?setor=exp", headers: await auth("separador") })).json().pedidos;
  const p = lista.find((o) => o.id === "PV-10427");
  assert.equal(p.ocorrencia_pendente, true);
  assert.equal(p.itens[0].qtd_devolver, 1);
  assert.deepEqual(await devolucoesDoPedido(pool, "PV-10427"), []); // ainda está na caixa
  // o separador confirma
  const s = await sincronizar("separador", [acao("separacao.ocorrencia", { pedido: "PV-10427" })]);
  assert.deepEqual(s.recusadas, []);
  [x] = await itens("PV-10427");
  assert.deepEqual([x.qtd_separada, x.qtd_devolver], [a.qtd - 1, 0]);
  assert.equal((await pedidoNoBanco("PV-10427")).ocorrencia_pendente, false);
  assert.deepEqual(await devolucoesDoPedido(pool, "PV-10427"),
    [{ numero: "PV-10427", origem: "separador", entregue_por: "separador", responsavel: null, status: "pendente", itens: [{ produto: a.produto, qtd: 1 }] }]);
});

test("físico vence: o separador (sem rede) separou a quantidade antiga depois do corte", async () => {
  const [, b] = await emSeparacao("PV-10425");
  await ocorrencia({ pedido: "PV-10425", tipo: "corte", cortes: { [b.produto]: b.qtd - 1 } });
  const s = await sincronizar("separador", [acao("separacao.item", { pedido: "PV-10425", sequencia: 2, qtdSeparada: b.qtd, status: "ok" })]);
  assert.deepEqual(s.recusadas, []);
  const [, x] = await itens("PV-10425");
  assert.deepEqual([x.qtd, x.qtd_separada, x.qtd_devolver, x.status], [b.qtd - 1, b.qtd, 1, "ok"]);
  assert.equal((await pedidoNoBanco("PV-10425")).ocorrencia_pendente, true);
});

test("separado aguardando conferência: o conferente tira da caixa (F9); nada nasce antes disso", async () => {
  const a = (await itens("PV-10404")).find((i) => i.qtd_separada === i.qtd && i.qtd > 1); // separado por completo
  const r = await ocorrencia({ pedido: "PV-10404", tipo: "corte", cortes: { [a.produto]: a.qtd - 1 } });
  assert.deepEqual([r.json().ocorrencia.avisar, r.json().ocorrencia.entradas], [["conferente"], []]);
  const x = (await itens("PV-10404")).find((i) => i.sequencia === a.sequencia);
  assert.deepEqual([x.qtd, x.qtd_separada, x.qtd_devolver], [a.qtd - 1, a.qtd_separada, 1]);
  assert.deepEqual(await devolucoesDoPedido(pool, "PV-10404"), []);
});

test("em conferência: o conferente tira (F9), entrega ao estoque e só então finaliza", async () => {
  const lista = async () => (await app.inject({ method: "GET", url: "/api/conferencia?setor=exp", headers: await auth("conferente") })).json().pedidos;
  const p = (await lista()).find((c) => c.pedido === "PV-10401");
  const contagens = p.itens.map((i) => ({ produto: i.produto, qtd: i.qtd_separada }));
  await sincronizar("conferente", [acao("conferencia.iniciar", { pedido: "PV-10401" })]);
  const [a] = p.itens;
  const r = await ocorrencia({ pedido: "PV-10401", tipo: "corte", cortes: { [a.produto]: a.qtd - 1 } });
  assert.deepEqual(r.json().ocorrencia.avisar, ["conferente"]);
  // o posto vê o que tem que sair
  const q = (await lista()).find((c) => c.pedido === "PV-10401");
  assert.equal(q.itens.find((i) => i.produto === a.produto).qtd_devolver, 1);
  const cedo = await sincronizar("conferente", [acao("conferencia.finalizar", { pedido: "PV-10401", volumes: 1, observacao: OBS, contagens })]);
  assert.deepEqual(cedo.recusadas.map((x) => x.motivo), ["FAÇA A DEVOLUÇÃO DO QUE O GESTOR CORTOU ANTES DE FINALIZAR (F9)."]);
  // tirou da caixa e entregou
  const fim = await sincronizar("conferente", [
    acao("conferencia.devolver", { pedido: "PV-10401", itens: [{ produto: a.produto, qtd: 1 }] }),
    acao("conferencia.finalizar", { pedido: "PV-10401", volumes: 1, observacao: OBS,
      contagens: contagens.map((x) => (x.produto === a.produto ? { ...x, qtd: x.qtd - 1 } : x)) }),
  ]);
  assert.deepEqual(fim.recusadas, []);
  assert.equal((await conferencia("PV-10401")).status, "conferido");
  const [d] = await devolucoesDoPedido(pool, "PV-10401");
  assert.deepEqual([d.origem, d.entregue_por, d.itens], ["conferente", "conferente", [{ produto: a.produto, qtd: 1 }]]);
  // o histórico do corte passa a mostrar a DEV e quem entregou
  const hist = (await app.inject({ method: "GET", url: "/api/ocorrencias?setor=exp", headers: await auth("coordenador") })).json().ocorrencias;
  assert.deepEqual(hist.find((o) => o.pedido === "PV-10401").entregas, [{ numero: d.numero, aguardando: false, quem: await nome("conferente") }]);
});

test("conferido: volta para a fila de quem conferiu tirar da caixa (F9) e refazer volumes e etiquetas", async () => {
  const [a] = await itens("PV-10401");
  const antes = (await pool.query("SELECT qtd_conferida FROM conferencia_itens WHERE pedido = 'PV-10401' AND produto = $1", [a.produto])).rows[0].qtd_conferida;
  const o = await ocorrencia({ pedido: "PV-10401", tipo: "corte", cortes: { [a.produto]: a.qtd - 1 } });
  assert.deepEqual(o.json().ocorrencia.avisar, ["conferente"]);
  const c = await conferencia("PV-10401");
  assert.deepEqual([c.status, c.conferente, c.volumes, c.designado_para], ["aguardando", null, null, "conferente"]);
  assert.equal(c.reaberto.referencia, "ALT-77");
  // a contagem não passa do que ficou na caixa
  const depois = (await pool.query("SELECT qtd_conferida FROM conferencia_itens WHERE pedido = 'PV-10401' AND produto = $1", [a.produto])).rows[0].qtd_conferida;
  assert.equal(depois, antes - 1);
  assert.equal((await devolucoesDoPedido(pool, "PV-10401")).length, 1); // só a de antes: o conferente ainda não tirou
  // o conferente tira (F9), entrega e refaz
  const contagens = (await itens("PV-10401")).map((i) => ({ produto: i.produto, qtd: i.qtd_separada - i.qtd_devolver }));
  const r = await sincronizar("conferente", [
    acao("conferencia.iniciar", { pedido: "PV-10401" }),
    acao("conferencia.devolver", { pedido: "PV-10401", itens: [{ produto: a.produto, qtd: 1 }] }),
    acao("conferencia.finalizar", { pedido: "PV-10401", volumes: 1, observacao: OBS, contagens }),
  ]);
  assert.deepEqual(r.recusadas, []);
  const d = (await devolucoesDoPedido(pool, "PV-10401")).at(-1);
  assert.deepEqual([d.numero, d.origem, d.entregue_por], ["PV-10401-2", "conferente", "conferente"]);
});

test("cancelamento: sai de tudo; o que estava na caixa vira entrada, entregue por quem estava com ela", async () => {
  // na conferência
  await sincronizar("conferente", [acao("conferencia.iniciar", { pedido: "PV-10402" })]);
  const r = await ocorrencia({ pedido: "PV-10402", tipo: "cancelamento" });
  assert.equal(r.json().pedido.etapa, "cancelado");
  assert.equal((await conferencia("PV-10402")).status, "cancelado");
  assert.equal((await pedidoNoBanco("PV-10402")).status, "cancelado");
  // ninguém bipa: a devolução espera o conferente marcar a entrega (o estoque ainda não vê)
  let [d] = await devolucoesDoPedido(pool, "PV-10402");
  assert.deepEqual([d.origem, d.status, d.responsavel, d.entregue_por], ["conferente", "a_entregar", "conferente", null]);
  assert.deepEqual(r.json().ocorrencia.entregas, [{ numero: "PV-10402", aguardando: true, quem: (await nome("conferente")) }]);
  const listaDoPosto = async () => (await app.inject({ method: "GET", url: "/api/conferencia?setor=exp", headers: await auth("conferente") })).json().pedidos;
  const noPosto = (await listaDoPosto()).find((c) => c.pedido === "PV-10402");
  assert.deepEqual([noPosto.status, noPosto.entregar.numero, noPosto.entregar.itens.length], ["cancelado", "PV-10402", d.itens.length]);
  const posto = await sincronizar("conferente", [acao("conferencia.contagem", { pedido: "PV-10402", produto: d.itens[0].produto, qtd: 1 })]);
  assert.deepEqual(posto.recusadas.map((x) => x.motivo), ["O GESTOR CANCELOU O PV-10402."]);
  // "Entregue ao estoque": registra quem e quando; a segunda vez não duplica
  const ent = await sincronizar("conferente", [acao("conferencia.entregar", { pedido: "PV-10402" }), acao("conferencia.entregar", { pedido: "PV-10402" })]);
  assert.deepEqual(ent.recusadas, []);
  const ds2 = await devolucoesDoPedido(pool, "PV-10402");
  assert.deepEqual(ds2.map((x) => [x.status, x.entregue_por]), [["pendente", "conferente"]]);
  assert.equal((await listaDoPosto()).find((c) => c.pedido === "PV-10402").entregar, null);
  // de novo: bloqueado
  assert.equal((await ocorrencia({ pedido: "PV-10402", tipo: "cancelamento" })).statusCode, 409);

  // em separação: o coletor fica sabendo (a lista traz o cancelado de hoje) e o que ele pegar sem rede volta ao estoque
  const [a, b] = await emSeparacao("PV-10424");
  await ocorrencia({ pedido: "PV-10424", tipo: "cancelamento" });
  const lista = (await app.inject({ method: "GET", url: "/api/separacao?setor=exp", headers: await auth("separador") })).json().pedidos;
  const cancelado = lista.find((o) => o.id === "PV-10424");
  assert.equal(cancelado.status, "cancelado");
  assert.deepEqual(cancelado.entregar.itens.map((i) => [i.sku, i.qtd]), [[a.produto, Number(a.qtd)]]);
  // o que ele pegou sem rede soma na mesma devolução; depois ele marca a entrega
  const s = await sincronizar("separador", [
    acao("separacao.item", { pedido: "PV-10424", sequencia: 2, qtdSeparada: b.qtd, status: "ok" }),
    acao("separacao.concluir", { pedido: "PV-10424", doca: "R9002-P1-A100-AP101" }),
    acao("separacao.entregar", { pedido: "PV-10424" }),
  ]);
  assert.deepEqual(s.recusadas.map((x) => x.motivo), ["O GESTOR CANCELOU O PV-10424. ENTREGUE O QUE JÁ SEPAROU AO ESTOQUE."]);
  const ds = await devolucoesDoPedido(pool, "PV-10424");
  assert.deepEqual(ds.map((x) => [x.numero, x.origem, x.status, x.entregue_por, x.itens]), [
    ["PV-10424", "separador", "pendente", "separador",
      [{ produto: a.produto, qtd: a.qtd }, { produto: b.produto, qtd: b.qtd }].sort((x, y) => x.produto.localeCompare(y.produto))],
  ]);
  // entregue: some da lista do coletor no dia seguinte, e hoje vem sem nada a entregar
  const depois = (await app.inject({ method: "GET", url: "/api/separacao?setor=exp", headers: await auth("separador") })).json().pedidos;
  assert.equal(depois.find((o) => o.id === "PV-10424").entregar, null);
  // e o quadro da Separação não mostra mais o pedido cancelado
  const quadro = (await app.inject({ method: "GET", url: "/api/quadro/separacao?setor=exp", headers: await auth("coordenador") })).json();
  assert.ok(!JSON.stringify(quadro).includes("PV-10424"));
});

test("cancelamento com dois separadores no mesmo pedido: cada um entrega a sua parte", async () => {
  const [a1] = await emSeparacao("PV-10426/1", "separador");
  const [a2] = await emSeparacao("PV-10426/2", "separador2");
  await ocorrencia({ pedido: "PV-10426", tipo: "cancelamento" });
  const ds = (await devolucoesDoPedido(pool, "PV-10426")).map((x) => [x.origem, x.status, x.responsavel, x.itens]);
  assert.deepEqual(ds, [
    ["separador", "a_entregar", "separador", [{ produto: a1.produto, qtd: a1.qtd }]],
    ["separador", "a_entregar", "separador2", [{ produto: a2.produto, qtd: a2.qtd }]],
  ]);
  // o coletor de cada um mostra só a sua
  const lista = (await app.inject({ method: "GET", url: "/api/separacao?setor=exp", headers: await auth("separador") })).json().pedidos;
  assert.deepEqual(lista.find((o) => o.id === "PV-10426/1").entregar.itens.map((i) => i.sku), [a1.produto]);
  // a entrega de um não marca a do outro
  await sincronizar("separador", [acao("separacao.entregar", { pedido: "PV-10426/1" })]);
  assert.deepEqual((await devolucoesDoPedido(pool, "PV-10426")).map((x) => [x.responsavel, x.status, x.entregue_por]),
    [["separador", "pendente", "separador"], ["separador2", "a_entregar", null]]);
});

test("cancelado na caixa de entrada da conferência: quem o gestor designa passa a ser o responsável pela entrega", async () => {
  await pool.query("UPDATE conferencias SET designado_para = NULL, ordem_fila = NULL WHERE pedido = 'PV-10403'");
  await ocorrencia({ pedido: "PV-10403", tipo: "cancelamento" });
  const resp = async () => (await devolucoesDoPedido(pool, "PV-10403")).map((x) => [x.origem, x.status, x.responsavel]);
  assert.deepEqual(await resp(), [["conferente", "a_entregar", null]]);
  const mover = (para) => app.inject({ method: "POST", url: "/api/quadro/conferencia/mover", headers: { authorization: `Bearer ${tokens.coordenador}` },
    payload: { setor: "exp", pedido: "PV-10403", para, ordem: [] } });
  assert.equal((await mover("conferente2")).statusCode, 200);
  assert.deepEqual(await resp(), [["conferente", "a_entregar", "conferente2"]]);
  const hist = (await app.inject({ method: "GET", url: "/api/ocorrencias?setor=exp", headers: await auth("coordenador") })).json().ocorrencias;
  assert.equal(hist.find((o) => o.pedido === "PV-10403").entregas[0].quem, (await nome("conferente2")));
  assert.equal((await mover(null)).statusCode, 200);
  assert.deepEqual(await resp(), [["conferente", "a_entregar", null]]);
});
