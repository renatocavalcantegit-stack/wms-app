// SQL das OCORRÊNCIAS DO PEDIDO (v75): o gestor corta item ou cancela o pedido na aba Ocorrências da Gestão.
// Quem decide O QUE muda é a regra pura compartilhado/regras/ocorrencias.js (planejarOcorrencia), a mesma da
// demonstração; aqui só se lê o pedido, chama a regra e grava, tudo numa transação.
//
// Quem devolve é quem está com a mercadoria na mão (decisão de 23/11/2026, ajustada no mesmo dia):
//   corte, parte em separação → o separador confirma no coletor (pedidos.ocorrencia_pendente; ação separacao.ocorrencia)
//   corte depois da separação (aguardando conferência, em conferência ou conferido) → o conferente tira bipando
//          (itens_pedido.qtd_devolver; ação conferencia.devolver). Conferido: volta para a fila de quem conferiu.
//   cancelamento → cancelado na hora; o que está na caixa vira devolução "a_entregar" e quem está com ela
//          marca "Entregue ao estoque" (ações separacao.entregar / conferencia.entregar)
//   fila, ou Montagem com a conferência dispensada → ninguém tem na mão: vale na hora
import { emTransacao } from "../banco.js";
import { criarDevolucao } from "./devolucoes.js";
import { separadoDoPedido } from "./aplicar-conferencia.js";
import {
  etapaDoPedido, bloqueioDaOcorrencia, validarOcorrencia, validarCorte, planejarOcorrencia, quemEstaComAParte,
  entregaAguardaResponsavel, MSG_SEM_CORTE,
} from "../../../compartilhado/regras/ocorrencias.js";
import { lerQuantidade } from "../../../compartilhado/regras/quantidade.js";

// erro que a rota devolve para a tela (404 = não existe, 409 = bloqueado, 400 = dado inválido)
export class ErroDaOcorrencia extends Error {
  constructor(status, mensagem) { super(mensagem); this.status = status; }
}

const arred = (x) => Math.round(Number(x) * 1000) / 1000;

// o pedido inteiro (todas as partes), a conferência e os itens. travar = dentro da transação do registro.
async function lerPedido(conexao, setor, id, travar = false) {
  const alvo = String(id || "").trim().toUpperCase().replace(/\/\d+$/, ""); // "PV-10426/1" abre o pedido original
  const partes = (await conexao.query(
    `SELECT p.* FROM pedidos p
      WHERE p.setor = $1 AND ((p.id = $2 AND p.pedido_pai IS NULL) OR p.pedido_pai = $2)
      ORDER BY p.parte_numero NULLS FIRST, p.id${travar ? " FOR UPDATE" : ""}`,
    [setor, alvo],
  )).rows;
  if (!partes.length) return null;
  const conf = (await conexao.query(`SELECT * FROM conferencias WHERE pedido = $1${travar ? " FOR UPDATE" : ""}`, [alvo])).rows[0] || null;
  const itens = (await conexao.query(
    `SELECT i.*, pr.descricao FROM itens_pedido i JOIN produtos pr ON pr.codigo = i.produto
      WHERE i.pedido_id = ANY($1) ORDER BY i.pedido_id, i.sequencia`,
    [partes.map((p) => p.id)],
  )).rows;
  const statusConf = conf?.status || null;
  const quem = (p) => quemEstaComAParte({ statusSeparacao: p.status, statusConferencia: p.status === "concluido" ? statusConf : null });
  return { alvo, partes, conf, itens, statusConf, quem };
}

// o pedido como o gestor vê (o mesmo formato da demonstração, js/dados/ocorrencias.js → abrirPedido)
function vista({ alvo, partes, conf, itens, statusConf, quem }) {
  const etapa = etapaDoPedido({ partes: partes.map((p) => ({ status: p.status })), statusConferencia: statusConf });
  const porSku = new Map();
  for (const i of itens) {
    const x = porSku.get(i.produto) || { sku: i.produto, desc: i.descricao, end: i.endereco_codigo, qtd: 0, mantido: 0, devolver: 0 };
    x.qtd = arred(x.qtd + Number(i.qtd));
    x.mantido = arred(x.mantido + Number(i.qtd_separada) - Number(i.qtd_devolver));
    x.devolver = arred(x.devolver + Number(i.qtd_devolver));
    porSku.set(i.produto, x);
  }
  return {
    id: alvo, cliente: partes[0].cliente, etapa, bloqueio: bloqueioDaOcorrencia(etapa), itens: [...porSku.values()],
    quem: [...new Set(partes.map(quem))], reaberto: !!conf?.reaberto,
  };
}

