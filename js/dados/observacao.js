// WMS Beach Bike — camada de dados da OBSERVAÇÃO DO PEDIDO (v76): quem leu e o que respondeu.
// As respostas ficam guardadas no aparelho: na demonstração, é daqui que a Gestão lê; com servidor, a resposta
// também vai pela fila de envio (ação "observacao.ciente") e o servidor devolve as respostas junto com o pedido.
// Guardar no aparelho também garante o offline: respondeu sem rede, não pergunta de novo.
// As regras (quem é obrigado, em que momento) estão em compartilhado/regras/observacao.js.
import { faltaResponder } from "../../compartilhado/regras/observacao.js";

const CHAVE = "wms-bb-obs-ciencias-v1";
const ler = () => { try { const d = JSON.parse(localStorage.getItem(CHAVE)); return Array.isArray(d) ? d : []; } catch { return []; } };
const mesma = (a, b) => a.pedido === b.pedido && (a.parte ?? null) === (b.parte ?? null) && a.login === b.login
  && a.papel === b.papel && a.momento === b.momento;

// pedido = o pedido original (PV-10426) · parte = a parte do dividido (PV-10426/1) ou null
export function registrarCiencia({ pedido, parte = null, login, nome, papel, momento, resposta }) {
  const nova = { pedido, parte, login, nome, papel, momento, resposta, feita_em: new Date().toISOString() };
  localStorage.setItem(CHAVE, JSON.stringify([...ler().filter((c) => !mesma(c, nova)), nova]));
  return nova;
}

// as respostas de um pedido original: as do servidor (quando houver) mais as deste aparelho que ainda não chegaram lá
export function cienciasDoPedido(pedido, doServidor = []) {
  const locais = ler().filter((c) => c.pedido === pedido && !doServidor.some((s) => mesma({ ...s, pedido }, c)));
  return [...doServidor.map((s) => ({ ...s, pedido })), ...locais].sort((a, b) => Date.parse(a.feita_em) - Date.parse(b.feita_em));
}

// o pedido (como o coletor e o posto guardam: { id, parte?, obsPedido, obsPara, ciencias? }) ainda pede a leitura
// desta pessoa neste momento?
export function precisaLer(o, { login, papel, momento }) {
  if (!o) return false;
  const pedido = o.parte?.pai || o.id;
  return faltaResponder({
    texto: o.obsPedido, para: o.obsPara, ciencias: cienciasDoPedido(pedido, o.ciencias || []),
    login, papel, momento, parte: o.parte ? o.id : null,
  });
}

// "reiniciar demonstração": as respostas começam do zero
export const apagarCiencias = () => localStorage.removeItem(CHAVE);
