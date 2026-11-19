// Fase 2: a Conferência passa pelo servidor. O posto manda as ações pela mesma fila da Separação;
// o pedido separado entra sozinho na caixa de entrada da conferência.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prepararBancoDeTeste } from "./banco-de-teste.js";
import { criarServidor } from "../src/servidor.js";
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
// cada login entra uma vez (o login único deixa entrar de novo no mesmo aparelho, mas não precisa)
const tokens = {};
async function entrar(login) {
  tokens[login] ||= (await app.inject({ method: "POST", url: "/api/login", payload: { login, pin: pin(login) } })).json().token;
  return tokens[login];
}
let relogio = Date.parse("2026-11-19T08:00:00Z");
const acao = (tipo, dados) => ({ id: randomUUID(), tipo, dados, feitaEm: new Date((relogio += 1000)).toISOString() });
const sincronizar = async (login, acoes) =>
  (await app.inject({ method: "POST", url: "/api/sincronizar", headers: { authorization: `Bearer ${await entrar(login)}` }, payload: { acoes } })).json();
const lista = async (login, setor = "exp") =>
  (await app.inject({ method: "GET", url: `/api/conferencia?setor=${setor}`, headers: { authorization: `Bearer ${await entrar(login)}` } })).json().pedidos;
const conferencia = async (id) => (await pool.query("SELECT * FROM conferencias WHERE pedido = $1", [id])).rows[0];
const OBS = { tipos: { caixa: 2 }, outro: "", atencao: "" };

test("o posto mostra só a fila do conferente, na ordem do quadro, com os itens separados", async () => {
  const ana = await lista("conferente");
  assert.deepEqual(ana.map((c) => c.pedido), ["PV-10401", "PV-10402"]);
  assert.deepEqual((await lista("conferente2")).map((c) => c.pedido), ["PV-10403"]);
  const p = ana[0];
  assert.equal(p.status, "aguardando");
  assert.equal(p.separador_nome, "Davi");
  assert.ok(p.doca);
  assert.ok(p.itens.length > 0 && p.itens.every((i) => i.descricao && i.qtd_separada != null));
  assert.deepEqual((await lista("conferente", "mont")).map((c) => c.pedido), ["OP-3208"]);
});

test("conferir de ponta a ponta: iniciar, contar, finalizar com volumes; divergência decidida no servidor", async () => {
  const [p] = await lista("conferente");
  const contagens = p.itens.map((i) => ({ produto: i.produto, qtd: i.qtd_separada }));
  const r = await sincronizar("conferente", [
    acao("conferencia.iniciar", { pedido: p.pedido }),
    acao("conferencia.contagem", { pedido: p.pedido, produto: contagens[0].produto, qtd: 1 }),
    acao("conferencia.finalizar", { pedido: p.pedido, volumes: 2, observacao: OBS, posto: "02", contagens }),
  ]);
  assert.deepEqual(r.recusadas, []);
  const c = await conferencia(p.pedido);
  assert.equal(c.status, "conferido");
  assert.equal(c.conferente, "conferente");
  assert.equal(c.volumes, 2);
  assert.equal(c.posto, "02");
  assert.deepEqual(c.observacao, OBS);
  const contadas = (await pool.query("SELECT produto, qtd_conferida FROM conferencia_itens WHERE pedido = $1 ORDER BY produto", [p.pedido])).rows;
  assert.equal(contadas.length, contagens.length);
  // aparece em "conferidos hoje" na lista do posto
  assert.equal((await lista("conferente")).find((x) => x.pedido === p.pedido).status, "conferido");

  // o segundo: faltou um produto → divergente
  const [, q] = await lista("conferente");
  const menos = q.itens.slice(1).map((i) => ({ produto: i.produto, qtd: i.qtd_separada }));
  await sincronizar("conferente", [acao("conferencia.iniciar", { pedido: q.pedido }), acao("conferencia.finalizar", { pedido: q.pedido, volumes: 1, observacao: OBS, contagens: menos })]);
  assert.equal((await conferencia(q.pedido)).status, "divergente");
});

test("dois postos no mesmo pedido: o segundo é conflito; perfil que não é conferente é recusado", async () => {
  const [p] = await lista("conferente2");
  assert.deepEqual((await sincronizar("conferente2", [acao("conferencia.iniciar", { pedido: p.pedido })])).recusadas, []);
  // o coordenador passa para a Ana enquanto a Bruna já começou (o quadro travaria; aqui, direto no banco)
  await pool.query("UPDATE conferencias SET designado_para = 'conferente' WHERE pedido = $1", [p.pedido]);
  const r = await sincronizar("conferente", [acao("conferencia.iniciar", { pedido: p.pedido })]);
  assert.equal(r.recusadas[0].resultado, "conflito");
  const sep = await sincronizar("separador", [acao("conferencia.iniciar", { pedido: "PV-10404" })]);
  assert.match(sep.recusadas[0].motivo, /PERFIL SEM PERMISSÃO/);
});

