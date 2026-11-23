// WMS Beach Bike — camada de dados das OCORRÊNCIAS DO PEDIDO (gestor de expedição), na demonstração.
// Corte de item e cancelamento do pedido inteiro, com motivo e referência do Sankhya.
// Uma ocorrência mexe em vários lugares ao mesmo tempo: o pedido na Separação (todas as partes, se dividido),
// a cópia na Conferência (se já chegou lá), a carga do Embarque (cancelado sai da carga) e o Estoque
// (o que sai da caixa vira entrada pendente de devolução).
//
// Quem devolve (decisão de 23/11/2026, ajustada no mesmo dia): quem está com a mercadoria na mão.
//   corte: parte em separação → o separador confirma no coletor; depois da separação (aguardando conferência,
//          em conferência ou conferido) → o conferente tira bipando (F9). Conferido: o pedido é reaberto.
//   cancelamento: cancelado na hora; o que está na caixa vira devolução "aguardando entrega" e quem está com
//          ela (separador ou conferente) só marca "Entregue ao estoque" (marcarEntregue).
// As regras (quanto devolver, quem devolve, o que bloqueia) estão em compartilhado/regras/ocorrencias.js.
// Com servidor, a Gestão usa as funções "…NoServidor" do fim do arquivo (a regra é a mesma, aplicada lá).
import { carregarPedidos, salvarPedidos } from "./separacao.js";
import { carregarConferencia, salvarConferencia } from "./conferencia.js";
import { pedidoEmCarregamento, retirarDasCargas } from "./embarque.js";
import { criarDevolucao, entregarDevolucao, devolucaoAEntregar } from "./recebimento.js";
import { lerQuantidade, arredondarQtd } from "../../compartilhado/regras/quantidade.js";
import {
  etapaDoPedido, bloqueioDaOcorrencia, validarOcorrencia, validarCorte, planejarOcorrencia, quemEstaComAParte,
  confirmarDevolucaoDaLinha, entregaAguardaResponsavel, MSG_SEM_CORTE,
} from "../../compartilhado/regras/ocorrencias.js";

const chave = (setor) => (setor === "mont" ? "wms-bb-ocorr-mont-v1" : "wms-bb-ocorr-v1");
const agora = () => new Date().toISOString();
const mesmoPedido = (o, id) => o.id === id || o.parte?.pai === id;
const PRONTA = (p) => p.status === "concluido";

// histórico das ocorrências do setor (mais novas primeiro), com a situação de cada devolução:
// entregas = [{ numero, aguardando, quem }] (aguardando = o responsável ainda não marcou "Entregue ao estoque")
const lerHistorico = (setor) => { try { return JSON.parse(localStorage.getItem(chave(setor))) || []; } catch { return []; } };
export function lerOcorrencias(setor) {
  return lerHistorico(setor).map((o) => ({ ...o, entregas: (o.entradas || []).map((numero) => {
    const d = devolucaoAEntregar(numero);
    return { numero, aguardando: !!d, quem: d?.quem || null };
  }) }));
}

// o pedido como está agora: as partes da Separação, a cópia da Conferência e quem está com cada parte
function lerPedido(setor, id) {
  const alvo = String(id || "").trim().toUpperCase().replace(/\/\d+$/, ""); // "PV-10426/1" abre o pedido original
  const confDb = carregarConferencia(setor);
  const pedidos = carregarPedidos(setor);
  const partes = pedidos.filter((o) => mesmoPedido(o, alvo));
  const conf = confDb.orders.find((o) => o.id === alvo) || null;
  const statusConf = conf?.conf?.status || null;
  const quem = (p) => quemEstaComAParte({ statusSeparacao: p.status, statusConferencia: PRONTA(p) ? statusConf : null });
  return { alvo, confDb, pedidos, partes, conf, statusConf, quem };
}

