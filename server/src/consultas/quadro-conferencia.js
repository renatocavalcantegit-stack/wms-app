// SQL do quadro da Conferência na Gestão (Fase 2, v67): caixa de entrada, fila de cada conferente e,
// na Montagem, os entregues à montagem hoje. Quem decide as travas é a regra pura
// compartilhado/regras/fila-do-conferente.js; aqui só se lê, chama a regra e grava.
// O que muda roda numa transação com as linhas travadas (FOR UPDATE), como no quadro da Separação.
import { emTransacao } from "../banco.js";
import { travaParaMoverConferencia, travaParaPular, novaOrdem, andamentoDaConferencia } from "../../../compartilhado/regras/fila-do-conferente.js";
import { montarConferencias, COLUNAS_DA_CONFERENCIA, CONFERENCIA_A_ENTREGAR } from "./conferencia.js";
import { ErroDoQuadro } from "./quadro.js";
import { trocarResponsavel } from "./devolucoes.js";

// Tudo o que o quadro mostra, numa chamada só. Devolve { agora, pedidos, conferentes }.
//   pedidos: o que ainda não foi conferido (caixa de entrada e filas), com o andamento de quem está conferindo,
//            e o cancelado que ainda espera o conferente entregar ao estoque (v75: sem ninguém, o gestor arrasta);
//            na Montagem, também o que foi entregue à montagem hoje (conferido ou com a conferência dispensada)
//   conferentes: todos os ativos, com o último contato do posto e quantos conferiram hoje
export async function quadroDaConferencia(pool, setor) {
  const agora = (await pool.query("SELECT now() AS agora")).rows[0].agora;
  const linhas = (await pool.query(
    `SELECT ${COLUNAS_DA_CONFERENCIA}, d.nome AS designado_por_nome, c.designado_em
       FROM conferencias c
       LEFT JOIN usuarios u ON u.login = c.conferente
       LEFT JOIN usuarios d ON d.login = c.designado_por
      WHERE c.setor = $1
        AND (c.status IN ('aguardando', 'andamento') OR (${CONFERENCIA_A_ENTREGAR})
          OR ($1 = 'mont' AND c.status IN ('conferido', 'divergente', 'dispensada') AND c.fim >= current_date))
      ORDER BY c.designado_para NULLS FIRST, c.ordem_fila NULLS LAST, c.chegou_em, c.pedido`,
    [setor],
  )).rows;
  const pedidos = (await montarConferencias(pool, linhas)).map((c) => ({ ...c, andamento: andamentoDaConferencia(c.itens.filter((i) => !i.em_separacao), c.contagens) }));

  const conferentes = (await pool.query(
    `SELECT u.login, u.nome,
            (SELECT max(s.ultimo_contato) FROM sessoes s
              WHERE s.login = u.login AND s.encerrada_em IS NULL AND s.expira_em > now()) AS ultimo_contato,
            EXISTS (SELECT 1 FROM sessoes s
              WHERE s.login = u.login AND s.encerrada_em IS NULL AND s.expira_em > now()) AS conectado,
            (SELECT count(*)::int FROM conferencias x
              WHERE x.conferente = u.login AND x.setor = $1 AND x.status IN ('conferido', 'divergente') AND x.fim >= current_date) AS conferidos_hoje
       FROM usuarios u
      WHERE u.perfil = 'conf' AND u.ativo
      ORDER BY u.nome`,
    [setor],
  )).rows;

  return { agora, pedidos, conferentes };
}

const travar = async (c, setor, pedido) =>
  (await c.query("SELECT pedido, status FROM conferencias WHERE setor = $1 AND pedido = $2 FOR UPDATE", [setor, pedido])).rows[0];

// Muda o pedido de fila. para = login do conferente, null = volta para a caixa de entrada.
// ordem = como a coluna de destino ficou na tela depois de soltar.
export async function moverNaConferencia(pool, { setor, pedido, para, ordem = [], por }) {
  return emTransacao(pool, async (c) => {
    const conf = await travar(c, setor, pedido);
    if (!conf) throw new ErroDoQuadro("Pedido não encontrado na conferência.", 404);
    const trava = travaParaMoverConferencia(conf, para);
    if (trava) throw new ErroDoQuadro(trava);

    if (!para) {
      await c.query(
        "UPDATE conferencias SET designado_para = NULL, ordem_fila = NULL, designado_em = now(), designado_por = $2 WHERE pedido = $1",
        [pedido, por],
      );
      await trocarResponsavel(c, { pedido, origem: "conferente", responsavel: null }); // cancelado: volta a ficar sem ninguém
      return { ok: true };
    }
    const conferente = (await c.query("SELECT 1 FROM usuarios WHERE login = $1 AND perfil = 'conf' AND ativo", [para])).rowCount;
    if (!conferente) throw new ErroDoQuadro("Conferente não encontrado.", 404);

    // a fila de destino como está agora (só o que ainda não começou: o que está em conferência fica no alto)
    const fila = (await c.query(
      `SELECT pedido FROM conferencias
        WHERE setor = $1 AND designado_para = $2 AND status = 'aguardando' AND pedido <> $3
        ORDER BY ordem_fila NULLS LAST, chegou_em, pedido
        FOR UPDATE`,
      [setor, para, pedido],
    )).rows.map((x) => x.pedido);
    const ordemNova = novaOrdem(fila, pedido, ordem);
    await c.query(
      "UPDATE conferencias SET designado_para = $2, designado_em = now(), designado_por = $3 WHERE pedido = $1",
      [pedido, para, por],
    );
    // pedido cancelado: quem recebe passa a ser o responsável pela entrega ao estoque (fica no histórico)
    await trocarResponsavel(c, { pedido, origem: "conferente", responsavel: para });
    for (const [n, id] of ordemNova.entries()) {
      await c.query("UPDATE conferencias SET ordem_fila = $2 WHERE pedido = $1 AND status = 'aguardando'", [id, n + 1]);
    }
    return { ok: true };
  });
}

// "Pular conferência" (Montagem): os pedidos vão direto para a montagem. Devolve { feitos, erros }:
// o que não pôde (já em conferência...) fica de fora com o motivo, e o resto segue.
export async function pularConferencia(pool, { setor, pedidos, por }) {
  return emTransacao(pool, async (c) => {
    const feitos = [], erros = [];
    for (const pedido of pedidos) {
      const conf = await travar(c, setor, pedido);
      const trava = travaParaPular(conf ? conf : null, setor);
      if (trava) { erros.push(trava); continue; }
      await c.query(
        `UPDATE conferencias SET status = 'dispensada', fim = now(), designado_para = NULL, ordem_fila = NULL,
                designado_em = now(), designado_por = $2 WHERE pedido = $1`,
        [pedido, por],
      );
      feitos.push(pedido);
    }
    if (!feitos.length) throw new ErroDoQuadro(erros[0] || "Nenhum pedido.");
    return { feitos, erros };
  });
}
