// WMS Beach Bike — regras do INVENTÁRIO FÍSICO (Auditoria). Funções puras: não leem nem gravam nada.
// A contagem não mexe no estoque. Divergência vai para o gestor aprovar ou rejeitar, e o saldo só muda na sincronização.
import { MSG_ENDERECO_INATIVO } from "./enderecos.js";
import { lerQuantidade, quantidadeValida, arredondarQtd } from "./quantidade.js";

export const MSG_PRODUTO_FORA_DO_ENDERECO = "PRODUTO NÃO PERTENCE A ESTE ENDEREÇO.";
export const MSG_ENDERECO_FORA_DO_INVENTARIO = "ENDEREÇO NÃO FAZ PARTE DESTE INVENTÁRIO.";
export const MSG_ENDERECO_FORA_DA_RUA = "ENDEREÇO DE OUTRA RUA. LEIA UM ENDEREÇO DA RUA ESCOLHIDA.";
export const MSG_ENDERECO_CONCLUIDO = "CONTAGEM DESTE ENDEREÇO JÁ CONCLUÍDA.";
export const MSG_INVENTARIO_FECHADO = "INVENTÁRIO FINALIZADO. NÃO RECEBE NOVAS CONTAGENS.";

export const TIPOS_INVENTARIO = { completo: "Completo", rotativo: "Rotativo" };
export const STATUS_INVENTARIO = { aberto: "Em aberto", finalizado: "Finalizado", sincronizado: "Sincronizado" };
// situação de cada item (produto num endereço)
export const STATUS_ITEM = {
  nao_contado: "Não contado", contando: "Em contagem", ok: "Sem divergência",
  divergente: "Aguardando aprovação", aprovado: "Aprovado", rejeitado: "Rejeitado",
};
// C5 é o limite: chegou nela, encerra e ela é a quantidade considerada
export const MAXIMO_CONTAGENS = 5;

// endereços que entram no inventário: picking e aéreo ativos (a doca guarda o que ainda vai ser armazenado)
export const enderecoInventariavel = (e) => !!e && e.ativo && (e.tipo === "picking" || e.tipo === "aereo");

// produtos previstos num endereço: os que têm saldo nele ou estão associados a ele (endereço padrão)
export function previstosDoEndereco(enderecoId, saldos, associacoes) {
  const set = new Set();
  saldos.forEach((s) => s.enderecoId === enderecoId && s.qtd > 0 && set.add(s.produto));
  associacoes.forEach((a) => a.enderecoId === enderecoId && set.add(a.produto));
  return [...set];
}

// ---------- sequência das contagens (C1…C5) ----------
// C1 = C2 encerra; C1 ≠ C2 gera C3; C3 = C2 encerra; … C5 é o limite.
// Ou seja: encerra quando a última contagem é igual à anterior, ou quando chega na C5.
export function itemEncerrado(contagens) {
  const n = contagens.length;
  if (n >= MAXIMO_CONTAGENS) return true;
  return n >= 2 && contagens[n - 1].qtd === contagens[n - 2].qtd;
}
// número da próxima contagem do item (null quando já encerrou)
export const proximaContagem = (contagens) => (itemEncerrado(contagens) ? null : contagens.length + 1);
// quantidade considerada para o ajuste: a última contagem de um item encerrado (na C5, a própria C5)
export const quantidadeConsiderada = (contagens) => (itemEncerrado(contagens) ? contagens[contagens.length - 1].qtd : null);

// situação do item, comparando a quantidade considerada com o saldo do sistema
export function statusDoItem(item, saldoSistema) {
  if (!item.contagens.length) return "nao_contado";
  if (!itemEncerrado(item.contagens)) return "contando";
  if (item.decisao) return item.decisao; // aprovado / rejeitado
  return quantidadeConsiderada(item.contagens) === saldoSistema ? "ok" : "divergente";
}
// diferença que o ajuste aplicaria (contado − sistema)
export const diferenca = (item, saldoSistema) => (itemEncerrado(item.contagens) ? quantidadeConsiderada(item.contagens) - saldoSistema : null);

// situação do endereço: pendente (ninguém finalizou), recontagem (algum item ainda precisa de nova contagem) ou concluído.
// "contado" = alguém já clicou FINALIZAR CONTAGEM nele (um endereço vazio, sem nada previsto nem achado, conclui assim).
export function statusDoEndereco(itensDoEndereco, contado = false) {
  if (!itensDoEndereco.length) return contado ? "concluido" : "pendente";
  if (itensDoEndereco.every((i) => !i.contagens.length)) return "pendente";
  return itensDoEndereco.every((i) => itemEncerrado(i.contagens)) ? "concluido" : "recontagem";
}
// contagem que o endereço está pedindo agora (a menor entre os itens abertos)
export function contagemDoEndereco(itensDoEndereco) {
  const abertos = itensDoEndereco.map((i) => proximaContagem(i.contagens)).filter(Boolean);
  return abertos.length ? Math.min(...abertos) : null;
}

