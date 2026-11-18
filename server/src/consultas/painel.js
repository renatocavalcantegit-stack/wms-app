// SQL do painel "Ao vivo" da Gestão (Fase 1c): andamento dos pedidos, contato dos separadores
// e as ações que o servidor recebeu mas não aplicou.

// Tudo o que a aba precisa numa consulta só da tela. setor = exp ou mont.
// Devolve { agora, pedidos, separadores, naoAplicadas }.
//   agora: a hora do servidor. A tela calcula "há X min" com ela, e não com o relógio do computador da Gestão.
export async function painelDaSeparacao(pool, setor) {
  const agora = (await pool.query("SELECT now() AS agora")).rows[0].agora;

  // pedidos do setor: os abertos e os concluídos hoje. Em andamento primeiro, depois pendentes
  // (prioridade alta antes), e os concluídos do mais recente para o mais antigo.
  const pedidos = (await pool.query(
    `SELECT p.id, p.cliente, p.cidade, p.prioridade, p.status, p.separador, p.inicio, p.fim, p.doca,
            p.lote, p.posicao_lote,
            count(i.*)::int                                        AS itens,
            count(i.*) FILTER (WHERE i.status <> 'pendente')::int  AS itens_feitos,
            count(i.*) FILTER (WHERE i.status = 'falta')::int      AS itens_com_falta
       FROM pedidos p
       LEFT JOIN itens_pedido i ON i.pedido_id = p.id
      WHERE p.setor = $1
        AND (p.status <> 'concluido' OR p.fim >= current_date)
      GROUP BY p.id
      ORDER BY CASE p.status WHEN 'andamento' THEN 0 WHEN 'pendente' THEN 1 ELSE 2 END,
               p.fim DESC NULLS LAST, (p.prioridade = 'alta') DESC, p.chegada`,
    [setor],
  )).rows;

  // separadores ativos: último contato (o mais recente entre as sessões dele) e a última ação feita no coletor
  const separadores = (await pool.query(
    `SELECT u.login, u.nome,
            (SELECT max(s.ultimo_contato) FROM sessoes s WHERE s.login = u.login) AS ultimo_contato,
            (SELECT max(a.feita_em) FROM acoes_recebidas a WHERE a.login = u.login) AS ultima_acao
       FROM usuarios u
      WHERE u.perfil = 'sep' AND u.ativo
      ORDER BY u.nome`,
  )).rows;

  // conflitos e recusas que o coordenador ainda não marcou como vistos (as mais novas primeiro)
  const naoAplicadas = (await pool.query(
    `SELECT a.id, a.login, u.nome, a.tipo, a.dados->>'pedido' AS pedido, a.resultado, a.motivo,
            a.feita_em, a.recebida_em
       FROM acoes_recebidas a
       JOIN usuarios u ON u.login = a.login
      WHERE a.resultado IN ('conflito', 'recusada') AND a.vista_em IS NULL
      ORDER BY a.recebida_em DESC
      LIMIT 100`,
  )).rows;

  return { agora, pedidos, separadores, naoAplicadas };
}

// O coordenador viu a ação não aplicada (e resolveu com o separador): sai da lista.
// Devolve false se o ID não existe, já foi visto ou não é uma ação não aplicada.
export async function marcarComoVista(pool, id, login) {
  const { rowCount } = await pool.query(
    `UPDATE acoes_recebidas
        SET vista_em = now(), vista_por = $2
      WHERE id = $1 AND vista_em IS NULL AND resultado IN ('conflito', 'recusada')`,
    [id, login],
  );
  return rowCount > 0;
}
