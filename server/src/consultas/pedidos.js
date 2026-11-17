// SQL dos pedidos da separação.

// Lista dos pedidos de um setor (exp ou mont), com o total de itens e de unidades.
// `status` é opcional: sem ele, vêm todos.
export async function listarPedidos(pool, { setor, status = null }) {
  const { rows } = await pool.query(
    `SELECT p.id, p.cliente, p.cidade, p.prioridade, p.chegada, p.status, p.separador, p.inicio, p.fim,
            p.doca, p.lote, p.posicao_lote, p.pedido_pai, p.parte_numero, p.partes_total,
            count(i.*)::int        AS itens,
            coalesce(sum(i.qtd), 0)::int AS unidades
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

// Um pedido com os itens na ordem de separação. Cada item traz a descrição
// e os códigos de barras do produto (para conferir o bipe no aparelho, mesmo sem rede).
export async function buscarPedido(pool, id) {
  const pedido = (await pool.query("SELECT * FROM pedidos WHERE id = $1", [id])).rows[0];
  if (!pedido) return null;

  const itens = await pool.query(
    `SELECT i.sequencia, i.produto, pr.descricao, pr.un, pr.checkout, i.endereco_codigo,
            i.qtd, i.qtd_separada, i.status, i.motivo,
            coalesce(
              (SELECT array_agg(e.codigo ORDER BY e.qtd, e.id) FROM embalagens e
                WHERE e.produto = i.produto AND e.codigo IS NOT NULL),
              '{}') AS codigos_de_barras
       FROM itens_pedido i
       JOIN produtos pr ON pr.codigo = i.produto
      WHERE i.pedido_id = $1
      ORDER BY i.sequencia`,
    [id],
  );
  return { ...pedido, itens: itens.rows };
}
