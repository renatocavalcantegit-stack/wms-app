// A RECEPÇÃO no coletor do estoquista (Estoque no servidor, entrega B · v78): a conferência e a finalização da nota.
//
// 1) O coletor baixa as notas em aberto (notasParaOColetor) e guarda numa chave própria e pequena.
//    Assim ele confere sem rede e nunca lê o Estoque inteiro.
// 2) Cada confirmação vira a ação "recepcao.conferir" na fila do aparelho; o "Finalizar nota" vira "recepcao.finalizar".
// 3) Aqui o servidor aplica cada ação com as MESMAS regras da demonstração (compartilhado/regras/recebimento.js).
//    Decisão de 25/11/2026: se dois coletores passaram do pendente, a confirmação que chegar por último é recusada
//    INTEIRA (nada entra pela metade) e as etiquetas dela precisam ser descartadas.
import { validarDoca, validarConferencia, validarCodigosDosVolumes, msgVolumeRepetido, ehDevolucao } from "../../../compartilhado/regras/recebimento.js";
import { lerQuantidade } from "../../../compartilhado/regras/quantidade.js";
import {
  COLUNAS_DA_NOTA, notaDaLinha, lerNota, lerConferencias, lerConferenciasDasNotas, recalcularStatus, MSG_NOTA_NAO_ENCONTRADA,
} from "./notas-entrada.js";

const PERFIS_DA_RECEPCAO = ["estq"];
// quantas notas em aberto o coletor baixa no máximo (as mais recentes). Em aberto costumam ser poucas dezenas.
export const LIMITE_DE_NOTAS_ABERTAS = 300;

// ---------- o que o coletor baixa ----------
// { notas, conferencias, produtos, embalagens, docas } — só o que a conferência das notas em aberto precisa:
// os produtos e as embalagens (códigos de barras) dos itens dessas notas e as docas (de recebimento e de devolução).
export async function notasParaOColetor(pool) {
  const linhas = (await pool.query(
    `SELECT ${COLUNAS_DA_NOTA} FROM notas_entrada n WHERE NOT n.finalizada ORDER BY n.data DESC, n.id DESC LIMIT $1`,
    [LIMITE_DE_NOTAS_ABERTAS],
  )).rows;
  const ids = linhas.map((r) => r.id);
  const itens = (await pool.query(
    `SELECT nota_id, produto, qtd FROM notas_entrada_itens WHERE nota_id = ANY($1) ORDER BY nota_id, produto`, [ids],
  )).rows;
  const notas = linhas.map((r) => {
    const { status, avisos, ...nota } = notaDaLinha(r, itens.filter((i) => i.nota_id === r.id).map(({ produto, qtd }) => ({ produto, qtd })));
    return nota;
  });
  const codigos = [...new Set(itens.map((i) => i.produto))];
  const produtos = (await pool.query(
    "SELECT codigo, descricao, un, checkout FROM produtos WHERE codigo = ANY($1) ORDER BY codigo", [codigos],
  )).rows;
  const embalagens = (await pool.query(
    "SELECT id, produto, codigo, descricao, qtd FROM embalagens WHERE produto = ANY($1) ORDER BY id", [codigos],
  )).rows;
  const docas = (await pool.query(
    "SELECT id, rua, predio, andar, apto, codigo, tipo, ativo FROM enderecos WHERE tipo IN ('doca', 'devolucao') ORDER BY id",
  )).rows;
  // as conferências vão sem quem conferiu (o coletor não mostra) e com a ação da fila que criou cada uma
  const conferencias = (await lerConferenciasDasNotas(pool, ids)).map(({ usuario, ...c }) => c);
  return { notas, conferencias, produtos, embalagens, docas };
}

// ---------- as ações que chegam da fila do coletor ----------
const recusa = (motivo) => ({ resultado: "recusada", motivo });
const APLICADA = { resultado: "aplicada", motivo: null };

// conexao: a da transação do lote (consultas/acoes.js) · usuario: { login, perfil } · acao: { id, tipo, dados, feitaEm }
export async function aplicarAcaoDaRecepcao(conexao, usuario, acao) {
  if (acao.tipo !== "recepcao.conferir" && acao.tipo !== "recepcao.finalizar") {
    return { resultado: "desconhecida", motivo: `TIPO DE AÇÃO DESCONHECIDO: ${acao.tipo}` };
  }
  if (!PERFIS_DA_RECEPCAO.includes(usuario.perfil)) return recusa("PERFIL SEM PERMISSÃO PARA CONFERIR NOTAS.");
  const notaId = Number(acao.dados?.nota);
  // FOR UPDATE: dois coletores na mesma nota ao mesmo tempo, o segundo espera o primeiro e vê o que ele conferiu
  const nota = Number.isInteger(notaId) && notaId > 0 ? await lerNota(conexao, notaId, { travar: true }) : null;
  if (!nota) return recusa(MSG_NOTA_NAO_ENCONTRADA);
  return acao.tipo === "recepcao.conferir" ? conferir(conexao, usuario, acao, nota) : finalizar(conexao, usuario, acao, nota);
}

