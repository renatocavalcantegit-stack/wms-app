// WMS Beach Bike — camada de dados do INVENTÁRIO FÍSICO (Auditoria).
// Guarda os inventários junto do estoque (mesmo localStorage). A contagem não mexe no saldo:
// o saldo só muda em sincronizar(), de uma vez e só com os ajustes aprovados.
import { lerEstoque, gravarEstoque, enderecoPorId, saldoNoEndereco, somarSaldo, registrarMovimento } from "./estoque.js";
import { podeAssociar } from "../../compartilhado/regras/enderecos.js";
import { lerQuantidade } from "../../compartilhado/regras/quantidade.js";
import {
  enderecoInventariavel, previstosDoEndereco, validarNovoInventario, validarProdutoNaContagem, validarQuantidadeContada,
  fecharContagemDoEndereco, itemEncerrado, quantidadeConsiderada, podeDecidir, planejarSincronizacao, statusDoEndereco,
  MSG_ENDERECO_FORA_DO_INVENTARIO, MSG_ENDERECO_CONCLUIDO, MSG_INVENTARIO_FECHADO,
} from "../../compartilhado/regras/inventario.js";

const agora = () => new Date().toISOString();

// ---------- consultas ----------
export const inventarioPorId = (db, id) => db.inventarios.find((i) => i.id === id) || null;
// no coletor só aparecem os inventários em aberto
export const inventariosAbertos = (db) => db.inventarios.filter((i) => i.status === "aberto");
export const itensDoEndereco = (inv, enderecoId) => inv.itens.filter((i) => i.enderecoId === enderecoId);
export const incluidosNoEndereco = (inv, enderecoId) => inv.rascunhos[enderecoId] || [];
export const situacaoDoEndereco = (inv, enderecoId) => statusDoEndereco(itensDoEndereco(inv, enderecoId), !!inv.contados[enderecoId]);
// saldo do sistema agora (é com ele que a divergência é comparada)
export const saldoDoItem = (db, item) => saldoNoEndereco(db, item.enderecoId, item.produto);

// ---------- WEB: criar ----------
// completo: todas as prateleiras (picking e aéreo) das ruas escolhidas, com os produtos previstos de cada uma.
// rotativo: só os pares produto + endereço que o gestor marcou.
export function criarInventario({ tipo, descricao, ruas = [], pares = [], usuario }) {
  const db = lerEstoque();
  const erro = validarNovoInventario({ tipo, descricao, ruas, pares });
  if (erro) return { ok: false, msg: erro };
  let enderecos, itens;
  if (tipo === "completo") {
    enderecos = db.enderecos.filter((e) => enderecoInventariavel(e) && ruas.includes(e.rua)).map((e) => e.id);
    itens = enderecos.flatMap((id) => previstosDoEndereco(id, db.saldos, db.associacoes).map((produto) => novoItem(id, produto, true)));
  } else {
    itens = pares.filter((p) => enderecoInventariavel(enderecoPorId(db, p.enderecoId))).map((p) => novoItem(p.enderecoId, p.produto, true));
    enderecos = [...new Set(itens.map((i) => i.enderecoId))];
  }
  if (!enderecos.length) return { ok: false, msg: "Nenhum endereço ativo de picking ou aéreo nessa seleção." };
  const inv = {
    id: db.proximoId.inventario++, tipo, descricao: descricao.trim(), status: "aberto", ruas: tipo === "completo" ? ruas : [],
    enderecos, itens, rascunhos: {}, contados: {}, criado: agora(), criadoPor: usuario,
    finalizado: null, finalizadoPor: null, sincronizado: null, sincronizadoPor: null, sincErro: null, novosPadrao: [],
  };
  db.inventarios.push(inv);
  gravarEstoque(db);
  return { ok: true, inventario: inv };
}
const novoItem = (enderecoId, produto, previsto) => ({ enderecoId, produto, previsto, contagens: [], decisao: null, decididoPor: null, decididoEm: null, ajuste: null });

