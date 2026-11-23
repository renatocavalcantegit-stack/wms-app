// WMS Beach Bike — regras das OCORRÊNCIAS DO PEDIDO (corte de item, cancelamento e devolução).
// Funções puras: não leem nem gravam nada.
//
// Por que existe: o cliente pode desistir de um item, ou do pedido inteiro, com o pedido já andando no WMS.
// O Sankhya NÃO reenvia o pedido alterado (decisão de segurança): o gestor de expedição recebe o aviso e
// registra a ocorrência aqui, com o motivo e a referência do Sankhya.
//
// Ideia central: cada item tem
//   qtd      = quanto o cliente quer agora (cai com o corte)
//   mantido  = quanto, já separado, continua na caixa do pedido
//   devolver = quanto, já separado, tem que SAIR da caixa e voltar ao estoque (vira entrada pendente no estoque)
// O que ainda não foi separado só diminui a quantidade: não há o que devolver.
// O que já foi separado e passou a sobrar sai da caixa pelas mãos de quem está com ela (ver planejarOcorrencia).
import { lerQuantidade, quantidadeValida, arredondarQtd, formatarQtd } from "./quantidade.js";

export const MOTIVOS_OCORRENCIA = {
  desistencia: "Cliente desistiu",
  alteracao: "Pedido alterado no Sankhya",
  outro: "Outro motivo",
};

// em que ponto o pedido está, do ponto de vista do gestor
export const ETAPAS_PEDIDO = {
  "aguardando-separacao": "Aguardando separação",
  separacao: "Em separação",
  "aguardando-conferencia": "Separado · aguardando conferência",
  conferencia: "Em conferência",
  conferido: "Conferido",
  carregamento: "Em carregamento",
  cancelado: "Cancelado",
};

export const MSG_PEDIDO_CANCELADO = "PEDIDO JÁ ESTÁ CANCELADO.";
export const MSG_EM_CARREGAMENTO = "PEDIDO JÁ ESTÁ SENDO CARREGADO NO EMBARQUE. TRATE DIRETO COM O EMBARQUE.";
export const MSG_SEM_MOTIVO = "Escolha o motivo da ocorrência.";
export const MSG_SEM_REFERENCIA = "Informe a referência do Sankhya (nº da alteração ou do cancelamento).";
export const MSG_SEM_CORTE = "Informe a nova quantidade de pelo menos um item.";

// partes: pedidos da Separação (1, ou várias se o pedido foi dividido) · conf: status na Conferência (ou null)
// carregando: algum volume do pedido já foi bipado no Embarque
export function etapaDoPedido({ partes = [], statusConferencia = null, cancelado = false, carregando = false }) {
  if (cancelado || statusConferencia === "cancelado" || (partes.length && partes.every((p) => p.status === "cancelado"))) return "cancelado";
  if (carregando) return "carregamento";
  if (statusConferencia === "conferido" || statusConferencia === "divergente") return "conferido";
  if (statusConferencia === "andamento") return "conferencia";
  if (statusConferencia === "aguardando") return "aguardando-conferencia";
  if (partes.length && partes.every((p) => p.status === "pendente")) return "aguardando-separacao";
  if (partes.length && partes.every((p) => p.status === "concluido")) return "aguardando-conferencia";
  return "separacao";
}

// o gestor só não age quando o pedido já foi cancelado ou já está subindo no caminhão
export function bloqueioDaOcorrencia(etapa) {
  if (etapa === "cancelado") return MSG_PEDIDO_CANCELADO;
  if (etapa === "carregamento") return MSG_EM_CARREGAMENTO;
  return null;
}

export function validarOcorrencia({ motivo, referencia }) {
  if (!MOTIVOS_OCORRENCIA[motivo]) return MSG_SEM_MOTIVO;
  if (!String(referencia || "").trim()) return MSG_SEM_REFERENCIA;
  return null;
}

// nova quantidade de um item (pode ser quebrada, até 3 casas): de zero até menos do que o cliente quer hoje
export function validarCorte(item, novaQtd) {
  const n = lerQuantidade(novaQtd); // "19,5" → 19.5
  if (!quantidadeValida(n)) return `${item.sku}: informe a nova quantidade (zero ou mais, até 3 casas depois da vírgula).`;
  if (n >= item.qtd) return `${item.sku}: a nova quantidade tem que ser menor que ${formatarQtd(item.qtd)}.`;
  return null;
}

// aplica o corte: o que estava na caixa e passou do novo total vira "a devolver"
export function aplicarCorte({ qtd, mantido, devolver = 0 }, novaQtd) {
  const novoMantido = Math.min(mantido, novaQtd);
  return { qtd: novaQtd, mantido: novoMantido, devolver: arredondarQtd(devolver + (mantido - novoMantido)) };
}

