// WMS Beach Bike — camada de dados do Recebimento: notas, conferências, volumes e armazenamento.
// Os dados ficam junto com o resto do Estoque (mesma gravação), porque conferir e armazenar mexem no saldo.
// Na Fase 1, o coletor grava aqui primeiro (cópia local) e a fila de sincronização manda para o servidor:
// por isso a conferência SOMA o que foi confirmado, em vez de travar o produto para outro coletor.
import { importacaoDeNotas } from "../demo-dados.js";
import { lerEstoque, gravarEstoque, enderecoPorId, somarSaldo, saldoNoEndereco, registrarMovimento } from "./estoque.js";
import { lerQuantidade, arredondarQtd } from "../../compartilhado/regras/quantidade.js";
import {
  validarDoca, validarConferencia, validarArmazenamento, distribuirArmazenamento, pendenteNaDoca, pendenteDaConferencia,
  codigoDoVolume, separarNotasImportadas, TIPO_DEVOLUCAO, numeroDaDevolucao,
} from "../../compartilhado/regras/recebimento.js";

// dia de hoje no formato AAAA-MM-DD (é a "data de armazenagem" da conferência)
const hoje = () => new Date().toLocaleDateString("sv");

// ---------- consultas ----------
export const notaPorId = (db, id) => db.notas.find((n) => n.id === id) || null;
// a nota pelo número digitado ou bipado (as notas ainda abertas têm preferência)
export function notaPorNumero(db, numero) {
  const t = String(numero).trim();
  const lista = db.notas.filter((n) => n.numero === t);
  return lista.find((n) => !n.finalizada) || lista[0] || null;
}
export const volumesDoItem = (db, notaId, produto) => db.volumes.filter((v) => v.notaId === notaId && v.produto === produto);
export const volumePorCodigo = (db, codigo) => db.volumes.find((v) => v.codigo === codigo) || null;

// ---------- conferência ----------
// confirma uma quantidade de um produto da nota, na doca lida.
// Soma ao conferido, põe o saldo na doca na hora e gera os volumes (com as etiquetas).
// Devolve { ok, conferencia, volumes } ou { ok: false, msg }.
export function conferir({ notaId, produto, qtd, volumes, docaId }) {
  const db = lerEstoque();
  const nota = notaPorId(db, notaId);
  const erroDoca = validarDoca(enderecoPorId(db, docaId), nota);
  if (erroDoca) return { ok: false, msg: erroDoca };
  const erro = validarConferencia(nota, { produto, qtd, volumes }, db.conferencias);
  if (erro) return { ok: false, msg: erro };

  const conferencia = { id: db.proximoId.conferencia++, notaId, produto, qtd: lerQuantidade(qtd), docaId, dia: hoje(), armazenado: 0, cancelado: 0, volumes: [] };
  const novos = [];
  for (let seq = 1; seq <= Number(volumes); seq++) {
    const v = { codigo: codigoDoVolume(db.proximoId.volume++), notaId, produto, conferenciaId: conferencia.id, seq, total: Number(volumes) };
    novos.push(v); conferencia.volumes.push(v.codigo);
  }
  db.conferencias.push(conferencia);
  db.volumes.push(...novos);
  // o estoque entra a cada produto conferido, não só ao finalizar a nota
  somarSaldo(db, docaId, produto, conferencia.qtd);
  registrarMovimento(db, { tipo: "recebimento", produto, qtd: conferencia.qtd, destino: docaId, nota: nota.numero });
  gravarEstoque(db);
  return { ok: true, conferencia, volumes: novos };
}

// finaliza a nota: não recebe mais conferências e não reabre. O que faltou vira divergência.
export function finalizarNota(notaId) {
  const db = lerEstoque();
  const nota = notaPorId(db, notaId);
  if (!nota || nota.finalizada) return { ok: false };
  nota.finalizada = true;
  gravarEstoque(db);
  return { ok: true };
}

// ---------- armazenamento ----------
// leva o produto da doca para o endereço de destino. Efetiva na hora (o coletor chama ao ler o QR do destino).
export function armazenar({ produto, docaId, qtd, destinoId }) {
  const db = lerEstoque();
  const pendente = pendenteNaDoca(db.conferencias, produto, docaId);
  const erro = validarArmazenamento({
    qtd, saldoOrigem: saldoNoEndereco(db, docaId, produto), pendente, origemId: docaId, destino: enderecoPorId(db, destinoId),
  });
  if (erro) return { ok: false, msg: erro };
  const quantidade = lerQuantidade(qtd);
  // abate das conferências pendentes desta doca, das mais antigas para as mais novas
  const daDoca = db.conferencias.filter((c) => c.produto === produto && c.docaId === docaId);
  for (const parte of distribuirArmazenamento(daDoca, quantidade)) {
    const c = db.conferencias.find((x) => x.id === parte.id);
    c.armazenado = arredondarQtd(c.armazenado + parte.qtd);
  }
  somarSaldo(db, docaId, produto, -quantidade);
  somarSaldo(db, destinoId, produto, quantidade);
  registrarMovimento(db, { tipo: "armazenamento", produto, qtd: quantidade, origem: docaId, destino: destinoId });
  gravarEstoque(db);
  return { ok: true };
}

