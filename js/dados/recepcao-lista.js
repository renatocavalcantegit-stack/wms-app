// WMS Beach Bike — a lista "conferidos, aguardando doca" da Conferência no coletor (v79).
//
// O estoquista confere vários produtos e, quando quiser, toca em "Endereçar" e lê a doca: tudo o que está na lista
// entra nessa doca de uma vez. Até lá, a lista fica guardada no aparelho (o app pode fechar, a bateria pode acabar).
// Nada desta lista vai para o servidor antes da doca: sem doca a mercadoria não tem lugar e não pode virar saldo.
// Vale para uma nota só (a nota aberta). Funciona igual com e sem servidor.
import { gravarNoAparelho } from "./armazenamento.js";

const CHAVE = "wms-bb-recepcao-lista-v1";
const VAZIA = { notaId: null, itens: [] };

export function lerListaDaDoca() {
  try {
    const d = JSON.parse(localStorage.getItem(CHAVE));
    return d && Array.isArray(d.itens) ? d : { ...VAZIA };
  } catch { return { ...VAZIA }; }
}
// devolve false se a memória do aparelho está cheia (a tela avisa e o item não entra)
const gravar = (d) => (d.itens.length ? gravarNoAparelho(CHAVE, JSON.stringify(d)) : (localStorage.removeItem(CHAVE), true));

// põe um produto conferido na lista (a tela já validou a quantidade contra o pendente da nota + o que está na lista)
export function porNaLista(notaId, produto, qtd) {
  const d = lerListaDaDoca();
  const itens = d.notaId === notaId ? d.itens : [];
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  return gravar({ notaId, itens: [...itens, { id, produto, qtd }] });
}

// tira um item (conferido errado), ou os itens que já entraram na doca
export function tirarDaLista(ids) {
  const fora = new Set([].concat(ids));
  const d = lerListaDaDoca();
  gravar({ ...d, itens: d.itens.filter((i) => !fora.has(i.id)) });
}

export const esvaziarLista = () => gravar({ ...VAZIA });

// a lista no formato de conferência, para somar ao conferido da tela e ao pendente (validarConferencia)
export const listaComoConferencias = (d = lerListaDaDoca()) =>
  d.itens.map((i) => ({ id: `lista-${i.id}`, notaId: d.notaId, produto: i.produto, qtd: i.qtd, armazenado: 0, cancelado: 0, volumes: [] }));
