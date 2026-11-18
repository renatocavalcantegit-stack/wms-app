// WMS Beach Bike — camada de dados da Separação.
// Só este arquivo sabe ONDE os pedidos e os lotes da separação ficam guardados.
// No localStorage do aparelho. Com servidor (Fase 1b), cada ação do separador também entra na fila de envio
// (js/dados/fila.js), que o js/sincronizacao.js manda para o servidor.
// Com servidor (Fase 1d), a lista vem do servidor (baixarDoServidor) e fica guardada aqui como cópia:
// sem rede, o coletor continua com ela.
import { seedSeparacao, seedSeparacaoMont, seedLotes, tipoDoProduto } from "../demo-dados.js";

// v4: doca de expedição, lotes e pedidos divididos (a versão nova da chave descarta os pedidos antigos)
// cada setor tem a sua fila: Expedição (pedidos de venda) ou Montagem (pedidos OP)
const chave = (setor) => (setor === "mont" ? "wms-bb-sep-mont-v7" : "wms-bb-sep-v7");
const chaveLotes = (setor) => (setor === "mont" ? "wms-bb-lotes-mont-v4" : "wms-bb-lotes-v4");

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

// avisa a tela quando OUTRA aba/janela mudou os pedidos (ex.: o gestor cortou um item ou cancelou um pedido)
export function aoMudarPedidos(setor, fn) {
  window.addEventListener("storage", (e) => { if (e.key === chave(setor)) fn(); });
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

// ---------- lista do servidor (Fase 1d) ----------

// Baixa a lista do setor. Devolve { ok: true, pedidos } (já no formato do coletor)
// ou { ok: false, erro: "sem-rede" | "sessao-vencida" | "servidor" }. buscar = fetch (nos testes, um de mentira)
export async function baixarDoServidor(sessao, setor, buscar = fetch) {
  let r;
  try {
    r = await buscar(`api/separacao?setor=${encodeURIComponent(setor)}`, {
      headers: { authorization: `Bearer ${sessao.token}` }, cache: "no-store",
    });
  } catch { return { ok: false, erro: "sem-rede" }; }
  if (r.status === 401) return { ok: false, erro: "sessao-vencida" };
  if (!r.ok) return { ok: false, erro: "servidor" };
  const { pedidos } = await r.json();
  return { ok: true, pedidos: pedidos.map(pedidoDoServidor) };
}

const ms = (iso) => (iso ? Date.parse(iso) : null);
const horaCurta = (iso) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

// pedido como o servidor manda (colunas do banco) → pedido como o coletor usa (o mesmo formato da demonstração)
export function pedidoDoServidor(p) {
  const fim = ms(p.fim);
  return {
    id: p.id, cliente: p.cliente, cidade: p.cidade, prio: p.prioridade, hora: horaCurta(p.chegada), aguardando: !!p.aguardando,
    status: p.status, inicio: ms(p.inicio), fim,
    operador: p.separador_nome || p.separador || null,
    separadorLogin: p.separador || null, // login de quem está com o pedido (para "Com Fulano")
    ordem: p.ordem_fila ?? null, // posição na fila do separador (Fase 1e: o coordenador decide a ordem no quadro)
    atual: 0,
    doca: p.doca ? { id: p.doca_id, codigo: p.doca, quando: fim, por: p.separador_nome || p.separador } : null,
    lote: p.lote || null, pos: p.posicao_lote || null,
    parte: p.pedido_pai ? { pai: p.pedido_pai, n: p.parte_numero, de: p.partes_total, ruas: p.parte_ruas, por: p.dividido_por } : null,
    itens: p.itens.map((i) => ({
      sku: i.produto, ean: i.codigos_de_barras[0] || "", eans: i.codigos_de_barras, desc: i.descricao, un: i.un,
      checkout: i.checkout, tipo: tipoDoProduto(i.descricao), end: i.endereco_codigo,
      qtd: i.qtd, sep: i.qtd_separada, status: i.status, motivo: i.motivo,
    })),
  };
}
