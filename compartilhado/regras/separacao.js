// WMS Beach Bike — regras da SEPARAÇÃO: doca de expedição, lote (vários pedidos numa viagem)
// e pedido grande dividido entre separadores. Funções puras: não leem nem gravam nada.
// Usadas pelo coletor (app.js), pela Conferência (junção das partes) e pelo painel do coordenador (gestao.js).
import { compararEnderecos, MSG_ENDERECO_INATIVO, MSG_ENDERECO_NAO_ENCONTRADO } from "./enderecos.js";

// =====================================================================
// DOCA DE EXPEDIÇÃO (onde o separador deixa a mercadoria para o conferente)
// =====================================================================
export const MSG_NAO_E_DOCA_EXPEDICAO = "ENDEREÇO NÃO É UMA DOCA DE EXPEDIÇÃO. LEIA O QR DA DOCA.";
export function validarDocaExpedicao(endereco) {
  if (!endereco) return MSG_ENDERECO_NAO_ENCONTRADO;
  if (!endereco.ativo) return MSG_ENDERECO_INATIVO;
  if (endereco.tipo !== "expedicao") return MSG_NAO_E_DOCA_EXPEDICAO;
  return null;
}

// ordem de atendimento entre pedidos: prioridade primeiro, depois quem chegou antes.
// (coletor guarda a hora "07:42"; o painel guarda a chegada em milissegundos — os dois comparam igual)
const chegadaDe = (p) => p.chegada ?? p.hora ?? "";
export const compararAtendimento = (a, b) =>
  (a.prio === "alta" ? 0 : 1) - (b.prio === "alta" ? 0 : 1) || (chegadaDe(a) < chegadaDe(b) ? -1 : chegadaDe(a) > chegadaDe(b) ? 1 : 0);

// =====================================================================
// LOTE: 2 a 6 pedidos numa viagem só, uma caixa por pedido no carrinho (A, B, C…)
// =====================================================================
export const MIN_PEDIDOS_LOTE = 2;
export const MAX_PEDIDOS_LOTE = 6;
export const POSICOES = ["A", "B", "C", "D", "E", "F"];

// pode juntar estes pedidos num lote? (só pedidos que ainda não começaram, fora de outro lote e que não são parte de um pedido dividido)
export function validarLote(pedidos) {
  if (pedidos.length < MIN_PEDIDOS_LOTE) return `Escolha pelo menos ${MIN_PEDIDOS_LOTE} pedidos para o lote.`;
  if (pedidos.length > MAX_PEDIDOS_LOTE) return `O lote aceita no máximo ${MAX_PEDIDOS_LOTE} pedidos (uma caixa por pedido no carrinho).`;
  const ruim = pedidos.find((p) => p.lote || p.parte || p.dividido || (p.status && p.status !== "pendente"));
  if (ruim) return `${ruim.id} não pode entrar no lote (já começou, já está em outro lote ou é pedido dividido).`;
  return null;
}

// posições do carrinho: o pedido de maior prioridade fica na A
export function posicoesDoLote(pedidos) {
  const ordem = [...pedidos].sort(compararAtendimento);
  return Object.fromEntries(ordem.map((p, k) => [p.id, POSICOES[k]]));
}

// paradas da viagem: os itens de todos os pedidos, na ordem do endereço.
// O mesmo produto no mesmo endereço vira UMA parada, com a quantidade de cada pedido (na ordem das posições).
export function montarParadas(pedidos, posicoes) {
  const mapa = new Map();
  const ordem = [...pedidos].sort((a, b) => posicoes[a.id].localeCompare(posicoes[b.id]));
  for (const p of ordem) {
    p.itens.forEach((i, idx) => {
      const chave = `${i.end}|${i.sku}`;
      if (!mapa.has(chave)) mapa.set(chave, { end: i.end, sku: i.sku, ean: i.ean, desc: i.desc, tipo: i.tipo, linhas: [] });
      mapa.get(chave).linhas.push({ pedido: p.id, pos: posicoes[p.id], idx, qtd: i.qtd, sep: i.sep, status: i.status });
    });
  }
  return [...mapa.values()]
    .map((x) => ({ ...x, total: x.linhas.reduce((t, l) => t + l.qtd, 0), lido: x.linhas.reduce((t, l) => t + l.sep, 0) }))
    .sort((a, b) => compararEnderecos(a.end, b.end) || a.sku.localeCompare(b.sku));
}
export const paradaConcluida = (parada) => parada.linhas.every((l) => l.status !== "pendente");
// para onde vai a próxima peça bipada: a primeira caixa (posição) que ainda não completou
export const destinoDaLeitura = (parada) => parada.linhas.find((l) => l.sep < l.qtd) || null;

