// Aplica no banco as ações da Conferência que chegam do posto (Fase 2), e o caminho do pedido separado
// até a conferência. Quem decide O QUE muda é a regra pura compartilhado/regras/acoes-conferencia.js;
// aqui só se lê, chama a regra e grava. Roda dentro da transação do lote (consultas/acoes.js).
import { avaliarAcaoDaConferencia } from "../../../compartilhado/regras/acoes-conferencia.js";
import { criarDevolucao } from "./devolucoes.js";

const PERFIS_DA_CONFERENCIA = ["conf"];
// nome do campo na regra → coluna no banco
const COLUNAS = { status: "status", conferente: "conferente", inicio: "inicio", fim: "fim", posto: "posto", volumes: "volumes", observacao: "observacao" };

// partesEmSeparacao (v72): pedido dividido, as partes que ainda não terminaram ("1/2", ...). Com alguma, não finaliza.
// devolver (v75): o que o gestor cortou e ainda tem que sair da caixa, por produto. Com algo, não finaliza.
export const conferenciaDoPedido = async (conexao, pedido, travar = false) =>
  (await conexao.query(
    `SELECT c.pedido, c.setor, c.status, c.conferente, c.designado_para AS "designadoPara",
            coalesce((SELECT array_agg(p.parte_numero || '/' || p.partes_total ORDER BY p.parte_numero)
                        FROM pedidos p WHERE p.pedido_pai = c.pedido AND p.status <> 'concluido'), '{}') AS "partesEmSeparacao",
            coalesce((SELECT json_agg(json_build_object('produto', d.produto, 'qtd', d.qtd))
                        FROM (SELECT i.produto, sum(i.qtd_devolver) AS qtd
                                FROM itens_pedido i JOIN pedidos p ON p.id = i.pedido_id
                               WHERE ((p.id = c.pedido AND p.pedido_pai IS NULL) OR (p.pedido_pai = c.pedido AND p.status = 'concluido'))
                                 AND i.qtd_devolver > 0
                               GROUP BY i.produto) d), '[]') AS devolver
       FROM conferencias c WHERE c.pedido = $1${travar ? " FOR UPDATE OF c" : ""}`,
    [pedido],
  )).rows[0] || null;

// o que foi separado e FICA na caixa, por produto (pedido dividido: somando as partes que já terminaram a separação).
// v75: o que o gestor cortou e ainda tem que sair (qtd_devolver) não conta.
export async function separadoDoPedido(conexao, pedido) {
  return (await conexao.query(
    `SELECT i.produto, sum(i.qtd_separada - i.qtd_devolver) AS qtd
       FROM itens_pedido i JOIN pedidos p ON p.id = i.pedido_id
      WHERE (p.id = $1 AND p.pedido_pai IS NULL) OR (p.pedido_pai = $1 AND p.status = 'concluido')
      GROUP BY i.produto ORDER BY i.produto`,
    [pedido],
  )).rows;
}

// A separação terminou: o pedido entra na caixa de entrada da conferência.
// Parte de pedido dividido (v72): entra o pedido original (uma conferência só) já com a PRIMEIRA parte que terminar,
// qualquer que seja. As outras partes aparecem nessa mesma conferência quando terminarem; ela só finaliza com todas.
// pedido = { id, setor, pedidoPai }
export async function entrarNaConferencia(conexao, pedido) {
  const id = pedido.pedidoPai || pedido.id;
  await conexao.query("INSERT INTO conferencias (pedido, setor) VALUES ($1, $2) ON CONFLICT (pedido) DO NOTHING", [id, pedido.setor]);
}

// "Separar novamente" antes de alguém começar a conferir: sai da conferência (volta quando a separação terminar).
// Pedido dividido: só sai se nenhuma outra parte continua pronta (senão a conferência fica, esperando esta parte).
export async function sairDaConferencia(conexao, pedido) {
  await conexao.query(
    `DELETE FROM conferencias WHERE pedido = $1 AND status = 'aguardando'
        AND NOT EXISTS (SELECT 1 FROM pedidos WHERE pedido_pai = $1 AND status = 'concluido')`,
    [pedido],
  );
}

