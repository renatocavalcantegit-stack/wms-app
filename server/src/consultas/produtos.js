// SQL do catálogo: produto, códigos de barras e onde ele está guardado.

// Acha o produto pelo código lido: código de barras de qualquer embalagem ou o código interno.
// `codigo` já chega normalizado (normalizarCodigo, em compartilhado/regras/produtos.js).
export async function buscarProdutoPorCodigo(pool, codigo) {
  const { rows } = await pool.query(
    `SELECT p.codigo, p.descricao, p.un, p.checkout
       FROM produtos p
      WHERE upper(p.codigo) = $1
         OR EXISTS (SELECT 1 FROM embalagens e WHERE e.produto = p.codigo AND e.codigo = $1)
      LIMIT 1`,
    [codigo],
  );
  const produto = rows[0];
  if (!produto) return null;

  const embalagens = await pool.query(
    "SELECT codigo, descricao, qtd FROM embalagens WHERE produto = $1 ORDER BY qtd, id",
    [produto.codigo],
  );
  // endereços com saldo, na ordem da rota (rua, prédio, andar, apartamento)
  const saldos = await pool.query(
    `SELECT e.id AS endereco_id, e.codigo AS endereco, e.tipo, s.qtd
       FROM saldos s
       JOIN enderecos e ON e.id = s.endereco_id
      WHERE s.produto = $1
      ORDER BY e.rua, e.predio, e.andar, e.apto`,
    [produto.codigo],
  );
  return { ...produto, embalagens: embalagens.rows, saldos: saldos.rows };
}
