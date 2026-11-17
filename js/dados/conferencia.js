// WMS Beach Bike — camada de dados da Conferência.
// Só este arquivo sabe ONDE os pedidos da conferência ficam guardados.
// Hoje: no localStorage do aparelho, e os pedidos separados só chegam se a Separação rodou no mesmo navegador.
// Na Fase 1: banco local (IndexedDB) + fila de sincronização; os pedidos separados chegam pelo servidor.
import { seedConferencia, seedConferenciaMont } from "../demo-dados.js";
import { lerPedidosSalvos as lerPedidosDaSeparacao } from "./separacao.js";
import { partesCompletas, juntarPartes } from "../../compartilhado/regras/separacao.js";

// v4: doca de expedição e pedidos divididos (a versão nova da chave descarta os pedidos antigos)
// cada setor tem a sua fila: Expedição (pedidos de venda) ou Montagem (pedidos OP)
const chave = (setor) => (setor === "mont" ? "wms-bb-conf-mont-v7" : "wms-bb-conf-v7");
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
export function carregarConferencia(setor) {
  let d;
  try { d = JSON.parse(localStorage.getItem(chave(setor))); } catch {}
  if (!d || !Array.isArray(d.orders)) {
    d = { orders: (setor === "mont" ? seedConferenciaMont() : seedConferencia()).map(prepararParaConferencia) };
  }
  importarConcluidosDaSeparacao(d, setor);
  return d;
}

// avisa a tela quando OUTRA aba/janela mudou a fila (ex.: o gestor cortou um item ou reabriu um pedido)
export function aoMudarConferencia(setor, fn) {
  window.addEventListener("storage", (e) => { if (e.key === chave(setor)) fn(); });
}

export function salvarConferencia(setor, db) {
  localStorage.setItem(chave(setor), JSON.stringify(db));
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
// Pedido dividido entre separadores só chega quando TODAS as partes terminaram, já juntado num pedido só.
// Pedido que já está na fila só é substituído se foi separado de novo (horário de fim diferente).
function importarConcluidosDaSeparacao(d, setor) {
  const separados = lerPedidosDaSeparacao(setor);
  const partesPorPai = {};
  separados.filter((o) => o.parte).forEach((o) => (partesPorPai[o.parte.pai] ||= []).push(o));
  const prontos = [
    ...separados.filter((o) => !o.parte && o.status === "concluido"),
    ...Object.values(partesPorPai).filter(partesCompletas).map(juntarPartes),
  ];
  prontos.forEach((o) => {
    const ex = d.orders.find((x) => x.id === o.id);
    if (ex && ex.fim === o.fim) return;
    const copy = JSON.parse(JSON.stringify(o));
    // item cortado depois de separado: na conferência, "sep" é o que fica na caixa e "devolver" o que sai dela
    copy.itens.forEach((i) => { if (i.devolver > 0) i.sep -= i.devolver; });
    prepararParaConferencia(copy);
    if (ex) d.orders[d.orders.indexOf(ex)] = copy; else d.orders.unshift(copy);
  });
}

export const lerPosto = () => localStorage.getItem(CHAVE_POSTO) || "01";
export const salvarPosto = (posto) => localStorage.setItem(CHAVE_POSTO, posto);
