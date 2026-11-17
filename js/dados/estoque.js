// WMS Beach Bike — camada de dados do Estoque (endereços, produtos, embalagens, endereço padrão e saldos).
// Só este arquivo sabe ONDE esses dados ficam guardados.
// Hoje: no localStorage do navegador (o painel WEB e o coletor de demonstração enxergam o mesmo dado).
// Na Fase 1: o servidor guarda o cadastro e o coletor trabalha com uma cópia local + fila de sincronização,
// sem precisar mudar as telas.
import { estoqueDeDemonstracao, importacaoDoErp } from "../demo-dados.js";
import {
  podeDesativar, codigoEmUso, codigoDoEndereco, TIPOS_ENDERECO, podeAssociar, partesDoEndereco, validarPartes, MSG_ENDERECO_EM_USO,
} from "../../compartilhado/regras/enderecos.js";
import { validarEmbalagem, separarImportacao } from "../../compartilhado/regras/embalagens.js";
import { tarefasNoEndereco } from "../../compartilhado/regras/movimentacao.js";
import { exigeCheckout } from "../../compartilhado/regras/produtos.js";

// v7: conferência por checkout no produto; v6: docas de expedição; v5: Inventário físico; v4: Movimentação (tarefas de abastecimento e mínimo/máximo); v3 trouxe os produtos reais, v2 o Recebimento.
// Mudar a chave troca a demonstração antiga pela nova.
const CHAVE = "wms-bb-estoque-v7";

// tudo o que está guardado; no primeiro acesso (ou se o dado estiver corrompido), começa com a demonstração
export function lerEstoque() {
  try {
    const d = JSON.parse(localStorage.getItem(CHAVE));
    if (d && Array.isArray(d.enderecos) && Array.isArray(d.produtos) && Array.isArray(d.notas) && Array.isArray(d.tarefas) && Array.isArray(d.inventarios)) return d;
  } catch {}
  return estoqueDeDemonstracao();
}

function gravar(db) {
  localStorage.setItem(CHAVE, JSON.stringify(db));
}
// as outras camadas de dados do Estoque (ex.: recebimento) gravam pelo mesmo caminho
export const gravarEstoque = gravar;

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

// saldo de um produto num endereço
export const saldoNoEndereco = (db, enderecoId, produto) =>
  db.saldos.filter((s) => s.enderecoId === enderecoId && s.produto === produto).reduce((t, s) => t + s.qtd, 0);

// soma (ou tira, com delta negativo) saldo de um produto num endereço. Quem chama já conferiu que não fica negativo.
export function somarSaldo(db, enderecoId, produto, delta) {
  let s = db.saldos.find((x) => x.enderecoId === enderecoId && x.produto === produto);
  if (!s) { s = { enderecoId, produto, qtd: 0 }; db.saldos.push(s); }
  s.qtd += delta;
  // saldo zerado sai da lista (a consulta só mostra endereços com saldo)
  if (s.qtd === 0) db.saldos = db.saldos.filter((x) => x !== s);
}

// registro de cada movimento de estoque (base do Extrato, quando os relatórios entrarem)
export function registrarMovimento(db, movimento) {
  db.movimentos.push({ quando: new Date().toISOString(), ...movimento });
}

// endereços padrão do produto e produtos padrão do endereço (ENDEREÇAR PRODUTO)
export const enderecosPadraoDoProduto = (db, codigo) =>
  db.associacoes.filter((a) => a.produto === codigo).map((a) => enderecoPorId(db, a.enderecoId));
export const produtosDoEndereco = (db, enderecoId) =>
  db.associacoes.filter((a) => a.enderecoId === enderecoId).map((a) => produtoPorCodigo(db, a.produto));

// ---------- endereços ----------
// cadastra um endereço com os números da prateleira (rua 3001, prédio 1, andar 100, apto 101 → R3001-P1-A100-AP101).
// Recebe um ID novo, que é o que vai no QR da prateleira. Devolve { ok, endereco } ou { ok: false, msg }.
export function criarEndereco({ rua, predio, andar, apto, tipo, deposito }) {
  const db = lerEstoque();
  const erro = validarPartes({ rua, predio, andar, apto });
  if (erro) return { ok: false, msg: erro };
  if (!TIPOS_ENDERECO[tipo]) return { ok: false, msg: "Escolha o tipo do endereço." };
  const partes = partesDoEndereco({ rua, predio, andar, apto });
  if (codigoEmUso(db.enderecos, partes)) return { ok: false, msg: MSG_ENDERECO_EM_USO };
  const novo = { id: db.proximoId.endereco++, ...partes, codigo: codigoDoEndereco(partes), tipo,
    deposito: String(deposito || "").trim() || "Principal", ativo: true, substituidoPor: null };
  db.enderecos.push(novo);
  gravar(db);
  return { ok: true, endereco: novo };
}

// grava os endereços gerados em lote; os que já existem ativos com o mesmo código são pulados (não duplica)
export function criarEnderecos(novos, deposito) {
  const db = lerEstoque();
  const ativos = new Set(db.enderecos.filter((e) => e.ativo).map((e) => e.codigo));
  let criados = 0, ignorados = 0;
  for (const e of novos) {
    if (ativos.has(e.codigo)) { ignorados++; continue; }
    db.enderecos.push({ ...e, id: db.proximoId.endereco++, deposito: String(deposito || "").trim() || "Principal", ativo: true, substituidoPor: null });
    ativos.add(e.codigo); criados++;
  }
  gravar(db);
  return { criados, ignorados };
}

export function desativarEndereco(id) {
  const db = lerEstoque();
  const e = enderecoPorId(db, id);
  // com saldo (inclusive o que espera armazenamento na doca) ou com tarefa de abastecimento pendente, não desativa
  const r = podeDesativar({ saldo: saldoDoEndereco(db, id), tarefasPendentes: tarefasNoEndereco(db.tarefas, id) });
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
  const erro = validarPartes({ rua, predio, andar, apto });
  if (erro) return { ok: false, msg: erro };
  const partes = partesDoEndereco({ rua, predio, andar, apto });
  if (codigoEmUso(db.enderecos, partes, id)) return { ok: false, msg: MSG_ENDERECO_EM_USO };
  const novo = { id: db.proximoId.endereco++, ...partes, codigo: codigoDoEndereco(partes), tipo, deposito, ativo: true, substituidoPor: null };
  db.enderecos.push(novo);
  antigo.substituidoPor = novo.id;
  gravar(db);
  return { ok: true, endereco: novo };
}

// ---------- produtos ----------
// a Conferência pergunta aqui se o produto exige checkout (bipe por unidade)
export const produtoExigeCheckout = (codigo) => exigeCheckout(produtoPorCodigo(lerEstoque(), codigo));
// várias perguntas de uma vez (lê o estoque uma vez só): devolve uma função codigo → true/false
export function consultaDeCheckout() {
  const db = lerEstoque();
  return (codigo) => exigeCheckout(produtoPorCodigo(db, codigo));
}
// só o gestor de estoque liga/desliga; fica registrado quem mudou e quando
export function definirCheckout(codigo, ligado, usuario) {
  const db = lerEstoque(), p = produtoPorCodigo(db, codigo);
  if (!p) return "Produto não encontrado.";
  p.checkout = !!ligado;
  p.checkoutAlterado = { por: usuario, quando: Date.now(), ligado: !!ligado };
  gravar(db);
  return null;
}
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
