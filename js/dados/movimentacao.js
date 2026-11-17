// WMS Beach Bike — camada de dados da MOVIMENTAÇÃO: tarefas de abastecimento, mínimo/máximo do picking,
// transferência e a baixa do picking feita pela separação.
// Os dados ficam junto com o resto do Estoque (mesma gravação), porque tudo aqui mexe no saldo.
import { lerEstoque, gravarEstoque, enderecoPorId, saldoNoEndereco, somarSaldo, registrarMovimento } from "./estoque.js";
import { MSG_ENDERECO_INATIVO, MSG_ENDERECO_NAO_ENCONTRADO } from "../../compartilhado/regras/enderecos.js";
import { pendenteNaDoca } from "../../compartilhado/regras/recebimento.js";
import { validarDocaDevolucao } from "../../compartilhado/regras/ocorrencias.js";
import { lerQuantidade, arredondarQtd } from "../../compartilhado/regras/quantidade.js";
import {
  validarLimite, necessidade, precisaAbastecer, escolherOrigens, tarefaDuplicada, tarefaPendente, ordenarTarefas,
  validarAbastecimento, statusDepoisDoPasso, abastecidoDaTarefa, validarTransferencia, baixadoPorPedido,
  MSG_TAREFA_JA_ABERTA, MSG_SEM_MAXIMO, MSG_PICKING_CHEIO, MSG_SEM_AEREO, MSG_NAO_E_PICKING,
} from "../../compartilhado/regras/movimentacao.js";

const agora = () => new Date().toISOString();

// ---------- consultas ----------
export const tarefaPorId = (db, id) => db.tarefas.find((t) => t.id === id) || null;
export const limiteDe = (db, produto, enderecoId) => db.limites.find((l) => l.produto === produto && l.enderecoId === enderecoId) || null;
// fila do coletor: abertas e em andamento, urgentes primeiro
export const tarefasPendentes = (db) => ordenarTarefas(db.tarefas.filter(tarefaPendente));

// aéreos com saldo do produto, descontando o que outras tarefas pendentes já reservaram ali
function aereosDisponiveis(db, produto) {
  const reservado = (enderecoId) => db.tarefas.filter((t) => tarefaPendente(t) && t.produto === produto)
    .flatMap((t) => t.origens).filter((o) => o.enderecoId === enderecoId).reduce((s, o) => arredondarQtd(s + o.qtd - o.feito), 0);
  return db.saldos.filter((s) => s.produto === produto && s.qtd > 0)
    .map((s) => ({ endereco: enderecoPorId(db, s.enderecoId), saldo: s.qtd - reservado(s.enderecoId) }))
    .filter((a) => a.endereco && a.endereco.tipo === "aereo");
}

// ---------- abastecimento ----------
// monta a tarefa (sem gravar): picking do produto, quantidade até o máximo e as origens no aéreo.
// quem: "sistema" (automática), "coletor" (pedido do estoquista) ou "gestor" (WEB).
function montarTarefa(db, produto, pickingId, { prioridade = "normal", quem, usuario = "" }) {
  const picking = enderecoPorId(db, pickingId);
  if (!picking) return { ok: false, msg: MSG_ENDERECO_NAO_ENCONTRADO };
  if (!picking.ativo) return { ok: false, msg: MSG_ENDERECO_INATIVO };
  if (picking.tipo !== "picking") return { ok: false, msg: MSG_NAO_E_PICKING };
  if (tarefaDuplicada(db.tarefas, produto, pickingId)) return { ok: false, msg: MSG_TAREFA_JA_ABERTA };
  const limite = limiteDe(db, produto, pickingId);
  if (!limite) return { ok: false, msg: MSG_SEM_MAXIMO };
  const falta = necessidade(saldoNoEndereco(db, pickingId, produto), limite.maximo);
  if (falta <= 0) return { ok: false, msg: MSG_PICKING_CHEIO };
  const origens = escolherOrigens(aereosDisponiveis(db, produto), falta, picking);
  if (!origens.length) return { ok: false, msg: MSG_SEM_AEREO };
  const tarefa = { id: db.proximoId.tarefa++, produto, pickingId, prioridade, status: "aberta", quem, usuario, criada: agora(),
    necessidade: falta, origens: origens.map((o) => ({ ...o, feito: 0 })) };
  return { ok: true, tarefa };
}

// solicitação manual (estoquista no coletor ou gestor no WEB). Vale mesmo com o picking acima do mínimo.
export function criarTarefa(produto, pickingId, { prioridade = "normal", quem, usuario } = {}) {
  const db = lerEstoque();
  const r = montarTarefa(db, produto, pickingId, { prioridade, quem, usuario });
  if (!r.ok) return r;
  db.tarefas.push(r.tarefa);
  gravarEstoque(db);
  return r;
}

