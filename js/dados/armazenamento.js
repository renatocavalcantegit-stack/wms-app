// WMS Beach Bike — gravação na memória do aparelho (localStorage), com o caso de MEMÓRIA CHEIA tratado (v77).
// O navegador guarda poucos megabytes por site. Se encher, o setItem dá erro; antes da v77 esse erro escapava
// e podia travar o coletor no meio de um item. Agora:
//   - quem grava recebe false (e a tela segue);
//   - se houver dados "descartáveis" (que podem ser refeitos), apaga e tenta de novo;
//   - avisa a tela (evento "wms-memoria-cheia"), para mostrar a mensagem à pessoa.

// a cópia do Estoque da demonstração (js/dados/estoque.js). Mudar a chave troca a demonstração antiga pela nova.
export const CHAVE_ESTOQUE = "wms-bb-estoque-v11";
export const EVENTO_MEMORIA_CHEIA = "wms-memoria-cheia";
export const MSG_MEMORIA_CHEIA = "A memória do aparelho está cheia. Avise o responsável pelo sistema.";

// o erro do navegador para "não cabe mais" (o nome muda de um navegador para outro)
const ehMemoriaCheia = (e) => e?.name === "QuotaExceededError" || e?.name === "NS_ERROR_DOM_QUOTA_REACHED" || e?.code === 22;

function avisar() {
  try { globalThis.dispatchEvent?.(new Event(EVENTO_MEMORIA_CHEIA)); } catch {}
}

// grava; devolve true se gravou. descartaveis = chaves que podem ser apagadas para abrir espaço.
export function gravarNoAparelho(chave, valor, { descartaveis = [] } = {}) {
  try {
    localStorage.setItem(chave, valor);
    return true;
  } catch (e) {
    if (!ehMemoriaCheia(e)) throw e;
  }
  const apagou = descartaveis.filter((d) => d !== chave && localStorage.getItem(d) !== null);
  apagou.forEach((d) => localStorage.removeItem(d));
  if (apagou.length) {
    try { localStorage.setItem(chave, valor); return true; } catch (e) { if (!ehMemoriaCheia(e)) throw e; }
  }
  avisar();
  return false;
}

// a tela mostra o aviso (ex.: toast) quando a memória encher
export function aoEncherMemoria(fn) {
  globalThis.addEventListener?.(EVENTO_MEMORIA_CHEIA, fn);
}
