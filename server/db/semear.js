// Apaga os dados e carrega a demonstração no banco. Uso: npm run semear
// Usa os MESMOS arquivos de demonstração do app (js/demo-*.js), então o banco e as telas mostram o mesmo estoque.
import { pathToFileURL } from "node:url";
import { conectar, emTransacao } from "../src/banco.js";
import { gerarHash } from "../src/senha.js";
import { USERS } from "../../js/sessao.js";
import { estoqueDeDemonstracao, seedSeparacao, seedSeparacaoMont } from "../../js/demo-dados.js";

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

export async function semear(pool) {
  const estoque = estoqueDeDemonstracao();
  const pedidos = [
    ...seedSeparacao().map((o) => ({ ...o, setor: "exp" })),
    ...seedSeparacaoMont().map((o) => ({ ...o, setor: "mont" })),
  ];

  await emTransacao(pool, async (c) => {
    // começa do zero (a ordem não importa com CASCADE)
    await c.query("TRUNCATE acoes_recebidas, sessoes, usuarios, itens_pedido, pedidos, associacoes, saldos, embalagens, enderecos, produtos CASCADE");

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

    await inserirLista(c, "pedidos",
      ["id text", "setor text", "cliente text", "cidade text", "prioridade text", "chegada timestamptz", "status text", "separador text",
        "inicio timestamptz", "fim timestamptz", "doca text", "lote text", "posicao_lote text",
        "pedido_pai text", "parte_numero integer", "partes_total integer", "parte_ruas text", "dividido_por text"],
      pedidos.map((o) => ({
        id: o.id, setor: o.setor, cliente: o.cliente, cidade: o.cidade, prioridade: o.prio, chegada: horaDeHoje(o.hora),
        status: o.status, separador: o.operador, inicio: dataOuNada(o.inicio), fim: dataOuNada(o.fim),
        doca: o.doca || null, lote: o.lote || null, posicao_lote: o.pos || null,
        pedido_pai: o.parte?.pai || null, parte_numero: o.parte?.n || null, partes_total: o.parte?.de || null,
        parte_ruas: o.parte?.ruas || null, dividido_por: o.parte?.por || null,
      })));

    // os itens já vêm na ordem da rota de separação; a posição na lista vira a sequência
    await inserirLista(c, "itens_pedido",
      ["pedido_id text", "sequencia integer", "produto text", "endereco_codigo text", "qtd numeric", "qtd_separada numeric", "status text", "motivo text"],
      pedidos.flatMap((o) => o.itens.map((i, n) => ({
        pedido_id: o.id, sequencia: n + 1, produto: i.sku, endereco_codigo: i.end, qtd: i.qtd,
        qtd_separada: i.sep || 0, status: i.status, motivo: i.motivo || "",
      }))));
  });

  return {
    usuarios: USERS.length, produtos: estoque.produtos.length, embalagens: estoque.embalagens.length,
    enderecos: estoque.enderecos.length, saldos: estoque.saldos.length, associacoes: estoque.associacoes.length, pedidos: pedidos.length,
  };
}

// rodando direto pelo terminal
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const pool = conectar();
  const totais = await semear(pool);
  console.log("Demonstração carregada:", Object.entries(totais).map(([k, v]) => `${v} ${k}`).join(", "));
  await pool.end();
}
