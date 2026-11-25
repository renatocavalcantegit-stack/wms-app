// v78 · Estoque no servidor, entrega B: a conferência da nota no coletor, pela fila.
// O coletor baixa as notas em aberto; cada confirmação é a ação "recepcao.conferir" e o "Finalizar nota" é
// "recepcao.finalizar". O servidor aplica com as regras da demonstração e o saldo continua igual ao histórico.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prepararBancoDeTeste } from "./banco-de-teste.js";
import { criarServidor } from "../src/servidor.js";
import { emTransacao } from "../src/banco.js";
import { USERS } from "../../js/sessao.js";
import { saldosForaDoHistorico } from "../src/consultas/notas-entrada.js";
import { criarDevolucao } from "../src/consultas/devolucoes.js";
import {
  msgAcimaDaNota, msgVolumeRepetido, MSG_NOTA_FINALIZADA, MSG_PRODUTO_FORA_DA_NOTA, MSG_NAO_E_DOCA, codigoDoVolumeDoAparelho,
} from "../../compartilhado/regras/recebimento.js";

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
const chamar = async (login, url) => app.inject({ method: "GET", url, headers: { authorization: `Bearer ${await entrar(login)}` } });
let relogio = Date.now() - 3_600_000;
const acao = (tipo, dados) => ({ id: randomUUID(), tipo, dados, feitaEm: new Date((relogio += 1000)).toISOString() });
const sincronizar = async (login, acoes) =>
  (await app.inject({ method: "POST", url: "/api/sincronizar", headers: { authorization: `Bearer ${await entrar(login)}` }, payload: { acoes } })).json();

const idDaNota = async (numero) => (await pool.query("SELECT id FROM notas_entrada WHERE numero = $1", [numero])).rows[0].id;
const umEndereco = async (tipo) => (await pool.query("SELECT id FROM enderecos WHERE tipo = $1 AND ativo ORDER BY id LIMIT 1", [tipo])).rows[0].id;
const saldo = async (endereco, produto) =>
  Number((await pool.query("SELECT qtd FROM saldos WHERE endereco_id = $1 AND produto = $2", [endereco, produto])).rows[0]?.qtd ?? 0);
// cada coletor gera os códigos dos seus volumes (código do aparelho + sequência)
let seqA = 0, seqB = 0;
const volumesA = (n) => Array.from({ length: n }, () => codigoDoVolumeDoAparelho("aaaa11", ++seqA));
const volumesB = (n) => Array.from({ length: n }, () => codigoDoVolumeDoAparelho("bbbb22", ++seqB));
const conferir = (nota, produto, qtd, doca, volumes) => acao("recepcao.conferir", { nota, rotulo: "NF", produto, qtd, doca, volumes, dia: "2026-11-25" });

test("o coletor baixa só as notas em aberto, com os produtos, as embalagens e as docas", async () => {
  const r = (await chamar("estoquista", "/api/recepcao/notas")).json();
  const abertas = (await pool.query("SELECT numero FROM notas_entrada WHERE NOT finalizada")).rows.map((x) => x.numero).sort();
  assert.deepEqual(r.notas.map((n) => n.numero).sort(), abertas);
  assert.ok(r.notas.every((n) => !n.finalizada && n.itens.length));
  const nota = r.notas.find((n) => n.numero === "48201");
  assert.deepEqual(nota.itens, [{ produto: "176", qtd: 100 }, { produto: "283", qtd: 15 }, { produto: "536", qtd: 20 }]);
  const produtos = new Set(r.produtos.map((p) => p.codigo));
  assert.ok(r.notas.every((n) => n.itens.every((i) => produtos.has(i.produto))), "todo produto das notas vem junto");
  assert.ok(r.embalagens.every((e) => produtos.has(e.produto)), "só as embalagens desses produtos");
  assert.ok(r.docas.length && r.docas.every((d) => d.tipo === "doca" || d.tipo === "devolucao"));
  assert.equal((await chamar("gestorestoque", "/api/recepcao/notas")).statusCode, 403);
});

test("conferir: soma ao conferido, põe o saldo na doca, grava os volumes e o histórico", async () => {
  const nota = await idDaNota("48201"), doca = await umEndereco("doca");
  const antes = await saldo(doca, "536");
  const a = conferir(nota, "536", 15, doca, volumesA(2));
  const r = await sincronizar("estoquista", [a]);
  assert.deepEqual(r.recusadas, []);
  const rec = (await pool.query("SELECT qtd, usuario, acao_id FROM recebimentos WHERE acao_id = $1", [a.id])).rows[0];
  assert.deepEqual([Number(rec.qtd), rec.usuario], [15, "estoquista"]);
  assert.deepEqual((await pool.query("SELECT codigo, seq, total FROM volumes_recebimento ORDER BY seq")).rows.filter((v) => v.codigo.startsWith("VAAAA11")),
    [{ codigo: "VAAAA11-0001", seq: 1, total: 2 }, { codigo: "VAAAA11-0002", seq: 2, total: 2 }]);
  assert.equal(await saldo(doca, "536"), antes + 15);
  assert.equal((await pool.query("SELECT status_conferencia FROM notas_entrada WHERE id = $1", [nota])).rows[0].status_conferencia, "aberta");
  assert.deepEqual(await saldosForaDoHistorico(pool), []);

  // o aparelho reenviou a mesma ação (a resposta se perdeu): não soma de novo
  const de = await sincronizar("estoquista", [a]);
  assert.deepEqual(de.repetidas, [a.id]);
  assert.equal(await saldo(doca, "536"), antes + 15);

  // o coletor vê a confirmação dele no que baixa (pela ação), e para de somar a cópia local
  const baixado = (await chamar("estoquista", "/api/recepcao/notas")).json();
  assert.ok(baixado.conferencias.some((c) => c.acaoId === a.id && c.qtd === 15));
});