test("pedido que acabou de ser separado entra na caixa de entrada da conferência; dividido, já com a primeira parte (v72)", async () => {
  const itens = async (id) => (await pool.query("SELECT sequencia, qtd FROM itens_pedido WHERE pedido_id = $1 ORDER BY sequencia", [id])).rows;
  const separar = async (login, id) => {
    await pool.query("UPDATE pedidos SET designado_para = $2 WHERE id = $1", [id, login]);
    return sincronizar(login, [
      acao("separacao.iniciar", { pedido: id }),
      ...(await itens(id)).map((i) => acao("separacao.item", { pedido: id, sequencia: i.sequencia, qtdSeparada: i.qtd, status: "ok" })),
      acao("separacao.concluir", { pedido: id, doca: "R9002-P1-A100-AP101" }),
    ]);
  };
  assert.deepEqual((await separar("separador", "PV-10427")).recusadas, []);
  const c = await conferencia("PV-10427");
  assert.equal(c.status, "aguardando");
  assert.equal(c.designado_para, null); // caixa de entrada: o coordenador decide quem confere

  // a 2/2 termina ANTES da 1/2: o pedido original já entra na conferência
  await separar("separador2", "PV-10426/2");
  assert.equal((await conferencia("PV-10426")).status, "aguardando");
  await pool.query("UPDATE conferencias SET designado_para = 'conferente2', ordem_fila = 9 WHERE pedido = 'PV-10426'");
  let junto = (await lista("conferente2")).find((x) => x.pedido === "PV-10426");
  assert.deepEqual(junto.partes.map((x) => [x.numero, x.pronta]), [[1, false], [2, true]]);
  assert.equal(junto.separador_nome, "Segundo Separador"); // só quem já entregou na doca
  const n1 = (await itens("PV-10426/1")).length, n2 = (await itens("PV-10426/2")).length;
  assert.equal(junto.itens.length, n1 + n2);
  assert.equal(junto.itens.filter((i) => i.em_separacao && i.parte === "1/2").length, n1);

  // o conferente confere o que chegou, mas não finaliza: a parte 1/2 ainda está em separação
  const contagens = () => junto.itens.map((i) => ({ produto: i.produto, qtd: i.em_separacao ? 0 : i.qtd_separada }));
  const cedo = await sincronizar("conferente2", [
    acao("conferencia.iniciar", { pedido: "PV-10426" }),
    acao("conferencia.finalizar", { pedido: "PV-10426", volumes: 1, observacao: OBS, contagens: contagens() }),
  ]);
  assert.deepEqual(cedo.recusadas.map((x) => x.motivo), ["A PARTE 1/2 DO PV-10426 AINDA ESTÁ EM SEPARAÇÃO."]);
  assert.equal((await conferencia("PV-10426")).status, "andamento");

  // a 1/2 termina: os itens dela entram na mesma conferência, e agora finaliza (uma conferência só)
  await separar("separador", "PV-10426/1");
  junto = (await lista("conferente2")).find((x) => x.pedido === "PV-10426");
  assert.ok(junto.partes.every((x) => x.pronta) && junto.itens.every((i) => !i.em_separacao));
  const fim = await sincronizar("conferente2", [
    acao("conferencia.finalizar", { pedido: "PV-10426", volumes: 2, observacao: OBS, contagens: contagens() }),
  ]);
  assert.deepEqual(fim.recusadas, []);
  assert.equal((await conferencia("PV-10426")).status, "conferido");
});

test("separar novamente: sai da conferência que ninguém começou; recusado depois que a conferência começou", async () => {
  // o PV-10427 está na caixa da conferência (teste anterior): separar de novo tira de lá
  const r = await sincronizar("separador", [acao("separacao.reabrir", { pedido: "PV-10427" })]);
  assert.deepEqual(r.recusadas, []);
  assert.equal(await conferencia("PV-10427"), undefined);
  // o PV-10401 já foi conferido: separar de novo é recusado
  await pool.query("UPDATE pedidos SET designado_para = 'separador' WHERE id = 'PV-10401'");
  const n = await sincronizar("separador", [acao("separacao.reabrir", { pedido: "PV-10401" })]);
  assert.match(n.recusadas[0].motivo, /SENDO CONFERIDO/);
});
