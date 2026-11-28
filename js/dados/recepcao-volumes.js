// WMS Beach Bike — os VOLUMES (palete ou caixa) da Conferência no coletor, enquanto são montados (v80).
//
// Decisões de 28/11/2026: o conferente cria os volumes e imprime as etiquetas antes; vincula os produtos a cada
// volume e, quando quiser, endereça o volume inteiro numa doca. Até ser endereçado o volume existe SÓ NESTE
// APARELHO (funciona sem rede; outro coletor não continua um volume que este começou). Endereçado, ele sai daqui:
// com servidor vai pela fila (js/dados/recepcao.js); na demonstração entra direto (js/dados/recebimento.js).
// Funciona igual com e sem servidor.
import { gravarNoAparelho } from "./armazenamento.js";
import { codigoDoAparelho } from "../sessao.js";
import { codigoDoVolumeDoAparelho } from "../../compartilhado/regras/recebimento.js";

const CHAVE = "wms-bb-recepcao-volumes-v1";
const CHAVE_SEQUENCIA = "wms-bb-volume-seq"; // a sequência dos volumes DESTE aparelho (a mesma desde a v78)

// os próximos n códigos de volume deste aparelho (V3FA2C-0001, V3FA2C-0002...)
export function proximosCodigosDeVolume(n) {
  const ultimo = Number(localStorage.getItem(CHAVE_SEQUENCIA)) || 0;
  localStorage.setItem(CHAVE_SEQUENCIA, String(ultimo + n));
  const aparelho = codigoDoAparelho();
  return Array.from({ length: n }, (_, i) => codigoDoVolumeDoAparelho(aparelho, ultimo + 1 + i));
}

// [{ codigo, tipo, notaId, criadoEm, itens: [{ id, produto, qtd }] }]
function ler() {
  try { const v = JSON.parse(localStorage.getItem(CHAVE)); return Array.isArray(v) ? v : []; } catch { return []; }
}
// devolve false se a memória do aparelho está cheia
const gravar = (vs) => (vs.length ? gravarNoAparelho(CHAVE, JSON.stringify(vs)) : (localStorage.removeItem(CHAVE), true));
const novoId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

// os volumes ainda sem doca de uma nota (na ordem em que foram criados)
export const volumesMontando = (notaId) => ler().filter((v) => v.notaId === notaId);
export const volumeMontando = (codigo) => ler().find((v) => v.codigo === codigo) || null;

// cria n volumes vazios da nota. Devolve os volumes criados (para imprimir as etiquetas) ou null (memória cheia).
export function criarVolumes(notaId, tipo, n) {
  const criadoEm = new Date().toISOString();
  const novos = proximosCodigosDeVolume(n).map((codigo) => ({ codigo, tipo, notaId, criadoEm, itens: [] }));
  return gravar([...ler(), ...novos]) ? novos : null;
}

// põe um produto no volume (a tela já validou a quantidade contra o pendente da nota)
export function vincular(codigo, produto, qtd) {
  const vs = ler();
  const v = vs.find((x) => x.codigo === codigo);
  if (!v) return false;
  v.itens.push({ id: novoId(), produto, qtd });
  return gravar(vs);
}

export function tirarDoVolume(codigo, itemId) {
  const vs = ler();
  const v = vs.find((x) => x.codigo === codigo);
  if (v) { v.itens = v.itens.filter((i) => i.id !== itemId); gravar(vs); }
}

// o volume foi endereçado (ou descartado): sai daqui
export const tirarVolumes = (codigos) => { const fora = new Set([].concat(codigos)); gravar(ler().filter((v) => !fora.has(v.codigo))); };
export const descartarVolumesDaNota = (notaId) => gravar(ler().filter((v) => v.notaId !== notaId));

// o servidor recusou o volume inteiro: ele volta a "montando", com os mesmos produtos e o mesmo código
// (a etiqueta continua valendo), para o conferente corrigir e endereçar de novo
export function restaurarVolume({ codigo, tipo, notaId, itens }) {
  const vs = ler().filter((v) => v.codigo !== codigo);
  gravar([...vs, { codigo, tipo, notaId, criadoEm: new Date().toISOString(), itens: itens.map((i) => ({ id: novoId(), produto: i.produto, qtd: i.qtd })) }]);
}

// os produtos dos volumes montando, no formato de conferência (somam ao conferido da tela e ao pendente)
export const volumesComoConferencias = (notaId) => volumesMontando(notaId).flatMap((v) =>
  v.itens.map((i) => ({ id: `vol-${i.id}`, notaId, produto: i.produto, qtd: i.qtd, armazenado: 0, cancelado: 0, volumes: [], volume: v.codigo })));
