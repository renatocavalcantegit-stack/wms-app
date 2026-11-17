// Aplica no banco uma ação que chegou do aparelho (Fase 1a: as da Separação).
// Quem decide O QUE muda é a regra pura compartilhado/regras/acoes-separacao.js.
// Aqui só se lê o pedido, chama a regra e grava o resultado.
import { avaliarAcaoDaSeparacao } from "../../../compartilhado/regras/acoes-separacao.js";

// quais perfis podem mandar cada grupo de ações
const PERFIS_DA_SEPARACAO = ["sep"];

// nome do campo na regra → coluna no banco
const COLUNAS_DO_PEDIDO = { status: "status", separador: "separador", inicio: "inicio", fim: "fim", doca: "doca", lote: "lote", posicaoLote: "posicao_lote" };
const COLUNAS_DO_ITEM = { qtdSeparada: "qtd_separada", status: "status", motivo: "motivo" };

// monta "coluna1 = $2, coluna2 = $3" a partir das mudanças (os valores vão separados, nunca dentro do SQL)
function montarSet(mudancas, colunas, primeiroParametro) {
  const campos = Object.keys(mudancas);
  return {
    set: campos.map((c, n) => `${colunas[c]} = $${primeiroParametro + n}`).join(", "),
    valores: campos.map((c) => mudancas[c]),
  };
}

// conexao: a da transação do lote · usuario: { login, perfil } · acao: { tipo, dados, feitaEm }
// Devolve { resultado, motivo }.
export async function aplicarAcao(conexao, usuario, acao) {
  if (!acao.tipo.startsWith("separacao.")) return { resultado: "desconhecida", motivo: `TIPO DE AÇÃO DESCONHECIDO: ${acao.tipo}` };
  if (!PERFIS_DA_SEPARACAO.includes(usuario.perfil)) return { resultado: "recusada", motivo: "PERFIL SEM PERMISSÃO PARA SEPARAR." };

  const pedidoId = String(acao.dados.pedido ?? "");
  // FOR UPDATE: trava a linha do pedido até o fim da transação.
  // Se dois coletores sincronizarem o mesmo pedido ao mesmo tempo, o segundo espera o primeiro terminar.
  const pedido = (await conexao.query("SELECT id, status, separador FROM pedidos WHERE id = $1 FOR UPDATE", [pedidoId])).rows[0] || null;
  const itens = pedido
    ? (await conexao.query("SELECT sequencia, qtd, status FROM itens_pedido WHERE pedido_id = $1 ORDER BY sequencia", [pedidoId])).rows
    : [];

  const r = avaliarAcaoDaSeparacao({ ...acao, login: usuario.login }, pedido, itens);
  if (!r) return { resultado: "desconhecida", motivo: `TIPO DE AÇÃO DESCONHECIDO: ${acao.tipo}` };
  if (r.resultado !== "aplicada") return { resultado: r.resultado, motivo: r.motivo };

  if (Object.keys(r.pedido).length) {
    const { set, valores } = montarSet(r.pedido, COLUNAS_DO_PEDIDO, 2);
    await conexao.query(`UPDATE pedidos SET ${set} WHERE id = $1`, [pedidoId, ...valores]);
  }
  for (const { sequencia, ...mudancas } of r.itens) {
    const { set, valores } = montarSet(mudancas, COLUNAS_DO_ITEM, 3);
    await conexao.query(`UPDATE itens_pedido SET ${set} WHERE pedido_id = $1 AND sequencia = $2`, [pedidoId, sequencia, ...valores]);
  }
  return { resultado: "aplicada", motivo: null };
}
