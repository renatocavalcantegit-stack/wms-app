// WMS Beach Bike — PEDIDO DIVIDIDO NA CONFERÊNCIA (v72).
// O pedido entra na conferência quando a PRIMEIRA parte termina a separação (qualquer uma: a 2/2 pode chegar antes
// da 1/2). O conferente já confere o que chegou, pode voltar à fila e conferir outro pedido enquanto espera,
// e só FINALIZA quando todas as partes terminaram. Continua sendo uma conferência só (um jogo de volumes e etiquetas).
//
// Usado pelo posto (conferencia.js), pela Gestão (gestao-conferencia-real.js) e pelo servidor (acoes-conferencia.js).
// Função pura: não lê nem grava nada.

// partes = [{ n, de, pronta, operador }] · pronta === false = ainda em separação (sem o campo = pronta)
export const partesEmSeparacao = (partes = []) => partes.filter((p) => p.pronta === false);

// "1/2" · "1/3 e 3/3"
export function rotuloDasPartes(partes) {
  const r = partes.map((p) => `${p.n}/${p.de}`);
  return r.length > 1 ? `${r.slice(0, -1).join(", ")} e ${r[r.length - 1]}` : r[0] || "";
}

// o item ainda não chegou: só existe nas partes em separação (nada separado nas partes prontas)
export const itemEmEspera = (i) => !(Number(i.sep) > 0) && (i.espera || []).length > 0;

// mensagens do posto
export function msgAguardandoPartes(partes) {
  const espera = partesEmSeparacao(partes);
  const quem = [...new Set(espera.map((p) => p.operador).filter(Boolean))].join(", ");
  const parte = espera.length > 1 ? `as partes ${rotuloDasPartes(espera)}` : `a parte ${rotuloDasPartes(espera)}`;
  return `Aguardando ${parte}${quem ? ` (${quem})` : ""} terminar a separação · pode voltar à fila (F2)`;
}
export const msgItemEmEspera = (i) =>
  `Este item é da parte ${(i.espera || []).join(" e ")}, ainda em separação. Confira quando a parte chegar.`;

// servidor: finalizar com parte em separação é recusado. espera = ["1/2", ...]
export function msgFinalizarComPartes(pedido, espera) {
  return espera.length > 1
    ? `AS PARTES ${espera.join(", ")} DO ${pedido} AINDA ESTÃO EM SEPARAÇÃO.`
    : `A PARTE ${espera[0]} DO ${pedido} AINDA ESTÁ EM SEPARAÇÃO.`;
}