// o pedido como o gestor vê: etapa, bloqueio e os itens com quanto o cliente quer, o que está na caixa e o que sai
export function abrirPedido(setor, id) {
  const { alvo, partes, conf, statusConf, quem } = lerPedido(setor, id);
  if (!partes.length && !conf) return null;
  const etapa = etapaDoPedido({ partes, statusConferencia: statusConf, cancelado: !!conf?.cancelado, carregando: pedidoEmCarregamento(alvo) });
  const porSku = new Map();
  for (const p of partes) for (const i of p.itens) {
    const x = porSku.get(i.sku) || { sku: i.sku, desc: i.desc, end: i.end, qtd: 0, mantido: 0, devolver: 0 };
    x.qtd = arredondarQtd(x.qtd + i.qtd);
    x.mantido = arredondarQtd(x.mantido + (i.sep || 0) - (i.devolver || 0));
    x.devolver = arredondarQtd(x.devolver + (i.devolver || 0));
    porSku.set(i.sku, x);
  }
  const base = conf || partes[0];
  return {
    id: alvo, cliente: base.cliente, etapa, bloqueio: bloqueioDaOcorrencia(etapa), itens: [...porSku.values()],
    quem: [...new Set(partes.map(quem))], reaberto: !!conf?.conf?.reaberto,
  };
}

