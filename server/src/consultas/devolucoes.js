// SQL das DEVOLUÇÕES (v75): o que saiu da caixa de um pedido (corte ou cancelamento) e foi entregue ao estoque.
// Cada uma é uma ENTRADA PENDENTE: o estoquista confere e armazena como uma nota (etapa do Estoque no servidor).
// Quem cria: a ocorrência do gestor (consultas/ocorrencias.js) e as ações do separador e do conferente
// (consultas/aplicar-acoes.js e aplicar-conferencia.js), sempre dentro da transação de quem chamou.
//
// Pedido cancelado (migração 009): ninguém bipa. A devolução nasce "a_entregar", com o responsável (quem está
// com a caixa); quando ele marca "Entregue ao estoque" (ações separacao.entregar / conferencia.entregar) ela
// vira "pendente" e só então aparece para o estoque. Fica registrado quem entregou (entregue_por) e quando.

// conexao: a da transação · itens = [{ produto, qtd }] (o mesmo produto pode vir mais de uma vez: soma)
// Devolve o número da entrada ("PV-10421", a segunda do mesmo pedido "PV-10421-2") ou null se não havia nada.
// aEntregar = true: espera o responsável marcar a entrega (entreguePor fica vazio até lá)
export async function criarDevolucao(conexao, { pedido, setor, origem, entreguePor = null, itens, aEntregar = false, responsavel = null }) {
  const soma = new Map();
  for (const { produto, qtd } of itens) if (Number(qtd) > 0) soma.set(produto, Math.round(((soma.get(produto) || 0) + Number(qtd)) * 1000) / 1000);
  if (!soma.size) return null;
  // trava as devoluções do pedido para duas ao mesmo tempo não pegarem o mesmo número
  await conexao.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`devolucao:${pedido}`]);
  const ja = (await conexao.query("SELECT count(*)::int AS n FROM devolucoes WHERE pedido = $1", [pedido])).rows[0].n;
  const numero = ja ? `${pedido}-${ja + 1}` : pedido;
  const { id } = (await conexao.query(
    `INSERT INTO devolucoes (numero, pedido, setor, origem, entregue_por, responsavel, status, entregue_em)
     VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $8::boolean THEN NULL ELSE now() END) RETURNING id`,
    [numero, pedido, setor, origem, aEntregar ? null : entreguePor, responsavel, aEntregar ? "a_entregar" : "pendente", aEntregar],
  )).rows[0];
  for (const [produto, qtd] of soma) {
    await conexao.query("INSERT INTO devolucao_itens (devolucao_id, produto, qtd) VALUES ($1, $2, $3)", [id, produto, qtd]);
  }
  return numero;
}

// O separador (coletor) ou o conferente (F9) entregou o que o gestor cortou: a devolução fica anotada na ocorrência
// do corte, para o histórico trocar "Conferente confirma" pelo número da DEV. Vai para os cortes do pedido que ainda
// esperavam essa pessoa; se nenhum esperava (entregou em duas vezes), para o corte mais recente.
export async function anotarNaOcorrencia(conexao, { pedido, origem, numero }) {
  if (!numero) return;
  await conexao.query(
    `UPDATE ocorrencias o SET entradas = array_append(o.entradas, $3::text)
      WHERE o.pedido = $1 AND o.tipo = 'corte' AND $2 = ANY(o.avisar) AND NOT ($3 = ANY(o.entradas))
        AND (NOT EXISTS (SELECT 1 FROM devolucoes d WHERE d.numero = ANY(o.entradas) AND d.origem = $2)
             OR o.id = (SELECT max(x.id) FROM ocorrencias x WHERE x.pedido = $1 AND x.tipo = 'corte' AND $2 = ANY(x.avisar)))`,
    [pedido, origem, numero],
  );
}

// Pedido cancelado que o separador pegou mais sem rede: soma na devolução que ainda espera a entrega dele.
// Devolve o número, ou null se não havia nenhuma esperando (quem chamou cria uma).
export async function somarNaEntrega(conexao, { pedido, origem, responsavel, itens }) {
  const d = (await conexao.query(
    `SELECT id, numero FROM devolucoes WHERE pedido = $1 AND origem = $2 AND status = 'a_entregar' AND responsavel = $3
      ORDER BY id LIMIT 1 FOR UPDATE`,
    [pedido, origem, responsavel],
  )).rows[0];
  if (!d) return null;
  for (const { produto, qtd } of itens) {
    if (!(Number(qtd) > 0)) continue;
    await conexao.query(
      `INSERT INTO devolucao_itens (devolucao_id, produto, qtd) VALUES ($1, $2, $3)
       ON CONFLICT (devolucao_id, produto) DO UPDATE SET qtd = devolucao_itens.qtd + excluded.qtd`,
      [d.id, produto, qtd],
    );
  }
  return d.numero;
}

// O responsável marcou "Entregue ao estoque": a devolução vira entrada pendente para o estoque.
// origem = separador ou conferente. soDele = só a que está no nome dele (separador: cada um entrega a sua).
// Devolve os números entregues ([] se já estava entregue: não duplica).
export async function marcarEntregue(conexao, { pedido, origem, login, soDele = false }) {
  const { rows } = await conexao.query(
    `UPDATE devolucoes SET status = 'pendente', entregue_por = $3, entregue_em = now()
      WHERE pedido = $1 AND origem = $2 AND status = 'a_entregar' AND (NOT $4::boolean OR responsavel = $3) RETURNING numero`,
    [pedido, origem, login, soDele],
  );
  return rows.map((r) => r.numero);
}

// Quando o gestor arrasta o pedido cancelado para um conferente (ou de volta para a caixa), ele passa a ser o responsável.
export async function trocarResponsavel(conexao, { pedido, origem, responsavel }) {
  await conexao.query(
    "UPDATE devolucoes SET responsavel = $3 WHERE pedido = $1 AND origem = $2 AND status = 'a_entregar'",
    [pedido, origem, responsavel],
  );
}
// O que ainda espera a entrega, por pedido, como o aparelho mostra: Map(pedido → { numero, itens: [{ sku, desc, qtd }] })
// responsavel: só a que está no nome dele (o separador vê só a sua)
export async function aEntregarDosPedidos(conexao, pedidos, origem, responsavel = null) {
  if (!pedidos.length) return new Map();
  const { rows } = await conexao.query(
    `SELECT d.pedido, d.numero,
            json_agg(json_build_object('sku', i.produto, 'desc', p.descricao, 'qtd', i.qtd::float8) ORDER BY i.produto) AS itens
       FROM devolucoes d JOIN devolucao_itens i ON i.devolucao_id = d.id JOIN produtos p ON p.codigo = i.produto
      WHERE d.pedido = ANY($1) AND d.origem = $2 AND d.status = 'a_entregar' AND ($3::text IS NULL OR d.responsavel = $3)
      GROUP BY d.id ORDER BY d.id`,
    [pedidos, origem, responsavel],
  );
  return new Map(rows.map((r) => [r.pedido, { numero: r.numero, itens: r.itens }]));
}

// as devoluções de um pedido, com os itens (para os testes e, depois, para o Estoque)
export async function devolucoesDoPedido(pool, pedido) {
  const { rows } = await pool.query(
    `SELECT d.numero, d.origem, d.entregue_por, d.responsavel, d.status,
            json_agg(json_build_object('produto', i.produto, 'qtd', i.qtd) ORDER BY i.produto) AS itens
       FROM devolucoes d JOIN devolucao_itens i ON i.devolucao_id = d.id
      WHERE d.pedido = $1 GROUP BY d.id ORDER BY d.id`,
    [pedido],
  );
  return rows;
}
