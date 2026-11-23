// Ações da Separação que chegam do coletor: o que cada uma muda no pedido, e quando vira conflito ou é recusada.
// Regra pura (sem banco): o servidor usa para aplicar, e o coletor vai usar para prever o resultado sem rede.
import { test } from "node:test";
import assert from "node:assert/strict";
import { avaliarAcaoDaSeparacao, TIPOS_DA_SEPARACAO } from "../compartilhado/regras/acoes-separacao.js";

const QUANDO = "2026-11-17T10:00:00.000Z";
const pedido = (extra = {}) => ({ id: "PV-1", status: "pendente", separador: null, ...extra });
const itens = (...lista) => lista.map(([qtd, status = "pendente"], n) => ({ sequencia: n + 1, qtd, status }));
const acao = (tipo, dados, login = "ana") => ({ tipo, dados: { pedido: "PV-1", ...dados }, login, feitaEm: QUANDO });
const avaliar = (a, p = pedido(), i = itens([10], [5])) => avaliarAcaoDaSeparacao(a, p, i);

test("os quatro tipos de ação da Separação", () => {
  assert.deepEqual(TIPOS_DA_SEPARACAO, ["separacao.iniciar", "separacao.item", "separacao.concluir", "separacao.reabrir", "separacao.ocorrencia"]);
});

test("pedido que não existe: recusada", () => {
  const r = avaliarAcaoDaSeparacao(acao("separacao.iniciar"), null, []);
  assert.equal(r.resultado, "recusada");
  assert.match(r.motivo, /NÃO ENCONTRADO/);
});

// ---------- iniciar ----------

test("iniciar: o pedido fica com quem começou, na hora em que começou (mesmo sem rede)", () => {
  assert.deepEqual(avaliar(acao("separacao.iniciar")),
    { resultado: "aplicada", pedido: { status: "andamento", separador: "ana", inicio: QUANDO }, itens: [] });
});

test("iniciar em lote: guarda o lote e a caixa do pedido", () => {
  const r = avaliar(acao("separacao.iniciar", { lote: "L-1", posicao: "A" }));
  assert.deepEqual(r.pedido, { status: "andamento", separador: "ana", inicio: QUANDO, lote: "L-1", posicaoLote: "A" });
});

test("iniciar de novo pelo mesmo separador (voltou ao pedido): nada muda", () => {
  assert.deepEqual(avaliar(acao("separacao.iniciar"), pedido({ status: "andamento", separador: "ana" })),
    { resultado: "aplicada", pedido: {}, itens: [] });
});

test("iniciar pedido que já está com outro separador: conflito para o coordenador", () => {
  const r = avaliar(acao("separacao.iniciar", {}, "bruno"), pedido({ status: "andamento", separador: "ana" }));
  assert.equal(r.resultado, "conflito");
  assert.match(r.motivo, /ana/);
});

test("iniciar pedido já concluído: recusada (o caminho é separar novamente)", () => {
  assert.equal(avaliar(acao("separacao.iniciar"), pedido({ status: "concluido", separador: "ana" })).resultado, "recusada");
});

// ---------- item ----------

const comAna = pedido({ status: "andamento", separador: "ana" });

test("item completo: grava a quantidade separada", () => {
  assert.deepEqual(avaliar(acao("separacao.item", { sequencia: 1, qtdSeparada: 10, status: "ok" }), comAna),
    { resultado: "aplicada", pedido: {}, itens: [{ sequencia: 1, qtdSeparada: 10, status: "ok", motivo: "" }] });
});

test("item com falta: guarda o que achou (pode ser quebrado) e o motivo", () => {
  const r = avaliar(acao("separacao.item", { sequencia: 2, qtdSeparada: "1,5", status: "falta", motivo: "Endereço vazio" }), comAna);
  assert.deepEqual(r.itens, [{ sequencia: 2, qtdSeparada: 1.5, status: "falta", motivo: "Endereço vazio" }]);
});

test("item: a mesma ação reenviada dá o mesmo resultado (grava o valor, não soma)", () => {
  const a = acao("separacao.item", { sequencia: 1, qtdSeparada: 10, status: "ok" });
  const depois = itens([10, "ok"], [5]);
  depois[0].qtd_separada = 10;
  assert.deepEqual(avaliar(a, comAna, depois).itens, [{ sequencia: 1, qtdSeparada: 10, status: "ok", motivo: "" }]);
});

