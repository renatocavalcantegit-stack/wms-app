// SQL das DEVOLUÇÕES (v75): o que saiu da caixa de um pedido (corte ou cancelamento) e foi entregue ao estoque.
// Cada uma é uma ENTRADA PENDENTE: o estoquista confere e armazena como uma nota (etapa do Estoque no servidor).
// Quem cria: a ocorrência do gestor (consultas/ocorrencias.js) e as ações do separador e do conferente
// (consultas/aplicar-acoes.js e aplicar-conferencia.js), sempre dentro da transação de quem chamou.

// conexao: a da transação · itens = [{ produto, qtd }] (o mesmo produto pode vir mais de uma vez: soma)
// Devolve o número da entrada ("PV-10421", a segunda do mesmo pedido "PV-10421-2") ou null se não havia nada.
export async function criarDevolucao(conexao, { pedido, setor, origem, entreguePor, itens }) {
  const soma = new Map();
  for (const { produto, qtd } of itens) if (Number(qtd) > 0) soma.set(produto, Math.round(((soma.get(produto) || 0) + Number(qtd)) * 1000) / 1000);
  if (!soma.size) return null;
  // trava as devoluções do pedido para duas ao mesmo tempo não pegarem o mesmo número
  await conexao.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`devolucao:${pedido}`]);
  const ja = (await conexao.query("SELECT count(*)::int AS n FROM devolucoes WHERE pedido = $1", [pedido])).rows[0].n;
  const numero = ja ? `${pedido}-${ja + 1}` : pedido;
  const { id } = (await conexao.query(
    "INSERT INTO devolucoes (numero, pedido, setor, origem, entregue_por) VALUES ($1, $2, $3, $4, $5) RETURNING id",
    [numero, pedido, setor, origem, entreguePor],
  )).rows[0];
  for (const [produto, qtd] of soma) {
    await conexao.query("INSERT INTO devolucao_itens (devolucao_id, produto, qtd) VALUES ($1, $2, $3)", [id, produto, qtd]);
  }
  return numero;
}

// as devoluções de um pedido, com os itens (para os testes e, depois, para o Estoque)
export async function devolucoesDoPedido(pool, pedido) {
  const { rows } = await pool.query(
    `SELECT d.numero, d.origem, d.entregue_por, d.status,
            json_agg(json_build_object('produto', i.produto, 'qtd', i.qtd) ORDER BY i.produto) AS itens
       FROM devolucoes d JOIN devolucao_itens i ON i.devolucao_id = d.id
      WHERE d.pedido = $1 GROUP BY d.id ORDER BY d.id`,
    [pedido],
  );
  return rows;
}
