// Apaga os dados e carrega a demonstração no banco. Uso: npm run semear
// Usa os MESMOS arquivos de demonstração do app (js/demo-*.js), então o banco e as telas mostram o mesmo estoque.
import { pathToFileURL } from "node:url";
import { conectar, emTransacao } from "../src/banco.js";
import { gerarHash } from "../src/senha.js";
import { USERS } from "../../js/sessao.js";
import { estoqueDeDemonstracao, seedSeparacao, seedSeparacaoMont, seedConferencia, seedConferenciaMont } from "../../js/demo-dados.js";
import { cadastroDoCliente } from "../../js/dados/clientes.js";
import { statusDaNota } from "../../compartilhado/regras/recebimento.js";

// Fila de cada separador no começo da demonstração (Fase 1e). O que não está aqui fica na caixa de entrada
// do coordenador: o PV-10423 (aguardando), o PV-10427 e o PV-10428 (que chega sem rota), e duas OPs.
// O lote L-1 anda inteiro (os dois pedidos têm a mesma posição na fila).
export const FILAS_DE_DEMONSTRACAO = {
  "PV-10421": ["separador", 1], "PV-10422": ["separador", 2], "PV-10424": ["separador", 3], "PV-10425": ["separador", 3],
  "PV-10426/1": ["separador", 4], "PV-10426/2": ["separador2", 1],
  "OP-3212": ["separador", 1], "OP-3213": ["separador", 2],
};
// Conferência (Fase 2): os pedidos que já chegam separados, na fila de cada conferente.
// O PV-10404 (aguardando) e a OP-3209 ficam na caixa de entrada da conferência.
export const FILAS_DA_CONFERENCIA = {
  "PV-10401": ["conferente", 1], "PV-10402": ["conferente", 2], "PV-10403": ["conferente2", 1],
  "OP-3208": ["conferente", 1], "OP-3210": ["conferente2", 1],
};
// chega do Sankhya sem rota: o coordenador define antes de mandar para um separador
export const SEM_ROTA_NA_DEMONSTRACAO = ["PV-10428"];
// rota do pedido: vem do Sankhya; na demonstração, do cadastro do cliente. Aguardando e Montagem não têm rota.
const rotaDoPedido = (o) => (o.setor !== "exp" || o.aguardando || SEM_ROTA_NA_DEMONSTRACAO.includes(o.id) ? null : cadastroDoCliente(o)?.rota || null);

// Insere uma lista de objetos de uma vez: o PostgreSQL recebe a lista como JSON e
// jsonb_to_recordset transforma cada objeto numa linha, com as colunas e tipos indicados.
async function inserirLista(conexao, tabela, colunas, linhas) {
  if (!linhas.length) return;
  const nomes = colunas.map((c) => c.split(" ")[0]).join(", ");
  await conexao.query(
    `INSERT INTO ${tabela} (${nomes}) SELECT ${nomes} FROM jsonb_to_recordset($1::jsonb) AS x(${colunas.join(", ")})`,
    [JSON.stringify(linhas)],
  );
}

// "07:42" de hoje → data e hora completas (os pedidos de demonstração só têm a hora)
function horaDeHoje(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}
const dataOuNada = (ms) => (ms ? new Date(ms).toISOString() : null);

// Notas de entrada da demonstração (v77), em todos os estados: aguardando, em aberto, conferida com e sem divergência,
// armazenamento parcial e completo. As conferências viram recebimentos com os volumes; o que está na doca esperando
// armazenar já está no saldo (e no saldo inicial). Os três status são os da regra statusDaNota.
async function semearNotas(c, estoque) {
  await inserirLista(c, "notas_entrada",
    ["id integer", "numero text", "tipo text", "fornecedor_codigo integer", "fornecedor_nome text", "data date", "finalizada boolean",
      "status_conferencia text", "status_divergencia text", "status_armazenamento text"],
    estoque.notas.map((n) => {
      const s = statusDaNota(n, estoque.conferencias);
      return { id: n.id, numero: n.numero, tipo: n.tipo, fornecedor_codigo: n.fornecedor.codigo ?? null, fornecedor_nome: n.fornecedor.nome,
        data: n.data, finalizada: n.finalizada, status_conferencia: s.conferencia, status_divergencia: s.divergencia, status_armazenamento: s.armazenamento };
    }));
  await inserirLista(c, "notas_entrada_itens", ["nota_id integer", "produto text", "qtd numeric"],
    estoque.notas.flatMap((n) => n.itens.map((i) => ({ nota_id: n.id, produto: i.produto, qtd: i.qtd }))));
  await inserirLista(c, "recebimentos",
    ["id integer", "nota_id integer", "produto text", "qtd numeric", "doca_id integer", "dia date", "armazenado numeric", "cancelado numeric"],
    estoque.conferencias.map((x) => ({ id: x.id, nota_id: x.notaId, produto: x.produto, qtd: x.qtd, doca_id: x.docaId, dia: x.dia,
      armazenado: x.armazenado, cancelado: x.cancelado })));
  await inserirLista(c, "volumes_recebimento", ["codigo text", "recebimento_id integer", "seq integer", "total integer"],
    estoque.volumes.map((v) => ({ codigo: v.codigo, recebimento_id: v.conferenciaId, seq: v.seq, total: v.total })));
  // os próximos números continuam depois dos da demonstração
  await c.query("SELECT setval('notas_entrada_id_seq', (SELECT coalesce(max(id), 0) + 1 FROM notas_entrada), false)");
  await c.query("SELECT setval('recebimentos_id_seq', (SELECT coalesce(max(id), 0) + 1 FROM recebimentos), false)");
}

