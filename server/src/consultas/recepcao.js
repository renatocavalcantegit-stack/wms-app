// A RECEPÇÃO no coletor do estoquista (Estoque no servidor, entrega B · v78): a conferência e a finalização da nota.
//
// 1) O coletor baixa as notas em aberto (notasParaOColetor) e guarda numa chave própria e pequena.
//    Assim ele confere sem rede e nunca lê o Estoque inteiro.
// 2) Cada confirmação vira a ação "recepcao.conferir" na fila do aparelho; o "Finalizar nota" vira "recepcao.finalizar".
// 3) Aqui o servidor aplica cada ação com as MESMAS regras da demonstração (compartilhado/regras/recebimento.js).
//    Decisão de 25/11/2026: se dois coletores passaram do pendente, a confirmação que chegar por último é recusada
//    INTEIRA (nada entra pela metade) e as etiquetas dela precisam ser descartadas.
// 4) v80: conferência por VOLUME. O coletor monta o volume (palete ou caixa) e manda "recepcao.enderecarVolume" com
//    o volume inteiro; se qualquer produto não passar, o volume é recusado INTEIRO (decisão de 28/11/2026).
import {
  validarDoca, validarConferencia, validarCodigosDosVolumes, msgVolumeRepetido, ehDevolucao, validarVolume,
} from "../../../compartilhado/regras/recebimento.js";
import { lerQuantidade } from "../../../compartilhado/regras/quantidade.js";
import {
  COLUNAS_DA_NOTA, notaDaLinha, lerNota, lerConferencias, lerConferenciasDasNotas, lerVolumesDasNotas, recalcularStatus, MSG_NOTA_NAO_ENCONTRADA,
} from "./notas-entrada.js";

const PERFIS_DA_RECEPCAO = ["estq"];
// quantas notas em aberto o coletor baixa no máximo (as mais recentes). Em aberto costumam ser poucas dezenas.
export const LIMITE_DE_NOTAS_ABERTAS = 300;

// ---------- o que o coletor baixa ----------
// { notas, conferencias, produtos, embalagens, docas, volumes } — só o que a conferência das notas em aberto precisa:
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
  // v80: os volumes já endereçados (com a ação da fila que criou cada um, para o coletor parar de somar a cópia local)
  const volumes = (await lerVolumesDasNotas(pool, ids)).map(({ usuario, feitoEm, ...v }) => v);
  return { notas, conferencias, produtos, embalagens, docas, volumes };
}

// ---------- as ações que chegam da fila do coletor ----------
const recusa = (motivo) => ({ resultado: "recusada", motivo });
const APLICADA = { resultado: "aplicada", motivo: null };

// conexao: a da transação do lote (consultas/acoes.js) · usuario: { login, perfil } · acao: { id, tipo, dados, feitaEm }
export async function aplicarAcaoDaRecepcao(conexao, usuario, acao) {
  if (!["recepcao.conferir", "recepcao.finalizar", "recepcao.enderecarVolume"].includes(acao.tipo)) {
    return { resultado: "desconhecida", motivo: `TIPO DE AÇÃO DESCONHECIDO: ${acao.tipo}` };
  }
  if (!PERFIS_DA_RECEPCAO.includes(usuario.perfil)) return recusa("PERFIL SEM PERMISSÃO PARA CONFERIR NOTAS.");
  const notaId = Number(acao.dados?.nota);
  // FOR UPDATE: dois coletores na mesma nota ao mesmo tempo, o segundo espera o primeiro e vê o que ele conferiu
  const nota = Number.isInteger(notaId) && notaId > 0 ? await lerNota(conexao, notaId, { travar: true }) : null;
  if (!nota) return recusa(MSG_NOTA_NAO_ENCONTRADA);
  if (acao.tipo === "recepcao.enderecarVolume") return enderecarVolume(conexao, usuario, acao, nota);
  return acao.tipo === "recepcao.conferir" ? conferir(conexao, usuario, acao, nota) : finalizar(conexao, usuario, acao, nota);
}

const lerDoca = async (conexao, id) =>
  (await conexao.query("SELECT id, tipo, ativo FROM enderecos WHERE id = $1", [Number(id) || 0])).rows[0] || null;
// o dia do aparelho (a "data de armazenagem"); se não veio, o dia em que a ação foi feita
const diaDaAcao = (acao) => (/^\d{4}-\d{2}-\d{2}$/.test(acao.dados.dia ?? "") ? acao.dados.dia : acao.feitaEm.slice(0, 10));
// um código de volume já existe? (os por produto da v78 e os volumes da v80 dividem os mesmos códigos)
async function codigoJaExiste(conexao, codigos) {
  return (await conexao.query(
    `SELECT codigo FROM volumes_recebimento WHERE codigo = ANY($1)
     UNION ALL SELECT codigo FROM volumes_entrada WHERE codigo = ANY($1) LIMIT 1`, [codigos],
  )).rows[0]?.codigo || null;
}

