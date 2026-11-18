// Fila do separador (quadro da Gestão), login único dos coletores e a recusa do que foi feito fora da fila.
import { test } from "node:test";
import assert from "node:assert/strict";
import { travaParaMover, novaOrdem, unidadeDoPedido, ehLote } from "../compartilhado/regras/fila-do-separador.js";
import { sessaoQueBloqueia, mensagemDeOutroAparelho, PERFIS_DE_UM_APARELHO } from "../compartilhado/regras/login-unico.js";
import { avaliarAcaoDaSeparacao } from "../compartilhado/regras/acoes-separacao.js";

test("fila: o lote anda inteiro; o pedido sozinho anda sozinho", () => {
  assert.equal(unidadeDoPedido({ id: "PV-1", lote: "L-1" }), "L-1");
  assert.equal(unidadeDoPedido({ id: "PV-1", lote: null }), "PV-1");
  assert.equal(ehLote("L-AB12"), true);
  assert.equal(ehLote("PV-10421"), false);
});

test("fila: em separação não muda; sem rota não vai para separador (aguardando e Montagem vão)", () => {
  assert.match(travaParaMover([{ id: "PV-1", status: "andamento" }], "ana"), /já está em separação/);
  assert.match(travaParaMover([{ id: "PV-1", status: "concluido" }], null), /já foi separado/);
  assert.match(travaParaMover([{ id: "PV-1", status: "pendente", rota: null }], "ana"), /Defina a rota do PV-1/);
  assert.equal(travaParaMover([{ id: "PV-1", status: "pendente", rota: null }], null), null, "sem rota pode voltar para a caixa");
  assert.equal(travaParaMover([{ id: "PV-1", status: "pendente", rota: null, aguardando: true }], "ana"), null);
  assert.equal(travaParaMover([{ id: "OP-1", status: "pendente", rota: null, op: true }], "ana", "mont"), null);
  assert.equal(travaParaMover([], "ana"), "Pedido não encontrado.");
});

test("fila: vale a ordem da tela para o que existe; o que a tela não conhecia vai para o fim, nada se repete", () => {
  assert.deepEqual(novaOrdem(["a", "b", "c"], "x", ["a", "x", "b", "c"]), ["a", "x", "b", "c"]);
  assert.deepEqual(novaOrdem(["a", "b", "c"], "x", ["x", "zz", "a", "x"]), ["x", "a", "b", "c"]);
  assert.deepEqual(novaOrdem(["a"], "x", []), ["a", "x"], "sem ordem: no fim da fila");
  assert.deepEqual(novaOrdem([], "x"), ["x"]);
});

test("login único: só separador, conferente e embarque; o mesmo aparelho pode entrar de novo", () => {
  assert.deepEqual(PERFIS_DE_UM_APARELHO, ["sep", "conf", "emb"]);
  const ativa = [{ aparelho: "A", criada_em: "2026-11-18T10:42:00Z", ultimo_contato: "2026-11-18T11:00:00Z" }];
  assert.equal(sessaoQueBloqueia("sep", ativa, "B"), ativa[0]);
  assert.equal(sessaoQueBloqueia("sep", ativa, "A"), null);
  assert.equal(sessaoQueBloqueia("sep", [], "B"), null);
  assert.equal(sessaoQueBloqueia("coord", ativa, "B"), null, "coordenador pode estar em vários aparelhos");
  assert.equal(sessaoQueBloqueia("emb", [{ aparelho: null, criada_em: "x" }], null), null, "aparelho sem código conta como o mesmo");
});

test("login único: o aviso diz desde quando e o último contato", () => {
  const s = { criada_em: "2026-11-18T10:42:00Z", ultimo_contato: "2026-11-18T11:00:00Z" };
  const m = mensagemDeOutroAparelho(s, Date.parse("2026-11-18T11:03:30Z"));
  assert.match(m, /^Você já está conectado em outro aparelho \(desde \d\d:42, último contato há 3 min\)\. Saia por lá ou peça ao coordenador para desconectar\.$/);
});

