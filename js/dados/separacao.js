// WMS Beach Bike — camada de dados da Separação.
// Só este arquivo sabe ONDE os pedidos e os lotes da separação ficam guardados.
// Hoje: no localStorage do aparelho. Na Fase 1: banco local (IndexedDB) + fila de sincronização com o servidor,
// sem precisar mudar as telas.
import { seedSeparacao, seedSeparacaoMont, seedLotes } from "../demo-dados.js";

// v4: doca de expedição, lotes e pedidos divididos (a versão nova da chave descarta os pedidos antigos)
// cada setor tem a sua fila: Expedição (pedidos de venda) ou Montagem (pedidos OP)
const chave = (setor) => (setor === "mont" ? "wms-bb-sep-mont-v6" : "wms-bb-sep-v6");
const chaveLotes = (setor) => (setor === "mont" ? "wms-bb-lotes-mont-v3" : "wms-bb-lotes-v3");

// pedidos de demonstração do setor (usados no primeiro acesso e em "reiniciar demonstração")
export const pedidosDeDemonstracao = (setor) => (setor === "mont" ? seedSeparacaoMont() : seedSeparacao());
export const lotesDeDemonstracao = (setor) => (setor === "mont" ? [] : seedLotes());

// pedidos guardados no aparelho; se ainda não há nenhum, começa com os de demonstração
export function carregarPedidos(setor) {
  const salvos = lerPedidosSalvos(setor);
  return salvos.length ? salvos : pedidosDeDemonstracao(setor);
}

export function salvarPedidos(setor, pedidos) {
  localStorage.setItem(chave(setor), JSON.stringify(pedidos));
}

// só o que já foi gravado (sem demonstração); a Conferência usa para buscar os pedidos concluídos
export function lerPedidosSalvos(setor) {
  try {
    const d = JSON.parse(localStorage.getItem(chave(setor)));
    return Array.isArray(d) ? d : [];
  } catch { return []; }
}

// lotes (vários pedidos numa viagem). Sem nada gravado ainda, vêm os de demonstração junto com os pedidos.
export function carregarLotes(setor) {
  try {
    const d = JSON.parse(localStorage.getItem(chaveLotes(setor)));
    if (Array.isArray(d)) return d;
  } catch {}
  return lerPedidosSalvos(setor).length ? [] : lotesDeDemonstracao(setor);
}
export function salvarLotes(setor, lotes) {
  localStorage.setItem(chaveLotes(setor), JSON.stringify(lotes));
}
