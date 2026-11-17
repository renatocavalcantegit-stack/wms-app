// WMS Beach Bike — AÇÕES DA SEPARAÇÃO que o coletor manda ao servidor (Fase 1).
// Função pura: recebe a ação, o pedido e os itens como estão AGORA e devolve o que muda.
// Não lê nem grava nada. O servidor usa para aplicar no banco (server/src/consultas/aplicar-acoes.js),
// e o coletor vai usar para saber o resultado antes mesmo de ter rede (testes em testes/acoes-separacao.test.js).
//
// As quatro ações, uma para cada coisa que o separador faz no coletor:
//   separacao.iniciar  { pedido, lote?, posicao? }                       abriu o pedido (sozinho ou num lote)
//   separacao.item     { pedido, sequencia, qtdSeparada, status, motivo? } confirmou um item (ok) ou registrou falta
//   separacao.concluir { pedido, doca }                                   leu o QR da doca de expedição
//   separacao.reabrir  { pedido }                                         "separar novamente" um pedido concluído
//
// O resultado é um destes:
//   { resultado: "aplicada", pedido: {campos que mudam}, itens: [{ sequencia, campos que mudam }] }
//   { resultado: "conflito", motivo }  outro separador já está com o pedido: o coordenador decide
//   { resultado: "recusada", motivo }  ação inválida (item que não existe, quantidade errada...)
//
// Por que gravar o VALOR e não somar? Se o coletor reenviar a mesma ação, o resultado é o mesmo.
import { lerQuantidade, quantidadeValida, formatarQtd } from "./quantidade.js";

export const TIPOS_DA_SEPARACAO = ["separacao.iniciar", "separacao.item", "separacao.concluir", "separacao.reabrir"];

const aplicada = (pedido = {}, itens = []) => ({ resultado: "aplicada", pedido, itens });
const conflito = (motivo) => ({ resultado: "conflito", motivo });
const recusada = (motivo) => ({ resultado: "recusada", motivo });

// o pedido está com outro separador (ou ainda não foi iniciado): o que esta pessoa fizer nele é conflito
function conflitoDeDono(pedido, login) {
  if (!pedido.separador) return conflito("PEDIDO AINDA NÃO FOI INICIADO NO SERVIDOR.");
  if (pedido.separador !== login) return conflito(`PEDIDO JÁ ESTÁ COM ${pedido.separador}.`);
  return null;
}

// acao = { tipo, dados, login, feitaEm } · pedido = { status, separador } ou null · itens = [{ sequencia, qtd, status }]
// Devolve null quando o tipo não é da Separação (quem chamou decide o que fazer).
export function avaliarAcaoDaSeparacao(acao, pedido, itens) {
  const { tipo, dados = {}, login, feitaEm } = acao;
  if (!TIPOS_DA_SEPARACAO.includes(tipo)) return null;
  if (!pedido) return recusada(`PEDIDO ${dados.pedido ?? ""} NÃO ENCONTRADO.`);

  if (tipo === "separacao.iniciar") {
    if (pedido.status === "concluido") return recusada("PEDIDO JÁ CONCLUÍDO. USE SEPARAR NOVAMENTE.");
    if (pedido.separador && pedido.separador !== login) return conflitoDeDono(pedido, login);
    if (pedido.status === "andamento") return aplicada(); // o mesmo separador voltou ao pedido
    const muda = { status: "andamento", separador: login, inicio: feitaEm };
    if (dados.lote) Object.assign(muda, { lote: dados.lote, posicaoLote: dados.posicao ?? null });
    return aplicada(muda);
  }

  if (tipo === "separacao.item") {
    const dono = conflitoDeDono(pedido, login);
    if (dono) return dono;
    if (pedido.status !== "andamento") return recusada("PEDIDO NÃO ESTÁ EM SEPARAÇÃO.");
    const item = itens.find((i) => i.sequencia === Number(dados.sequencia));
    if (!item) return recusada(`ITEM ${dados.sequencia} NÃO EXISTE NO PEDIDO.`);
    if (item.status === "cortado") return recusada("ITEM CORTADO PELO GESTOR.");
    const qtd = lerQuantidade(dados.qtdSeparada);
    if (!quantidadeValida(qtd)) return recusada("QUANTIDADE SEPARADA INVÁLIDA (ZERO OU MAIS, ATÉ 3 CASAS).");
    if (qtd > item.qtd) return recusada(`QUANTIDADE ACIMA DO PEDIDO (${formatarQtd(item.qtd)}).`);
    if (dados.status === "ok") {
      if (qtd !== item.qtd) return recusada("ITEM COMPLETO TEM QUE TER A QUANTIDADE DO PEDIDO. MENOS QUE ISSO É FALTA.");
      return aplicada({}, [{ sequencia: item.sequencia, qtdSeparada: qtd, status: "ok", motivo: "" }]);
    }
    if (dados.status === "falta") {
      if (qtd >= item.qtd) return recusada("FALTA TEM QUE SER MENOR QUE A QUANTIDADE DO PEDIDO.");
      const motivo = String(dados.motivo ?? "").trim();
      if (!motivo) return recusada("INFORME O MOTIVO DA FALTA.");
      return aplicada({}, [{ sequencia: item.sequencia, qtdSeparada: qtd, status: "falta", motivo }]);
    }
    return recusada("STATUS DO ITEM TEM QUE SER ok OU falta.");
  }

  if (tipo === "separacao.concluir") {
    const dono = conflitoDeDono(pedido, login);
    if (dono) return dono;
    if (pedido.status === "concluido") return aplicada(); // reenvio
    if (pedido.status !== "andamento") return recusada("PEDIDO NÃO ESTÁ EM SEPARAÇÃO.");
    const doca = String(dados.doca ?? "").trim();
    if (!doca) return recusada("INFORME A DOCA DE EXPEDIÇÃO.");
    if (itens.some((i) => i.status === "pendente")) return recusada("AINDA HÁ ITEM PENDENTE NO PEDIDO.");
    return aplicada({ status: "concluido", fim: feitaEm, doca });
  }

  // separacao.reabrir — quem reabre fica com o pedido; o item cortado continua cortado.
  // (Conferir se a conferência ainda não começou entra quando a Conferência passar pelo servidor.)
  if (pedido.status !== "concluido") return recusada("SÓ PEDIDO CONCLUÍDO PODE SER SEPARADO NOVAMENTE.");
  return aplicada(
    { status: "andamento", separador: login, inicio: feitaEm, fim: null, doca: null },
    itens.filter((i) => i.status !== "cortado").map((i) => ({ sequencia: i.sequencia, qtdSeparada: 0, status: "pendente", motivo: "" })),
  );
}
