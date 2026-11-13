// WMS Beach Bike — camada de dados da Separação.
// Só este arquivo sabe ONDE os pedidos da separação ficam guardados.
// Hoje: no localStorage do aparelho. Na Fase 1: banco local (IndexedDB) + fila de sincronização com o servidor,
// sem precisar mudar as telas.
import { seedSeparacao, seedSeparacaoMont } from "../demo-dados.js";

// cada setor tem a sua fila: Expedição (pedidos de venda) ou Montagem (pedidos OP)
const chave = (setor) => (setor === "mont" ? "wms-bb-sep-mont-v1" : "wms-bb-sep-v1");

// pedidos de demonstração do setor (usados no primeiro acesso e em "reiniciar demonstração")
export const pedidosDeDemonstracao = (setor) => (setor === "mont" ? seedSeparacaoMont() : seedSeparacao());

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
