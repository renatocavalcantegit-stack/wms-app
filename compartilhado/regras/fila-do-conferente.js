// WMS Beach Bike — FILA DO CONFERENTE no quadro da Conferência da Gestão (Fase 2, v67).
// O mesmo jeito da fila do separador (fila-do-separador.js): caixa de entrada + uma fila por conferente.
// Funções puras: o servidor usa para as travas (server/src/consultas/quadro-conferencia.js) e a Gestão para desenhar.
import { novaOrdem } from "./fila-do-separador.js";

export { novaOrdem };
export const FINALIZADA = ["conferido", "divergente", "dispensada"];

// c = { pedido, status } · para = login do conferente (null = caixa de entrada) · Devolve a mensagem da trava ou null.
export function travaParaMoverConferencia(c, para) {
  if (!c) return "Pedido não encontrado na conferência.";
  if (c.status === "andamento") return `${c.pedido} já está em conferência: não dá para mudar de fila.`;
  if (FINALIZADA.includes(c.status)) return c.status === "dispensada" ? `${c.pedido} já foi entregue à montagem.` : `${c.pedido} já foi conferido.`;
  return null;
}

// "Pular conferência" (só na Montagem): o pedido vai direto para a montagem, sem conferir.
export function travaParaPular(c, setor) {
  if (setor !== "mont") return "Só a Montagem pode dispensar a conferência.";
  if (!c) return "Pedido não encontrado na conferência.";
  if (c.status === "andamento") return `${c.pedido} já está em conferência`;
  if (FINALIZADA.includes(c.status)) return `${c.pedido} já foi entregue à montagem`;
  return null;
}

// O andamento da conferência de um pedido, a partir do que foi separado e do que já foi contado.
// itens = [{ produto, qtd_separada }] (pedido dividido: as linhas de todas as partes) · contagens = [{ produto, qtd, fora }]
// Devolve { itens, itensFeitos, unidades, unidadesFeitas, pc } (por produto: a conferência conta por produto).
export function andamentoDaConferencia(itens, contagens = []) {
  const separado = new Map();
  for (const i of itens) separado.set(i.produto, (separado.get(i.produto) || 0) + Number(i.qtd_separada || 0));
  const contado = new Map(contagens.filter((x) => !x.fora).map((x) => [x.produto, Number(x.qtd)]));
  let unidades = 0, unidadesFeitas = 0, itensFeitos = 0;
  for (const [produto, sep] of separado) {
    const c = contado.get(produto) || 0;
    unidades += sep; unidadesFeitas += Math.min(c, sep);
    if (c === sep) itensFeitos++;
  }
  const r = (n) => Math.round(n * 1000) / 1000;
  return { itens: separado.size, itensFeitos, unidades: r(unidades), unidadesFeitas: r(unidadesFeitas), pc: unidades ? Math.round((100 * unidadesFeitas) / unidades) : 0 };
}