// ---------- COLETOR: contar ----------
// o endereço lido precisa estar no inventário e ainda ter contagem a fazer
export function validarEnderecoDaContagem(inv, enderecoId) {
  if (inv.status !== "aberto") return MSG_INVENTARIO_FECHADO;
  if (!inv.enderecos.includes(enderecoId)) return MSG_ENDERECO_FORA_DO_INVENTARIO;
  if (situacaoDoEndereco(inv, enderecoId) === "concluido") return MSG_ENDERECO_CONCLUIDO;
  return null;
}

// INCLUIR: guarda na hora (se o operador sair, ao voltar continua de onde parou)
export function incluir(invId, enderecoId, { produto, qtd, operador }) {
  const db = lerEstoque();
  const inv = inventarioPorId(db, invId);
  const erro = validarEnderecoDaContagem(inv, enderecoId) || validarProdutoNaContagem(inv, itensDoEndereco(inv, enderecoId), produto) || validarQuantidadeContada(qtd);
  if (erro) return { ok: false, msg: erro };
  (inv.rascunhos[enderecoId] ||= []).push({ produto, qtd: lerQuantidade(qtd), operador, quando: agora() });
  gravarEstoque(db);
  return { ok: true };
}

export function removerIncluido(invId, enderecoId, indice) {
  const db = lerEstoque();
  const inv = inventarioPorId(db, invId);
  if (inv.status !== "aberto") return { ok: false, msg: MSG_INVENTARIO_FECHADO };
  inv.rascunhos[enderecoId]?.splice(indice, 1);
  gravarEstoque(db);
  return { ok: true };
}

// FINALIZAR CONTAGEM: grava a contagem da vez de cada item aberto (sem sobrescrever as anteriores)
export function finalizarContagem(invId, enderecoId, operador) {
  const db = lerEstoque();
  const inv = inventarioPorId(db, invId);
  const erro = validarEnderecoDaContagem(inv, enderecoId);
  if (erro) return { ok: false, msg: erro };
  const quando = agora();
  for (const c of fecharContagemDoEndereco(itensDoEndereco(inv, enderecoId), incluidosNoEndereco(inv, enderecoId))) {
    let item = inv.itens.find((i) => i.enderecoId === enderecoId && i.produto === c.produto);
    if (!item) { item = novoItem(enderecoId, c.produto, false); inv.itens.push(item); }
    item.contagens.push({ n: item.contagens.length + 1, qtd: c.qtd, operador, quando });
  }
  delete inv.rascunhos[enderecoId];
  inv.contados[enderecoId] = true;
  gravarEstoque(db);
  return { ok: true, situacao: situacaoDoEndereco(inv, enderecoId) };
}

// ---------- WEB: analisar, finalizar e sincronizar ----------
// aprovar ou rejeitar a divergência (o gestor não digita quantidade)
export function decidir(invId, indice, decisao, usuario) {
  const db = lerEstoque();
  const inv = inventarioPorId(db, invId), item = inv.itens[indice];
  const erro = podeDecidir(inv, item, saldoDoItem(db, item));
  if (erro) return { ok: false, msg: erro };
  Object.assign(item, { decisao, decididoPor: usuario, decididoEm: agora() });
  gravarEstoque(db);
  return { ok: true };
}

// finalizar: bloqueia novas contagens na hora e o inventário some do coletor (pode ter endereço pendente)
export function finalizarInventario(invId, usuario) {
  const db = lerEstoque();
  const inv = inventarioPorId(db, invId);
  if (inv.status !== "aberto") return { ok: false, msg: "INVENTÁRIO JÁ FINALIZADO." };
  Object.assign(inv, { status: "finalizado", finalizado: agora(), finalizadoPor: usuario, rascunhos: {} });
  gravarEstoque(db);
  return { ok: true };
}