// cancelamento pelo gestor (WEB): o produto sai da lista de pendentes e o saldo CONTINUA na doca
// (depois pode ser movido por Transferência). Sem confirmação nem registro de quem cancelou, como no documento.
export function cancelarPendente(notaId, produto) {
  const db = lerEstoque();
  for (const c of db.conferencias.filter((x) => x.notaId === notaId && x.produto === produto)) c.cancelado = arredondarQtd(c.cancelado + pendenteDaConferencia(c));
  gravarEstoque(db);
}

// ---------- devolução de pedido (v75) ----------
// O que saiu de um pedido (corte ou cancelamento) vira uma entrada pendente, igual a uma nota:
// o estoquista confere bipando, lê a doca e depois armazena. itens = [{ produto, qtd }]
// aguardando = { responsavel, nome } (cancelamento): a devolução espera quem está com a caixa marcar
// "Entregue ao estoque" (entregarDevolucao). Até lá fica em db.aEntregar e o estoque não vê.
export function criarDevolucao({ pedido, itens, entreguePor, aguardando = null }) {
  const soma = new Map();
  itens.filter((i) => i.qtd > 0).forEach((i) => soma.set(i.produto, arredondarQtd((soma.get(i.produto) || 0) + i.qtd)));
  if (!soma.size) return null;
  const db = lerEstoque();
  db.aEntregar ||= [];
  const numero = numeroDaDevolucao([...db.notas, ...db.aEntregar], pedido);
  const lista = [...soma].map(([produto, qtd]) => ({ produto, qtd }));
  if (aguardando) {
    const d = { numero, pedido, tipo: TIPO_DEVOLUCAO, itens: lista, responsavel: aguardando.responsavel, quem: aguardando.nome || null, criada: new Date().toISOString() };
    db.aEntregar.push(d);
    gravarEstoque(db);
    return { ...d, aguardando: true };
  }
  const nota = {
    id: db.proximoId.nota++, numero, pedido, tipo: TIPO_DEVOLUCAO, finalizada: false,
    fornecedor: { nome: `Entregue por ${entreguePor || "—"}` }, data: hoje(), itens: lista, entreguePor: entreguePor || null,
  };
  db.notas.push(nota);
  gravarEstoque(db);
  return nota;
}

// O responsável marcou "Entregue ao estoque": a devolução vira a entrada que o estoquista confere (registra quem e quando).
// Devolve a nota criada, ou null se já tinha sido entregue (o mesmo toque duas vezes não duplica).
export function entregarDevolucao(numero, entreguePor) {
  const db = lerEstoque();
  const i = (db.aEntregar || []).findIndex((d) => d.numero === numero);
  if (i < 0) return null;
  const [d] = db.aEntregar.splice(i, 1);
  const nota = {
    id: db.proximoId.nota++, numero, pedido: d.pedido, tipo: TIPO_DEVOLUCAO, finalizada: false,
    fornecedor: { nome: `Entregue por ${entreguePor || "—"}` }, data: hoje(), itens: d.itens,
    entregue: { por: entreguePor, quando: new Date().toISOString() },
  };
  db.notas.push(nota);
  gravarEstoque(db);
  return nota;
}
// quem entregou a devolução ao estoque (ou null)
export function quemEntregou(numero) {
  const n = lerEstoque().notas.find((x) => x.numero === numero && x.tipo === TIPO_DEVOLUCAO);
  return n?.entreguePor || n?.entregue?.por || null;
}
// a devolução ainda esperando a entrega (ou null)
export const devolucaoAEntregar = (numero) => (lerEstoque().aEntregar || []).find((d) => d.numero === numero) || null;

// ---------- notas do ERP (simulado) ----------
export function importarNotasDoErp() {
  const db = lerEstoque();
  const r = separarNotasImportadas(db.notas, importacaoDeNotas());
  for (const n of r.importadas) db.notas.push({ ...n, id: db.proximoId.nota++ });
  gravarEstoque(db);
  return r;
}
