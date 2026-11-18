// WMS Beach Bike — FILA DO SEPARADOR no quadro da Gestão (Fase 1e). Sem tela e sem banco: só a decisão.
//
// O coordenador arrasta o pedido (ou o lote inteiro) da caixa de entrada para a coluna de um separador,
// de um separador para outro, de volta para a caixa, ou muda a ordem dentro da fila.
// O coletor do separador mostra só a fila dele, nesta ordem.
// Travas (as mesmas da demonstração, agora conferidas no servidor):
//   - pedido em separação (ou já separado) não muda de fila;
//   - pedido sem rota (que não é aguardando) não vai para separador: primeiro o coordenador define a rota.
import { precisaDeRota, ehPrioridade } from "./aguardando.js";

// o que anda junto no quadro: o lote inteiro ou o pedido sozinho
export const unidadeDoPedido = (p) => p.lote || p.id;
export const ehLote = (id) => String(id).startsWith("L-");

// pedidos = os pedidos da unidade que vai mudar · para = login do separador (null = caixa de entrada)
// setor = exp ou mont (na Montagem não há rota) · Devolve a mensagem da trava ou null.
export function travaParaMover(pedidos, para, setor = "exp") {
  if (!pedidos.length) return "Pedido não encontrado.";
  const ruim = pedidos.find((p) => p.status !== "pendente");
  if (ruim) return ruim.status === "andamento"
    ? `${ruim.id} já está em separação: não dá para mudar de fila.`
    : `${ruim.id} já foi separado.`;
  if (para && setor === "exp") {
    const semRota = pedidos.find((p) => precisaDeRota(p));
    if (semRota) return `Defina a rota do ${semRota.id} antes de mandar para um separador.`;
  }
  return null;
}

// A ordem nova da fila de destino, em unidades (pedido ou lote).
// filaAtual = unidades que já estão lá, na ordem de hoje (sem a que está chegando)
// unidade = a que está chegando · pedida = a ordem que a tela mandou (como ficou na coluna depois de soltar)
// A tela pode estar desatualizada (outro coordenador mexeu ao mesmo tempo): vale a ordem pedida para o que
// existe; o que a tela não conhecia vai para o fim, e nada some nem se repete.
export function novaOrdem(filaAtual, unidade, pedida = []) {
  const validas = new Set([...filaAtual, unidade]);
  const ordem = [...new Set(pedida.filter((u) => validas.has(u)))];
  for (const u of filaAtual) if (!ordem.includes(u)) ordem.push(u);
  if (!ordem.includes(unidade)) ordem.push(unidade);
  return ordem;
}

// ---------- o quadro na tela ----------

// Junta os pedidos do quadro (como vêm do servidor) em unidades: o lote vira um card só.
// Devolve [{ id, ehLote, pedidos, para, ordem, andamento, chegada }].
export function unidadesDoQuadro(pedidos) {
  const grupos = new Map();
  for (const p of pedidos) {
    const id = unidadeDoPedido(p);
    if (!grupos.has(id)) grupos.set(id, []);
    grupos.get(id).push(p);
  }
  return [...grupos].map(([id, ps]) => ({
    id, ehLote: !!ps[0].lote, pedidos: [...ps].sort((a, b) => String(a.posicao_lote || "").localeCompare(String(b.posicao_lote || ""))),
    para: ps[0].designado_para || null,
    ordem: Math.min(...ps.map((p) => p.ordem_fila ?? Infinity)),
    andamento: ps.some((p) => p.status === "andamento"),
    chegada: Math.min(...ps.map((p) => Date.parse(p.chegada))),
  }));
}

// Caixa de entrada: primeiro o que precisa do coordenador (sem rota), depois a prioridade (na expedição, o aguardando;
// na Montagem, a do Sankhya), depois quem chegou antes.
// Fila do separador: o que está em separação no alto, depois a ordem da fila.
export function colunasDoQuadro(unidades, setor = "exp") {
  const semRota = (u) => setor === "exp" && u.pedidos.some((p) => precisaDeRota(p));
  const prio = (u) => u.pedidos.some((p) => ehPrioridade({ aguardando: p.aguardando, prio: p.prioridade }, setor));
  const caixa = unidades.filter((u) => !u.para).sort((a, b) =>
    (semRota(b) - semRota(a)) || (prio(b) - prio(a)) || a.chegada - b.chegada);
  const filas = Map.groupBy(unidades.filter((u) => u.para), (u) => u.para);
  for (const [k, us] of filas) filas.set(k, us.sort((a, b) => (b.andamento - a.andamento) || a.ordem - b.ordem || a.chegada - b.chegada));
  return { caixa, filas };
}

// Situação do separador na coluna dele:
//   desconectado  não está conectado em nenhum coletor (saiu, ou o turno acabou)
//   sem-contato   conectado, mas o coletor não dá sinal há mais de 90 s (sem rede, desligado, app fechado)
//   separando     tem pedido em andamento · aguardando: tem fila, ainda não começou · livre: fila vazia
export const SEM_CONTATO_MS = 90_000;
export function situacaoNoQuadro(sep, fila, agora) {
  if (!sep.conectado) return "desconectado";
  if (!sep.ultimo_contato || +agora - Date.parse(sep.ultimo_contato) > SEM_CONTATO_MS) return "sem-contato";
  if (fila.some((u) => u.andamento)) return "separando";
  return fila.length ? "aguardando" : "livre";
}
