// SQL do quadro da Separação na Gestão (Fase 1e): caixa de entrada, fila de cada separador, rota e lotes.
// Quem decide as travas é a regra pura compartilhado/regras/fila-do-separador.js; aqui só se lê, chama a regra e grava.
// Tudo o que muda roda numa transação, com as linhas dos pedidos travadas (FOR UPDATE): se dois coordenadores
// mexerem no mesmo pedido ao mesmo tempo, o segundo espera o primeiro terminar e vê o resultado dele.
import { randomBytes } from "node:crypto";
import { emTransacao } from "../banco.js";
import { travaParaMover, novaOrdem, unidadeDoPedido } from "../../../compartilhado/regras/fila-do-separador.js";
import { validarLote, posicoesDoLote } from "../../../compartilhado/regras/separacao.js";
import { ehPrioridade, precisaDeRota } from "../../../compartilhado/regras/aguardando.js";
import { rota as rotaPeloId } from "../../../compartilhado/regras/rotas.js";

// erro que a rota da API devolve para a tela (409 = a trava não deixou; 404 = não existe)
export class ErroDoQuadro extends Error {
  constructor(mensagem, status = 409) { super(mensagem); this.status = status; }
}

// pedido do banco → o que a regra pura espera (a Montagem não tem rota: conta como OP)
const paraRegra = (p, setor) => ({
  id: p.id, status: p.status, rota: p.rota, aguardando: p.aguardando, op: setor === "mont",
  lote: p.lote, parte: p.pedido_pai, prio: ehPrioridade({ aguardando: p.aguardando, prio: p.prioridade }, setor) ? "alta" : "normal",
  chegada: new Date(p.chegada).toISOString(),
});

// Tudo o que o quadro mostra, numa chamada só. Devolve { agora, pedidos, separadores }.
//   pedidos: os que ainda não foram separados (caixa de entrada e filas), com o andamento de quem está separando
//   separadores: todos os ativos, com o último contato do coletor e quantos separaram hoje
export async function quadroDaSeparacao(pool, setor) {
  const agora = (await pool.query("SELECT now() AS agora")).rows[0].agora;
  const pedidos = (await pool.query(
    `SELECT p.id, p.cliente, p.cidade, p.prioridade, p.chegada, p.status, p.separador, u.nome AS separador_nome,
            p.inicio, p.designado_para, p.ordem_fila, p.rota, p.aguardando, p.lote, p.posicao_lote,
            p.pedido_pai, p.parte_numero, p.partes_total, p.parte_ruas,
            count(i.*)::int                                              AS itens,
            count(i.*) FILTER (WHERE i.status <> 'pendente')::int        AS itens_feitos,
            coalesce(sum(i.qtd), 0)                                      AS unidades,
            coalesce(sum(i.qtd_separada) FILTER (WHERE i.status <> 'pendente'), 0) AS unidades_feitas,
            (SELECT json_build_object('endereco', ia.endereco_codigo, 'descricao', pr.descricao)
               FROM itens_pedido ia JOIN produtos pr ON pr.codigo = ia.produto
              WHERE ia.pedido_id = p.id AND ia.status = 'pendente'
              ORDER BY ia.sequencia LIMIT 1)                             AS item_atual
       FROM pedidos p
       LEFT JOIN usuarios u ON u.login = p.separador
       LEFT JOIN itens_pedido i ON i.pedido_id = p.id
      WHERE p.setor = $1 AND p.status <> 'concluido'
      GROUP BY p.id, u.nome
      ORDER BY p.designado_para NULLS FIRST, p.ordem_fila NULLS LAST, p.chegada, p.id`,
    [setor],
  )).rows;

  const separadores = (await pool.query(
    `SELECT u.login, u.nome,
            (SELECT max(s.ultimo_contato) FROM sessoes s
              WHERE s.login = u.login AND s.encerrada_em IS NULL AND s.expira_em > now()) AS ultimo_contato,
            EXISTS (SELECT 1 FROM sessoes s
              WHERE s.login = u.login AND s.encerrada_em IS NULL AND s.expira_em > now()) AS conectado,
            (SELECT count(*)::int FROM pedidos x
              WHERE x.separador = u.login AND x.setor = $1 AND x.status = 'concluido' AND x.fim >= current_date) AS separados_hoje
       FROM usuarios u
      WHERE u.perfil = 'sep' AND u.ativo
      ORDER BY u.nome`,
    [setor],
  )).rows;

  return { agora, pedidos, separadores };
}

// pedidos de uma unidade (o pedido sozinho ou todos os do lote), travados até o fim da transação
async function travarUnidade(c, setor, unidade) {
  return (await c.query(
    "SELECT * FROM pedidos WHERE setor = $1 AND (id = $2 OR lote = $2) ORDER BY posicao_lote, id FOR UPDATE",
    [setor, unidade],
  )).rows;
}