export async function abrirPedidoDoGestor(pool, setor, id) {
  const d = await lerPedido(pool, setor, id);
  if (!d) throw new ErroDaOcorrencia(404, `Pedido ${String(id).trim()} não encontrado neste setor.`);
  return vista(d);
}

// a situação de cada devolução da ocorrência: [{ numero, aguardando, quem }]
// aguardando = ainda não entregue (quem = o responsável) · entregue: quem = quem entregou
const ENTREGAS = `coalesce((SELECT json_agg(json_build_object('numero', d.numero, 'aguardando', d.status = 'a_entregar',
            'quem', CASE WHEN d.status = 'a_entregar' THEN coalesce(r.nome, d.responsavel) ELSE coalesce(e.nome, d.entregue_por) END)
            ORDER BY d.id)
       FROM devolucoes d LEFT JOIN usuarios r ON r.login = d.responsavel LEFT JOIN usuarios e ON e.login = d.entregue_por
      WHERE d.numero = ANY(o.entradas)), '[]') AS entregas`;

// histórico do setor, mais novas primeiro (o mesmo formato da demonstração)
export async function listarOcorrencias(pool, setor, id = null) {
  const { rows } = await pool.query(
    `SELECT o.id, o.pedido, o.tipo, o.etapa, o.motivo, o.referencia, o.itens, o.avisar, o.entradas, o.feita_em,
            coalesce(u.nome, o.usuario) AS usuario, ${ENTREGAS}
       FROM ocorrencias o LEFT JOIN usuarios u ON u.login = o.usuario
      WHERE o.setor = $1 AND ($2::int IS NULL OR o.id = $2) ORDER BY o.feita_em DESC, o.id DESC LIMIT 200`,
    [setor, id],
  );
  return rows.map(({ feita_em, ...o }) => ({ ...o, quando: feita_em }));
}