// abastecimento automático: quando o saldo do picking atinge ou fica abaixo do mínimo.
// Chamado depois de cada baixa no picking (separação, transferência). Mexe só no db recebido; quem chama grava.
function verificarAutomatico(db, produto, pickingId) {
  const limite = limiteDe(db, produto, pickingId);
  if (!limite || !precisaAbastecer(saldoNoEndereco(db, pickingId, produto), limite.minimo)) return;
  const r = montarTarefa(db, produto, pickingId, { quem: "sistema" });
  if (r.ok) db.tarefas.push(r.tarefa);
}

// um passo no coletor: retirou de uma origem e guardou no picking. Efetiva ao tocar CONFIRMAR ABASTECIMENTO.
export function abastecer(tarefaId, { origemId, produto, qtd, destinoId, usuario }) {
  const db = lerEstoque();
  const t = tarefaPorId(db, tarefaId);
  if (!t || !tarefaPendente(t)) return { ok: false, msg: "TAREFA NÃO ESTÁ MAIS DISPONÍVEL." };
  const destino = enderecoPorId(db, destinoId);
  const erro = validarAbastecimento(t, { origemId, produto, qtd, destino, saldoOrigem: saldoNoEndereco(db, origemId, produto) });
  if (erro) return { ok: false, msg: erro };
  const quantidade = lerQuantidade(qtd);
  mover(db, { tipo: "abastecimento", produto, qtd: quantidade, origemId, destinoId, usuario, tarefa: t.id });
  const origem = t.origens.find((o) => o.enderecoId === origemId);
  origem.feito = arredondarQtd(origem.feito + quantidade);
  t.status = statusDepoisDoPasso(t);
  if (t.status === "concluida") t.fim = agora();
  t.usuario = usuario || t.usuario;
  gravarEstoque(db);
  return { ok: true, tarefa: t };
}

// retirou menos que o planejado: termina a tarefa como PARCIAL (o restante fica sem nova tarefa automática)
export function finalizarParcial(tarefaId) {
  const db = lerEstoque();
  const t = tarefaPorId(db, tarefaId);
  if (!t || !tarefaPendente(t)) return { ok: false, msg: "TAREFA NÃO ESTÁ MAIS DISPONÍVEL." };
  if (abastecidoDaTarefa(t) === 0) return { ok: false, msg: "NADA FOI ABASTECIDO AINDA. PARA DESISTIR, CANCELE A TAREFA." };
  t.status = "parcial"; t.fim = agora();
  gravarEstoque(db);
  return { ok: true };
}

// cancelar: pelo estoquista no coletor ou pelo gestor no WEB. O que já foi abastecido continua no picking.
export function cancelarTarefa(tarefaId) {
  const db = lerEstoque();
  const t = tarefaPorId(db, tarefaId);
  if (!t || !tarefaPendente(t)) return { ok: false, msg: "TAREFA NÃO ESTÁ MAIS DISPONÍVEL." };
  t.status = "cancelada"; t.fim = agora();
  gravarEstoque(db);
  return { ok: true };
}

// prioridade: NORMAL ou URGENTE (o gestor eleva)
export function alterarPrioridade(tarefaId, prioridade) {
  const db = lerEstoque();
  const t = tarefaPorId(db, tarefaId);
  if (!t || !tarefaPendente(t)) return { ok: false, msg: "TAREFA NÃO ESTÁ MAIS DISPONÍVEL." };
  t.prioridade = prioridade;
  gravarEstoque(db);
  return { ok: true };
}

// mínimo e máximo de um produto num picking (WEB). Ao salvar, já confere se precisa abastecer.
export function salvarLimite(produto, enderecoId, { minimo, maximo }) {
  const erro = validarLimite({ minimo, maximo });
  if (erro) return { ok: false, msg: erro };
  const db = lerEstoque();
  const l = limiteDe(db, produto, enderecoId);
  if (l) Object.assign(l, { minimo: lerQuantidade(minimo), maximo: lerQuantidade(maximo) });
  else db.limites.push({ produto, enderecoId, minimo: lerQuantidade(minimo), maximo: lerQuantidade(maximo) });
  const antes = db.tarefas.length;
  verificarAutomatico(db, produto, enderecoId);
  gravarEstoque(db);
  return { ok: true, tarefaCriada: db.tarefas.length > antes };
}

// ---------- transferência ----------
// quanto dá para transferir: na doca, o que ainda espera armazenamento fica reservado para o Armazenamento
// (só a sobra — por exemplo, o que o gestor cancelou do pendente — pode sair por transferência)
export function saldoTransferivel(db, enderecoId, produto) {
  const saldo = saldoNoEndereco(db, enderecoId, produto);
  const e = enderecoPorId(db, enderecoId);
  if (!e || e.tipo !== "doca") return saldo;
  return Math.max(0, saldo - pendenteNaDoca(db.conferencias, produto, enderecoId));
}

