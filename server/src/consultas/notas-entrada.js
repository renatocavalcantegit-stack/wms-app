// SQL das NOTAS DE ENTRADA (Estoque no servidor, entrega A · v77): a aba Entrada da Gestão de Estoque.
// Uma nota é uma Compra (vem do ERP) ou uma Devolução (nasce quando a devolução de um pedido fica "pendente").
// As regras são as mesmas da demonstração (compartilhado/regras/recebimento.js): este arquivo só lê e grava.
//
// Performance (risco 4 do plano): a lista filtra e pagina NO BANCO. Os três status de cada nota ficam gravados
// em notas_entrada (recalculados pela regra statusDaNota a cada mudança, na mesma transação), então a lista
// nunca precisa ler todas as notas com os itens para saber o status.
import { emTransacao } from "../banco.js";
import { statusDaNota, separarNotasImportadas, TIPO_DEVOLUCAO, cadastrosDasNotas, notaSemCadastro } from "../../../compartilhado/regras/recebimento.js";
import { importacaoDeNotas } from "../../../js/demo-dados.js";

// a regra recusou (nota não existe, nada pendente...): a mensagem vai para a tela
export class ErroDaNota extends Error {
  constructor(mensagem, status = 409) { super(mensagem); this.status = status; }
}
export const MSG_NOTA_NAO_ENCONTRADA = "NOTA NÃO ENCONTRADA.";
export const MSG_NADA_PENDENTE = "NADA PENDENTE DE ARMAZENAR NESTE PRODUTO.";
export const POR_PAGINA = [10, 20, 30, 50];

// ---------- a nota no formato das regras (o mesmo da demonstração) ----------
// nota: { id, numero, tipo, fornecedor: { codigo, nome }, data: "AAAA-MM-DD", finalizada, pedido, itens: [{ produto, qtd }] }
// conferencias: [{ id, notaId, produto, qtd, docaId, dia, armazenado, cancelado, volumes: [códigos] }]
export const COLUNAS_DA_NOTA = `n.id, n.numero, n.tipo, n.fornecedor_codigo, n.fornecedor_nome, to_char(n.data, 'YYYY-MM-DD') AS data,
  n.finalizada, n.pedido, n.status_conferencia, n.status_divergencia, n.status_armazenamento, n.avisos`;
export const notaDaLinha = (r, itens = []) => ({
  id: r.id, numero: r.numero, tipo: r.tipo, fornecedor: { codigo: r.fornecedor_codigo, nome: r.fornecedor_nome },
  data: r.data, finalizada: r.finalizada, pedido: r.pedido, itens, avisos: r.avisos,
  status: { conferencia: r.status_conferencia, divergencia: r.status_divergencia, armazenamento: r.status_armazenamento },
});

export async function lerNota(conexao, id, { travar = false } = {}) {
  const r = (await conexao.query(`SELECT ${COLUNAS_DA_NOTA} FROM notas_entrada n WHERE n.id = $1 ${travar ? "FOR UPDATE" : ""}`, [id])).rows[0];
  if (!r) return null;
  const itens = (await conexao.query("SELECT produto, qtd FROM notas_entrada_itens WHERE nota_id = $1 ORDER BY produto", [id])).rows;
  return notaDaLinha(r, itens);
}
export const lerConferencias = (conexao, notaId) => lerConferenciasDasNotas(conexao, [notaId]);
// v78: acaoId = a ação da fila do coletor que criou o recebimento · usuario = o nome de quem conferiu
export async function lerConferenciasDasNotas(conexao, notaIds) {
  const { rows } = await conexao.query(
    `SELECT r.id, r.nota_id AS "notaId", r.produto, r.qtd, r.doca_id AS "docaId", to_char(r.dia, 'YYYY-MM-DD') AS dia,
            r.armazenado, r.cancelado, r.acao_id AS "acaoId", coalesce(u.nome, r.usuario) AS usuario,
            coalesce((SELECT array_agg(v.codigo ORDER BY v.seq) FROM volumes_recebimento v WHERE v.recebimento_id = r.id), '{}') AS volumes
       FROM recebimentos r LEFT JOIN usuarios u ON u.login = r.usuario
      WHERE r.nota_id = ANY($1) ORDER BY r.id`,
    [notaIds],
  );
  return rows;
}