// tipo "corte": cortes = { sku: novaQtd } · tipo "cancelamento": todos os itens vão para zero
export function registrarOcorrencia(setor, id, { tipo, cortes = {}, motivo, referencia, usuario }) {
  const ped = abrirPedido(setor, id);
  if (!ped) return { ok: false, msg: "PEDIDO NÃO ENCONTRADO." };
  if (ped.bloqueio) return { ok: false, msg: ped.bloqueio };
  const erro = validarOcorrencia({ motivo, referencia });
  if (erro) return { ok: false, msg: erro };
  const novas = tipo === "cancelamento" ? {} : Object.fromEntries(Object.entries(cortes).filter(([, v]) => String(v).trim() !== ""));
  if (tipo !== "cancelamento" && !Object.keys(novas).length) return { ok: false, msg: MSG_SEM_CORTE };
  for (const [sku, nova] of Object.entries(novas)) {
    const item = ped.itens.find((i) => i.sku === sku);
    const e = item ? validarCorte(item, nova) : `${sku}: item não está no pedido.`;
    if (e) return { ok: false, msg: e };
  }

  // a fila da conferência é lida ANTES de gravar a separação: senão ela importaria o pedido já mudado
  const { confDb, pedidos, partes, conf, quem } = lerPedido(setor, ped.id);
  const linhas = partes.flatMap((p) => p.itens.map((i, n) => ({
    chave: `${p.id}|${n}`, sku: i.sku, qtd: i.qtd, sep: i.sep || 0, devolver: i.devolver || 0, status: i.status, motivo: i.motivo, quem: quem(p),
    // quem está com a caixa desta parte (cada separador entrega o que pegou)
    dono: quem(p) === "separador" ? p.operador || null : quem(p) === "conferente" ? conf?.conf?.conferente || null : null,
  })));
  const plano = planejarOcorrencia({ tipo, novas: Object.fromEntries(Object.entries(novas).map(([k, v]) => [k, lerQuantidade(v)])), linhas });
  const quando = agora(), registro = { quando, motivo, referencia: String(referencia).trim(), usuario };

  // quem está com a caixa (lido ANTES de mudar o status: o cancelamento tira a parte do separador)
  const nomeDe = {
    gestor: usuario,
    separador: [...new Set(partes.filter((p) => quem(p) === "separador").map((p) => p.operador).filter(Boolean))].join(" + ") || null,
    conferente: conf?.conf?.conferente || null,
  };
  const quemDaParte = new Map(partes.map((p) => [p.id, quem(p)]));

  // 0. Estoque: no corte, só o que ninguém tem na mão vira entrada na hora (Montagem dispensada); no cancelamento,
  //    a devolução de quem está com a caixa espera ele marcar "Entregue ao estoque" (uma por pessoa)
  const entradas = [];
  const descDe = (sku) => ped.itens.find((i) => i.sku === sku)?.desc || "";
  const paraEstoque = (itens) => itens.map((d) => ({ produto: d.sku, qtd: d.qtd }));
  for (const [q, itens] of Object.entries(plano.devolucoes)) {
    if (entregaAguardaResponsavel(tipo, q)) continue; // vem por plano.entregas
    const n = criarDevolucao({ pedido: ped.id, itens: paraEstoque(itens), entreguePor: nomeDe[q] || usuario });
    if (n) entradas.push(n);
  }
  // o que cada responsável vê para entregar: { numero, itens: [{ sku, desc, qtd }] }, por "quem|dono"
  const aEntregarDe = new Map();
  for (const e of plano.entregas) {
    const n = criarDevolucao({ pedido: ped.id, itens: paraEstoque(e.itens), aguardando: { responsavel: e.quem, nome: e.dono || nomeDe[e.quem] } });
    if (!n) continue;
    entradas.push(n);
    aEntregarDe.set(`${e.quem}|${e.dono ?? ""}`, { numero: n.numero, itens: n.itens.map((i) => ({ sku: i.produto, desc: descDe(i.produto), qtd: i.qtd })) });
  }
  const aEntregar = (q, dono = null) => aEntregarDe.get(`${q}|${dono ?? ""}`) || null;

  // 1. Separação: todas as partes do pedido
  const mudadas = new Set();
  for (const m of plano.linhas) {
    const [pid, n] = m.chave.split("|");
    const p = partes.find((x) => x.id === pid), i = p.itens[Number(n)];
    if (i.qtdPedida == null) i.qtdPedida = i.qtd; // a quantidade antes do primeiro corte (o aviso do separador mostra)
    Object.assign(i, { qtd: m.qtd, sep: m.sep, devolver: m.devolver, status: m.status, motivo: m.motivo });
    mudadas.add(p);
  }
  if (tipo === "cancelamento") {
    partes.forEach((p) => Object.assign(p, { status: "cancelado", cancelado: registro, ocorrenciaPendente: false },
      quemDaParte.get(p.id) === "separador" && aEntregar("separador", p.operador) ? { entregar: aEntregar("separador", p.operador) } : {}));
  }
  // o separador confirma no coletor (corte simples ou "devolver item")
  else [...mudadas].filter((p) => quem(p) === "separador").forEach((p) => (p.ocorrenciaPendente = true));
  salvarPedidos(setor, pedidos);

  // 2. Conferência (se o pedido já chegou lá): a cópia dela é refeita a partir das partes
  if (conf) {
    for (const ci of conf.itens) {
      const ls = partes.flatMap((p) => p.itens.filter((i) => i.sku === ci.sku).map((i) => ({ i, pronta: PRONTA(p) || !p.parte })));
      if (!ls.length) continue;
      const prontas = ls.filter((x) => x.pronta);
      ci.qtd = arredondarQtd(ls.reduce((t, x) => t + x.i.qtd, 0));
      ci.sep = arredondarQtd(prontas.reduce((t, x) => t + (x.i.sep || 0) - (x.i.devolver || 0), 0));
      // "devolver" na conferência é o total a tirar (o que já foi entregue fica em conf.postado)
      ci.devolver = arredondarQtd(((conf.conf.postado || {})[ci.sku] || 0) + prontas.reduce((t, x) => t + (x.i.devolver || 0), 0));
    }
    if (tipo === "cancelamento") {
      conf.cancelado = registro;
      // o conferente (de quem está na fila, ou que conferiu) marca "Entregue ao estoque" no posto
      const doConferente = aEntregar("conferente", conf.conf.conferente || null);
      Object.assign(conf.conf, { status: "cancelado", fim: Date.now() }, doConferente ? { entregar: doConferente } : {});
    } else if (plano.avisar.includes("conferente") && (conf.conf.status === "conferido" || conf.conf.status === "divergente")) {
      // já conferido: volta para a fila de quem conferiu tirar da caixa (F9), refazer os volumes e reimprimir as
      // etiquetas. Como no servidor: volumes e observação são refeitos do zero, e o pedido sai da carga.
      Object.assign(conf.conf, { status: "aguardando", fim: null, reaberto: registro, volumes: null, obs: null, erp: null });
      retirarDasCargas(ped.id);
    }
    // o que foi contado nunca passa do que ficou na caixa
    conf.itens.forEach((ci) => { if ((conf.conf.itens[ci.sku] || 0) > ci.sep) conf.conf.itens[ci.sku] = ci.sep; });
    salvarConferencia(setor, confDb);
  }
  // 3. Embarque: cancelado sai da carga
  if (tipo === "cancelamento") retirarDasCargas(ped.id);

  const lista = lerHistorico(setor);
  const resumo = plano.resumo.map((r) => ({ ...r, desc: ped.itens.find((i) => i.sku === r.sku)?.desc || "" }));
  const ocorrencia = { id: (lista[0]?.id || 0) + 1, pedido: ped.id, cliente: ped.cliente, tipo, etapa: ped.etapa, itens: resumo, ...registro,
    avisar: plano.avisar, entradas: entradas.map((n) => n.numero) };
  localStorage.setItem(chave(setor), JSON.stringify([ocorrencia, ...lista]));
  return { ok: true, ocorrencia: lerOcorrencias(setor)[0], pedido: abrirPedido(setor, ped.id) };
}

