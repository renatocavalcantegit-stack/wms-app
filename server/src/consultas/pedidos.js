// SQL dos pedidos da separação.

// Lista dos pedidos de um setor (exp ou mont), com o total de itens e de unidades.
// `status` é opcional: sem ele, vêm todos.
export async function listarPedidos(pool, { setor, status = null }) {
  const { rows } = await pool.query(
    `SELECT p.id, p.cliente, p.cidade, p.prioridade, p.chegada, p.status, p.separador, p.inicio, p.fim,
            p.doca, p.lote, p.posicao_lote, p.pedido_pai, p.parte_numero, p.partes_total,
            count(i.*)::int        AS itens,
            coalesce(sum(i.qtd), 0) AS unidades -- numeric: pode ser quebrado (101,5)
       FROM pedidos p
       LEFT JOIN itens_pedido i ON i.pedido_id = p.id
      WHERE p.setor = $1
        AND ($2::text IS NULL OR p.status = $2)
      GROUP BY p.id
      ORDER BY (p.prioridade = 'alta') DESC, p.chegada`,
    [setor, status],
  );
  return rows;
}

// Colunas de cada item: a descrição e os códigos de barras do produto vão junto
// (o coletor confere o bipe no próprio aparelho, mesmo sem rede).
const COLUNAS_DO_ITEM = `
  i.pedido_id, i.sequencia, i.produto, pr.descricao, pr.un, pr.checkout, i.endereco_codigo,
  i.qtd, i.qtd_separada, i.status, i.motivo,
  coalesce(
    (SELECT array_agg(e.codigo ORDER BY e.qtd, e.id) FROM embalagens e
      WHERE e.produto = i.produto AND e.codigo IS NOT NULL),
    '{}') AS codigos_de_barras`;

// Um pedido com os itens na ordem de separação.
export async function buscarPedido(pool, id) {
  const pedido = (await pool.query("SELECT * FROM pedidos WHERE id = $1", [id])).rows[0];
  if (!pedido) return null;

  const itens = await pool.query(
    `SELECT ${COLUNAS_DO_ITEM}
       FROM itens_pedido i
       JOIN produtos pr ON pr.codigo = i.produto
      WHERE i.pedido_id = $1
      ORDER BY i.sequencia`,
    [id],
  );
  return { ...pedido, itens: itens.rows };
}

// O passo do item da vez (v63): grava em que item e em que passo o separador está, para a Gestão.
// Só vale no pedido que está em separação com quem mandou (o resto é ignorado, sem erro).
export async function registrarPasso(pool, login, { passo, itens }) {
  await pool.query(
    `UPDATE pedidos p SET item_da_vez = x.sequencia, passo_da_vez = $3
       FROM json_to_recordset($1::json) AS x(pedido text, sequencia integer)
      WHERE p.id = x.pedido AND p.separador = $2 AND p.status = 'andamento'`,
    [JSON.stringify(itens), login, passo],
  );
}

// Tudo o que o coletor precisa para montar a lista do separador, numa chamada só (Fase 1d):
// cada pedido com os itens. O coletor guarda uma cópia e continua com ela quando fica sem rede.
// Desde a Fase 1e, cada separador vê só a FILA DELE (o que o coordenador mandou para ele, na ordem da fila),
// o que ele está separando e o que ele concluiu hoje. O que está na caixa de entrada ou com outra pessoa não aparece.
//   separador_nome  nome de quem está com o pedido
//   doca_id         ID do endereço da doca (o coletor conta quantos pedidos esperam em cada doca)
export async function pedidosDoColetor(pool, setor, login) {
  const pedidos = (await pool.query(
    `SELECT p.*, u.nome AS separador_nome,
            (SELECT min(e.id) FROM enderecos e WHERE e.codigo = p.doca) AS doca_id
       FROM pedidos p
       LEFT JOIN usuarios u ON u.login = p.separador
      WHERE p.setor = $1
        AND ((p.designado_para = $2 AND p.status <> 'concluido')
          OR (p.separador = $2 AND (p.status <> 'concluido' OR p.fim >= current_date)))
      ORDER BY p.ordem_fila NULLS LAST, p.chegada, p.id`,
    [setor, login],
  )).rows;
  if (!pedidos.length) return [];

  const itens = (await pool.query(
    `SELECT ${COLUNAS_DO_ITEM}
       FROM itens_pedido i
       JOIN produtos pr ON pr.codigo = i.produto
      WHERE i.pedido_id = ANY($1)
      ORDER BY i.pedido_id, i.sequencia`,
    [pedidos.map((p) => p.id)],
  )).rows;
  const porPedido = Map.groupBy(itens, (i) => i.pedido_id);
  return pedidos.map((p) => ({ ...p, itens: porPedido.get(p.id) || [] }));
}
