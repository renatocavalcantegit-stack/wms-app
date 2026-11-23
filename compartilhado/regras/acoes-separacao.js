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
//   separacao.ocorrencia { pedido }                                       confirmou o pedido do gestor (corte/devolução, v75)
//
// Pedido do gestor (v75): o corte já está no servidor; o separador confirma e o que tinha que sair da caixa vira
// entrada pendente no estoque (devolverAgora). Se ele separou sem rede a quantidade antiga, o FÍSICO VENCE:
// o servidor aceita o que está na caixa (até a quantidade original) e o que passou vira "a devolver".
//
// O resultado é um destes:
//   { resultado: "aplicada", pedido: {campos que mudam}, itens: [{ sequencia, campos que mudam }], devolverAgora? }
//     devolverAgora = [{ sequencia, qtd }] o que sai da caixa e vira entrada pendente no estoque
//   { resultado: "conflito", motivo }  outro separador já está com o pedido: o coordenador decide
//   { resultado: "recusada", motivo }  ação inválida (item que não existe, quantidade errada...)
//
// Por que gravar o VALOR e não somar? Se o coletor reenviar a mesma ação, o resultado é o mesmo.
import { lerQuantidade, quantidadeValida, formatarQtd, arredondarQtd } from "./quantidade.js";
import { podeSepararNovamente } from "./separacao.js";
import { confirmarDevolucaoDaLinha } from "./ocorrencias.js";

export const TIPOS_DA_SEPARACAO = ["separacao.iniciar", "separacao.item", "separacao.concluir", "separacao.reabrir", "separacao.ocorrencia"];

const aplicada = (pedido = {}, itens = [], devolverAgora = []) => ({ resultado: "aplicada", pedido, itens, ...(devolverAgora.length ? { devolverAgora } : {}) });
export const msgCanceladoPeloGestor = (id) => `O GESTOR CANCELOU O ${id}. ENTREGUE O QUE JÁ SEPAROU AO ESTOQUE.`;
const conflito = (motivo) => ({ resultado: "conflito", motivo });
const recusada = (motivo) => ({ resultado: "recusada", motivo });

// Fila do separador (Fase 1e): o coordenador decide quem separa cada pedido. Se ele passou o pedido para outra
// pessoa (ou devolveu para a caixa de entrada) enquanto o coletor estava sem rede, o que o coletor fez nele é recusado
// e vai para as "não aplicadas" da Gestão. pedido.designadoPara: login do separador da fila, null = caixa de entrada.
// Sem o campo (undefined), não há fila para conferir.
function foraDaFila(pedido, login) {
  if (pedido.designadoPara === undefined || pedido.designadoPara === login) return null;
  const id = pedido.id ?? "pedido";
  return recusada(pedido.designadoPara
    ? `O COORDENADOR PASSOU O ${id} PARA OUTRA PESSOA.`
    : `O COORDENADOR TIROU O ${id} DA SUA FILA.`);
}

// o pedido está com outro separador (ou ainda não foi iniciado): o que esta pessoa fizer nele é conflito
function conflitoDeDono(pedido, login) {
  if (!pedido.separador) return foraDaFila(pedido, login) || conflito("PEDIDO AINDA NÃO FOI INICIADO NO SERVIDOR.");
  if (pedido.separador !== login) return conflito(`PEDIDO JÁ ESTÁ COM ${pedido.separador}.`);
  return null;
}