// uma confirmação do coletor: soma ao conferido, põe o saldo na doca e grava os volumes (com os códigos que o
// coletor já imprimiu). Saldo e movimento na mesma transação: o histórico nunca se separa do saldo.
async function conferir(conexao, usuario, acao, nota) {
  const d = acao.dados;
  const doca = (await conexao.query("SELECT id, tipo, ativo FROM enderecos WHERE id = $1", [Number(d.doca) || 0])).rows[0] || null;
  const erroDoca = validarDoca(doca, nota);
  if (erroDoca) return recusa(erroDoca);
  const codigos = Array.isArray(d.volumes) ? d.volumes : [];
  const erroDosCodigos = validarCodigosDosVolumes(codigos);
  if (erroDosCodigos) return recusa(erroDosCodigos);
  // finalizada, produto fora da nota, quantidade inválida ou ACIMA DO PENDENTE (outro coletor conferiu antes)
  const erro = validarConferencia(nota, { produto: d.produto, qtd: d.qtd, volumes: codigos.length }, await lerConferencias(conexao, nota.id));
  if (erro) return recusa(erro);
  const ja = (await conexao.query("SELECT codigo FROM volumes_recebimento WHERE codigo = ANY($1) LIMIT 1", [codigos])).rows[0];
  if (ja) return recusa(msgVolumeRepetido(ja.codigo));

  const qtd = lerQuantidade(d.qtd);
  // o dia do aparelho (a "data de armazenagem"); se não veio, o dia em que a ação foi feita
  const dia = /^\d{4}-\d{2}-\d{2}$/.test(d.dia ?? "") ? d.dia : acao.feitaEm.slice(0, 10);
  const { id } = (await conexao.query(
    `INSERT INTO recebimentos (nota_id, produto, qtd, doca_id, dia, usuario, feito_em, acao_id)
     VALUES ($1, $2, $3, $4, $5::date, $6, $7, $8) RETURNING id`,
    [nota.id, d.produto, qtd, doca.id, dia, usuario.login, acao.feitaEm, acao.id],
  )).rows[0];
  await conexao.query(
    `INSERT INTO volumes_recebimento (codigo, recebimento_id, seq, total)
     SELECT v.codigo, $2, v.seq, $3 FROM unnest($1::text[]) WITH ORDINALITY AS v(codigo, seq)`,
    [codigos, id, codigos.length],
  );
  await conexao.query(
    `INSERT INTO saldos (endereco_id, produto, qtd) VALUES ($1, $2, $3)
     ON CONFLICT (endereco_id, produto) DO UPDATE SET qtd = saldos.qtd + EXCLUDED.qtd`,
    [doca.id, d.produto, qtd],
  );
  await conexao.query(
    `INSERT INTO movimentos (tipo, produto, qtd, destino_id, usuario, feito_em, nota_id, pedido)
     VALUES ('recebimento', $1, $2, $3, $4, $5, $6, $7)`,
    [d.produto, qtd, doca.id, usuario.login, acao.feitaEm, nota.id, nota.pedido],
  );
  await recalcularStatus(conexao, nota.id);
  return APLICADA;
}

// "Finalizar nota": não recebe mais conferências e não reabre. Repetida (já finalizada), não muda nada.
// A nota de devolução finalizada: a devolução passa a "recebida" (o estoque conferiu).
async function finalizar(conexao, usuario, acao, nota) {
  if (nota.finalizada) return APLICADA;
  await conexao.query(
    "UPDATE notas_entrada SET finalizada = true, finalizada_em = $2, finalizada_por = $3 WHERE id = $1",
    [nota.id, acao.feitaEm, usuario.login],
  );
  if (ehDevolucao(nota)) {
    await conexao.query(
      `UPDATE devolucoes SET status = 'recebida'
        WHERE id = (SELECT devolucao_id FROM notas_entrada WHERE id = $1) AND status = 'pendente'`,
      [nota.id],
    );
  }
  await recalcularStatus(conexao, nota.id);
  return APLICADA;
}
