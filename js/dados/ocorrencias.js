// WMS Beach Bike — camada de dados das OCORRÊNCIAS DO PEDIDO (gestor de expedição).
// Corte de item e cancelamento do pedido inteiro, com motivo e referência do Sankhya.
// Uma ocorrência mexe em vários lugares ao mesmo tempo: o pedido na Separação (todas as partes, se dividido),
// a cópia na Conferência (se já chegou lá) e a carga do Embarque (cancelado sai da carga).
// As regras (quanto devolver, em que etapa o pedido está, o que bloqueia) estão em compartilhado/regras/ocorrencias.js.
import { carregarPedidos, salvarPedidos } from "./separacao.js";
import { carregarConferencia, salvarConferencia } from "./conferencia.js";
import { pedidoEmCarregamento, retirarDasCargas } from "./embarque.js";
import {
  etapaDoPedido, bloqueioDaOcorrencia, validarOcorrencia, validarCorte, aplicarCorte, MSG_SEM_CORTE,
} from "../../compartilhado/regras/ocorrencias.js";

const chave = (setor) => (setor === "mont" ? "wms-bb-ocorr-mont-v1" : "wms-bb-ocorr-v1");
const agora = () => new Date().toISOString();
const mesmoPedido = (o, id) => o.id === id || o.parte?.pai === id;

// histórico das ocorrências do setor (mais novas primeiro)
export function lerOcorrencias(setor) {
  try { return JSON.parse(localStorage.getItem(chave(setor))) || []; } catch { return []; }
}

// o pedido como o gestor vê: etapa, bloqueio e os itens com quanto o cliente quer, o que está na caixa e o que volta
export function abrirPedido(setor, id) {
  const alvo = String(id || "").trim().toUpperCase();
  const partes = carregarPedidos(setor).filter((o) => mesmoPedido(o, alvo));
  const conf = carregarConferencia(setor).orders.find((o) => o.id === alvo) || null;
  if (!partes.length && !conf) return null;
  const etapa = etapaDoPedido({ partes, statusConferencia: conf?.conf?.status || null, carregando: pedidoEmCarregamento(alvo) });
  // depois que chegou na Conferência, a cópia dela é a mais atual; antes, os itens das partes da Separação
  const itens = conf
    ? conf.itens.map((i) => ({ sku: i.sku, desc: i.desc, end: i.end, qtd: i.qtd, mantido: i.sep, devolver: i.devolver || 0 }))
    : partes.flatMap((p) => p.itens.map((i) => ({ sku: i.sku, desc: i.desc, end: i.end, qtd: i.qtd, mantido: i.sep - (i.devolver || 0), devolver: i.devolver || 0, status: i.status })));
  const base = conf || partes[0];
  return { id: alvo, cliente: base.cliente, etapa, bloqueio: bloqueioDaOcorrencia(etapa), itens, reaberto: !!conf?.conf?.reaberto };
}

// tipo "corte": cortes = { sku: novaQtd } · tipo "cancelamento": todos os itens vão para zero
export function registrarOcorrencia(setor, id, { tipo, cortes = {}, motivo, referencia, usuario }) {
  const ped = abrirPedido(setor, id);
  if (!ped) return { ok: false, msg: "PEDIDO NÃO ENCONTRADO." };
  if (ped.bloqueio) return { ok: false, msg: ped.bloqueio };
  const erro = validarOcorrencia({ motivo, referencia });
  if (erro) return { ok: false, msg: erro };
  const novas = tipo === "cancelamento"
    ? Object.fromEntries(ped.itens.filter((i) => i.qtd > 0).map((i) => [i.sku, 0]))
    : Object.fromEntries(Object.entries(cortes).filter(([, v]) => String(v).trim() !== ""));
  if (tipo !== "cancelamento" && !Object.keys(novas).length) return { ok: false, msg: MSG_SEM_CORTE };
  for (const [sku, nova] of Object.entries(novas)) {
    const item = ped.itens.find((i) => i.sku === sku);
    const e = item ? validarCorte(item, nova) : `${sku}: item não está no pedido.`;
    if (e) return { ok: false, msg: e };
  }

  const quando = agora(), registro = { quando, motivo, referencia: String(referencia).trim(), usuario };
  // o que muda em cada item, visto ANTES de mexer (vai para o histórico)
  const resumo = Object.entries(novas).map(([sku, nova]) => {
    const i = ped.itens.find((x) => x.sku === sku);
    return { sku, desc: i.desc, de: i.qtd, para: Number(nova), devolver: aplicarCorte(i, Number(nova)).devolver };
  });
  // a fila da conferência é lida ANTES de gravar a separação: senão ela importaria o pedido já cortado e cortaria de novo
  const confDb = carregarConferencia(setor);
  // 1. Separação: todas as partes do pedido
  const pedidos = carregarPedidos(setor);
  const partes = pedidos.filter((o) => mesmoPedido(o, ped.id));
  for (const [sku, nova] of Object.entries(novas)) {
    for (const p of partes) {
      const i = p.itens.find((x) => x.sku === sku); if (!i) continue;
      const r = aplicarCorte({ qtd: i.qtd, mantido: i.sep - (i.devolver || 0), devolver: i.devolver || 0 }, Number(nova));
      Object.assign(i, { qtd: r.qtd, devolver: r.devolver });
      // ainda não separado e zerado: o separador pula; falta que o corte cobriu deixa de ser falta
      if (i.status === "pendente" && r.qtd === 0) i.status = "cortado";
      else if (i.status === "falta" && r.mantido >= r.qtd) Object.assign(i, { status: "ok", motivo: "" });
    }
  }
  if (tipo === "cancelamento") {
    for (const p of partes) {
      p.cancelado = registro;
      // nada foi separado ainda: o pedido simplesmente sai da separação
      if (p.itens.every((i) => !i.sep)) p.status = "cancelado";
    }
  }
  salvarPedidos(setor, pedidos);

  // 2. Conferência (se o pedido já chegou lá)
  const conf = confDb.orders.find((o) => o.id === ped.id);
  if (conf) {
    for (const [sku, nova] of Object.entries(novas)) {
      const i = conf.itens.find((x) => x.sku === sku); if (!i) continue;
      const r = aplicarCorte({ qtd: i.qtd, mantido: i.sep, devolver: i.devolver || 0 }, Number(nova));
      Object.assign(i, { qtd: r.qtd, sep: r.mantido, devolver: r.devolver });
    }
    if (tipo === "cancelamento") conf.cancelado = registro;
    const fisico = conf.itens.some((i) => i.sep > 0 || (i.devolver || 0) > 0);
    if (tipo === "cancelamento" && !fisico) conf.conf.status = "cancelado";
    // já conferido: volta para a fila, para tirar o que sai e refazer volumes e etiquetas
    else if (conf.conf.status === "conferido" || conf.conf.status === "divergente") {
      Object.assign(conf.conf, { status: "aguardando", fim: null, reaberto: registro });
    }
    salvarConferencia(setor, confDb);
  }
  // 3. Embarque: cancelado sai da carga
  if (tipo === "cancelamento") retirarDasCargas(ped.id);

  const lista = lerOcorrencias(setor);
  const ocorrencia = { id: (lista[0]?.id || 0) + 1, pedido: ped.id, cliente: ped.cliente, tipo, etapa: ped.etapa, itens: resumo, ...registro };
  localStorage.setItem(chave(setor), JSON.stringify([ocorrencia, ...lista]));
  return { ok: true, ocorrencia, pedido: abrirPedido(setor, ped.id) };
}