// acao = { tipo, dados, login, feitaEm } · pedido = { id, status, separador, designadoPara?, statusConferencia? } ou null
// itens = [{ sequencia, qtd, status, qtdPedida?, qtdSeparada?, devolver?, motivo? }] (qtdPedida: a quantidade antes do corte)
// Devolve null quando o tipo não é da Separação (quem chamou decide o que fazer).
export function avaliarAcaoDaSeparacao(acao, pedido, itens) {
  const { tipo, dados = {}, login, feitaEm } = acao;
  if (!TIPOS_DA_SEPARACAO.includes(tipo)) return null;
  if (!pedido) return recusada(`PEDIDO ${dados.pedido ?? ""} NÃO ENCONTRADO.`);

  // cancelado pelo gestor (v75): nada mais muda no pedido. O que o separador pegou sem saber (estava sem rede)
  // volta ao estoque: vira entrada pendente, entregue por ele.
  if (pedido.status === "cancelado") {
    if (tipo === "separacao.ocorrencia") return aplicada();
    if (tipo !== "separacao.item" || pedido.separador !== login) return recusada(msgCanceladoPeloGestor(pedido.id ?? ""));
    const item = itens.find((i) => i.sequencia === Number(dados.sequencia));
    const qtd = lerQuantidade(dados.qtdSeparada);
    if (!item || !quantidadeValida(qtd)) return recusada(msgCanceladoPeloGestor(pedido.id ?? ""));
    const extra = arredondarQtd(qtd - (Number(item.qtdSeparada) || 0));
    return extra > 0 ? aplicada({}, [], [{ sequencia: item.sequencia, qtd: extra }]) : aplicada();
  }

  if (tipo === "separacao.iniciar") {
    if (pedido.status === "concluido") return recusada("PEDIDO JÁ CONCLUÍDO. USE SEPARAR NOVAMENTE.");
    if (pedido.separador && pedido.separador !== login) return conflitoDeDono(pedido, login);
    if (pedido.status === "andamento") return aplicada(); // o mesmo separador voltou ao pedido
    const fila = foraDaFila(pedido, login);
    if (fila) return fila;
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
    const qtd = lerQuantidade(dados.qtdSeparada);
    if (!quantidadeValida(qtd)) return recusada("QUANTIDADE SEPARADA INVÁLIDA (ZERO OU MAIS, ATÉ 3 CASAS).");
    // o gestor cortou o item e o separador (sem rede) separou a quantidade antiga: o físico vence
    const pedida = Number(item.qtdPedida ?? item.qtd);
    if (Number(item.qtd) < pedida && qtd >= Number(item.qtd)) {
      if (qtd > pedida) return recusada(`QUANTIDADE ACIMA DO PEDIDO (${formatarQtd(pedida)}).`);
      const devolver = arredondarQtd(qtd - Number(item.qtd));
      return aplicada(devolver > 0 ? { ocorrenciaPendente: true } : {},
        [{ sequencia: item.sequencia, qtdSeparada: qtd, devolver, status: qtd === 0 ? "cortado" : "ok", motivo: "" }]);
    }
    if (item.status === "cortado") return recusada("ITEM CORTADO PELO GESTOR.");
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

  // separacao.ocorrencia — o separador confirmou o pedido do gestor: o que tinha que sair da caixa saiu
  if (tipo === "separacao.ocorrencia") {
    const dono = conflitoDeDono(pedido, login);
    if (dono) return dono;
    const saem = itens.filter((i) => Number(i.devolver) > 0);
    return aplicada({ ocorrenciaPendente: false },
      saem.map((i) => {
        const r = confirmarDevolucaoDaLinha({ qtd: i.qtd, sep: i.qtdSeparada, devolver: i.devolver, status: i.status, motivo: i.motivo });
        return { sequencia: i.sequencia, qtdSeparada: r.sep, devolver: r.devolver, status: r.status, motivo: r.motivo };
      }),
      saem.map((i) => ({ sequencia: i.sequencia, qtd: Number(i.devolver) })));
  }

  // separacao.reabrir — quem reabre fica com o pedido; o item cortado continua cortado.
  // Só enquanto ninguém começou a conferir (Fase 2: pedido.statusConferencia vem do servidor; sem o campo, não confere).
  if (pedido.status !== "concluido") return recusada("SÓ PEDIDO CONCLUÍDO PODE SER SEPARADO NOVAMENTE.");
  const naConferencia = podeSepararNovamente(pedido.statusConferencia);
  if (naConferencia) return recusada(naConferencia);
  return aplicada(
    { status: "andamento", separador: login, inicio: feitaEm, fim: null, doca: null },
    itens.filter((i) => i.status !== "cortado").map((i) => ({ sequencia: i.sequencia, qtdSeparada: 0, status: "pendente", motivo: "" })),
  );
}