test("dois coletores passaram do pendente: a confirmação que chega por último é recusada inteira", async () => {
  const nota = await idDaNota("48201"), doca = await umEndereco("doca");
  const antes = await saldo(doca, "536");
  // o pendente era 5; o coletor B conferiu 4 sem rede, o A conferiu 3 sem rede. O B chega primeiro.
  const b = conferir(nota, "536", 4, doca, volumesB(1));
  const a = conferir(nota, "536", 3, doca, volumesA(1));
  assert.deepEqual((await sincronizar("estoquista", [b])).recusadas, []);
  const r = await sincronizar("estoquista", [a]);
  assert.deepEqual(r.recusadas, [{ id: a.id, resultado: "recusada", motivo: msgAcimaDaNota(1) }]);
  assert.equal(await saldo(doca, "536"), antes + 4, "nada da confirmação recusada entrou");
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM recebimentos WHERE acao_id = $1", [a.id])).rows[0].n, 0);
  assert.deepEqual(await saldosForaDoHistorico(pool), []);
});

test("recusas: produto fora da nota, endereço que não é doca, código de volume repetido", async () => {
  const nota = await idDaNota("48201"), doca = await umEndereco("doca"), picking = await umEndereco("picking");
  const fora = conferir(nota, "17480", 1, doca, volumesA(1));
  const naoDoca = conferir(nota, "176", 1, picking, volumesA(1));
  const repetido = conferir(nota, "176", 1, doca, ["VAAAA11-0001"]);
  const r = await sincronizar("estoquista", [fora, naoDoca, repetido]);
  assert.deepEqual(r.recusadas.map((x) => x.motivo), [MSG_PRODUTO_FORA_DA_NOTA, MSG_NAO_E_DOCA, msgVolumeRepetido("VAAAA11-0001")]);
  // o perfil errado não confere nota
  const sep = await sincronizar("separador", [conferir(nota, "176", 1, doca, volumesA(1))]);
  assert.equal(sep.recusadas[0].motivo, "PERFIL SEM PERMISSÃO PARA CONFERIR NOTAS.");
});

test("finalizar: a nota sai do coletor, a conferência atrasada é recusada e o gestor vê quem conferiu e as recusas", async () => {
  const nota = await idDaNota("48201"), doca = await umEndereco("doca");
  const fim = acao("recepcao.finalizar", { nota, rotulo: "NF 48201" });
  const fimDeNovo = acao("recepcao.finalizar", { nota, rotulo: "NF 48201" });
  const atrasada = conferir(nota, "176", 1, doca, volumesB(1));
  const r = await sincronizar("estoquista", [fim, fimDeNovo, atrasada]);
  assert.deepEqual(r.recusadas, [{ id: atrasada.id, resultado: "recusada", motivo: MSG_NOTA_FINALIZADA }], "finalizar duas vezes não é erro");
  const n = (await pool.query("SELECT finalizada, finalizada_por, status_divergencia FROM notas_entrada WHERE id = $1", [nota])).rows[0];
  assert.deepEqual(n, { finalizada: true, finalizada_por: "estoquista", status_divergencia: "com" });
  assert.ok(!(await chamar("estoquista", "/api/recepcao/notas")).json().notas.some((x) => x.id === nota));

  const det = (await chamar("gestorestoque", `/api/estoque/notas/${nota}`)).json();
  assert.ok(det.conferencias.filter((c) => c.acaoId).every((c) => c.usuario === "Usuário Estoquista"));
  assert.deepEqual(det.recusas.map((x) => [x.tipo, x.quem, x.motivo]), [
    ["recepcao.conferir", "Usuário Estoquista", msgAcimaDaNota(1)],
    ["recepcao.conferir", "Usuário Estoquista", MSG_PRODUTO_FORA_DA_NOTA],
    ["recepcao.conferir", "Usuário Estoquista", MSG_NAO_E_DOCA],
    ["recepcao.conferir", "Usuário Estoquista", msgVolumeRepetido("VAAAA11-0001")],
    ["recepcao.conferir", "Usuário Separador", "PERFIL SEM PERMISSÃO PARA CONFERIR NOTAS."],
    ["recepcao.conferir", "Usuário Estoquista", MSG_NOTA_FINALIZADA],
  ]);
});

test("nota de devolução: conferida na doca de devolução e finalizada, a devolução passa a recebida", async () => {
  await emTransacao(pool, (c) => criarDevolucao(c, { pedido: "PV-20001", setor: "exp", origem: "gestor", entreguePor: "coordenador", itens: [{ produto: "536", qtd: 2 }] }));
  const nota = await idDaNota("PV-20001"), docaDev = await umEndereco("devolucao");
  const r = await sincronizar("estoquista", [conferir(nota, "536", 2, docaDev, volumesA(1)), acao("recepcao.finalizar", { nota })]);
  assert.deepEqual(r.recusadas, []);
  assert.equal((await pool.query("SELECT status FROM devolucoes WHERE numero = 'PV-20001'")).rows[0].status, "recebida");
  const mov = (await pool.query("SELECT tipo, pedido FROM movimentos WHERE nota_id = $1", [nota])).rows;
  assert.deepEqual(mov, [{ tipo: "recebimento", pedido: "PV-20001" }]);
  assert.deepEqual(await saldosForaDoHistorico(pool), []);
});
