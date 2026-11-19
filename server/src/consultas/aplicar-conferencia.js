// Aplica no banco as ações da Conferência que chegam do posto (Fase 2), e o caminho do pedido separado
// até a conferência. Quem decide O QUE muda é a regra pura compartilhado/regras/acoes-conferencia.js;
// aqui só se lê, chama a regra e grava. Roda dentro da transação do lote (consultas/acoes.js).
import { avaliarAcaoDaConferencia } from "../../../compartilhado/regras/acoes-conferencia.js";

const PERFIS_DA_CONFERENCIA = ["conf"];
// nome do campo na regra → coluna no banco
const COLUNAS = { status: "status", conferente: "conferente", inicio: "inicio", fim: "fim", posto: "posto", volumes: "volumes", observacao: "observacao" };

export const conferenciaDoPedido = async (conexao, pedido, travar = false) =>
  (await conexao.query(
    `SELECT pedido, setor, status, conferente, designado_para AS "designadoPara" FROM conferencias WHERE pedido = $1${travar ? " FOR UPDATE" : ""}`,
    [pedido],
  )).rows[0] || null;

// o que foi separado, por produto (pedido dividido: somando todas as partes)
export async function separadoDoPedido(conexao, pedido) {
  return (await conexao.query(
    `SELECT i.produto, sum(i.qtd_separada) AS qtd
       FROM itens_pedido i JOIN pedidos p ON p.id = i.pedido_id
      WHERE (p.id = $1 AND p.pedido_pai IS NULL) OR p.pedido_pai = $1
      GROUP BY i.produto ORDER BY i.produto`,
    [pedido],
  )).rows;
}

// A separação terminou: o pedido entra na caixa de entrada da conferência.
// Parte de pedido dividido: só quando TODAS as partes terminaram, e entra o pedido original (uma conferência só).
// pedido = { id, setor, pedidoPai }
export async function entrarNaConferencia(conexao, pedido) {
  let id = pedido.id;
  if (pedido.pedidoPai) {
    const faltam = (await conexao.query(
      "SELECT count(*)::int AS n FROM pedidos WHERE pedido_pai = $1 AND status <> 'concluido'", [pedido.pedidoPai],
    )).rows[0].n;
    if (faltam) return;
    id = pedido.pedidoPai;
  }
  await conexao.query("INSERT INTO conferencias (pedido, setor) VALUES ($1, $2) ON CONFLICT (pedido) DO NOTHING", [id, pedido.setor]);
}

// "Separar novamente" antes de alguém começar a conferir: sai da conferência (volta quando a separação terminar)
export async function sairDaConferencia(conexao, pedido) {
  await conexao.query("DELETE FROM conferencias WHERE pedido = $1 AND status = 'aguardando'", [pedido]);
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
  for (const x of r.contagens) {
    await conexao.query(
      `INSERT INTO conferencia_itens (pedido, produto, qtd_conferida, fora) VALUES ($1, $2, $3, $4)
       ON CONFLICT (pedido, produto) DO UPDATE SET qtd_conferida = excluded.qtd_conferida, fora = excluded.fora`,
      [id, x.produto, x.qtd, x.fora],
    );
  }
  return { resultado: "aplicada", motivo: null };
}