// recalcula e grava os três status da nota (chamar na mesma transação de quem mudou a nota ou os recebimentos)
export async function recalcularStatus(conexao, notaId) {
  const nota = await lerNota(conexao, notaId);
  const s = statusDaNota(nota, await lerConferencias(conexao, notaId));
  await conexao.query(
    "UPDATE notas_entrada SET status_conferencia = $2, status_divergencia = $3, status_armazenamento = $4 WHERE id = $1",
    [notaId, s.conferencia, s.divergencia, s.armazenamento],
  );
  return s;
}

// ---------- devolução → nota ----------
// A devolução ficou "pendente" (entregue ao estoque): vira uma nota do tipo Devolução, com os mesmos itens.
// Chamada por consultas/devolucoes.js, na transação de quem entregou. Não duplica (devolucao_id é único).
export async function abrirNotaDaDevolucao(conexao, devolucaoId) {
  const { rows } = await conexao.query(
    `INSERT INTO notas_entrada (numero, tipo, fornecedor_nome, data, devolucao_id, pedido)
     SELECT d.numero, $2, 'Entregue por ' || coalesce(u.nome, d.entregue_por, '—'), coalesce(d.entregue_em, now())::date, d.id, d.pedido
       FROM devolucoes d LEFT JOIN usuarios u ON u.login = d.entregue_por
      WHERE d.id = $1 AND d.status = 'pendente'
     ON CONFLICT (devolucao_id) DO NOTHING
     RETURNING id`,
    [devolucaoId, TIPO_DEVOLUCAO],
  );
  if (!rows.length) return null;
  await conexao.query(
    "INSERT INTO notas_entrada_itens (nota_id, produto, qtd) SELECT $1, produto, qtd FROM devolucao_itens WHERE devolucao_id = $2",
    [rows[0].id, devolucaoId],
  );
  return rows[0].id;
}