// ---------- quem devolve (decisão de 23/11/2026, ajustada no mesmo dia) ----------
// Quem está com a mercadoria na mão é quem devolve, e toda devolução vira uma ENTRADA PENDENTE no estoque.
// Fica registrado quem pegou a mercadoria e quem a entregou ao estoque (rastreabilidade).
// CORTE de item:
//   parte ainda não iniciada            → ninguém (nada separado: só diminui)
//   parte em separação                  → separador confirma no coletor (corte simples ou "devolver item")
//   separada, aguardando a conferência  → conferente: a fila mostra "Item a devolver" e o posto abre direto no F9
//   em conferência                      → conferente tira da caixa bipando (F9)
//   conferida                           → conferente: o pedido é reaberto na fila de quem conferiu, ele tira (F9),
//                                         refaz os volumes e reimprime as etiquetas (e o pedido sai da carga)
// CANCELAMENTO: o pedido fica cancelado na hora. Ninguém bipa: o WMS gera a devolução com o que está na caixa,
// "aguardando entrega", e o responsável (separador no coletor; conferente no posto) só marca "Entregue ao estoque".
// A entrada só aparece para o estoque depois de entregue.
// "gestor" sobra para o que ninguém tem na mão (fila; Montagem com a conferência dispensada): vale na hora.
export const QUEM_DEVOLVE = { gestor: "Gestor", separador: "Separador", conferente: "Conferente" };
export function quemEstaComAParte({ statusSeparacao, statusConferencia = null }) {
  if (statusSeparacao === "andamento") return "separador";
  if (statusSeparacao === "concluido" && statusConferencia !== "dispensada") return "conferente";
  return "gestor";
}
// o cancelamento gera a devolução "aguardando entrega" para quem está com a caixa (o gestor não tem nada na mão)
export const entregaAguardaResponsavel = (tipo, quem) => tipo === "cancelamento" && quem !== "gestor";

// O que a ocorrência muda, linha por linha (cada linha = um item de uma parte do pedido).
// linhas = [{ chave, sku, qtd, sep, devolver, status, motivo, quem, dono? }]
//   dono     = quem está com a caixa daquela linha (login ou nome): cada pessoa entrega a sua parte
//   sep      = o que está na caixa (inclui o que ainda tem que sair)
//   devolver = o que ainda tem que sair da caixa (pedido do gestor que o separador/conferente não confirmou)
// tipo "corte": novas = { sku: novaQtd } (já validadas) · tipo "cancelamento": tudo vai a zero
// Devolve:
//   linhas     [{ chave, qtd, sep, devolver, status, motivo }] as que mudaram
//   devolucoes { gestor|separador|conferente: [{ sku, qtd }] } o que sai da caixa AGORA: no corte, só o do gestor
//              (entrada na hora); no cancelamento, de todos (separador/conferente: "aguardando entrega")
//   entregas   [{ quem, dono, itens: [{ sku, qtd }] }] cancelamento: uma devolução "aguardando entrega" por pessoa
//              (dois separadores com partes do mesmo pedido: cada um entrega a sua)
//   avisar     ["separador", "conferente"] quem tem que confirmar no aparelho
//   resumo     [{ sku, de, para, devolver }] para o histórico
export function planejarOcorrencia({ tipo, novas = {}, linhas }) {
  const mudou = [], devolucoes = {}, avisar = new Set(), resumo = new Map(), porDono = new Map();
  const juntar = (lista, sku, qtd) => {
    const x = lista.find((d) => d.sku === sku);
    if (x) x.qtd = arredondarQtd(x.qtd + qtd); else lista.push({ sku, qtd: arredondarQtd(qtd) });
  };
  const somar = (quem, sku, qtd, dono = null) => {
    if (!(qtd > 0)) return;
    juntar((devolucoes[quem] ||= []), sku, qtd);
    if (tipo !== "cancelamento" || !entregaAguardaResponsavel(tipo, quem)) return;
    const k = `${quem}|${dono ?? ""}`;
    if (!porDono.has(k)) porDono.set(k, { quem, dono: dono ?? null, itens: [] });
    juntar(porDono.get(k).itens, sku, qtd);
  };
  const anotar = (sku, de, para, devolver) => {
    const r = resumo.get(sku) || { sku, de: 0, para: 0, devolver: 0 };
    r.de = arredondarQtd(r.de + de); r.para = arredondarQtd(r.para + para); r.devolver = arredondarQtd(r.devolver + devolver);
    resumo.set(sku, r);
  };
  // a nova quantidade de um produto se distribui pelas linhas dele, na ordem
  const restante = Object.fromEntries(Object.entries(novas).map(([sku, n]) => [sku, lerQuantidade(n)]));

  for (const l of linhas) {
    const sep = Number(l.sep) || 0, pend = Number(l.devolver) || 0, qtd = Number(l.qtd) || 0;
    if (tipo === "cancelamento") {
      if (!qtd && !sep) continue;
      // tudo o que está na caixa volta ao estoque: quem está com ela marca "Entregue ao estoque"
      somar(l.quem, l.sku, sep, l.dono);
      mudou.push({ chave: l.chave, qtd: 0, sep: 0, devolver: 0, status: "cortado", motivo: "" });
      anotar(l.sku, qtd, 0, sep);
      continue;
    }
    if (!(l.sku in restante)) continue;
    const nova = Math.min(restante[l.sku], qtd);
    restante[l.sku] = arredondarQtd(restante[l.sku] - nova);
    if (nova === qtd) continue;
    const r = aplicarCorte({ qtd, mantido: arredondarQtd(sep - pend), devolver: pend }, nova);
    let novoSep = sep, novoDev = r.devolver;
    if (l.quem === "gestor") { somar("gestor", l.sku, r.devolver); novoSep = r.mantido; novoDev = 0; }
    else avisar.add(l.quem);
    let status = l.status, motivo = l.motivo || "";
    if (r.qtd === 0 && arredondarQtd(novoSep - novoDev) === 0 && (status === "pendente" || novoSep === 0)) status = "cortado";
    else if (status === "falta" && r.mantido >= r.qtd) { status = "ok"; motivo = ""; }
    mudou.push({ chave: l.chave, qtd: r.qtd, sep: novoSep, devolver: novoDev, status, motivo });
    anotar(l.sku, qtd, r.qtd, arredondarQtd(r.devolver - pend));
  }
  return { linhas: mudou, devolucoes, entregas: [...porDono.values()], avisar: [...avisar], resumo: [...resumo.values()] };
}