// grava UM recebimento: soma ao conferido, põe o saldo na doca e grava o movimento (na mesma transação: o histórico
// nunca se separa do saldo). Devolve o id do recebimento.
async function receber(conexao, usuario, acao, nota, { produto, qtd, docaId, dia, acaoId = null, volume = null }) {
  const { id } = (await conexao.query(
    `INSERT INTO recebimentos (nota_id, produto, qtd, doca_id, dia, usuario, feito_em, acao_id, volume_codigo)
     VALUES ($1, $2, $3, $4, $5::date, $6, $7, $8, $9) RETURNING id`,
    [nota.id, produto, qtd, docaId, dia, usuario.login, acao.feitaEm, acaoId, volume],
  )).rows[0];
  await conexao.query(
    `INSERT INTO saldos (endereco_id, produto, qtd) VALUES ($1, $2, $3)
     ON CONFLICT (endereco_id, produto) DO UPDATE SET qtd = saldos.qtd + EXCLUDED.qtd`,
    [docaId, produto, qtd],
  );
  await conexao.query(
    `INSERT INTO movimentos (tipo, produto, qtd, destino_id, usuario, feito_em, nota_id, pedido)
     VALUES ('recebimento', $1, $2, $3, $4, $5, $6, $7)`,
    [produto, qtd, docaId, usuario.login, acao.feitaEm, nota.id, nota.pedido],
  );
  return id;
}

// uma confirmação do coletor: soma ao conferido, põe o saldo na doca e grava os volumes (com os códigos que o
// coletor já imprimiu). Saldo e movimento na mesma transação: o histórico nunca se separa do saldo.
async function conferir(conexao, usuario, acao, nota) {
  const d = acao.dados;
  const doca = await lerDoca(conexao, d.doca);
  const erroDoca = validarDoca(doca, nota);
  if (erroDoca) return recusa(erroDoca);
  const codigos = Array.isArray(d.volumes) ? d.volumes : [];
  const erroDosCodigos = validarCodigosDosVolumes(codigos);
  if (erroDosCodigos) return recusa(erroDosCodigos);
  // finalizada, produto fora da nota, quantidade inválida ou ACIMA DO PENDENTE (outro coletor conferiu antes)
  const erro = validarConferencia(nota, { produto: d.produto, qtd: d.qtd, volumes: codigos.length }, await lerConferencias(conexao, nota.id));
  if (erro) return recusa(erro);
  const ja = codigos.length ? await codigoJaExiste(conexao, codigos) : null;
  if (ja) return recusa(msgVolumeRepetido(ja));

  const id = await receber(conexao, usuario, acao, nota,
    { produto: d.produto, qtd: lerQuantidade(d.qtd), docaId: doca.id, dia: diaDaAcao(acao), acaoId: acao.id });
  await conexao.query(
    `INSERT INTO volumes_recebimento (codigo, recebimento_id, seq, total)
     SELECT v.codigo, $2, v.seq, $3 FROM unnest($1::text[]) WITH ORDINALITY AS v(codigo, seq)`,
    [codigos, id, codigos.length],
  );
  await recalcularStatus(conexao, nota.id);
  return APLICADA;
}

// v80: o volume inteiro (palete ou caixa) entra na doca: grava o volume e um recebimento por produto, ligado a ele.
// Recusado INTEIRO se qualquer produto não passar, se o código já existe ou se o endereço não é doca.
async function enderecarVolume(conexao, usuario, acao, nota) {
  const d = acao.dados;
  const doca = await lerDoca(conexao, d.doca);
  const erroDoca = validarDoca(doca, nota);
  if (erroDoca) return recusa(erroDoca);
  const erroDoCodigo = validarCodigosDosVolumes([d.volume]);
  if (erroDoCodigo) return recusa(erroDoCodigo);
  const itens = Array.isArray(d.itens) ? d.itens.map((i) => ({ produto: String(i?.produto ?? ""), qtd: i?.qtd })) : [];
  const erro = validarVolume(nota, { tipo: d.tipo, itens }, await lerConferencias(conexao, nota.id));
  if (erro) return recusa(erro);
  const ja = await codigoJaExiste(conexao, [d.volume]);
  if (ja) return recusa(msgVolumeRepetido(ja));

  const dia = diaDaAcao(acao);
  await conexao.query(
    `INSERT INTO volumes_entrada (codigo, nota_id, tipo, doca_id, dia, usuario, feito_em, acao_id)
     VALUES ($1, $2, $3, $4, $5::date, $6, $7, $8)`,
    [d.volume, nota.id, d.tipo, doca.id, dia, usuario.login, acao.feitaEm, acao.id],
  );
  for (const i of itens) {
    await receber(conexao, usuario, acao, nota, { produto: i.produto, qtd: lerQuantidade(i.qtd), docaId: doca.id, dia, volume: d.volume });
  }
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
