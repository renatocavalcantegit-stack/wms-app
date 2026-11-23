// WMS Beach Bike — camada de dados das OCORRÊNCIAS DO PEDIDO (gestor de expedição), na demonstração.
// Corte de item e cancelamento do pedido inteiro, com motivo e referência do Sankhya.
// Uma ocorrência mexe em vários lugares ao mesmo tempo: o pedido na Separação (todas as partes, se dividido),
// a cópia na Conferência (se já chegou lá), a carga do Embarque (cancelado sai da carga) e o Estoque
// (o que sai da caixa vira entrada pendente de devolução).
//
// Quem devolve (decisão de 23/11/2026): quem está com a mercadoria na mão.
//   parte em separação → o separador confirma no coletor · em conferência → o conferente tira bipando (F9)
//   fila, separado aguardando conferência ou conferido → o próprio gestor (a entrada nasce na hora)
// Cancelamento: sempre o gestor; o que já saiu da prateleira vira entrada na hora.
// As regras (quanto devolver, quem devolve, o que bloqueia) estão em compartilhado/regras/ocorrencias.js.
// Com servidor, a Gestão usa as funções "…NoServidor" do fim do arquivo (a regra é a mesma, aplicada lá).
import { carregarPedidos, salvarPedidos } from "./separacao.js";
import { carregarConferencia, salvarConferencia } from "./conferencia.js";
import { pedidoEmCarregamento, retirarDasCargas } from "./embarque.js";
import { criarDevolucao } from "./recebimento.js";
import { lerQuantidade, arredondarQtd } from "../../compartilhado/regras/quantidade.js";
import {
  etapaDoPedido, bloqueioDaOcorrencia, validarOcorrencia, validarCorte, planejarOcorrencia, quemEstaComAParte,
  confirmarDevolucaoDaLinha, MSG_SEM_CORTE,
} from "../../compartilhado/regras/ocorrencias.js";

const chave = (setor) => (setor === "mont" ? "wms-bb-ocorr-mont-v1" : "wms-bb-ocorr-v1");
const agora = () => new Date().toISOString();
const mesmoPedido = (o, id) => o.id === id || o.parte?.pai === id;
const PRONTA = (p) => p.status === "concluido";

// histórico das ocorrências do setor (mais novas primeiro)
export function lerOcorrencias(setor) {
  try { return JSON.parse(localStorage.getItem(chave(setor))) || []; } catch { return []; }
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
  })));
  const plano = planejarOcorrencia({ tipo, novas: Object.fromEntries(Object.entries(novas).map(([k, v]) => [k, lerQuantidade(v)])), linhas });
  const quando = agora(), registro = { quando, motivo, referencia: String(referencia).trim(), usuario };

  // quem entrega ao estoque o que sair da caixa (lido ANTES de mudar o status: o cancelamento tira a parte do separador)
  const nomeDe = {
    gestor: usuario,
    separador: [...new Set(partes.filter((p) => quem(p) === "separador").map((p) => p.operador).filter(Boolean))].join(" + ") || usuario,
    conferente: conf?.conf?.conferente || usuario,
  };

  // 1. Separação: todas as partes do pedido
  const mudadas = new Set();
  for (const m of plano.linhas) {
    const [pid, n] = m.chave.split("|");
    const p = partes.find((x) => x.id === pid), i = p.itens[Number(n)];
    if (i.qtdPedida == null) i.qtdPedida = i.qtd; // a quantidade antes do primeiro corte (o aviso do separador mostra)
    Object.assign(i, { qtd: m.qtd, sep: m.sep, devolver: m.devolver, status: m.status, motivo: m.motivo });
    mudadas.add(p);
  }
  if (tipo === "cancelamento") partes.forEach((p) => Object.assign(p, { status: "cancelado", cancelado: registro, ocorrenciaPendente: false }));
  // o separador confirma no coletor (corte simples ou "devolver item")
  else [...mudadas].filter((p) => quem(p) === "separador").forEach((p) => (p.ocorrenciaPendente = true));
  salvarPedidos(setor, pedidos);

  // 2. Conferência (se o pedido já chegou lá): a cópia dela é refeita a partir das partes
  const doGestor = (plano.devolucoes.gestor || []).reduce((t, d) => t + d.qtd, 0);
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
      Object.assign(conf.conf, { status: "cancelado", fim: Date.now() });
    } else if (doGestor > 0 && (conf.conf.status === "conferido" || conf.conf.status === "divergente")) {
      // já conferido: o gestor tirou da caixa; o pedido volta para refazer os volumes e reimprimir as etiquetas
      // como no servidor: volumes e observação são refeitos do zero
      Object.assign(conf.conf, { status: "aguardando", fim: null, reaberto: registro, volumes: null, obs: null, erp: null });
    }
    // o que foi contado nunca passa do que ficou na caixa
    conf.itens.forEach((ci) => { if ((conf.conf.itens[ci.sku] || 0) > ci.sep) conf.conf.itens[ci.sku] = ci.sep; });
    salvarConferencia(setor, confDb);
  }
  // 3. Embarque: cancelado sai da carga
  if (tipo === "cancelamento") retirarDasCargas(ped.id);

  // 4. Estoque: o que saiu da caixa agora vira entrada pendente, entregue por quem estava com ela
  const entradas = Object.entries(plano.devolucoes).map(([q, itens]) =>
    criarDevolucao({ pedido: ped.id, itens: itens.map((d) => ({ produto: d.sku, qtd: d.qtd })), entreguePor: nomeDe[q] })).filter(Boolean);

  const lista = lerOcorrencias(setor);
  const resumo = plano.resumo.map((r) => ({ ...r, desc: ped.itens.find((i) => i.sku === r.sku)?.desc || "" }));
  const ocorrencia = { id: (lista[0]?.id || 0) + 1, pedido: ped.id, cliente: ped.cliente, tipo, etapa: ped.etapa, itens: resumo, ...registro,
    avisar: plano.avisar, entradas: entradas.map((n) => n.numero) };
  localStorage.setItem(chave(setor), JSON.stringify([ocorrencia, ...lista]));
  return { ok: true, ocorrencia, pedido: abrirPedido(setor, ped.id) };
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
