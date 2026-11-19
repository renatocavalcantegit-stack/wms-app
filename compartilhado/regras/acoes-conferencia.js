// WMS Beach Bike — AÇÕES DA CONFERÊNCIA que o posto manda ao servidor (Fase 2).
// Função pura: recebe a ação, a conferência, o que foi separado e o que já foi contado, e devolve o que muda.
// Não lê nem grava nada. O servidor usa para aplicar no banco (server/src/consultas/aplicar-conferencia.js).
// É o mesmo jeito das ações da Separação (acoes-separacao.js).
//
//   conferencia.iniciar   { pedido }                                        "Iniciar conferência" no posto
//   conferencia.contagem  { pedido, produto, qtd }                          quanto foi contado do produto (o valor atual)
//   conferencia.finalizar { pedido, volumes, observacao, posto, contagens } finalizou (contagens = tudo o que contou)
//   conferencia.volumes   { pedido, volumes, observacao }                   corrigiu os volumes de um pedido conferido
//   conferencia.reabrir   { pedido }                                        "conferir novamente" um pedido conferido
//
// Resultado: { resultado: "aplicada", conferencia: {campos que mudam}, contagens: [{ produto, qtd, fora }], zerar? }
//            { resultado: "conflito", motivo }   outro conferente já está com o pedido
//            { resultado: "recusada", motivo }   ação inválida
// Por que gravar o VALOR e não somar? Se o posto reenviar a mesma ação, o resultado é o mesmo.
import { lerQuantidade, quantidadeValida, arredondarQtd } from "./quantidade.js";

export const TIPOS_DA_CONFERENCIA = ["conferencia.iniciar", "conferencia.contagem", "conferencia.finalizar", "conferencia.volumes", "conferencia.reabrir"];
export const FINALIZADA = ["conferido", "divergente"];

const aplicada = (conferencia = {}, contagens = [], extra = {}) => ({ resultado: "aplicada", conferencia, contagens, ...extra });
const conflito = (motivo) => ({ resultado: "conflito", motivo });
const recusada = (motivo) => ({ resultado: "recusada", motivo });

// Fila do conferente: o coordenador passou o pedido para outra pessoa (ou devolveu para a caixa) enquanto o posto
// estava sem rede. designadoPara: login do conferente da fila, null = caixa de entrada; undefined = sem fila.
function foraDaFila(c, login) {
  if (c.designadoPara === undefined || c.designadoPara === login) return null;
  return recusada(c.designadoPara
    ? `O COORDENADOR PASSOU O ${c.pedido} PARA OUTRA PESSOA.`
    : `O COORDENADOR TIROU O ${c.pedido} DA SUA FILA.`);
}
function conflitoDeDono(c, login) {
  if (!c.conferente) return foraDaFila(c, login) || conflito("CONFERÊNCIA AINDA NÃO FOI INICIADA NO SERVIDOR.");
  if (c.conferente !== login) return conflito(`PEDIDO JÁ ESTÁ COM ${c.conferente}.`);
  return null;
}

// Com divergência: algum produto contado diferente do separado, ou produto fora do pedido.
// esperado = [{ produto, qtd }] · contagens = [{ produto, qtd, fora }]
export function temDivergencia(esperado, contagens) {
  const contado = new Map(contagens.filter((x) => !x.fora).map((x) => [x.produto, arredondarQtd(Number(x.qtd))]));
  if (contagens.some((x) => x.fora && Number(x.qtd) > 0)) return true;
  return esperado.some((e) => arredondarQtd(Number(e.qtd)) !== (contado.get(e.produto) ?? 0));
}

// lê uma contagem que veio do posto: { produto, qtd } → { produto, qtd, fora } ou a mensagem de erro
function lerContagem(x, esperado) {
  const produto = String(x?.produto ?? "").trim();
  if (!produto) return "INFORME O PRODUTO.";
  const qtd = lerQuantidade(x.qtd);
  if (!quantidadeValida(qtd)) return "QUANTIDADE CONFERIDA INVÁLIDA (ZERO OU MAIS, ATÉ 3 CASAS).";
  return { produto, qtd, fora: !esperado.some((e) => e.produto === produto) };
}

