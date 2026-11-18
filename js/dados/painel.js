// WMS Beach Bike — dados do painel "Ao vivo" da Gestão (Fase 1c). Só funciona com o servidor.
// A Gestão não guarda nada no aparelho: lê o painel do servidor e ouve o canal de tempo real.

// Lê o painel. Devolve { ok: true, painel } ou { ok: false, erro: "sem-rede" | "sessao-vencida" | "servidor" }.
// buscar = fetch (nos testes, um de mentira)
export async function buscarPainel(sessao, setor, buscar = fetch) {
  let r;
  try {
    r = await buscar(`api/painel/separacao?setor=${encodeURIComponent(setor)}`, {
      headers: { authorization: `Bearer ${sessao.token}` }, cache: "no-store",
    });
  } catch { return { ok: false, erro: "sem-rede" }; }
  if (r.status === 401) return { ok: false, erro: "sessao-vencida" };
  if (!r.ok) return { ok: false, erro: "servidor" };
  return { ok: true, painel: await r.json() };
}

// O coordenador viu a ação não aplicada: sai da lista (em todas as telas da Gestão).
export async function marcarVista(sessao, id, buscar = fetch) {
  try {
    const r = await buscar(`api/painel/nao-aplicadas/${encodeURIComponent(id)}/vista`, {
      method: "POST", headers: { authorization: `Bearer ${sessao.token}` },
    });
    return r.ok;
  } catch { return false; }
}

// Ouve o canal de tempo real (SSE). aoAvisar(evento) é chamado quando chegam ações, quando um coletor
// dá sinal de vida e quando outra tela marca uma ação como vista. Se a conexão cair, o navegador
// reconecta sozinho. Devolve uma função para fechar.
// O EventSource não manda cabeçalhos: por isso o token vai no endereço.
export function ouvirTempoReal(sessao, aoAvisar) {
  const fonte = new EventSource(`api/tempo-real?token=${encodeURIComponent(sessao.token)}`);
  for (const evento of ["acoes", "contato", "painel"]) fonte.addEventListener(evento, () => aoAvisar(evento));
  return () => fonte.close();
}