// ---------- lista (aba Entrada) ----------
// filtros = { nf, fornecedor, de, ate, conferencia, divergencia, armazenamento } (vazio = todos)
// Devolve { notas, total, pagina, porPagina, contagens } — contagens são os indicadores do topo (todas as notas).
export async function listarNotas(pool, filtros = {}, pagina = 1, porPagina = 20) {
  const f = { nf: "", fornecedor: "", de: "", ate: "", conferencia: "", divergencia: "", armazenamento: "", ...filtros };
  const condicoes = [], valores = [];
  const valor = (v) => { valores.push(v); return `$${valores.length}`; };
  if (f.nf.trim()) condicoes.push(`n.numero LIKE ${valor(`%${f.nf.trim()}%`)}`);
  if (f.fornecedor.trim()) {
    const t = f.fornecedor.trim();
    condicoes.push(`(n.fornecedor_nome ILIKE ${valor(`%${t}%`)} OR n.fornecedor_codigo::text = ${valor(t)})`);
  }
  if (f.de) condicoes.push(`n.data >= ${valor(f.de)}::date`);
  if (f.ate) condicoes.push(`n.data <= ${valor(f.ate)}::date`);
  if (f.conferencia) condicoes.push(`n.status_conferencia = ${valor(f.conferencia)}`);
  if (f.divergencia) condicoes.push(`n.status_divergencia = ${valor(f.divergencia)}`);
  if (f.armazenamento) condicoes.push(`n.status_armazenamento = ${valor(f.armazenamento)}`);
  const onde = condicoes.length ? `WHERE ${condicoes.join(" AND ")}` : "";

  const total = (await pool.query(`SELECT count(*)::int AS n FROM notas_entrada n ${onde}`, valores)).rows[0].n;
  const paginas = Math.max(1, Math.ceil(total / porPagina));
  const atual = Math.min(Math.max(1, pagina), paginas);
  const { rows } = await pool.query(
    `SELECT ${COLUNAS_DA_NOTA}, (SELECT count(*)::int FROM notas_entrada_itens i WHERE i.nota_id = n.id) AS produtos
       FROM notas_entrada n ${onde}
      ORDER BY n.data DESC, n.id DESC
      LIMIT ${valor(porPagina)} OFFSET ${valor((atual - 1) * porPagina)}`,
    valores,
  );
  const contagens = (await pool.query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE status_conferencia = 'aguardando')::int AS aguardando,
            count(*) FILTER (WHERE status_conferencia = 'aberta')::int AS aberta,
            count(*) FILTER (WHERE status_conferencia = 'conferida')::int AS conferida,
            count(*) FILTER (WHERE status_divergencia = 'com')::int AS com,
            count(*) FILTER (WHERE status_armazenamento = 'parcial')::int AS parcial,
            count(*) FILTER (WHERE status_armazenamento = 'armazenado')::int AS armazenado
       FROM notas_entrada`,
  )).rows[0];
  return { notas: rows.map((r) => ({ ...notaDaLinha(r), produtos: r.produtos })), total, pagina: atual, porPagina, contagens };
}

// ---------- detalhe ----------
// A nota com tudo o que a tela do detalhe usa: os itens, as conferências (com os códigos dos volumes),
// os volumes (para reimprimir), a descrição e a unidade dos produtos e o código das docas.
export async function detalheDaNota(pool, id) {
  const nota = await lerNota(pool, id);
  if (!nota) throw new ErroDaNota(MSG_NOTA_NAO_ENCONTRADA, 404);
  const conferencias = await lerConferencias(pool, id);
  const volumes = (await pool.query(
    `SELECT v.codigo, r.nota_id AS "notaId", r.produto, v.recebimento_id AS "conferenciaId", v.seq, v.total
       FROM volumes_recebimento v JOIN recebimentos r ON r.id = v.recebimento_id
      WHERE r.nota_id = $1 ORDER BY r.produto, v.recebimento_id, v.seq`,
    [id],
  )).rows;
  const produtos = (await pool.query(
    "SELECT codigo, descricao, un, cadastrado_por_nota FROM produtos WHERE codigo IN (SELECT produto FROM notas_entrada_itens WHERE nota_id = $1)",
    [id],
  )).rows;
  const docas = (await pool.query(
    "SELECT id, codigo FROM enderecos WHERE id IN (SELECT doca_id FROM recebimentos WHERE nota_id = $1)",
    [id],
  )).rows;
  // v78: o que o coletor mandou e o servidor NÃO aplicou (ex.: dois coletores passaram do pendente)
  const recusas = (await pool.query(
    `SELECT a.tipo, coalesce(u.nome, a.login) AS quem, a.feita_em AS quando, a.motivo, a.dados->>'produto' AS produto, a.dados->>'qtd' AS qtd
       FROM acoes_recebidas a LEFT JOIN usuarios u ON u.login = a.login
      WHERE a.tipo LIKE 'recepcao.%' AND a.dados->>'nota' = $1::text AND a.resultado <> 'aplicada'
      ORDER BY a.feita_em`,
    [id],
  )).rows;
  return { nota, conferencias, volumes, produtos, docas, recusas };
}

// ---------- cancelar pendente ----------
// O gestor tira o produto da lista de armazenamento: o que estava pendente vira "cancelado" e o saldo CONTINUA
// na doca (depois pode ser movido por transferência). Fica registrado quem cancelou e quando.
export async function cancelarPendente(pool, { notaId, produto, login }) {
  return emTransacao(pool, async (c) => {
    if (!(await lerNota(c, notaId, { travar: true }))) throw new ErroDaNota(MSG_NOTA_NAO_ENCONTRADA, 404);
    const { rows } = await c.query(
      `UPDATE recebimentos SET cancelado = qtd - armazenado, cancelado_por = $3, cancelado_em = now()
        WHERE nota_id = $1 AND produto = $2 AND armazenado + cancelado < qtd
       RETURNING id`,
      [notaId, produto, login],
    );
    if (!rows.length) throw new ErroDaNota(MSG_NADA_PENDENTE);
    return { status: await recalcularStatus(c, notaId) };
  });
}

// ---------- buscar notas do ERP ----------
// Até o Sankhya ser ligado, a busca é SIMULADA: traz as notas de exemplo da demonstração (decisão de 25/11/2026).
// Nota que já existe (mesmo número e fornecedor) é bloqueada, sem duplicar (regra separarNotasImportadas).
// O produto que a nota traz e o WMS não tem é cadastrado junto, na mesma transação (regra cadastrosDasNotas):
// checkout ligado, código de barras de outro produto fica de fora com aviso na nota. O que já existe não muda.
export async function importarNotasDoErp(pool, recebidas = importacaoDeNotas()) {
  return emTransacao(pool, async (c) => {
    // duas buscas ao mesmo tempo não importam a mesma nota duas vezes
    await c.query("SELECT pg_advisory_xact_lock(hashtext('notas-do-erp'))");
    const existentes = (await c.query(
      "SELECT numero, fornecedor_codigo FROM notas_entrada WHERE tipo = 'Compra' AND numero = ANY($1)",
      [recebidas.map((n) => n.numero)],
    )).rows.map((r) => ({ numero: r.numero, fornecedor: { codigo: r.fornecedor_codigo } }));
    const r = separarNotasImportadas(existentes, recebidas);
    // só o que esta busca precisa saber: quais produtos já existem e de quem são os códigos de barras que vieram
    const cadastrados = new Set((await c.query(
      "SELECT codigo FROM produtos WHERE codigo = ANY($1)", [r.importadas.flatMap((n) => n.itens.map((i) => i.produto))],
    )).rows.map((x) => x.codigo));
    const codigos = r.importadas.flatMap((n) => n.itens.flatMap((i) => (i.cadastro?.embalagens || []).map((e) => String(e.codigo ?? "").trim()))).filter(Boolean);
    const donos = new Map((await c.query("SELECT codigo, produto FROM embalagens WHERE codigo = ANY($1)", [codigos])).rows.map((x) => [x.codigo, x.produto]));

    const importadas = [], bloqueadas = [...r.bloqueadas];
    for (const cad of cadastrosDasNotas(r.importadas, { existe: (x) => cadastrados.has(x), donoDoCodigo: (x) => donos.get(x) || null })) {
      if (cad.bloqueio) { bloqueadas.push({ nota: cad.nota, msg: cad.bloqueio }); continue; }
      const n = notaSemCadastro(cad.nota);
      const { id } = (await c.query(
        `INSERT INTO notas_entrada (numero, tipo, fornecedor_codigo, fornecedor_nome, data, avisos)
         VALUES ($1, 'Compra', $2, $3, $4::date, $5) RETURNING id`,
        [n.numero, n.fornecedor.codigo, n.fornecedor.nome, n.data, cad.avisos],
      )).rows[0];
      for (const p of cad.produtos) await cadastrarProduto(c, p, id);
      await c.query(
        `INSERT INTO notas_entrada_itens (nota_id, produto, qtd)
         SELECT $1, x.produto, x.qtd FROM jsonb_to_recordset($2::jsonb) AS x(produto text, qtd numeric)`,
        [id, JSON.stringify(n.itens)],
      );
      for (const p of cad.produtos) cadastrados.add(p.codigo);
      importadas.push({ ...n, id, avisos: cad.avisos, produtosNovos: cad.produtos.map((p) => p.codigo) });
    }
    return { importadas, bloqueadas };
  });
}

// o produto novo que veio na nota, com as embalagens (dentro da transação da importação)
async function cadastrarProduto(c, p, notaId) {
  await c.query(
    `INSERT INTO produtos (codigo, descricao, un, checkout, fornecedor, grupo, subgrupo, estoque_min, estoque_max,
       controla_validade, controla_lote, controla_serie, peso_bruto, peso_liquido, shelflife, cadastrado_por_nota, cadastrado_em)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, now())`,
    [p.codigo, p.descricao, p.un, p.checkout, p.fornecedor, p.grupo, p.subgrupo, p.estoqueMin, p.estoqueMax,
      p.controlaValidade, p.controlaLote, p.controlaSerie, p.pesoBruto, p.pesoLiquido, p.shelflife, notaId],
  );
  for (const e of p.embalagens) {
    await c.query("INSERT INTO embalagens (produto, codigo, descricao, qtd) VALUES ($1, $2, $3, $4)", [p.codigo, e.codigo, e.descricao, e.qtd]);
  }
}

// ---------- saldo × histórico ----------
// Confere se o saldo de cada endereço é igual à soma dos movimentos (entradas − saídas).
// Devolve as diferenças ([] = tudo certo). Roda nos testes e pode rodar a qualquer hora no banco real.
export async function saldosForaDoHistorico(pool) {
  const { rows } = await pool.query(
    `WITH historico AS (
       SELECT endereco_id, produto, sum(qtd) AS qtd FROM (
         SELECT destino_id AS endereco_id, produto, qtd FROM movimentos WHERE destino_id IS NOT NULL
         UNION ALL
         SELECT origem_id, produto, -qtd FROM movimentos WHERE origem_id IS NOT NULL
       ) m GROUP BY endereco_id, produto
     )
     SELECT coalesce(s.endereco_id, h.endereco_id) AS endereco_id, coalesce(s.produto, h.produto) AS produto,
            coalesce(s.qtd, 0) AS saldo, coalesce(h.qtd, 0) AS historico
       FROM saldos s FULL JOIN historico h ON h.endereco_id = s.endereco_id AND h.produto = s.produto
      WHERE coalesce(s.qtd, 0) <> coalesce(h.qtd, 0)
      ORDER BY 1, 2`,
  );
  return rows;
}