// sincronizar: aplica TODOS os ajustes aprovados de uma vez. Se um falhar, nenhum é aplicado e o inventário
// continua finalizado para nova tentativa. Depois do sucesso, fica só para consulta.
export function sincronizar(invId, usuario) {
  const db = lerEstoque();
  const inv = inventarioPorId(db, invId);
  const itens = inv.itens.map((i) => ({ ...i, endereco: enderecoPorId(db, i.enderecoId), saldo: saldoDoItem(db, i) }));
  const plano = planejarSincronizacao(inv, itens);
  if (!plano.ok) {
    if (inv.status === "finalizado") { inv.sincErro = plano.msg; gravarEstoque(db); }
    return plano;
  }
  const quando = agora();
  // guarda o saldo de cada item no momento da sincronização (o histórico compara com ele)
  inv.itens.forEach((it, k) => (it.saldoSinc = itens[k].saldo));
  for (const a of plano.ajustes) {
    somarSaldo(db, a.enderecoId, a.produto, a.delta);
    registrarMovimento(db, { tipo: "inventario", produto: a.produto, qtd: a.delta, origemId: null, destinoId: a.enderecoId,
      usuario, inventario: inv.id, saldoDestinoAntes: a.antes, saldoDestinoDepois: a.depois });
    inv.itens.find((i) => i.enderecoId === a.enderecoId && i.produto === a.produto).ajuste = { antes: a.antes, delta: a.delta, depois: a.depois, quando };
  }
  // inventário completo: produto achado num endereço que não é o padrão dele passa a ser padrão (só agora, nunca na contagem)
  if (inv.tipo === "completo") {
    for (const i of inv.itens) {
      if (!itemEncerrado(i.contagens) || quantidadeConsiderada(i.contagens) <= 0) continue;
      if (i.decisao === "rejeitado") continue;
      const e = enderecoPorId(db, i.enderecoId);
      if (!podeAssociar(db.associacoes, i.produto, e).ok) continue; // já é padrão (ou o endereço não aceita)
      db.associacoes.push({ produto: i.produto, enderecoId: i.enderecoId });
      inv.novosPadrao.push({ produto: i.produto, enderecoId: i.enderecoId, quando });
    }
  }
  Object.assign(inv, { status: "sincronizado", sincronizado: quando, sincronizadoPor: usuario, sincErro: null });
  gravarEstoque(db);
  return { ok: true, ajustes: plano.ajustes.length, novosPadrao: inv.novosPadrao.length };
}

// ---------- divergências de saldo da separação ----------
// o separador confirmou mais do que o sistema tinha no endereço; o gestor abre um inventário rotativo
// só daquele produto naquele endereço (a contagem corrige o saldo pelo caminho de sempre)
export function inventariarDivergencia(divergenciaId, usuario) {
  const d = lerEstoque().divergencias.find((x) => x.id === divergenciaId);
  if (!d || d.status !== "aberta") return { ok: false, msg: "DIVERGÊNCIA JÁ TRATADA." };
  const r = criarInventario({ tipo: "rotativo", descricao: `Divergência ${d.id} · ${d.produto}${d.pedido ? ` · ${d.pedido}` : ""}`,
    pares: [{ enderecoId: d.enderecoId, produto: d.produto }], usuario });
  if (!r.ok) return r;
  const db = lerEstoque();
  Object.assign(db.divergencias.find((x) => x.id === divergenciaId), { status: "inventario", inventario: r.inventario.id, tratadaPor: usuario, tratadaEm: agora() });
  gravarEstoque(db);
  return r;
}
// encerrar sem inventário (ex.: o gestor já sabe a causa); fica registrado quem encerrou
export function encerrarDivergencia(divergenciaId, usuario) {
  const db = lerEstoque();
  const d = db.divergencias.find((x) => x.id === divergenciaId);
  if (!d || d.status !== "aberta") return { ok: false, msg: "DIVERGÊNCIA JÁ TRATADA." };
  Object.assign(d, { status: "encerrada", tratadaPor: usuario, tratadaEm: agora() });
  gravarEstoque(db);
  return { ok: true };
}