// o separador (ou o conferente) confirmou: o que tinha que sair saiu da caixa e vai para o estoque
export function confirmarDevolucaoDaLinha({ qtd, sep, devolver = 0, status, motivo = "" }) {
  const novoSep = arredondarQtd((Number(sep) || 0) - (Number(devolver) || 0));
  if (Number(qtd) === 0 && novoSep === 0) return { sep: 0, devolver: 0, status: "cortado", motivo: "" };
  if (status === "falta" && novoSep >= Number(qtd)) return { sep: novoSep, devolver: 0, status: "ok", motivo: "" };
  return { sep: novoSep, devolver: 0, status, motivo };
}

// o corte que o separador vê no aviso: itens com quantidade menor que a do pedido original
// itens = [{ sku, desc, qtd, qtdPedida, devolver, status }]
export const itensCortados = (itens) => itens.filter((i) => i.qtdPedida != null && Number(i.qtd) < Number(i.qtdPedida));

// ---------- devolução na Conferência ----------
// devolvido: unidades que o conferente já tirou da caixa (bipando) · postado: já entrou na doca de devolução
export const faltaTirar = (item, devolvido = 0) => Math.max(0, arredondarQtd((item.devolver || 0) - devolvido));
export const faltaPostar = (devolvido = 0, postado = 0) => Math.max(0, arredondarQtd(devolvido - postado));

// o pedido só finaliza depois que tudo o que tinha que sair saiu E entrou na doca de devolução
export function devolucaoPendente(itens, postados = {}) {
  return itens.some((i) => (i.devolver || 0) > (postados[i.sku] || 0));
}

// bipe no modo devolução: quanto conta (nunca mais do que falta tirar daquele item)
export const MSG_NADA_A_DEVOLVER = "ESTE PRODUTO NÃO TEM NADA A DEVOLVER NESTE PEDIDO.";
export function lerDevolucao(item, devolvido, qtd) {
  if (!item || faltaTirar(item, devolvido) <= 0) return { ok: false, msg: MSG_NADA_A_DEVOLVER };
  return { ok: true, qtd: Math.min(Number(qtd) || 1, faltaTirar(item, devolvido)) };
}

// doca de devolução: onde o que saiu do pedido espera o estoquista armazenar
export const MSG_NAO_E_DOCA_DEVOLUCAO = "ENDEREÇO NÃO É A DOCA DE DEVOLUÇÃO. LEIA O QR DA DOCA DE DEVOLUÇÃO.";
export function validarDocaDevolucao(endereco) {
  if (!endereco || !endereco.ativo || endereco.tipo !== "devolucao") return MSG_NAO_E_DOCA_DEVOLUCAO;
  return null;
}
