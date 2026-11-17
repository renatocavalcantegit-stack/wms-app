// SQL da sincronização: guarda as ações que chegam dos aparelhos.
import { emTransacao } from "../banco.js";

// Grava as ações do lote. A que já existe (mesmo ID, porque o aparelho reenviou) é ignorada:
// "ON CONFLICT (id) DO NOTHING" não insere e "RETURNING" não devolve nada para ela.
// Devolve os IDs separados em "novas" (gravadas agora) e "repetidas" (já estavam gravadas).
export async function registrarAcoes(pool, login, acoes) {
  return emTransacao(pool, async (conexao) => {
    const novas = [], repetidas = [];
    for (const acao of acoes) {
      const { rowCount } = await conexao.query(
        `INSERT INTO acoes_recebidas (id, login, tipo, dados, feita_em)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO NOTHING`,
        [acao.id, login, acao.tipo, acao.dados, acao.feitaEm],
      );
      (rowCount ? novas : repetidas).push(acao.id);
    }
    return { novas, repetidas };
  });
}