// ---------- coletor ----------
// produto lido no endereço: no rotativo só o previsto; no completo qualquer produto (o não previsto entra na contagem)
export function validarProdutoNaContagem(inv, itensDoEndereco, produto) {
  if (inv.status !== "aberto") return MSG_INVENTARIO_FECHADO;
  const item = itensDoEndereco.find((i) => i.produto === produto);
  if (inv.tipo === "rotativo" && !item) return MSG_PRODUTO_FORA_DO_ENDERECO;
  // item já encerrado (ex.: só outro produto do endereço está em recontagem) não recebe nova contagem
  if (item && itemEncerrado(item.contagens)) return "ESTE PRODUTO JÁ TEVE A CONTAGEM ENCERRADA NESTE ENDEREÇO.";
  return null;
}
export function validarQuantidadeContada(qtd) {
  // aceita quantidade quebrada (101,5), com até 3 casas depois da vírgula
  if (!quantidadeValida(lerQuantidade(qtd))) return "Informe a quantidade contada (zero ou mais, até 3 casas depois da vírgula).";
  return null;
}

// FINALIZAR CONTAGEM do endereço: cada item aberto recebe a contagem da vez com o que foi incluído
// (o previsto que não foi bipado conta ZERO). Produto novo (completo) vira item com a sua C1.
// Devolve as contagens a gravar: [{ produto, qtd, novo }]
export function fecharContagemDoEndereco(itensDoEndereco, incluidos) {
  const soma = {};
  incluidos.forEach((x) => (soma[x.produto] = arredondarQtd((soma[x.produto] || 0) + x.qtd)));
  const fora = [];
  itensDoEndereco.filter((i) => !itemEncerrado(i.contagens)).forEach((i) => fora.push({ produto: i.produto, qtd: soma[i.produto] || 0, novo: false }));
  Object.keys(soma).filter((p) => !itensDoEndereco.some((i) => i.produto === p)).forEach((p) => fora.push({ produto: p, qtd: soma[p], novo: true }));
  return fora;
}

// ---------- WEB ----------
export function validarNovoInventario({ tipo, descricao, ruas, pares }) {
  if (!TIPOS_INVENTARIO[tipo]) return "Escolha o tipo do inventário.";
  if (!String(descricao || "").trim()) return "Informe a descrição do inventário.";
  if (tipo === "completo" && !(ruas && ruas.length)) return "Escolha pelo menos uma rua.";
  if (tipo === "rotativo" && !(pares && pares.length)) return "Selecione pelo menos um produto/endereço.";
  return null;
}

// só item encerrado com divergência recebe decisão; e só antes de sincronizar
export function podeDecidir(inv, item, saldoSistema) {
  if (inv.status === "sincronizado") return "INVENTÁRIO SINCRONIZADO. SOMENTE CONSULTA.";
  if (!itemEncerrado(item.contagens)) return "A CONTAGEM DESTE ITEM AINDA NÃO ENCERROU.";
  if (quantidadeConsiderada(item.contagens) === saldoSistema && !item.decisao) return "ITEM SEM DIVERGÊNCIA.";
  return null;
}

// sincronização: monta TODOS os ajustes aprovados. Se qualquer um não puder ser aplicado, nenhum é (atômico).
// itens: [{ produto, enderecoId, endereco, contagens, decisao, saldo }]  →  { ok, ajustes } ou { ok: false, msg }
export function planejarSincronizacao(inv, itens) {
  if (inv.status === "aberto") return { ok: false, msg: "FINALIZE O INVENTÁRIO ANTES DE SINCRONIZAR." };
  if (inv.status === "sincronizado") return { ok: false, msg: "INVENTÁRIO JÁ SINCRONIZADO." };
  const ajustes = [];
  for (const i of itens) {
    if (i.decisao !== "aprovado" || !itemEncerrado(i.contagens)) continue;
    const contado = quantidadeConsiderada(i.contagens);
    if (contado === i.saldo) continue; // o saldo já bate (mudou depois da contagem): nada a ajustar
    if (!i.endereco || !i.endereco.ativo) return { ok: false, msg: `${MSG_ENDERECO_INATIVO} (${i.endereco ? i.endereco.codigo : "?"}) NENHUM AJUSTE FOI APLICADO.` };
    ajustes.push({ produto: i.produto, enderecoId: i.enderecoId, antes: i.saldo, delta: contado - i.saldo, depois: contado });
  }
  return { ok: true, ajustes };
}

// indicadores do painel
export function indicadores(itens, enderecoIds, saldoDe, contados = {}) {
  const porEnd = {};
  itens.forEach((i) => (porEnd[i.enderecoId] ||= []).push(i));
  const stEnd = enderecoIds.map((id) => statusDoEndereco(porEnd[id] || [], !!contados[id]));
  const st = itens.map((i) => statusDoItem(i, saldoDe(i)));
  const c = (k) => st.filter((s) => s === k).length;
  const concluidos = stEnd.filter((s) => s === "concluido").length;
  return {
    pct: enderecoIds.length ? Math.round((concluidos / enderecoIds.length) * 100) : 0,
    enderecos: enderecoIds.length, concluidos, pendentes: enderecoIds.length - concluidos,
    previstos: itens.filter((i) => i.previsto).length,
    contados: itens.filter((i) => itemEncerrado(i.contagens)).length,
    naoContados: itens.filter((i) => !itemEncerrado(i.contagens)).length,
    contagens: itens.reduce((t, i) => t + i.contagens.length, 0),
    divergencias: c("divergente") + c("aprovado") + c("rejeitado"),
    aguardando: c("divergente"), aprovados: c("aprovado"), rejeitados: c("rejeitado"),
  };
}