// conferencia = true: também os pedidos já separados, na caixa e nas filas da conferência (os testes usam).
// Pelo terminal (npm run semear), sem eles: o teste operacional começa na Separação e o pedido chega
// na conferência pelo caminho de verdade (o separador termina → caixa "Separados" da Gestão).
export async function semear(pool, { conferencia = false } = {}) {
  const estoque = estoqueDeDemonstracao();
  const pedidos = [
    ...seedSeparacao().map((o) => ({ ...o, setor: "exp" })),
    ...seedSeparacaoMont().map((o) => ({ ...o, setor: "mont" })),
  ];
  // já separados: entram direto na caixa de entrada (ou na fila) da conferência
  const separados = conferencia ? [
    ...seedConferencia().map((o) => ({ ...o, setor: "exp" })),
    ...seedConferenciaMont().map((o) => ({ ...o, setor: "mont" })),
  ] : [];
  pedidos.push(...separados);

  await emTransacao(pool, async (c) => {
    // começa do zero (a ordem não importa com CASCADE)
    await c.query("TRUNCATE movimentos, volumes_recebimento, recebimentos, notas_entrada_itens, notas_entrada, observacao_ciencias, devolucao_itens, devolucoes, ocorrencias, conferencia_itens, conferencias, acoes_recebidas, sessoes, usuarios, itens_pedido, pedidos, associacoes, saldos, embalagens, enderecos, produtos CASCADE");

    await inserirLista(c, "usuarios", ["login text", "nome text", "perfil text", "pin_hash text"],
      USERS.map((u) => ({ login: u.login, nome: u.nome, perfil: u.perfil, pin_hash: gerarHash(u.pin) })));

    await inserirLista(c, "produtos",
      ["codigo text", "descricao text", "un text", "checkout boolean", "fornecedor integer", "grupo text", "subgrupo text",
        "estoque_min integer", "estoque_max integer", "controla_validade boolean", "controla_lote boolean", "controla_serie boolean",
        "peso_bruto numeric", "peso_liquido numeric", "shelflife integer"],
      estoque.produtos.map((p) => ({
        codigo: p.codigo, descricao: p.descricao, un: p.un, checkout: p.checkout !== false, fornecedor: p.fornecedor,
        grupo: p.grupo, subgrupo: p.subgrupo, estoque_min: p.estoqueMin, estoque_max: p.estoqueMax,
        controla_validade: !!p.controlaValidade, controla_lote: !!p.controlaLote, controla_serie: !!p.controlaSerie,
        peso_bruto: p.pesoBruto, peso_liquido: p.pesoLiquido, shelflife: p.shelflife,
      })));

    await inserirLista(c, "embalagens", ["id integer", "produto text", "codigo text", "descricao text", "qtd integer"],
      estoque.embalagens.map((e) => ({ id: e.id, produto: e.produto, codigo: e.codigo || null, descricao: e.descricao, qtd: e.qtd })));

    // endereço substituído aponta para outro endereço: grava todos primeiro e liga depois
    await inserirLista(c, "enderecos",
      ["id integer", "rua integer", "predio integer", "andar integer", "apto integer", "codigo text", "tipo text", "deposito text", "ativo boolean"],
      estoque.enderecos.map((e) => ({ id: e.id, rua: e.rua, predio: e.predio, andar: e.andar, apto: e.apto, codigo: e.codigo, tipo: e.tipo, deposito: e.deposito, ativo: e.ativo })));
    for (const e of estoque.enderecos.filter((x) => x.substituidoPor)) {
      await c.query("UPDATE enderecos SET substituido_por = $1 WHERE id = $2", [e.substituidoPor, e.id]);
    }

    await inserirLista(c, "saldos", ["endereco_id integer", "produto text", "qtd numeric"],
      estoque.saldos.map((s) => ({ endereco_id: s.enderecoId, produto: s.produto, qtd: s.qtd })));

    await inserirLista(c, "associacoes", ["produto text", "endereco_id integer"],
      estoque.associacoes.map((a) => ({ produto: a.produto, endereco_id: a.enderecoId })));

    // Estoque no servidor (v77): o saldo de hoje é o começo do histórico (um movimento "saldo_inicial" por saldo)
    await inserirLista(c, "movimentos", ["tipo text", "produto text", "qtd numeric", "destino_id integer"],
      estoque.saldos.map((s) => ({ tipo: "saldo_inicial", produto: s.produto, qtd: s.qtd, destino_id: s.enderecoId })));
    await semearNotas(c, estoque);

    await inserirLista(c, "pedidos",
      ["id text", "setor text", "cliente text", "cidade text", "prioridade text", "chegada timestamptz", "status text", "separador text",
        "inicio timestamptz", "fim timestamptz", "doca text", "lote text", "posicao_lote text",
        "pedido_pai text", "parte_numero integer", "partes_total integer", "parte_ruas text", "dividido_por text",
        "rota text", "aguardando boolean", "designado_para text", "ordem_fila integer", "designado_em timestamptz", "designado_por text",
        "observacao_pedido text", "observacao_para text[]"],
      pedidos.map((o) => ({
        id: o.id, setor: o.setor, cliente: o.cliente, cidade: o.cidade, prioridade: o.prio, chegada: horaDeHoje(o.hora),
        status: o.status, separador: o.operador, inicio: dataOuNada(o.inicio), fim: dataOuNada(o.fim),
        doca: (typeof o.doca === "object" ? o.doca?.codigo : o.doca) || null, lote: o.lote || null, posicao_lote: o.pos || null,
        pedido_pai: o.parte?.pai || null, parte_numero: o.parte?.n || null, partes_total: o.parte?.de || null,
        parte_ruas: o.parte?.ruas || null, dividido_por: o.parte?.por || null,
        rota: rotaDoPedido(o), aguardando: !!o.aguardando,
        designado_para: FILAS_DE_DEMONSTRACAO[o.id]?.[0] || null, ordem_fila: FILAS_DE_DEMONSTRACAO[o.id]?.[1] || null,
        designado_em: FILAS_DE_DEMONSTRACAO[o.id] ? horaDeHoje(o.hora) : null, designado_por: FILAS_DE_DEMONSTRACAO[o.id] ? "coordenador" : null,
        observacao_pedido: o.obsPedido || null, observacao_para: o.obsPara ?? null,
      })));

    // os itens já vêm na ordem da rota de separação; a posição na lista vira a sequência
    await inserirLista(c, "itens_pedido",
      ["pedido_id text", "sequencia integer", "produto text", "endereco_codigo text", "qtd numeric", "qtd_pedida numeric", "qtd_separada numeric", "status text", "motivo text"],
      pedidos.flatMap((o) => o.itens.map((i, n) => ({
        pedido_id: o.id, sequencia: n + 1, produto: i.sku, endereco_codigo: i.end, qtd: i.qtd, qtd_pedida: i.qtd,
        qtd_separada: i.sep || 0, status: i.status, motivo: i.motivo || "",
      }))));

    await inserirLista(c, "conferencias",
      ["pedido text", "setor text", "designado_para text", "ordem_fila integer", "designado_em timestamptz", "designado_por text", "chegou_em timestamptz"],
      separados.map((o) => ({
        pedido: o.id, setor: o.setor, chegou_em: dataOuNada(o.fim),
        designado_para: FILAS_DA_CONFERENCIA[o.id]?.[0] || null, ordem_fila: FILAS_DA_CONFERENCIA[o.id]?.[1] || null,
        designado_em: FILAS_DA_CONFERENCIA[o.id] ? dataOuNada(o.fim) : null, designado_por: FILAS_DA_CONFERENCIA[o.id] ? "coordenador" : null,
      })));
  });

  return {
    usuarios: USERS.length, produtos: estoque.produtos.length, embalagens: estoque.embalagens.length,
    enderecos: estoque.enderecos.length, saldos: estoque.saldos.length, associacoes: estoque.associacoes.length, pedidos: pedidos.length,
    conferencias: separados.length, notas: estoque.notas.length,
  };
}

// rodando direto pelo terminal
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const pool = conectar();
  const totais = await semear(pool);
  console.log("Demonstração carregada:", Object.entries(totais).map(([k, v]) => `${v} ${k}`).join(", "));
  await pool.end();
}
