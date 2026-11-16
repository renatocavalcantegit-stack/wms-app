// WMS Beach Bike — camada de dados do Estoque (endereços, produtos, embalagens, endereço padrão e saldos).
// Só este arquivo sabe ONDE esses dados ficam guardados.
// Hoje: no localStorage do navegador (o painel WEB e o coletor de demonstração enxergam o mesmo dado).
// Na Fase 1: o servidor guarda o cadastro e o coletor trabalha com uma cópia local + fila de sincronização,
// sem precisar mudar as telas.
import { estoqueDeDemonstracao, importacaoDoErp } from "../demo-dados.js";
import { podeDesativar, conflitoAoReativar, codigoDoEndereco, podeAssociar, MSG_ENDERECO_EM_USO } from "../../compartilhado/regras/enderecos.js";
import { validarEmbalagem, separarImportacao } from "../../compartilhado/regras/embalagens.js";

const CHAVE = "wms-bb-estoque-v1";

// tudo o que está guardado; no primeiro acesso (ou se o dado estiver corrompido), começa com a demonstração
export function lerEstoque() {
  try {
    const d = JSON.parse(localStorage.getItem(CHAVE));
    if (d && Array.isArray(d.enderecos) && Array.isArray(d.produtos)) return d;
  } catch {}
  return estoqueDeDemonstracao();
}

function gravar(db) {
  localStorage.setItem(CHAVE, JSON.stringify(db));
}

export function reiniciarDemonstracao() {
  localStorage.removeItem(CHAVE);
}

// avisa a tela quando OUTRA aba/janela (ex.: o coletor) mudou o estoque — é o "tempo real" da demonstração
export function aoMudarEstoque(fn) {
  window.addEventListener("storage", (e) => { if (e.key === CHAVE) fn(); });
}

// ---------- consultas ----------
export const enderecoPorId = (db, id) => db.enderecos.find((e) => e.id === id) || null;
export const produtoPorCodigo = (db, codigo) => db.produtos.find((p) => p.codigo === codigo) || null;
export const embalagensDoProduto = (db, codigo) => db.embalagens.filter((e) => e.produto === codigo);

// soma de tudo o que está guardado num endereço (todos os produtos)
export const saldoDoEndereco = (db, enderecoId) =>
  db.saldos.filter((s) => s.enderecoId === enderecoId).reduce((t, s) => t + s.qtd, 0);

// onde o produto está, só endereços com saldo maior que zero (consulta de produto)
export function saldosDoProduto(db, codigo) {
  return db.saldos
    .filter((s) => s.produto === codigo && s.qtd > 0)
    .map((s) => ({ endereco: enderecoPorId(db, s.enderecoId), qtd: s.qtd }));
}

// endereços padrão do produto e produtos padrão do endereço (ENDEREÇAR PRODUTO)
export const enderecosPadraoDoProduto = (db, codigo) =>
  db.associacoes.filter((a) => a.produto === codigo).map((a) => enderecoPorId(db, a.enderecoId));
export const produtosDoEndereco = (db, enderecoId) =>
  db.associacoes.filter((a) => a.enderecoId === enderecoId).map((a) => produtoPorCodigo(db, a.produto));

// ---------- endereços ----------
// grava os endereços gerados em lote; os que já existem ativos com o mesmo código são ignorados (não duplica)
export function criarEnderecos(novos, deposito) {
  const db = lerEstoque();
  const ativos = new Set(db.enderecos.filter((e) => e.ativo).map((e) => e.codigo));
  let criados = 0, ignorados = 0;
  for (const e of novos) {
    if (ativos.has(e.codigo)) { ignorados++; continue; }
    db.enderecos.push({ ...e, id: db.proximoId.endereco++, deposito: deposito || "Principal", ativo: true, substituidoPor: null });
    ativos.add(e.codigo); criados++;
  }
  gravar(db);
  return { criados, ignorados };
}

export function desativarEndereco(id) {
  const db = lerEstoque();
  const e = enderecoPorId(db, id);
  // tarefas pendentes (abastecimento, armazenamento) entram aqui quando esses módulos existirem
  const r = podeDesativar({ saldo: saldoDoEndereco(db, id), tarefasPendentes: 0 });
  if (!r.ok) return r;
  e.ativo = false;
  gravar(db);
  return { ok: true };
}

// reativar com os mesmos ou novos dados: nasce um endereço novo (ID e QR novos).
// O antigo continua inativo para sempre, guardando o histórico, e o QR antigo segue bloqueado.
export function reativarEndereco(id, { rua, predio, andar, apto, tipo, deposito }) {
  const db = lerEstoque();
  const antigo = enderecoPorId(db, id);
  const partes = { rua: +rua, predio: +predio, andar: +andar, apto: +apto };
  if (Object.values(partes).some((n) => !Number.isInteger(n) || n < 1)) return { ok: false, msg: "Rua, prédio, andar e apartamento: números inteiros a partir de 1." };
  if (conflitoAoReativar(db.enderecos, partes, id)) return { ok: false, msg: MSG_ENDERECO_EM_USO };
  const novo = { id: db.proximoId.endereco++, ...partes, codigo: codigoDoEndereco(partes), tipo, deposito, ativo: true, substituidoPor: null };
  db.enderecos.push(novo);
  antigo.substituidoPor = novo.id;
  gravar(db);
  return { ok: true, endereco: novo };
}

// ---------- produtos ----------
// importação simulada do ERP: produto que já existe é bloqueado, sem alterar o que está no WMS
export function importarProdutosDoErp() {
  const db = lerEstoque();
  const r = separarImportacao(db.produtos, importacaoDoErp());
  db.produtos.push(...r.importados);
  gravar(db);
  return r;
}

// ---------- embalagens ----------
// cria (sem id) ou altera (com id) uma embalagem; devolve { ok, msg }
export function salvarEmbalagem(produto, dados, id = null) {
  const db = lerEstoque();
  const r = validarEmbalagem(dados, db.embalagens, id);
  if (!r.ok) return r;
  if (id) Object.assign(db.embalagens.find((e) => e.id === id), r.embalagem);
  else db.embalagens.push({ id: db.proximoId.embalagem++, produto, ...r.embalagem });
  gravar(db);
  return { ok: true };
}

export function excluirEmbalagem(id) {
  const db = lerEstoque();
  db.embalagens = db.embalagens.filter((e) => e.id !== id);
  gravar(db);
}

// ---------- endereço padrão ----------
export function associarProduto(produto, enderecoId) {
  const db = lerEstoque();
  const r = podeAssociar(db.associacoes, produto, enderecoPorId(db, enderecoId));
  if (!r.ok) return r;
  db.associacoes.push({ produto, enderecoId });
  gravar(db);
  return { ok: true };
}

export function removerAssociacao(produto, enderecoId) {
  const db = lerEstoque();
  db.associacoes = db.associacoes.filter((a) => !(a.produto === produto && a.enderecoId === enderecoId));
  gravar(db);
}