test("ações: o coordenador passou o pedido para outra pessoa (ou para a caixa) enquanto o coletor estava sem rede", () => {
  const ini = { tipo: "separacao.iniciar", dados: { pedido: "PV-1" }, login: "ana", feitaEm: "2026-11-18T10:00:00Z" };
  const item = { tipo: "separacao.item", dados: { pedido: "PV-1", sequencia: 1, qtdSeparada: 1, status: "ok" }, login: "ana" };
  const itens = [{ sequencia: 1, qtd: 1, status: "pendente" }];
  const pedido = (designadoPara) => ({ id: "PV-1", status: "pendente", separador: null, designadoPara });
  assert.deepEqual(avaliarAcaoDaSeparacao(ini, pedido("bruno"), itens), { resultado: "recusada", motivo: "O COORDENADOR PASSOU O PV-1 PARA OUTRA PESSOA." });
  assert.deepEqual(avaliarAcaoDaSeparacao(item, pedido("bruno"), itens), { resultado: "recusada", motivo: "O COORDENADOR PASSOU O PV-1 PARA OUTRA PESSOA." });
  assert.deepEqual(avaliarAcaoDaSeparacao(ini, pedido(null), itens), { resultado: "recusada", motivo: "O COORDENADOR TIROU O PV-1 DA SUA FILA." });
  assert.equal(avaliarAcaoDaSeparacao(ini, pedido("ana"), itens).resultado, "aplicada");
  // sem o campo da fila (antes da Fase 1e), nada muda
  assert.equal(avaliarAcaoDaSeparacao(ini, { id: "PV-1", status: "pendente", separador: null }, itens).resultado, "aplicada");
  // já começou com outra pessoa: continua sendo conflito (o coordenador decide)
  assert.equal(avaliarAcaoDaSeparacao(ini, { ...pedido("bruno"), status: "andamento", separador: "bruno" }, itens).resultado, "conflito");
});

test("quadro: o lote vira um card; caixa com sem rota e aguardando no alto; fila com o que está em separação no alto", async () => {
  const { unidadesDoQuadro, colunasDoQuadro, situacaoNoQuadro } = await import("../compartilhado/regras/fila-do-separador.js");
  const ped = (id, o = {}) => ({ id, status: "pendente", rota: "centro", aguardando: false, lote: null, designado_para: null, ordem_fila: null, chegada: "2026-11-18T10:00:00Z", ...o });
  const us = unidadesDoQuadro([
    ped("PV-1", { chegada: "2026-11-18T08:00:00Z" }),
    ped("PV-2", { rota: null }),
    ped("PV-3", { aguardando: true, rota: null }),
    ped("PV-4", { lote: "L-1", posicao_lote: "B", designado_para: "ana", ordem_fila: 1 }),
    ped("PV-5", { lote: "L-1", posicao_lote: "A", designado_para: "ana", ordem_fila: 1 }),
    ped("PV-6", { designado_para: "ana", ordem_fila: 2, status: "andamento" }),
  ]);
  const lote = us.find((u) => u.id === "L-1");
  assert.deepEqual([lote.ehLote, lote.pedidos.map((p) => p.id)], [true, ["PV-5", "PV-4"]]);
  const { caixa, filas } = colunasDoQuadro(us);
  assert.deepEqual(caixa.map((u) => u.id), ["PV-2", "PV-3", "PV-1"]);
  assert.deepEqual(filas.get("ana").map((u) => u.id), ["PV-6", "L-1"]);
  assert.deepEqual(colunasDoQuadro(us, "mont").caixa.map((u) => u.id), ["PV-3", "PV-1", "PV-2"], "na Montagem não há sem rota");

  const agora = Date.parse("2026-11-18T11:00:00Z");
  const sep = (o) => ({ conectado: true, ultimo_contato: "2026-11-18T10:59:30Z", ...o });
  assert.equal(situacaoNoQuadro(sep({ conectado: false }), [], agora), "desconectado");
  assert.equal(situacaoNoQuadro(sep({ ultimo_contato: "2026-11-18T10:58:00Z" }), [], agora), "sem-contato");
  assert.equal(situacaoNoQuadro(sep(), filas.get("ana"), agora), "separando");
  assert.equal(situacaoNoQuadro(sep(), [lote], agora), "aguardando");
  assert.equal(situacaoNoQuadro(sep(), [], agora), "livre");
});
