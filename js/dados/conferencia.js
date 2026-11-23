// WMS Beach Bike — camada de dados da Conferência.
// Só este arquivo sabe ONDE os pedidos da conferência ficam guardados.
// Hoje: no localStorage do aparelho, e os pedidos separados só chegam se a Separação rodou no mesmo navegador.
// Na Fase 1: banco local (IndexedDB) + fila de sincronização; os pedidos separados chegam pelo servidor.
import { seedConferencia, seedConferenciaMont } from "../demo-dados.js";
import { lerPedidosSalvos as lerPedidosDaSeparacao } from "./separacao.js";
import { algumaParteConcluida, juntarPartes } from "../../compartilhado/regras/separacao.js";

// v4: doca de expedição e pedidos divididos (a versão nova da chave descarta os pedidos antigos)
// cada setor tem a sua fila: Expedição (pedidos de venda) ou Montagem (pedidos OP)
// com servidor (Fase 2), a cópia da lista do servidor fica numa chave à parte: não mistura com a demonstração
const chave = (setor, servidor = false) => (setor === "mont" ? "wms-bb-conf-mont-v7" : "wms-bb-conf-v7") + (servidor ? "-srv" : "");
// posto de conferência escolhido neste aparelho
const CHAVE_POSTO = "wms-bb-posto";

// prepara um pedido separado para ser conferido (zera as contagens da conferência)
// (conferir de novo mantém o que já foi devolvido: essa mercadoria já saiu da caixa e entrou na doca de devolução)
export function prepararParaConferencia(o) {
  const antes = o.conf || {};
  o.conf = { status: "aguardando", itens: {}, fora: [], log: [], inicio: null, fim: null, volumes: 0, conferente: null,
    devolvido: antes.devolvido || {}, postado: antes.postado || {}, reaberto: antes.reaberto || null };
  o.itens.forEach((i) => (o.conf.itens[i.sku] = 0));
  return o;
}

// fila da conferência ({ orders: [...] }); no primeiro acesso, começa com os pedidos de demonstração.
// Sempre traz junto os pedidos que a Separação concluiu.
// Com servidor: só a cópia guardada da última lista (vazia no primeiro acesso); a lista vem do servidor.
export function carregarConferencia(setor, { servidor = false } = {}) {
  let d;
  try { d = JSON.parse(localStorage.getItem(chave(setor, servidor))); } catch {}
  if (servidor) return d && Array.isArray(d.orders) ? d : { orders: [] };
  if (!d || !Array.isArray(d.orders)) {
    d = { orders: (setor === "mont" ? seedConferenciaMont() : seedConferencia()).map(prepararParaConferencia) };
  }
  importarConcluidosDaSeparacao(d, setor);
  return d;
}

// avisa a tela quando OUTRA aba/janela mudou a fila (ex.: o gestor cortou um item ou reabriu um pedido)
export function aoMudarConferencia(setor, fn, { servidor = false } = {}) {
  window.addEventListener("storage", (e) => { if (e.key === chave(setor, servidor)) fn(); });
}

export function salvarConferencia(setor, db, { servidor = false } = {}) {
  localStorage.setItem(chave(setor, servidor), JSON.stringify(db));
}

// pedidos da conferência já gravados (sem demonstração); o Embarque usa para montar a carga avulsa
export function lerPedidosDaConferencia(setor) {
  try { return (JSON.parse(localStorage.getItem(chave(setor))) || {}).orders || []; } catch { return []; }
}

// status do pedido na conferência (null = ainda não está gravado lá, ou seja, ninguém abriu)
export function statusNaConferencia(setor, id) {
  return lerPedidosDaConferencia(setor).find((o) => o.id === id)?.conf?.status || null;
}

// "separar novamente": o pedido sai da fila da conferência enquanto ninguém começou a conferir.
// Ele volta sozinho quando a nova separação terminar (importarConcluidosDaSeparacao).
export function retirarDaConferencia(setor, id) {
  let d;
  try { d = JSON.parse(localStorage.getItem(chave(setor))); } catch {}
  if (!d || !Array.isArray(d.orders)) return;
  const o = d.orders.find((x) => x.id === id);
  if (!o || o.conf?.status !== "aguardando") return;
  d.orders = d.orders.filter((x) => x !== o);
  salvarConferencia(setor, d);
}

