// WMS Beach Bike — regras do painel "Ao vivo" da Gestão (Fase 1c). Sem tela e sem rede: só a decisão.
//
// Situação de cada separador, a partir do último contato do coletor e dos pedidos em andamento:
//   separando    tem pedido em andamento e o coletor deu sinal há pouco
//   livre        sem pedido em andamento e com contato recente
//   sem-contato  o coletor não dá sinal há mais de SEM_CONTATO_MS (sem rede, desligado ou com o app fechado)
//   fora         nunca entrou com o servidor (ou só há muito tempo)
//
// O coletor manda o batimento a cada 30 s (js/sincronizacao.js). Três batimentos perdidos = sem contato.
export const SEM_CONTATO_MS = 90_000;
// contato mais antigo que um turno inteiro: conta como "fora" (a sessão do turno dura 14 h)
export const FORA_DO_TURNO_MS = 14 * 60 * 60_000;

const ORDEM = { "sem-contato": 0, separando: 1, livre: 2, fora: 3 };

// sep = { login, nome, ultimo_contato, ultima_acao } · pedidos = lista do painel · agora = Date ou ms
export function situacaoDoSeparador(sep, pedidos, agora) {
  const t = +agora;
  const atuais = pedidos.filter((p) => p.status === "andamento" && p.separador === sep.login);
  const contato = sep.ultimo_contato ? Date.parse(sep.ultimo_contato) : null;
  let situacao;
  if (contato === null || t - contato > FORA_DO_TURNO_MS) situacao = atuais.length ? "sem-contato" : "fora";
  else if (t - contato > SEM_CONTATO_MS) situacao = "sem-contato";
  else situacao = atuais.length ? "separando" : "livre";
  return { ...sep, situacao, pedidos: atuais.map((p) => p.id), semContatoMs: contato === null ? null : t - contato };
}

// a lista na ordem da tela: primeiro quem precisa de atenção (sem contato), depois separando, livres e fora.
// "sem contato" sem pedido na mão vai depois de quem está livre: não atrapalha nenhum pedido.
export function separadoresDoPainel(separadores, pedidos, agora) {
  const peso = (s) => (s.situacao === "sem-contato" && !s.pedidos.length ? 2.5 : ORDEM[s.situacao]);
  return separadores
    .map((s) => situacaoDoSeparador(s, pedidos, agora))
    .sort((a, b) => peso(a) - peso(b) || a.nome.localeCompare(b.nome, "pt-BR"));
}

// andamento do pedido em % (itens já separados, com falta ou ok, sobre o total)
export const progressoDoPedido = (p) => (p.itens ? Math.round((100 * p.itens_feitos) / p.itens) : 0);

// "agora", "há 3 min", "há 1h05"
export function haQuantoTempo(ms) {
  const m = Math.floor(Math.max(0, ms) / 60_000);
  if (m < 1) return "agora";
  if (m < 60) return `há ${m} min`;
  return `há ${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
}

// números do topo da aba
export function resumoDoPainel(pedidos, separadores, naoAplicadas) {
  return {
    emSeparacao: pedidos.filter((p) => p.status === "andamento").length,
    pendentes: pedidos.filter((p) => p.status === "pendente").length,
    concluidosHoje: pedidos.filter((p) => p.status === "concluido").length,
    semContato: separadores.filter((s) => s.situacao === "sem-contato").length,
    naoAplicadas: naoAplicadas.length,
  };
}
