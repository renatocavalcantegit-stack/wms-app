// WMS Beach Bike — OBSERVAÇÃO DO PEDIDO (o texto do vendedor que vem do Sankhya), v76.
// Função pura: decide quem é obrigado a ler, em que momento, e confere a resposta. Não lê nem grava nada.
// A demonstração (js/dados/observacao.js) e o servidor (server/src/consultas/observacao.js) usam as mesmas regras.
//
// Não confundir com a "observação dos volumes", que o conferente preenche e o WMS grava no Sankhya.
//
// Quem lê (decisão de 24/11/2026):
//   - todos podem abrir a observação a qualquer momento (botão "Observação do pedido");
//   - OBRIGATÓRIA, enquanto o Sankhya não diz para quem é: separador e conferente;
//   - no futuro, o analista de pedidos marca no Sankhya para quem ela é (separador, conferente, embarque):
//     o campo "para" do pedido. Aí ela é obrigatória SÓ para quem foi marcado; os outros só têm o botão de ver.
//     para = null (o Sankhya não mandou) → o padrão; para = [] (o analista não marcou ninguém) → ninguém.
//
// Os dois momentos de cada um:
//   inicio  separador: antes do 1º item · conferente: ao abrir o pedido · embarque: ao bipar o 1º volume
//           resposta: "li" (Li e entendi)
//   fim     separador: antes de ler a doca · conferente: antes de finalizar · embarque: ao bipar o último volume
//           resposta: "apliquei" (Li e apliquei) ou "nao_era" (Não era para mim: só registra e avisa o gestor)

export const PAPEIS = ["separador", "conferente", "embarque"];
export const OBRIGATORIA_SEM_MARCACAO = ["separador", "conferente"];
export const MOMENTOS = ["inicio", "fim"];
export const RESPOSTAS = { inicio: ["li"], fim: ["apliquei", "nao_era"] };

export const TEXTO_DA_RESPOSTA = { li: "Li e entendi", apliquei: "Li e apliquei", nao_era: "Não era para mim" };
export const TEXTO_DO_PAPEL = { separador: "separador", conferente: "conferente", embarque: "embarque" };
export const TEXTO_DO_MOMENTO = {
  separador: { inicio: "início", fim: "antes da doca" },
  conferente: { inicio: "início", fim: "antes de finalizar" },
  embarque: { inicio: "1º volume", fim: "último volume" },
};

// o papel de cada perfil de login (quem manda a resposta)
export const PAPEL_DO_PERFIL = { sep: "separador", conf: "conferente", emb: "embarque" };

export const MSG_SEM_OBSERVACAO = "ESTE PEDIDO NÃO TEM OBSERVAÇÃO.";
export const MSG_RESPOSTA_INVALIDA = "RESPOSTA DA OBSERVAÇÃO INVÁLIDA.";
export const MSG_PERFIL_SEM_OBSERVACAO = "PERFIL SEM OBSERVAÇÃO DO PEDIDO.";

export const textoDaObservacao = (texto) => String(texto ?? "").trim();
export const temObservacao = (texto) => textoDaObservacao(texto) !== "";

// para quem a leitura é obrigatória: o que o Sankhya marcou ou, sem marcação, o padrão
export function obrigatoriaPara(texto, para) {
  if (!temObservacao(texto)) return [];
  return Array.isArray(para) ? PAPEIS.filter((p) => para.includes(p)) : [...OBRIGATORIA_SEM_MARCACAO];
}
export const ehObrigatoria = (texto, para, papel) => obrigatoriaPara(texto, para).includes(papel);

// esta pessoa ainda tem que responder neste momento?
// ciencias = [{ login, papel, momento, parte? }] (o que já foi respondido: no aparelho ou no servidor)
// parte = id da parte do pedido dividido (cada separador de cada parte lê); null no pedido inteiro
export function faltaResponder({ texto, para, ciencias = [], login, papel, momento, parte = null }) {
  if (!ehObrigatoria(texto, para, papel)) return false;
  return !ciencias.some((c) => c.login === login && c.papel === papel && c.momento === momento && (c.parte ?? null) === (parte ?? null));
}

// a resposta que chegou do aparelho (ação "observacao.ciente"): devolve { momento, resposta, papel } ou { erro }
// perfil = perfil de quem mandou · texto = a observação do pedido
export function validarCiencia({ momento, resposta }, perfil, texto) {
  const papel = PAPEL_DO_PERFIL[perfil];
  if (!papel) return { erro: MSG_PERFIL_SEM_OBSERVACAO };
  if (!temObservacao(texto)) return { erro: MSG_SEM_OBSERVACAO };
  if (!MOMENTOS.includes(momento) || !RESPOSTAS[momento].includes(resposta)) return { erro: MSG_RESPOSTA_INVALIDA };
  return { momento, resposta, papel };
}

// "Davi (separador) · Li e apliquei · antes da doca" (a gaveta da Gestão)
export const descreverCiencia = (c) =>
  `${c.nome || c.login} (${TEXTO_DO_PAPEL[c.papel] || c.papel}) · ${TEXTO_DA_RESPOSTA[c.resposta] || c.resposta} · ${TEXTO_DO_MOMENTO[c.papel]?.[c.momento] || c.momento}`;

// quem respondeu "Não era para mim" (o gestor é avisado)
export const naoEraPara = (ciencias = []) => ciencias.filter((c) => c.resposta === "nao_era");