test("item de pedido que está com outro separador ou não foi iniciado: conflito", () => {
  const a = acao("separacao.item", { sequencia: 1, qtdSeparada: 10, status: "ok" }, "bruno");
  assert.equal(avaliar(a, comAna).resultado, "conflito");
  assert.equal(avaliar(acao("separacao.item", { sequencia: 1, qtdSeparada: 10, status: "ok" })).resultado, "conflito");
});

test("item inválido é recusado: sequência, status, quantidade e motivo", () => {
  const recusa = (dados) => avaliar(acao("separacao.item", dados), comAna);
  assert.match(recusa({ sequencia: 9, qtdSeparada: 1, status: "ok" }).motivo, /ITEM/);
  assert.equal(recusa({ sequencia: 1, qtdSeparada: 1, status: "talvez" }).resultado, "recusada");
  assert.equal(recusa({ sequencia: 1, qtdSeparada: 11, status: "ok" }).resultado, "recusada"); // acima do pedido
  assert.equal(recusa({ sequencia: 1, qtdSeparada: 9, status: "ok" }).resultado, "recusada"); // ok tem que ser completo
  assert.equal(recusa({ sequencia: 1, qtdSeparada: 10, status: "falta", motivo: "x" }).resultado, "recusada"); // falta tem que ser menor
  assert.equal(recusa({ sequencia: 1, qtdSeparada: 1.2345, status: "falta", motivo: "x" }).resultado, "recusada"); // mais de 3 casas
  assert.equal(recusa({ sequencia: 1, qtdSeparada: 2, status: "falta" }).resultado, "recusada"); // falta sem motivo
});

test("item cortado pelo gestor não recebe separação", () => {
  assert.equal(avaliar(acao("separacao.item", { sequencia: 1, qtdSeparada: 0, status: "falta", motivo: "x" }), comAna,
    itens([10, "cortado"], [5])).resultado, "recusada");
});

// ---------- concluir ----------

test("concluir: todos os itens resolvidos, grava a doca e a hora do fim", () => {
  const r = avaliar(acao("separacao.concluir", { doca: "R9002-P1-A100-AP101" }), comAna, itens([10, "ok"], [5, "falta"], [3, "cortado"]));
  assert.deepEqual(r, { resultado: "aplicada", pedido: { status: "concluido", fim: QUANDO, doca: "R9002-P1-A100-AP101" }, itens: [] });
});

test("concluir com item pendente, sem doca ou por outro separador: não conclui", () => {
  const doca = { doca: "R9002-P1-A100-AP101" };
  assert.match(avaliar(acao("separacao.concluir", doca), comAna, itens([10, "ok"], [5])).motivo, /PENDENTE/);
  assert.equal(avaliar(acao("separacao.concluir", {}), comAna, itens([10, "ok"])).resultado, "recusada");
  assert.equal(avaliar(acao("separacao.concluir", doca, "bruno"), comAna, itens([10, "ok"])).resultado, "conflito");
});

test("concluir de novo (reenvio): nada muda", () => {
  const r = avaliar(acao("separacao.concluir", { doca: "D1" }), pedido({ status: "concluido", separador: "ana" }), itens([10, "ok"]));
  assert.deepEqual(r, { resultado: "aplicada", pedido: {}, itens: [] });
});

// ---------- reabrir (separar novamente) ----------

test("separar novamente: o pedido concluído volta para quem reabriu, com os itens zerados (o cortado continua cortado)", () => {
  const r = avaliar(acao("separacao.reabrir", {}, "bruno"), pedido({ status: "concluido", separador: "ana" }),
    itens([10, "ok"], [5, "falta"], [3, "cortado"]));
  assert.deepEqual(r, {
    resultado: "aplicada",
    pedido: { status: "andamento", separador: "bruno", inicio: QUANDO, fim: null, doca: null },
    itens: [{ sequencia: 1, qtdSeparada: 0, status: "pendente", motivo: "" }, { sequencia: 2, qtdSeparada: 0, status: "pendente", motivo: "" }],
  });
});

test("separar novamente só vale para pedido concluído", () => {
  assert.equal(avaliar(acao("separacao.reabrir"), comAna).resultado, "recusada");
});

// ---------- tipo desconhecido ----------

