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
//   devolver = quanto, já separado, tem que SAIR da caixa e voltar ao estoque (pela doca de devolução)
// O que ainda não foi separado só diminui a quantidade: não há o que devolver.
// O que já foi separado e passou a sobrar vira "a devolver" e é tirado na conferência (bipando).

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

// nova quantidade de um item: número inteiro, de zero até menos do que o cliente quer hoje
export function validarCorte(item, novaQtd) {
  const n = Number(novaQtd);
  if (String(novaQtd).trim() === "" || !Number.isInteger(n) || n < 0) return `${item.sku}: informe um número inteiro (zero ou mais).`;
  if (n >= item.qtd) return `${item.sku}: a nova quantidade tem que ser menor que ${item.qtd}.`;
  return null;
}

// aplica o corte: o que estava na caixa e passou do novo total vira "a devolver"
export function aplicarCorte({ qtd, mantido, devolver = 0 }, novaQtd) {
  const novoMantido = Math.min(mantido, novaQtd);
  return { qtd: novaQtd, mantido: novoMantido, devolver: devolver + (mantido - novoMantido) };
}

// ---------- devolução na Conferência ----------
// devolvido: unidades que o conferente já tirou da caixa (bipando) · postado: já entrou na doca de devolução
export const faltaTirar = (item, devolvido = 0) => Math.max(0, (item.devolver || 0) - devolvido);
export const faltaPostar = (devolvido = 0, postado = 0) => Math.max(0, devolvido - postado);

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
