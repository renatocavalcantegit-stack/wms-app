// SQL da Conferência (Fase 2): o que o posto do conferente e o quadro da Gestão leem.
// Uma conferência é de um pedido inteiro. Pedido dividido: o pedido original (PV-10426), com as partes
// (PV-10426/1, /2) juntas: os itens de todas, a doca e o separador de cada parte.
// v72: a conferência começa com a primeira parte pronta. Parte ainda em separação: "pronta: false", e os itens
// dela vêm com "em_separacao: true" (o separado ainda não vale; o posto mostra apagado).
import { COLUNAS_DO_ITEM } from "./pedidos.js";
import { aEntregarDosPedidos } from "./devolucoes.js";
import { cienciasDosPedidos } from "./observacao.js";

// pedido cancelado cuja devolução ainda espera o conferente marcar "Entregue ao estoque" (v75)
export const CONFERENCIA_A_ENTREGAR = `c.status = 'cancelado' AND EXISTS (SELECT 1 FROM devolucoes d
  WHERE d.pedido = c.pedido AND d.origem = 'conferente' AND d.status = 'a_entregar')`;

// as conferências de uma lista, cada uma com o pedido (cabeçalho, partes, itens separados) e o que já foi contado
async function montar(pool, conferencias) {
  if (!conferencias.length) return [];
  const ids = conferencias.map((c) => c.pedido);
  const pedidos = (await pool.query(
    `SELECT p.*, coalesce(u.nome, p.separador) AS separador_nome
       FROM pedidos p LEFT JOIN usuarios u ON u.login = p.separador
      WHERE (p.id = ANY($1) AND p.pedido_pai IS NULL) OR p.pedido_pai = ANY($1)
      ORDER BY p.parte_numero NULLS FIRST, p.id`,
    [ids],
  )).rows;
  const itens = (await pool.query(
    `SELECT ${COLUNAS_DO_ITEM} FROM itens_pedido i JOIN produtos pr ON pr.codigo = i.produto
      WHERE i.pedido_id = ANY($1) ORDER BY i.pedido_id, i.sequencia`,
    [pedidos.map((p) => p.id)],
  )).rows;
  const contagens = (await pool.query(
    `SELECT ci.pedido, ci.produto, ci.qtd_conferida AS qtd, ci.fora, pr.descricao
       FROM conferencia_itens ci LEFT JOIN produtos pr ON pr.codigo = ci.produto
      WHERE ci.pedido = ANY($1) ORDER BY ci.produto`,
    [ids],
  )).rows;
  const entregar = await aEntregarDosPedidos(pool, conferencias.filter((c) => c.status === "cancelado").map((c) => c.pedido), "conferente");
  const ciencias = await cienciasDosPedidos(pool, ids);
  const doPedido = Map.groupBy(pedidos, (p) => p.pedido_pai || p.id);
  const itensDe = Map.groupBy(itens, (i) => i.pedido_id);
  const contagensDe = Map.groupBy(contagens, (x) => x.pedido);

  return conferencias.map((c) => {
    const ps = doPedido.get(c.pedido) || [];
    const base = ps[0] || {};
    const partes = ps.filter((p) => p.pedido_pai);
    const prontas = ps.filter((p) => !p.pedido_pai || p.status === "concluido"); // quem já entregou na doca
    return {
      ...c,
      cliente: base.cliente, cidade: base.cidade, prioridade: base.prioridade, chegada: base.chegada,
      rota: base.rota ?? null, aguardando: !!base.aguardando,
      // v76: a observação do vendedor (cada parte leva o texto do pedido original) e quem já leu
      observacao_pedido: base.observacao_pedido ?? null, observacao_para: base.observacao_para ?? null,
      ciencias: ciencias.get(c.pedido) || [],
      separador_nome: [...new Set(prontas.map((p) => p.separador_nome).filter(Boolean))].join(" + ") || null,
      doca: partes.length ? null : base.doca ?? null,
      separado_em: prontas.length ? new Date(Math.max(...prontas.map((p) => +new Date(p.fim || 0)))) : null,
      partes: partes.map((p) => ({ numero: p.parte_numero, de: p.partes_total, separador_nome: p.separador_nome, doca: p.doca, fim: p.fim,
        pronta: p.status === "concluido" })),
      itens: ps.flatMap((p) => (itensDe.get(p.id) || []).map((i) => (p.pedido_pai && p.status !== "concluido"
        ? { ...i, em_separacao: true, parte: `${p.parte_numero}/${p.partes_total}` } : i))),
      contagens: (contagensDe.get(c.pedido) || []).map(({ pedido, ...x }) => x),
      entregar: entregar.get(c.pedido) || null, // cancelado: o que o conferente leva ao estoque { numero, itens }
    };
  });
}

const COLUNAS = `c.pedido, c.setor, c.status, c.designado_para, c.ordem_fila, c.conferente, coalesce(u.nome, c.conferente) AS conferente_nome,
  c.inicio, c.fim, c.posto, c.volumes, c.observacao, c.chegou_em, c.reaberto, c.cancelado`;

// A lista do posto: só a FILA de quem pediu (o que o coordenador mandou para ele, na ordem do quadro),
// o que ele está conferindo e o que conferiu hoje, e o pedido cancelado que ainda espera ele entregar ao estoque.
export async function conferenciasDoPosto(pool, setor, login) {
  const conferencias = (await pool.query(
    `SELECT ${COLUNAS} FROM conferencias c LEFT JOIN usuarios u ON u.login = c.conferente
      WHERE c.setor = $1
        AND ((c.designado_para = $2 AND c.status IN ('aguardando', 'andamento'))
          OR (c.conferente = $2 AND (c.status = 'andamento' OR c.fim >= current_date))
          OR (coalesce(c.conferente, c.designado_para) = $2 AND ${CONFERENCIA_A_ENTREGAR}))
      ORDER BY c.ordem_fila NULLS LAST, c.chegou_em, c.pedido`,
    [setor, login],
  )).rows;
  return montar(pool, conferencias);
}

export { montar as montarConferencias, COLUNAS as COLUNAS_DA_CONFERENCIA };