// volumes: na expedição, pelo menos 1 (etiqueta e observação); na Montagem não há volumes
function lerVolumes(setor, dados) {
  if (setor === "mont") return { volumes: null, observacao: null };
  const volumes = Number(dados.volumes);
  if (!Number.isInteger(volumes) || volumes < 1) return "INFORME A QUANTIDADE DE VOLUMES (1 OU MAIS).";
  const o = dados.observacao;
  if (!o || typeof o !== "object") return "INFORME A OBSERVAÇÃO DOS VOLUMES.";
  return { volumes, observacao: o };
}

// acao = { tipo, dados, login, feitaEm } · conferencia = { pedido, setor, status, conferente, designadoPara? } ou null
// esperado = o que foi separado, por produto · contagens = o que já está contado
// Devolve null quando o tipo não é da Conferência.
export function avaliarAcaoDaConferencia(acao, conferencia, esperado = [], contagens = []) {
  const { tipo, dados = {}, login, feitaEm } = acao;
  if (!TIPOS_DA_CONFERENCIA.includes(tipo)) return null;
  const c = conferencia;
  if (!c) return recusada(`PEDIDO ${dados.pedido ?? ""} NÃO ESTÁ NA CONFERÊNCIA (A SEPARAÇÃO AINDA NÃO TERMINOU).`);

  if (tipo === "conferencia.iniciar") {
    if (FINALIZADA.includes(c.status)) return recusada("PEDIDO JÁ CONFERIDO. USE CONFERIR NOVAMENTE.");
    if (c.conferente && c.conferente !== login) return conflitoDeDono(c, login);
    if (c.status === "andamento") return aplicada(); // o mesmo conferente voltou ao pedido
    const fila = foraDaFila(c, login);
    if (fila) return fila;
    return aplicada({ status: "andamento", conferente: login, inicio: feitaEm });
  }

  if (tipo === "conferencia.contagem") {
    const dono = conflitoDeDono(c, login);
    if (dono) return dono;
    if (c.status !== "andamento") return recusada("PEDIDO NÃO ESTÁ EM CONFERÊNCIA.");
    const x = lerContagem(dados, esperado);
    if (typeof x === "string") return recusada(x);
    return aplicada({}, [x]);
  }

  if (tipo === "conferencia.finalizar") {
    const dono = conflitoDeDono(c, login);
    if (dono) return dono;
    if (FINALIZADA.includes(c.status)) return aplicada(); // reenvio
    if (c.status !== "andamento") return recusada("PEDIDO NÃO ESTÁ EM CONFERÊNCIA.");
    const v = lerVolumes(c.setor, dados);
    if (typeof v === "string") return recusada(v);
    // as contagens da finalização valem por tudo (o posto manda o que contou de cada produto)
    const lidas = (Array.isArray(dados.contagens) ? dados.contagens : []).map((x) => lerContagem(x, esperado));
    const erro = lidas.find((x) => typeof x === "string");
    if (erro) return recusada(erro);
    const status = temDivergencia(esperado, lidas) ? "divergente" : "conferido";
    return aplicada({ status, fim: feitaEm, posto: dados.posto ? String(dados.posto) : null, ...v }, lidas, { zerar: true });
  }

  if (tipo === "conferencia.volumes") {
    const dono = conflitoDeDono(c, login);
    if (dono) return dono;
    if (!FINALIZADA.includes(c.status)) return recusada("SÓ PEDIDO CONFERIDO TEM VOLUMES PARA CORRIGIR.");
    const v = lerVolumes(c.setor, dados);
    if (typeof v === "string") return recusada(v);
    return aplicada(v);
  }

  // conferencia.reabrir — quem reabre fica com o pedido; as contagens voltam a zero
  if (!FINALIZADA.includes(c.status)) return recusada("SÓ PEDIDO CONFERIDO PODE SER CONFERIDO NOVAMENTE.");
  const fila = foraDaFila(c, login);
  if (fila) return fila;
  return aplicada({ status: "andamento", conferente: login, inicio: feitaEm, fim: null, volumes: null, observacao: null }, [], { zerar: true });
}
