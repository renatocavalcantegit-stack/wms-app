// WMS Beach Bike — LOGIN ÚNICO dos coletores (Fase 1e). Sem tela e sem banco: só a decisão.
//
// O separador, o conferente e o embarque ficam conectados em UM aparelho de cada vez.
// Login em outro aparelho é RECUSADO (não derruba o coletor que talvez esteja no meio de um pedido):
// a pessoa sai pelo outro aparelho ou, se ele sumiu ou quebrou, o coordenador desconecta pela Gestão
// (menu do usuário → Dispositivos).
// No MESMO aparelho pode entrar de novo (ex.: a sessão venceu, ou trocou de usuário e voltou).
// Os coordenadores e o estoque podem estar em vários aparelhos ao mesmo tempo (computador e celular).

export const PERFIS_DE_UM_APARELHO = ["sep", "conf", "emb"];

// sessoes = sessões ATIVAS do usuário (não encerradas e dentro do prazo): [{ aparelho, criada_em, ultimo_contato }]
// aparelho = código do aparelho que está tentando entrar (pode faltar: aparelho antigo, sem código)
// Devolve a sessão que impede o login, ou null se pode entrar.
export function sessaoQueBloqueia(perfil, sessoes, aparelho) {
  if (!PERFIS_DE_UM_APARELHO.includes(perfil)) return null;
  return sessoes.find((s) => (s.aparelho ?? null) !== (aparelho ?? null)) || null;
}

const hora = (d) => new Date(d).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
function haQuanto(ms) {
  const m = Math.floor(Math.max(0, ms) / 60_000);
  if (m < 1) return "agora";
  if (m < 60) return `há ${m} min`;
  return `há ${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
}

// o aviso que aparece no login recusado
export function mensagemDeOutroAparelho(sessao, agora = Date.now()) {
  const contato = sessao.ultimo_contato ? `, último contato ${haQuanto(+agora - Date.parse(sessao.ultimo_contato))}` : "";
  return `Você já está conectado em outro aparelho (desde ${hora(sessao.criada_em)}${contato}). `
    + "Saia por lá ou peça ao coordenador para desconectar.";
}

// por que a sessão terminou (o aparelho mostra isso quando o servidor recusa o token)
export const MOTIVOS_DE_FIM = {
  coordenador: "O coordenador desconectou este aparelho.",
  saiu: "Você saiu deste aparelho.",
  "novo-login": "Você entrou de novo neste aparelho.",
};