// conexao: a da transação do lote · usuario: { login, perfil } · acao: { tipo, dados, feitaEm }
export async function aplicarAcaoDaConferencia(conexao, usuario, acao) {
  if (!PERFIS_DA_CONFERENCIA.includes(usuario.perfil)) return { resultado: "recusada", motivo: "PERFIL SEM PERMISSÃO PARA CONFERIR." };
  const id = String(acao.dados.pedido ?? "");
  // FOR UPDATE: dois postos no mesmo pedido ao mesmo tempo, o segundo espera o primeiro e vê o resultado dele
  const conferencia = await conferenciaDoPedido(conexao, id, true);
  const esperado = conferencia ? await separadoDoPedido(conexao, id) : [];
  const contagens = conferencia
    ? (await conexao.query("SELECT produto, qtd_conferida AS qtd, fora FROM conferencia_itens WHERE pedido = $1", [id])).rows
    : [];

  const r = avaliarAcaoDaConferencia({ ...acao, login: usuario.login }, conferencia, esperado, contagens);
  if (!r) return { resultado: "desconhecida", motivo: `TIPO DE AÇÃO DESCONHECIDO: ${acao.tipo}` };
  if (r.resultado !== "aplicada") return { resultado: r.resultado, motivo: r.motivo };

  const campos = Object.keys(r.conferencia);
  if (campos.length) {
    const valores = campos.map((c) => (c === "observacao" && r.conferencia[c] ? JSON.stringify(r.conferencia[c]) : r.conferencia[c]));
    await conexao.query(
      `UPDATE conferencias SET ${campos.map((c, n) => `${COLUNAS[c]} = $${n + 2}`).join(", ")} WHERE pedido = $1`,
      [id, ...valores],
    );
  }
  if (r.zerar) await conexao.query("DELETE FROM conferencia_itens WHERE pedido = $1", [id]);
  // v75: o conferente tirou da caixa o que o gestor cortou. Sai de cada linha que tinha "a devolver" e vira
  // entrada pendente no estoque, entregue por ele.
  if (r.devolver?.length) {
    for (const { produto, qtd } of r.devolver) {
      let resta = qtd;
      const linhas = (await conexao.query(
        `SELECT i.pedido_id, i.sequencia, i.qtd, i.qtd_separada, i.qtd_devolver FROM itens_pedido i JOIN pedidos p ON p.id = i.pedido_id
          WHERE ((p.id = $1 AND p.pedido_pai IS NULL) OR (p.pedido_pai = $1 AND p.status = 'concluido'))
            AND i.produto = $2 AND i.qtd_devolver > 0 ORDER BY i.pedido_id, i.sequencia FOR UPDATE OF i`,
        [id, produto],
      )).rows;
      for (const l of linhas) {
        if (resta <= 0) break;
        const x = Math.min(resta, Number(l.qtd_devolver));
        await conexao.query(
          `UPDATE itens_pedido SET qtd_separada = qtd_separada - $3, qtd_devolver = qtd_devolver - $3,
                  status = CASE WHEN qtd = 0 AND qtd_separada - $3 = 0 THEN 'cortado' ELSE status END
            WHERE pedido_id = $1 AND sequencia = $2`,
          [l.pedido_id, l.sequencia, x],
        );
        resta = Math.round((resta - x) * 1000) / 1000;
      }
    }
    await criarDevolucao(conexao, { pedido: id, setor: conferencia.setor, origem: "conferente", entreguePor: usuario.login, itens: r.devolver });
  }
  for (const x of r.contagens) {
    await conexao.query(
      `INSERT INTO conferencia_itens (pedido, produto, qtd_conferida, fora) VALUES ($1, $2, $3, $4)
       ON CONFLICT (pedido, produto) DO UPDATE SET qtd_conferida = excluded.qtd_conferida, fora = excluded.fora`,
      [id, x.produto, x.qtd, x.fora],
    );
  }
  return { resultado: "aplicada", motivo: null };
}
