// SQL da sincronização: guarda as ações que chegam dos aparelhos e aplica cada uma (Fase 1a).
import { emTransacao } from "../banco.js";
import { aplicarAcao } from "./aplicar-acoes.js";

// Grava e aplica as ações do lote, tudo numa transação só.
//
// - Ordem: aplica na ordem em que as ações foram FEITAS no aparelho (feitaEm), não na ordem em que chegaram.
// - Repetida (mesmo ID, o aparelho reenviou): "ON CONFLICT (id) DO NOTHING" não grava de novo,
//   nada é aplicado outra vez, e o resultado guardado da primeira vez volta na resposta.
// - Cada ação tem um SAVEPOINT: se der erro inesperado ao aplicar uma, só ela é desfeita
//   (fica como "recusada") e as outras do lote continuam.
//
// usuario = { login, perfil } · Devolve { novas, repetidas, recusadas: [{ id, resultado, motivo }] }.
export async function registrarAcoes(pool, usuario, acoes) {
  return emTransacao(pool, async (conexao) => {
    const resultados = new Map(); // id → { nova, resultado, motivo }
    const naOrdemFeita = [...acoes].sort((a, b) => Date.parse(a.feitaEm) - Date.parse(b.feitaEm));

    for (const acao of naOrdemFeita) {
      const { rowCount } = await conexao.query(
        `INSERT INTO acoes_recebidas (id, login, tipo, dados, feita_em)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO NOTHING`,
        [acao.id, usuario.login, acao.tipo, acao.dados, acao.feitaEm],
      );
      if (!rowCount) {
        const { rows } = await conexao.query("SELECT resultado, motivo FROM acoes_recebidas WHERE id = $1", [acao.id]);
        resultados.set(acao.id, { nova: false, ...rows[0] });
        continue;
      }

      let r;
      await conexao.query("SAVEPOINT acao");
      try {
        r = await aplicarAcao(conexao, usuario, acao);
        await conexao.query("RELEASE SAVEPOINT acao");
      } catch (erro) {
        await conexao.query("ROLLBACK TO SAVEPOINT acao");
        r = { resultado: "recusada", motivo: `ERRO AO APLICAR: ${erro.message}` };
      }
      await conexao.query(
        `UPDATE acoes_recebidas
            SET resultado = $2, motivo = $3, aplicada_em = CASE WHEN $2 = 'aplicada' THEN now() END
          WHERE id = $1`,
        [acao.id, r.resultado, r.motivo],
      );
      resultados.set(acao.id, { nova: true, ...r });
    }

    // as listas saem na ordem em que o aparelho mandou
    const novas = acoes.filter((a) => resultados.get(a.id).nova).map((a) => a.id);
    const repetidas = acoes.filter((a) => !resultados.get(a.id).nova).map((a) => a.id);
    const recusadas = acoes
      .filter((a) => resultados.get(a.id).resultado && resultados.get(a.id).resultado !== "aplicada")
      .map((a) => ({ id: a.id, resultado: resultados.get(a.id).resultado, motivo: resultados.get(a.id).motivo }));
    return { novas, repetidas, recusadas };
  });
}