// dados = { setor, pedido, tipo, cortes: { sku: novaQtd }, motivo, referencia } · usuario = { login, nome }
// Devolve { ocorrencia, pedido } ou lança ErroDaOcorrencia.
export async function registrarOcorrencia(pool, dados, usuario) {
  const { setor, tipo, motivo } = dados;
  const referencia = String(dados.referencia || "").trim();
  return emTransacao(pool, async (c) => {
    const d = await lerPedido(c, setor, dados.pedido, true);
    if (!d) throw new ErroDaOcorrencia(404, `Pedido ${String(dados.pedido).trim()} não encontrado neste setor.`);
    const ped = vista(d);
    if (ped.bloqueio) throw new ErroDaOcorrencia(409, ped.bloqueio);
    const erro = validarOcorrencia({ motivo, referencia });
    if (erro) throw new ErroDaOcorrencia(400, erro);
    const novas = tipo === "cancelamento" ? {}
      : Object.fromEntries(Object.entries(dados.cortes || {}).filter(([, v]) => String(v).trim() !== ""));
    if (tipo !== "cancelamento" && !Object.keys(novas).length) throw new ErroDaOcorrencia(400, MSG_SEM_CORTE);
    for (const [sku, nova] of Object.entries(novas)) {
      const item = ped.itens.find((i) => i.sku === sku);
      const e = item ? validarCorte(item, nova) : `${sku}: item não está no pedido.`;
      if (e) throw new ErroDaOcorrencia(400, e);
    }

    const parteDe = new Map(d.partes.map((p) => [p.id, p]));
    const linhas = d.itens.map((i) => ({
      chave: `${i.pedido_id}|${i.sequencia}`, sku: i.produto, qtd: Number(i.qtd), sep: Number(i.qtd_separada), devolver: Number(i.qtd_devolver),
      status: i.status, motivo: i.motivo, quem: d.quem(parteDe.get(i.pedido_id)),
      // quem está com a caixa desta parte (cada separador entrega o que pegou; o conferente, o que está no posto)
      dono: (() => {
        const p = parteDe.get(i.pedido_id), q = d.quem(p);
        return q === "separador" ? p.separador || null : q === "conferente" ? d.conf?.conferente || d.conf?.designado_para || null : null;
      })(),
    }));
    const plano = planejarOcorrencia({ tipo, novas: Object.fromEntries(Object.entries(novas).map(([k, v]) => [k, lerQuantidade(v)])), linhas });
    const registro = { quando: new Date().toISOString(), motivo, referencia, usuario: usuario.nome || usuario.login };

    // 1. os itens (todas as partes); qtd_pedida guarda a quantidade antes do primeiro corte
    const mudadas = new Set();
    for (const m of plano.linhas) {
      const [pid, seq] = m.chave.split("|");
      await c.query(
        `UPDATE itens_pedido SET qtd_pedida = coalesce(qtd_pedida, qtd), qtd = $3, qtd_separada = $4, qtd_devolver = $5, status = $6, motivo = $7
          WHERE pedido_id = $1 AND sequencia = $2`,
        [pid, Number(seq), m.qtd, m.sep, m.devolver, m.status, m.motivo],
      );
      mudadas.add(pid);
    }
    // 2. as partes: cancelado sai de tudo; corte em separação espera o separador confirmar
    const ids = d.partes.map((p) => p.id);
    if (tipo === "cancelamento") {
      await c.query("UPDATE pedidos SET status = 'cancelado', cancelado = $2, ocorrencia_pendente = false WHERE id = ANY($1)", [ids, registro]);
    } else {
      const doSeparador = d.partes.filter((p) => mudadas.has(p.id) && d.quem(p) === "separador").map((p) => p.id);
      if (doSeparador.length) await c.query("UPDATE pedidos SET ocorrencia_pendente = true WHERE id = ANY($1)", [doSeparador]);
    }
    // 3. a conferência
    if (d.conf && tipo === "cancelamento") {
      await c.query("UPDATE conferencias SET status = 'cancelado', cancelado = $2, fim = now() WHERE pedido = $1", [d.alvo, registro]);
    } else if (d.conf && plano.avisar.includes("conferente") && ["conferido", "divergente"].includes(d.conf.status)) {
      // já conferido: volta para a fila de quem conferiu tirar da caixa (F9), refazer volumes e reimprimir etiquetas
      await c.query(
        `UPDATE conferencias SET status = 'aguardando', reaberto = $2, designado_para = coalesce(conferente, designado_para),
                conferente = NULL, inicio = NULL, fim = NULL, volumes = NULL, observacao = NULL, posto = NULL WHERE pedido = $1`,
        [d.alvo, registro],
      );
    }
    if (d.conf && tipo !== "cancelamento") {
      // o que foi contado nunca passa do que ficou na caixa
      const ficou = new Map((await separadoDoPedido(c, d.alvo)).map((x) => [x.produto, Number(x.qtd)]));
      for (const [produto, qtd] of ficou) {
        await c.query("UPDATE conferencia_itens SET qtd_conferida = $3 WHERE pedido = $1 AND produto = $2 AND qtd_conferida > $3", [d.alvo, produto, qtd]);
      }
    }
    // 4. o que sai da caixa agora: no corte, só o que ninguém tem na mão (entrada na hora); no cancelamento, a
    //    devolução de quem está com a caixa espera ele marcar "Entregue ao estoque" (a_entregar), uma por pessoa.
    //    Na caixa de entrada da conferência, sem ninguém: o responsável é quem o gestor designar (quadro).
    const entradas = [];
    const paraEstoque = (itens) => itens.map((x) => ({ produto: x.sku, qtd: x.qtd }));
    for (const [q, itens] of Object.entries(plano.devolucoes)) {
      if (entregaAguardaResponsavel(tipo, q)) continue; // vem por plano.entregas
      const numero = await criarDevolucao(c, {
        pedido: d.alvo, setor, origem: tipo === "cancelamento" ? "cancelamento" : q, entreguePor: usuario.login, itens: paraEstoque(itens),
      });
      if (numero) entradas.push(numero);
    }
    for (const e of plano.entregas) {
      const numero = await criarDevolucao(c, {
        pedido: d.alvo, setor, origem: e.quem, aEntregar: true, responsavel: e.dono, itens: paraEstoque(e.itens),
      });
      if (numero) entradas.push(numero);
    }
    // 5. o histórico
    const resumo = plano.resumo.map((r) => ({ ...r, desc: ped.itens.find((i) => i.sku === r.sku)?.desc || "" }));
    const o = (await c.query(
      `INSERT INTO ocorrencias (pedido, setor, tipo, etapa, motivo, referencia, usuario, itens, avisar, entradas)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id, feita_em`,
      [d.alvo, setor, tipo, ped.etapa, motivo, referencia, usuario.login, JSON.stringify(resumo), plano.avisar, entradas],
    )).rows[0];
    const [ocorrencia] = await listarOcorrencias(c, setor, o.id);
    return { ocorrencia, pedido: vista(await lerPedido(c, setor, d.alvo)) };
  });
}
