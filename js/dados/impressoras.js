// WMS Beach Bike — IMPRESSORAS de etiqueta da rede (v81): a lista, a impressão e a última escolhida.
//
// O navegador não fala com a impressora: ele pede ao servidor, e o servidor (na mesma rede da Argox) monta a
// etiqueta e manda direto para ela. Por isso a impressão precisa do Wi-Fi; sem rede, a tela oferece
// "Imprimir neste aparelho" (a impressão do navegador, como na demonstração).
// Cada função devolve { ok: true, ... } ou { ok: false, erro } (erro já é a frase para mostrar).
import { MSG_SEM_REDE_PARA_IMPRIMIR } from "../../compartilhado/regras/impressoras.js";

const CHAVE_ULTIMA = "wms-bb-impressora-v1"; // a última impressora escolhida NESTE aparelho (id)
const TEMPO_MS = 12000; // o servidor espera a impressora até 5 s; aqui damos folga para o Wi-Fi

async function chamar(sessao, url, { metodo = "GET", corpo } = {}, buscar = fetch) {
  const parar = new AbortController();
  const relogio = setTimeout(() => parar.abort(), TEMPO_MS);
  let r;
  try {
    r = await buscar(url, {
      method: metodo, cache: "no-store", signal: parar.signal,
      headers: { authorization: `Bearer ${sessao.token}`, ...(corpo ? { "content-type": "application/json" } : {}) },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
  } catch { return { ok: false, erro: MSG_SEM_REDE_PARA_IMPRIMIR, semRede: true }; } finally { clearTimeout(relogio); }
  const dados = await r.json().catch(() => ({}));
  if (r.status === 401) return { ok: false, erro: "Sessão encerrada: saia e entre de novo.", sessaoVencida: true };
  if (!r.ok) return { ok: false, erro: dados.erro || "O servidor respondeu com erro." };
  return { ok: true, ...(Array.isArray(dados) ? { impressoras: dados } : dados) };
}

// coletor: só as ativas (id, nome, setor) · gestor: todas, com IP e porta
export const listarImpressoras = (sessao, buscar) => chamar(sessao, "api/impressoras", {}, buscar);
// gestor: grava (nova, ou a existente quando vem o id). Devolve { ok, ...impressora }
export const salvarImpressora = (sessao, dados, id, buscar) =>
  chamar(sessao, id ? `api/impressoras/${id}` : "api/impressoras", { metodo: id ? "PUT" : "POST", corpo: dados }, buscar);
export const imprimirTeste = (sessao, id, buscar) => chamar(sessao, `api/impressoras/${id}/teste`, { metodo: "POST", corpo: {} }, buscar);

// etiquetas = [{ codigo, tipo, nota, fornecedor, dia }] · devolve { ok, enviadas, impressora }
export function imprimirNaImpressora(sessao, impressora, etiquetas, buscar) {
  return chamar(sessao, "api/imprimir", { metodo: "POST", corpo: { impressora: Number(impressora), etiquetas } }, buscar);
}

export const ultimaImpressora = () => Number(localStorage.getItem(CHAVE_ULTIMA)) || null;
export const lembrarImpressora = (id) => localStorage.setItem(CHAVE_ULTIMA, String(id));
