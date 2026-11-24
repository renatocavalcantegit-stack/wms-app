// SQL da OBSERVAÇÃO DO PEDIDO (v76): quem leu e o que respondeu (migração 010).
// Quem decide se a resposta vale é a regra pura compartilhado/regras/observacao.js; aqui só se lê e grava.
import { validarCiencia } from "../../../compartilhado/regras/observacao.js";

// A ação "observacao.ciente" { pedido, momento, resposta } (o pedido pode ser uma parte: PV-10426/1).
// O papel vem do perfil de quem mandou (separador, conferente, embarque). Respondeu de novo: vale a última.
// Devolve { resultado, motivo }.
export async function aplicarCiencia(conexao, usuario, acao) {
  const id = String(acao.dados?.pedido ?? "");
  const pedido = (await conexao.query(
    "SELECT id, pedido_pai, observacao_pedido FROM pedidos WHERE id = $1", [id],
  )).rows[0];
  if (!pedido) return { resultado: "recusada", motivo: `PEDIDO ${id} NÃO ENCONTRADO.` };
  const r = validarCiencia(acao.dados, usuario.perfil, pedido.observacao_pedido);
  if (r.erro) return { resultado: "recusada", motivo: r.erro };
  await conexao.query(
    `INSERT INTO observacao_ciencias (pedido, parte, login, papel, momento, resposta, feita_em)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (pedido, coalesce(parte, ''), login, papel, momento)
       DO UPDATE SET resposta = excluded.resposta, feita_em = excluded.feita_em`,
    [pedido.pedido_pai || pedido.id, pedido.pedido_pai ? pedido.id : null, usuario.login, r.papel, r.momento, r.resposta, acao.feitaEm],
  );
  return { resultado: "aplicada", motivo: null };
}

// as respostas de uma lista de pedidos ORIGINAIS: Map(pedido → [{ login, nome, papel, momento, resposta, parte, feita_em }])
export async function cienciasDosPedidos(conexao, pedidos) {
  if (!pedidos.length) return new Map();
  const { rows } = await conexao.query(
    `SELECT o.pedido, o.parte, o.login, coalesce(u.nome, o.login) AS nome, o.papel, o.momento, o.resposta, o.feita_em
       FROM observacao_ciencias o LEFT JOIN usuarios u ON u.login = o.login
      WHERE o.pedido = ANY($1) ORDER BY o.feita_em, o.id`,
    [pedidos],
  );
  return Map.groupBy(rows.map(({ pedido, ...c }) => ({ pedido, ...c })), (c) => c.pedido);
}