// Muda a unidade (pedido ou lote) de fila. para = login do separador, null = volta para a caixa de entrada.
// ordem = como a coluna de destino ficou na tela depois de soltar (unidades: pedidos e lotes).
export async function moverNoQuadro(pool, { setor, unidade, para, ordem = [], por }) {
  return emTransacao(pool, async (c) => {
    let pedidos = await travarUnidade(c, setor, unidade);
    // pedido que está num lote anda com o lote inteiro
    if (pedidos.length === 1 && pedidos[0].lote) { unidade = pedidos[0].lote; pedidos = await travarUnidade(c, setor, unidade); }
    if (!pedidos.length) throw new ErroDoQuadro("Pedido não encontrado.", 404);
    const trava = travaParaMover(pedidos.map((p) => paraRegra(p, setor)), para, setor);
    if (trava) throw new ErroDoQuadro(trava);

    if (!para) {
      await c.query(
        `UPDATE pedidos SET designado_para = NULL, ordem_fila = NULL, designado_em = now(), designado_por = $3
          WHERE setor = $1 AND (id = $2 OR lote = $2)`,
        [setor, unidade, por],
      );
      return { ok: true };
    }

    const separador = (await c.query("SELECT 1 FROM usuarios WHERE login = $1 AND perfil = 'sep' AND ativo", [para])).rowCount;
    if (!separador) throw new ErroDoQuadro("Separador não encontrado.", 404);

    // a fila de destino como está agora (só o que ainda não começou: o que está em separação fica no alto da coluna)
    const fila = (await c.query(
      `SELECT id, lote FROM pedidos
        WHERE setor = $1 AND designado_para = $2 AND status = 'pendente' AND id <> ALL($3) AND (lote IS NULL OR lote <> $4)
        ORDER BY ordem_fila NULLS LAST, chegada, id
        FOR UPDATE`,
      [setor, para, pedidos.map((p) => p.id), unidade],
    )).rows;
    const filaAtual = [...new Set(fila.map(unidadeDoPedido))];
    const ordemNova = novaOrdem(filaAtual, unidade, ordem);

    await c.query(
      `UPDATE pedidos SET designado_para = $3, designado_em = now(), designado_por = $4
        WHERE setor = $1 AND (id = $2 OR lote = $2)`,
      [setor, unidade, para, por],
    );
    // numera a fila: 1 = o próximo (os pedidos do mesmo lote ficam com o mesmo número)
    for (const [n, u] of ordemNova.entries()) {
      await c.query("UPDATE pedidos SET ordem_fila = $3 WHERE setor = $1 AND (id = $2 OR lote = $2) AND status = 'pendente'", [setor, u, n + 1]);
    }
    return { ok: true };
  });
}

// O coordenador definiu a rota do pedido que chegou sem rota (só na expedição).
export async function definirRota(pool, { setor, pedido, rota }) {
  if (setor !== "exp") throw new ErroDoQuadro("Na Montagem o pedido não tem rota.");
  if (!rotaPeloId(rota)) throw new ErroDoQuadro("Rota desconhecida.", 400);
  return emTransacao(pool, async (c) => {
    const p = (await c.query("SELECT id, status, aguardando FROM pedidos WHERE id = $1 AND setor = $2 FOR UPDATE", [pedido, setor])).rows[0];
    if (!p) throw new ErroDoQuadro("Pedido não encontrado.", 404);
    if (p.aguardando) throw new ErroDoQuadro(`${p.id} é aguardando (o cliente retira): não tem rota.`);
    if (p.status === "concluido") throw new ErroDoQuadro(`${p.id} já foi separado.`);
    await c.query("UPDATE pedidos SET rota = $2 WHERE id = $1", [p.id, rota]);
    return { ok: true };
  });
}

// código do lote: "L-" e 4 letras/números (o coletor também cria lotes, com outro formato; o banco não deixa repetir)
const codigoDeLote = () => "L-" + randomBytes(3).toString("hex").toUpperCase().slice(0, 4);

// O coordenador agrupou pedidos da caixa de entrada num lote (uma viagem só, uma caixa por pedido no carrinho).
// Devolve { id, posicoes }.
export async function criarLote(pool, { setor, pedidos: ids }) {
  return emTransacao(pool, async (c) => {
    const linhas = (await c.query("SELECT * FROM pedidos WHERE setor = $1 AND id = ANY($2) ORDER BY id FOR UPDATE", [setor, ids])).rows;
    if (linhas.length !== new Set(ids).size) throw new ErroDoQuadro("Pedido não encontrado.", 404);
    const ps = linhas.map((p) => paraRegra(p, setor));
    const erro = validarLote(ps)
      || (linhas.some((p) => p.designado_para) ? "Só pedidos da caixa de entrada entram no lote." : null)
      || (setor === "exp" && ps.some((p) => precisaDeRota(p)) ? "Defina a rota dos pedidos antes de agrupar." : null);
    if (erro) throw new ErroDoQuadro(erro);

    let id;
    do id = codigoDeLote();
    while ((await c.query("SELECT 1 FROM pedidos WHERE lote = $1", [id])).rowCount);
    const posicoes = posicoesDoLote(ps);
    for (const p of linhas) await c.query("UPDATE pedidos SET lote = $2, posicao_lote = $3 WHERE id = $1", [p.id, id, posicoes[p.id]]);
    return { id, posicoes };
  });
}

// Desfaz o lote antes de começar: cada pedido volta a andar sozinho, no mesmo lugar (caixa ou fila).
export async function desfazerLote(pool, { setor, lote }) {
  return emTransacao(pool, async (c) => {
    const pedidos = (await c.query("SELECT id, status FROM pedidos WHERE setor = $1 AND lote = $2 FOR UPDATE", [setor, lote])).rows;
    if (!pedidos.length) throw new ErroDoQuadro("Lote não encontrado.", 404);
    if (pedidos.some((p) => p.status !== "pendente")) throw new ErroDoQuadro("Lote já começou: não dá para desfazer.");
    await c.query("UPDATE pedidos SET lote = NULL, posicao_lote = NULL WHERE setor = $1 AND lote = $2", [setor, lote]);
    return { ok: true, pedidos: pedidos.map((p) => p.id) };
  });
}
