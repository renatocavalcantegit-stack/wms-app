// WMS Beach Bike — dados do quadro da Separação e da tela de Dispositivos, na Gestão com servidor (Fase 1e).
// Só este arquivo sabe ONDE o quadro fica: no servidor. A Gestão não guarda nada dele no aparelho.
// Cada função devolve { ok: true, ... } ou { ok: false, erro } (erro já é a frase para mostrar ao coordenador).
// buscar = fetch (nos testes, um de mentira)

const ERRO_DE_REDE = "Sem conexão com o servidor. Confira a rede e tente de novo.";

async function chamar(sessao, url, { corpo, metodo = corpo ? "POST" : "GET" } = {}, buscar = fetch) {
  let r;
  try {
    r = await buscar(url, {
      method: metodo, cache: "no-store",
      headers: { authorization: `Bearer ${sessao.token}`, ...(corpo ? { "content-type": "application/json" } : {}) },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
  } catch { return { ok: false, erro: ERRO_DE_REDE, semRede: true }; }
  const dados = await r.json().catch(() => ({}));
  if (r.status === 401) return { ok: false, erro: "Sessão encerrada: saia e entre de novo.", sessaoVencida: true };
  if (!r.ok) return { ok: false, erro: dados.erro || "O servidor respondeu com erro." };
  return { ok: true, ...dados };
}

// ---------- quadro da Separação ----------
export const buscarQuadro = (sessao, setor, buscar) => chamar(sessao, `api/quadro/separacao?setor=${encodeURIComponent(setor)}`, {}, buscar);
// unidade = pedido ou lote · para = login do separador (null = caixa de entrada) · ordem = a coluna de destino depois de soltar
export const moverNoQuadro = (sessao, setor, unidade, para, ordem, buscar) =>
  chamar(sessao, "api/quadro/mover", { corpo: { setor, unidade, para, ordem } }, buscar);
export const definirRota = (sessao, setor, pedido, rota, buscar) => chamar(sessao, "api/quadro/rota", { corpo: { setor, pedido, rota } }, buscar);
export const criarLote = (sessao, setor, pedidos, buscar) => chamar(sessao, "api/quadro/lotes", { corpo: { setor, pedidos } }, buscar);
export const desfazerLote = (sessao, setor, lote, buscar) =>
  chamar(sessao, `api/quadro/lotes/${encodeURIComponent(lote)}/desfazer`, { corpo: { setor } }, buscar);
// o pedido com os itens (a gaveta do pedido)
export const buscarPedido = (sessao, id, buscar) => chamar(sessao, `api/pedidos/${encodeURIComponent(id)}`, {}, buscar);

// ---------- Dispositivos (login único) ----------
export const buscarDispositivos = (sessao, buscar) => chamar(sessao, "api/dispositivos", {}, buscar);
export const desconectarDispositivo = (sessao, id, buscar) =>
  chamar(sessao, `api/dispositivos/${encodeURIComponent(id)}/desconectar`, { metodo: "POST" }, buscar);

// Ouve o canal de tempo real (SSE): o quadro mudou (outra Gestão), chegaram ações ou o batimento de um coletor,
// ou um aparelho entrou / saiu. O navegador reconecta sozinho se a conexão cair. Devolve uma função para fechar.
// O EventSource não manda cabeçalhos: por isso o token vai no endereço.
export function ouvirQuadro(sessao, aoAvisar) {
  const fonte = new EventSource(`api/tempo-real?token=${encodeURIComponent(sessao.token)}`);
  for (const evento of ["quadro", "acoes", "contato", "dispositivos"]) fonte.addEventListener(evento, () => aoAvisar(evento));
  return () => fonte.close();
}