// traz pedidos concluídos na Separação (mesmo navegador).
// Pedido dividido (v72): chega com a PRIMEIRA parte que terminar, já juntado num pedido só; as partes que
// ainda estão em separação vêm com "pronta: false" e os itens delas em espera.
// Pedido que já está na fila só é substituído se foi separado de novo (horário de fim diferente).
// Se a conferência dele já começou e chegou outra parte, só entram os itens novos: o que já foi contado fica.
function importarConcluidosDaSeparacao(d, setor) {
  const separados = lerPedidosDaSeparacao(setor);
  const partesPorPai = {};
  separados.filter((o) => o.parte).forEach((o) => (partesPorPai[o.parte.pai] ||= []).push(o));
  const prontos = [
    ...separados.filter((o) => !o.parte && o.status === "concluido"),
    ...Object.values(partesPorPai).filter(algumaParteConcluida).map(juntarPartes),
  ];
  prontos.forEach((o) => {
    const ex = d.orders.find((x) => x.id === o.id);
    const chave = (x) => `${x.fim}|${(x.partes || []).map((p) => p.pronta !== false).join()}`;
    if (ex && chave(ex) === chave(o)) return;
    const copy = JSON.parse(JSON.stringify(o));
    // item cortado depois de separado: na conferência, "sep" é o que fica na caixa e "devolver" o que sai dela
    copy.itens.forEach((i) => { if (i.devolver > 0) i.sep -= i.devolver; });
    if (ex && o.partes?.length && ex.conf?.status === "andamento") {
      // chegou mais uma parte de um pedido em conferência: atualiza os itens e as partes, mantém as contagens
      Object.assign(ex, { itens: copy.itens, partes: copy.partes, operador: copy.operador, fim: copy.fim });
      copy.itens.forEach((i) => { if (!(i.sku in ex.conf.itens)) ex.conf.itens[i.sku] = 0; });
      return;
    }
    prepararParaConferencia(copy);
    if (ex) d.orders[d.orders.indexOf(ex)] = copy; else d.orders.unshift(copy);
  });
}

export const lerPosto = () => localStorage.getItem(CHAVE_POSTO) || "01";
export const salvarPosto = (posto) => localStorage.setItem(CHAVE_POSTO, posto);

// ---------- lista do servidor (Fase 2) ----------
const ms = (iso) => (iso ? Date.parse(iso) : null);
const horaCurta = (iso) => (iso ? new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "");
const num = (x) => Number(x ?? 0);

// conferência como o servidor manda → pedido como o posto usa (o mesmo formato da demonstração).
// O mesmo produto em duas partes vira uma linha só (a conferência conta por produto).
export function conferenciaDoServidor(c) {
  // item de parte ainda em separação (v72): o separado não vale ainda; "espera" diz de que parte ele é
  const porProduto = new Map();
  for (const i of c.itens) {
    // corte do gestor (v75): "sep" é o que fica na caixa; "devolver", o que ainda tem que sair dela
    const devolver = i.em_separacao ? 0 : num(i.qtd_devolver);
    const sep = i.em_separacao ? 0 : num(i.qtd_separada) - devolver;
    const falta = !i.em_separacao && i.status === "falta";
    const x = porProduto.get(i.produto);
    if (x) {
      x.qtd += num(i.qtd); x.sep += sep; x.devolver += devolver;
      if (falta) { x.status = "falta"; x.motivo ||= i.motivo; }
      if (i.em_separacao && !x.espera.includes(i.parte)) x.espera.push(i.parte);
      continue;
    }
    porProduto.set(i.produto, {
      sku: i.produto, ean: i.codigos_de_barras?.[0] || "", eans: i.codigos_de_barras || [], desc: i.descricao, un: i.un,
      end: i.endereco_codigo, qtd: num(i.qtd), sep, status: falta ? "falta" : "ok", motivo: falta ? i.motivo || "" : "",
      espera: i.em_separacao ? [i.parte] : [], devolver,
    });
  }
  const itens = [...porProduto.values()];
  const contado = Object.fromEntries(itens.map((i) => [i.sku, 0]));
  const fora = [];
  for (const x of c.contagens || []) {
    if (x.fora) { if (num(x.qtd) > 0) fora.push({ sku: x.produto, ean: "", desc: x.descricao || x.produto, q: num(x.qtd) }); }
    else contado[x.produto] = num(x.qtd);
  }
  const doca = (codigo) => (codigo ? { codigo } : null);
  return {
    id: c.pedido, cliente: c.cliente, cidade: c.cidade, prio: c.prioridade, hora: horaCurta(c.chegada), aguardando: !!c.aguardando,
    rota: c.rota || null, status: "concluido", operador: c.separador_nome || null, fim: ms(c.separado_em),
    doca: doca(c.doca),
    partes: (c.partes || []).map((p) => ({ n: p.numero, de: p.de, operador: p.separador_nome, doca: doca(p.doca), fim: ms(p.fim), pronta: p.pronta !== false })),
    ordem: c.ordem_fila ?? null,
    itens,
    conf: {
      status: c.status, itens: contado, fora, log: [], inicio: ms(c.inicio), fim: ms(c.fim), volumes: c.volumes || 0,
      conferente: c.conferente_nome || null, conferenteLogin: c.conferente || null, posto: c.posto || null,
      obs: c.observacao || undefined, devolvido: {}, postado: {}, reaberto: c.reaberto || null,
      // cancelado (v75): o que o conferente tem que entregar ao estoque { numero, itens: [{ sku, desc, qtd }] }
      entregar: c.entregar || null,
    },
  };
}

// Baixa a lista do posto. Devolve { ok: true, pedidos } (no formato do posto) ou { ok: false, erro }.
export async function baixarConferencia(sessao, setor, buscar = fetch) {
  let r;
  try {
    r = await buscar(`api/conferencia?setor=${encodeURIComponent(setor)}`, { headers: { authorization: `Bearer ${sessao.token}` }, cache: "no-store" });
  } catch { return { ok: false, erro: "sem-rede" }; }
  if (r.status === 401) return { ok: false, erro: "sessao-vencida" };
  if (!r.ok) return { ok: false, erro: "servidor" };
  const { pedidos } = await r.json();
  return { ok: true, pedidos: pedidos.map(conferenciaDoServidor) };
}