// Pedido cancelado: quem estava com a caixa marcou "Entregue ao estoque". entregar = o "entregar" da parte (coletor)
// ou da cópia da conferência (posto); quem chamou grava o pedido. Registra quem e quando; a entrada aparece para o
// estoque. Devolve a nota (null se já estava entregue). Com servidor (entrada: false), quem registra é a ação
// "separacao.entregar" / "conferencia.entregar".
export function marcarEntregue(entregar, usuario, { entrada = true } = {}) {
  if (!entregar || entregar.entregue) return null;
  entregar.entregue = { por: usuario, quando: new Date().toISOString() };
  return entrada ? entregarDevolucao(entregar.numero, usuario) : null;
}

// O separador confirmou o pedido do gestor no coletor: o que tinha que sair da caixa vira entrada pendente.
// pedido = o pedido (ou a parte) como o coletor guarda · Devolve a entrada criada (ou null: só corte simples).
// Com servidor (entrada: false), a entrada nasce lá, quando a ação "separacao.ocorrencia" chega.
export function confirmarNaSeparacao(pedido, usuario, { entrada = true } = {}) {
  const saem = [];
  pedido.itens.forEach((i) => {
    if (!(i.devolver > 0)) return;
    saem.push({ produto: i.sku, qtd: i.devolver });
    const r = confirmarDevolucaoDaLinha(i);
    Object.assign(i, { sep: r.sep, devolver: r.devolver, status: r.status, motivo: r.motivo });
  });
  pedido.ocorrenciaPendente = false;
  return { saiu: saem, nota: entrada ? criarDevolucao({ pedido: pedido.parte?.pai || pedido.id, itens: saem, entreguePor: usuario }) : null };
}

// O conferente tirou da caixa (bipando) o que o gestor cortou e entregou ao estoque.
// itens = [{ produto, qtd }] · As partes da Separação também descontam, para a cópia da conferência continuar certa.
export function devolverNaConferencia(setor, pedidoId, itens, conferente) {
  const pedidos = carregarPedidos(setor);
  const partes = pedidos.filter((o) => mesmoPedido(o, pedidoId) && (PRONTA(o) || !o.parte));
  for (const { produto, qtd } of itens) {
    let resta = qtd;
    for (const i of partes.flatMap((p) => p.itens.filter((x) => x.sku === produto && x.devolver > 0))) {
      const x = Math.min(resta, i.devolver);
      const r = confirmarDevolucaoDaLinha({ ...i, devolver: x });
      Object.assign(i, { sep: r.sep, devolver: arredondarQtd(i.devolver - x), status: i.devolver - x > 0 ? i.status : r.status, motivo: r.motivo });
      resta = arredondarQtd(resta - x);
      if (resta <= 0) break;
    }
  }
  salvarPedidos(setor, pedidos);
  return criarDevolucao({ pedido: pedidoId, itens, entreguePor: conferente });
}

// ---------- com servidor (a Gestão de verdade) ----------
// Mesmo formato da demonstração: a regra é aplicada no servidor (server/src/consultas/ocorrencias.js).
async function chamar(sessao, caminho, corpo) {
  let r;
  try {
    r = await fetch(caminho, {
      method: corpo ? "POST" : "GET", cache: "no-store",
      headers: { authorization: `Bearer ${sessao.token}`, ...(corpo ? { "content-type": "application/json" } : {}) },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
  } catch { return { ok: false, msg: "Sem rede. A ocorrência precisa do servidor: tente de novo." }; }
  const dados = await r.json().catch(() => ({}));
  if (!r.ok) return { ok: false, msg: dados.erro || "O servidor não respondeu. Tente de novo." };
  return { ok: true, ...dados };
}
export const abrirPedidoNoServidor = (sessao, setor, id) =>
  chamar(sessao, `api/ocorrencias/pedido?setor=${encodeURIComponent(setor)}&pedido=${encodeURIComponent(String(id).trim())}`);
export const registrarOcorrenciaNoServidor = (sessao, setor, id, dados) =>
  chamar(sessao, "api/ocorrencias", { setor, pedido: id, tipo: dados.tipo, cortes: dados.cortes || {}, motivo: dados.motivo, referencia: dados.referencia });
export const lerOcorrenciasDoServidor = (sessao, setor) => chamar(sessao, `api/ocorrencias?setor=${encodeURIComponent(setor)}`);