// FALTA no lote: o que foi achado vai primeiro para a posição A (prioridade), depois B…
// Devolve a quantidade de cada linha: [{ pedido, idx, sep, falta }]
export function distribuirAchado(linhas, achado) {
  let resta = Math.max(0, Math.floor(achado));
  return linhas.map((l) => {
    const sep = Math.min(l.qtd, resta);
    resta -= sep;
    return { pedido: l.pedido, idx: l.idx, sep, falta: sep < l.qtd };
  });
}

// =====================================================================
// PEDIDO GRANDE DIVIDIDO (só o coordenador): 2 a 4 partes, cada uma para um separador
// =====================================================================
export const MIN_PARTES = 2;
export const MAX_PARTES = 4;

export function validarDivisao(pedido, partes) {
  if (!(partes >= MIN_PARTES && partes <= MAX_PARTES)) return `Divida em ${MIN_PARTES} a ${MAX_PARTES} partes.`;
  if (pedido.lote) return "PEDIDO ESTÁ EM UM LOTE. DESFAÇA O LOTE ANTES DE DIVIDIR.";
  if (pedido.parte || pedido.dividido) return "PEDIDO JÁ ESTÁ DIVIDIDO.";
  if (pedido.iniciado) return "SEPARAÇÃO JÁ COMEÇOU. SÓ É POSSÍVEL DIVIDIR ANTES DE INICIAR.";
  if (pedido.itens.length < partes) return `O pedido tem ${pedido.itens.length} item(ns): não dá para dividir em ${partes} partes.`;
  return null;
}

// sugestão: blocos de endereços seguidos (cada separador fica numa região do armazém),
// equilibrando as unidades. Devolve, para cada parte, os índices dos itens (na ordem do endereço).
export function sugerirDivisao(itens, partes) {
  const ordem = itens.map((i, idx) => ({ i, idx })).sort((a, b) => compararEnderecos(a.i.end, b.i.end));
  const total = ordem.reduce((t, x) => t + x.i.qtd, 0);
  const grupos = [];
  let atual = [], soma = 0;
  ordem.forEach((x, k) => {
    atual.push(x.idx); soma += x.i.qtd;
    const faltamPartes = partes - grupos.length - 1;   // partes que ainda vêm depois desta
    const faltamItens = ordem.length - k - 1;          // itens que ainda vêm depois deste
    const alvo = (total * (grupos.length + 1)) / partes;
    // fecha a parte quando chega na sua fatia, mas sempre deixando pelo menos 1 item para cada parte seguinte
    if (faltamPartes > 0 && (soma >= alvo || faltamItens === faltamPartes)) { grupos.push(atual); atual = []; }
  });
  grupos.push(atual);
  return grupos;
}
// cada parte precisa de pelo menos 1 item e todo item numa parte só
export function validarPartes(itens, grupos) {
  if (grupos.some((g) => !g.length)) return "Toda parte precisa de pelo menos 1 item.";
  const todos = grupos.flat();
  if (todos.length !== itens.length || new Set(todos).size !== itens.length) return "Cada item precisa estar em exatamente uma parte.";
  return null;
}

// rótulo das ruas de uma parte (ex.: "Rua 3001–3002")
export function ruasDaParte(itens, idxs) {
  // números de verdade: a rua 0 existe e a 802 vem antes da 1000 (ordenar como texto daria o contrário)
  const ruas = [...new Set(idxs.map((k) => String(itens[k].end).match(/^R(\d+)/)?.[1]).filter((r) => r != null).map(Number))].sort((a, b) => a - b);
  return ruas.length ? `Rua ${ruas[0]}${ruas.length > 1 ? "–" + ruas[ruas.length - 1] : ""}` : "";
}

// junta as partes separadas num pedido só para a Conferência (só quando TODAS terminaram).
// partes: os pedidos-parte ({ parte: { pai, n, de }, itens, operador, doca, fim })
export function partesCompletas(partes) {
  if (!partes.length) return false;
  const de = partes[0].parte.de;
  return partes.length === de && partes.every((p) => p.status === "concluido");
}
export function juntarPartes(partes) {
  const ordem = [...partes].sort((a, b) => a.parte.n - b.parte.n);
  const itens = ordem.flatMap((p) => p.itens.map((i) => ({ ...i })))
    .sort((a, b) => compararEnderecos(a.end, b.end));
  const base = ordem[0];
  return {
    ...base, id: base.parte.pai, parte: null, itens,
    operador: [...new Set(ordem.map((p) => p.operador).filter(Boolean))].join(" + "),
    doca: base.doca,
    partes: ordem.map((p) => ({ n: p.parte.n, de: p.parte.de, operador: p.operador, doca: p.doca, fim: p.fim })),
    fim: Math.max(...ordem.map((p) => p.fim || 0)),
    inicio: Math.min(...ordem.map((p) => p.inicio || Infinity)),
  };
}