// move do endereço de origem para o de destino; se a origem for picking e ficar no mínimo, nasce a tarefa automática
export function transferir({ origemId, produto, qtd, destinoId, usuario }) {
  const db = lerEstoque();
  const origem = enderecoPorId(db, origemId), destino = enderecoPorId(db, destinoId);
  const erro = validarTransferencia({ origem, destino, saldoOrigem: saldoTransferivel(db, origemId, produto), qtd });
  if (erro) return { ok: false, msg: erro };
  mover(db, { tipo: "transferencia", produto, qtd: lerQuantidade(qtd), origemId, destinoId, usuario });
  if (origem.tipo === "picking") verificarAutomatico(db, produto, origemId);
  gravarEstoque(db);
  return { ok: true };
}

// ---------- separação ----------
// o separador confirmou o item: o saldo do picking diminui (nunca fica negativo).
// O item da separação traz o código do endereço (R3001-P1-A100-AP101) e o código do produto.
export function baixarPorSeparacao({ endereco, produto, qtd, usuario, pedido }) {
  const quantidade = lerQuantidade(qtd);
  if (!(quantidade > 0)) return;
  const db = lerEstoque();
  const e = db.enderecos.find((x) => x.codigo === endereco && x.ativo);
  if (!e) return;
  const antes = saldoNoEndereco(db, e.id, produto);
  const tirar = Math.min(quantidade, antes);
  if (tirar > 0) {
    somarSaldo(db, e.id, produto, -tirar);
    registrarMovimento(db, { tipo: "separacao", produto, qtd: tirar, origem: e.id, usuario, pedido, saldoOrigemAntes: antes, saldoOrigemDepois: antes - tirar });
  }
  // o separador confirmou mais do que o sistema tinha: o saldo para em zero (é o que o sistema sabe) e a
  // diferença vira uma divergência para o gestor de estoque investigar (sugestão: inventário rotativo do endereço)
  if (quantidade > antes) {
    db.divergencias.push({ id: db.proximoId.divergencia++, enderecoId: e.id, produto, pedido, usuario, quando: new Date().toISOString(),
      sistema: antes, separado: quantidade, diferenca: quantidade - antes, status: "aberta", inventario: null });
  }
  if (e.tipo === "picking") verificarAutomatico(db, produto, e.id);
  gravarEstoque(db);
}

// "separar novamente": tudo o que a separação anterior deste pedido baixou volta para o mesmo endereço,
// com movimento de estorno (assim a nova separação baixa de novo sem tirar duas vezes).
export function estornarSeparacao({ pedido, usuario }) {
  const db = lerEstoque();
  const devolver = baixadoPorPedido(db.movimentos, pedido);
  for (const d of devolver) {
    const antes = saldoNoEndereco(db, d.enderecoId, d.produto);
    somarSaldo(db, d.enderecoId, d.produto, d.qtd);
    registrarMovimento(db, { tipo: "estorno-separacao", produto: d.produto, qtd: d.qtd, destino: d.enderecoId, usuario, pedido,
      saldoDestinoAntes: antes, saldoDestinoDepois: antes + d.qtd });
  }
  if (devolver.length) gravarEstoque(db);
  return devolver;
}

// devolução de pedido cortado/cancelado: o conferente tirou as unidades da caixa e leu o QR da doca de devolução.
// O saldo entra na doca e fica pendente de armazenar (o estoquista guarda pelo Armazenamento, como uma nota).
// itens: [{ produto, qtd }]
export function registrarDevolucao({ pedido, itens, docaId, usuario }) {
  const db = lerEstoque();
  const erro = validarDocaDevolucao(enderecoPorId(db, docaId));
  if (erro) return { ok: false, msg: erro };
  const dia = new Date().toLocaleDateString("sv-SE"); // AAAA-MM-DD, como no recebimento
  for (const { produto, qtd } of itens.filter((i) => i.qtd > 0)) {
    const antes = saldoNoEndereco(db, docaId, produto);
    somarSaldo(db, docaId, produto, qtd);
    registrarMovimento(db, { tipo: "devolucao", produto, qtd, destino: docaId, usuario, pedido, saldoDestinoAntes: antes, saldoDestinoDepois: arredondarQtd(antes + qtd) });
    // mesma pendência de armazenar que a conferência de uma nota cria (sem nota: vem do pedido)
    db.conferencias.push({ id: db.proximoId.conferencia++, notaId: null, devolucao: pedido, produto, qtd, docaId, dia, armazenado: 0, cancelado: 0, volumes: [] });
  }
  gravarEstoque(db);
  return { ok: true };
}

// tira da origem, põe no destino e registra o movimento com os saldos de antes e depois (base dos relatórios)
function mover(db, { tipo, produto, qtd, origemId, destinoId, usuario, tarefa }) {
  const oAntes = saldoNoEndereco(db, origemId, produto), dAntes = saldoNoEndereco(db, destinoId, produto);
  somarSaldo(db, origemId, produto, -qtd);
  somarSaldo(db, destinoId, produto, qtd);
  registrarMovimento(db, { tipo, produto, qtd, origem: origemId, destino: destinoId, usuario, tarefa,
    saldoOrigemAntes: oAntes, saldoOrigemDepois: arredondarQtd(oAntes - qtd), saldoDestinoAntes: dAntes, saldoDestinoDepois: arredondarQtd(dAntes + qtd) });
}