test("tipo que esta regra não conhece: devolve null (quem chamou decide)", () => {
  assert.equal(avaliar(acao("separacao.leitura")), null);
});

// ---------- pedido do gestor (v75) ----------
const emSeparacao = pedido({ status: "andamento", separador: "ana" });
const cortado = (extra) => ({ sequencia: 1, qtd: 3, qtdPedida: 5, qtdSeparada: 0, devolver: 0, status: "pendente", motivo: "", ...extra });

test("físico vence: o gestor cortou de 5 para 3 e o separador (sem rede) separou 5 — aceita e 2 viram a devolver", () => {
  const r = avaliar(acao("separacao.item", { sequencia: 1, qtdSeparada: 5, status: "ok" }), emSeparacao, [cortado()]);
  assert.deepEqual(r, { resultado: "aplicada", pedido: { ocorrenciaPendente: true },
    itens: [{ sequencia: 1, qtdSeparada: 5, devolver: 2, status: "ok", motivo: "" }] });
  // separou exatamente a quantidade nova: nada a devolver
  assert.deepEqual(avaliar(acao("separacao.item", { sequencia: 1, qtdSeparada: 3, status: "ok" }), emSeparacao, [cortado()]).itens[0].devolver, 0);
  // item zerado pelo gestor e separado mesmo assim: tudo volta
  const zerado = cortado({ qtd: 0, status: "cortado" });
  assert.deepEqual(avaliar(acao("separacao.item", { sequencia: 1, qtdSeparada: 5, status: "ok" }), emSeparacao, [zerado]).itens[0],
    { sequencia: 1, qtdSeparada: 5, devolver: 5, status: "ok", motivo: "" });
  // acima da quantidade original continua recusado
  assert.match(avaliar(acao("separacao.item", { sequencia: 1, qtdSeparada: 6, status: "ok" }), emSeparacao, [cortado()]).motivo, /ACIMA DO PEDIDO \(5\)/);
});

test("confirmar o pedido do gestor: o que tinha que sair da caixa vira entrada pendente", () => {
  const itensDoPedido = [cortado({ qtdSeparada: 5, devolver: 2, status: "ok" }), { sequencia: 2, qtd: 4, qtdPedida: 4, qtdSeparada: 4, devolver: 0, status: "ok" },
    cortado({ sequencia: 3, qtd: 0, qtdSeparada: 6, devolver: 6, status: "ok", qtdPedida: 6 })];
  assert.deepEqual(avaliar(acao("separacao.ocorrencia", {}), emSeparacao, itensDoPedido), {
    resultado: "aplicada", pedido: { ocorrenciaPendente: false },
    itens: [{ sequencia: 1, qtdSeparada: 3, devolver: 0, status: "ok", motivo: "" }, { sequencia: 3, qtdSeparada: 0, devolver: 0, status: "cortado", motivo: "" }],
    devolverAgora: [{ sequencia: 1, qtd: 2 }, { sequencia: 3, qtd: 6 }],
  });
  // só corte simples (nada separado): só apaga o aviso
  assert.deepEqual(avaliar(acao("separacao.ocorrencia", {}), emSeparacao, [cortado()]), { resultado: "aplicada", pedido: { ocorrenciaPendente: false }, itens: [] });
  assert.equal(avaliar(acao("separacao.ocorrencia", {}, "bia"), emSeparacao, [cortado()]).resultado, "conflito");
});

test("pedido cancelado pelo gestor: nada mais muda; o que foi pego sem rede volta ao estoque", () => {
  const cancelado = pedido({ status: "cancelado", separador: "ana" });
  const it = [{ sequencia: 1, qtd: 0, qtdPedida: 5, qtdSeparada: 0, devolver: 0, status: "cortado" }];
  assert.deepEqual(avaliar(acao("separacao.item", { sequencia: 1, qtdSeparada: 5, status: "ok" }), cancelado, it),
    { resultado: "aplicada", pedido: {}, itens: [], devolverAgora: [{ sequencia: 1, qtd: 5 }] });
  assert.match(avaliar(acao("separacao.concluir", { doca: "D1" }), cancelado, it).motivo, /O GESTOR CANCELOU O PV-1/);
  assert.match(avaliar(acao("separacao.iniciar"), cancelado, it).motivo, /O GESTOR CANCELOU/);
  assert.equal(avaliar(acao("separacao.ocorrencia", {}), cancelado, it).resultado, "aplicada");
});
