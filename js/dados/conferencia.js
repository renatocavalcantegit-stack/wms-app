// WMS Beach Bike — camada de dados da Conferência.
// Só este arquivo sabe ONDE os pedidos da conferência ficam guardados.
// Hoje: no localStorage do aparelho, e os pedidos separados só chegam se a Separação rodou no mesmo navegador.
// Na Fase 1: banco local (IndexedDB) + fila de sincronização; os pedidos separados chegam pelo servidor.
import { seedConferencia, seedConferenciaMont } from "../demo-dados.js";
import { lerPedidosSalvos as lerPedidosDaSeparacao } from "./separacao.js";

// cada setor tem a sua fila: Expedição (pedidos de venda) ou Montagem (pedidos OP)
const chave = (setor) => (setor === "mont" ? "wms-bb-conf-mont-v1" : "wms-bb-conf-v1");
// posto de conferência escolhido neste aparelho
const CHAVE_POSTO = "wms-bb-posto";

// prepara um pedido separado para ser conferido (zera as contagens da conferência)
export function prepararParaConferencia(o) {
  o.conf = { status: "aguardando", itens: {}, fora: [], log: [], inicio: null, fim: null, volumes: 0, conferente: null };
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

export function salvarConferencia(setor, db) {
  localStorage.setItem(chave(setor), JSON.stringify(db));
}

// pedidos da conferência já gravados (sem demonstração); o Embarque usa para montar a carga avulsa
export function lerPedidosDaConferencia(setor) {
  try { return (JSON.parse(localStorage.getItem(chave(setor))) || {}).orders || []; } catch { return []; }
}

// traz pedidos concluídos na Separação (mesmo navegador).
// Pedido que já está na fila só é substituído se foi separado de novo (horário de fim diferente).
function importarConcluidosDaSeparacao(d, setor) {
  lerPedidosDaSeparacao(setor).filter((o) => o.status === "concluido").forEach((o) => {
    const ex = d.orders.find((x) => x.id === o.id);
    if (ex && ex.fim === o.fim) return;
    const copy = prepararParaConferencia(JSON.parse(JSON.stringify(o)));
    if (ex) d.orders[d.orders.indexOf(ex)] = copy; else d.orders.unshift(copy);
  });
}

export const lerPosto = () => localStorage.getItem(CHAVE_POSTO) || "01";
export const salvarPosto = (posto) => localStorage.setItem(CHAVE_POSTO, posto);
