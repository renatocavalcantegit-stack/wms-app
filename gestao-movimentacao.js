// WMS Beach Bike — Gestão de Estoque (WEB), aba MOVIMENTAÇÃO: tarefas de abastecimento e mínimo/máximo do picking.
// O gestor gera tarefas, muda a prioridade e cancela; a execução é no coletor.
// A transferência no WEB é só relatório (fica para quando os relatórios entrarem).
import { esc } from "./js/util.js";
import { session } from "./js/sessao.js";
import { enderecoPorId, produtoPorCodigo, saldoNoEndereco, enderecosPadraoDoProduto } from "./js/dados/estoque.js";
import { tarefaPorId, limiteDe, criarTarefa, cancelarTarefa, alterarPrioridade, salvarLimite } from "./js/dados/movimentacao.js";
import { compararEnderecos } from "./compartilhado/regras/enderecos.js";
import { buscarProdutos } from "./compartilhado/regras/embalagens.js";
import { PRIORIDADES, STATUS_TAREFA, tarefaPendente, planejadoDaTarefa, abastecidoDaTarefa, precisaAbastecer } from "./compartilhado/regras/movimentacao.js";

export const FILTROS_MOVIMENTACAO = { sub: "tarefas", busca: "", status: "pendentes", prioridade: "", situacao: "" };

let tela;
export function iniciarMovimentacao(funcoes) { tela = funcoes; }

const num = (n) => Number(n).toLocaleString("pt-BR");
const hora = (iso) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const QUEM = { sistema: "Automática", coletor: "Coletor", gestor: "Gestor" };
const COR_STATUS = { aberta: "g", andamento: "y", concluida: "v", parcial: "y", cancelada: "x" };
const pilula = (cor, texto) => `<span class="ge-st ${cor}">${texto}</span>`;
const pilulaPrioridade = (p) => pilula(p === "urgente" ? "r" : "g", PRIORIDADES[p]);

export function telaMovimentacao(db, f) {
  const abas = `<div class="ge-subabas">
    <button class="${f.sub === "tarefas" ? "on" : ""}" data-sub="tarefas">Tarefas de abastecimento</button>
    <button class="${f.sub === "limites" ? "on" : ""}" data-sub="limites">Mínimo e máximo</button></div>`;
  return f.sub === "limites" ? telaLimites(db, f, abas) : telaTarefas(db, f, abas);
}

// =====================================================================
// TAREFAS DE ABASTECIMENTO
// =====================================================================
const casaBusca = (db, codigo, busca) => {
  const t = busca.trim().toLowerCase(); if (!t) return true;
  const p = produtoPorCodigo(db, codigo);
  return codigo.toLowerCase().includes(t) || p.descricao.toLowerCase().includes(t);
};

function telaTarefas(db, f, abas) {
  const lista = db.tarefas
    .filter((t) => (f.status === "pendentes" ? tarefaPendente(t) : !f.status || t.status === f.status))
    .filter((t) => !f.prioridade || t.prioridade === f.prioridade)
    .filter((t) => casaBusca(db, t.produto, f.busca))
    // pendentes: urgentes primeiro e as mais antigas antes; o resto, as mais recentes primeiro
    .sort((a, b) => (tarefaPendente(b) - tarefaPendente(a)) || (b.prioridade === "urgente") - (a.prioridade === "urgente")
      || (tarefaPendente(a) ? a.id - b.id : b.id - a.id));
  const { itens, rodape } = tela.paginar(lista, "movimentacao");
  const conta = (fn) => db.tarefas.filter(fn).length;
  const kpi = (rotulo, n, filtro, cor = "") => {
    const alvo = { status: "", prioridade: "", ...filtro };
    const ativo = f.status === alvo.status && f.prioridade === alvo.prioridade;
    return `<button class="gx-kpi ge-kpi ${cor} ${ativo ? "on" : ""}" data-kpi='${JSON.stringify(alvo)}'>${rotulo} <b>${num(n)}</b></button>`;
  };
  const opcoes = (chave, pares, rotulo) => `<select data-f="${chave}"><option value="">${rotulo}</option>${pares.map(([k, l]) =>
    `<option value="${k}" ${f[chave] === k ? "selected" : ""}>${l}</option>`).join("")}</select>`;

  return `
  <div class="ge-head">
    <div><h1>Movimentação</h1><p class="ge-sub">Abastecimento do aéreo para o picking. A tarefa nasce sozinha quando o picking chega no mínimo; o coletor executa.</p></div>
    <div class="ge-actions"><button class="btn primary" id="btGerarTarefa">Gerar tarefa</button></div>
  </div>
  ${abas}
  <div class="gx-kpis ge-kpis">
    ${kpi("Pendentes", conta(tarefaPendente), { status: "pendentes" })}
    ${kpi("Abertas", conta((t) => t.status === "aberta"), { status: "aberta" })}
    ${kpi("Em andamento", conta((t) => t.status === "andamento"), { status: "andamento" })}
    ${kpi("Urgentes", conta((t) => tarefaPendente(t) && t.prioridade === "urgente"), { status: "pendentes", prioridade: "urgente" }, "red")}
    ${kpi("Concluídas", conta((t) => t.status === "concluida"), { status: "concluida" })}
    ${kpi("Parciais", conta((t) => t.status === "parcial"), { status: "parcial" })}
    ${kpi("Canceladas", conta((t) => t.status === "cancelada"), { status: "cancelada" })}
    ${kpi("Todas", db.tarefas.length, {})}
  </div>
  <div class="ge-filtros">
    <label class="gx-search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
      <input data-f="busca" value="${esc(f.busca)}" placeholder="Produto (código ou descrição)" autocomplete="off"></label>
    ${opcoes("status", [["pendentes", "Pendentes (abertas e em andamento)"], ...Object.entries(STATUS_TAREFA)], "Status: todos")}
    ${opcoes("prioridade", Object.entries(PRIORIDADES), "Prioridade: todas")}
    <button class="ge-limpar" data-limpar>Limpar filtros</button>
  </div>
  <div class="ge-card">
    <table class="ge-tab">
      <thead><tr><th class="r">Nº</th><th>Produto</th><th>Picking</th><th class="r">Saldo / mín / máx</th><th>Origens no aéreo</th><th class="r">Abastecido</th>
        <th>Prioridade</th><th>Status</th><th>Criada</th><th></th></tr></thead>
      <tbody>${itens.map((t) => linhaTarefa(db, t)).join("") || `<tr><td colspan="10" class="ge-vazio">Nenhuma tarefa com esses filtros.</td></tr>`}</tbody>
    </table>
    ${rodape}
  </div>`;
}

function linhaTarefa(db, t) {
  const p = produtoPorCodigo(db, t.produto), pk = enderecoPorId(db, t.pickingId);
  const lim = limiteDe(db, t.produto, t.pickingId);
  const saldo = saldoNoEndereco(db, t.pickingId, t.produto);
  const origens = t.origens.map((o) => `<span class="ge-orig ${o.feito >= o.qtd ? "ok" : ""}"><span class="gaddr">${enderecoPorId(db, o.enderecoId).codigo}</span> ${num(o.feito)}/${num(o.qtd)}</span>`).join("");
  const pend = tarefaPendente(t);
  const acoes = pend ? `<button class="ge-link" data-prioridade="${t.id}">${t.prioridade === "urgente" ? "Tornar normal" : "Tornar urgente"}</button>
    <button class="ge-link red" data-canceltarefa="${t.id}">Cancelar</button>` : "";
  return `<tr class="${pend ? "" : "off"}">
    <td class="r mono">${t.id}</td>
    <td><b class="mono">${esc(p.codigo)}</b> <span class="ge-desc">${esc(p.descricao)}</span></td>
    <td><span class="gaddr">${pk.codigo}</span></td>
    <td class="r ${lim && precisaAbastecer(saldo, lim.minimo) ? "ge-neg" : ""}">${num(saldo)} / ${lim ? `${num(lim.minimo)} / ${num(lim.maximo)}` : "—"}</td>
    <td><div class="ge-origs">${origens}</div></td>
    <td class="r">${num(abastecidoDaTarefa(t))} / ${num(planejadoDaTarefa(t))}</td>
    <td>${pilulaPrioridade(t.prioridade)}</td>
    <td>${pilula(COR_STATUS[t.status], STATUS_TAREFA[t.status])}</td>
    <td class="ge-quando">${hora(t.criada)}<small>${QUEM[t.quem] || t.quem}${t.usuario ? ` · ${esc(t.usuario)}` : ""}</small></td>
    <td class="r ge-acoes">${acoes}</td>
  </tr>`;
}

// gerar tarefa: produto (código) → picking padrão dele → prioridade
function modalGerar(db, codigo = "") {
  const p = codigo ? produtoPorCodigo(db, codigo) : null;
  const pickings = p ? enderecosPadraoDoProduto(db, p.codigo).filter((e) => e && e.ativo && e.tipo === "picking").sort((a, b) => compararEnderecos(a.codigo, b.codigo)) : [];
  const achados = !p && codigo ? buscarProdutos(db.produtos, codigo).slice(0, 6) : [];
  tela.abrirModal(`<h2>Gerar tarefa de abastecimento</h2>
    <form id="fGerar" class="ge-form">
      <label class="field"><span>Produto (código ou descrição)</span><input name="produto" value="${esc(p ? p.codigo : codigo)}" autocomplete="off" required></label>
      ${p ? `<p class="ge-lote-info ok"><b>${esc(p.codigo)}</b> · ${esc(p.descricao)}</p>` : achados.length ? `<div class="ge-achados">${achados.map((x) =>
        `<button type="button" class="ge-link" data-escolherprod="${esc(x.codigo)}"><b>${esc(x.codigo)}</b> ${esc(x.descricao)}</button>`).join("")}</div>` : ""}
      ${p ? `<label class="field"><span>Picking</span><select name="picking">${pickings.map((e) => {
        const lim = limiteDe(db, p.codigo, e.id);
        return `<option value="${e.id}">${e.codigo} · saldo ${num(saldoNoEndereco(db, e.id, p.codigo))}${lim ? ` · mín ${lim.minimo} / máx ${lim.maximo}` : " · sem mín/máx"}</option>`;
      }).join("")}</select></label>
      ${pickings.length ? "" : `<p class="ge-msg">PRODUTO SEM PICKING PADRÃO. ASSOCIE EM ENDEREÇAMENTO.</p>`}
      <label class="field"><span>Prioridade</span><select name="prioridade">${Object.entries(PRIORIDADES).map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select></label>` : ""}
      <p id="gerarErr" class="ge-msg" hidden></p>
      <div class="m-act"><button type="button" class="btn ghost" data-fechar>Cancelar</button><button class="btn primary">${p ? "Gerar tarefa" : "Buscar produto"}</button></div>
    </form>`);
}

// =====================================================================
// MÍNIMO E MÁXIMO (por produto em cada picking)
// =====================================================================
function telaLimites(db, f, abas) {
  // todos os produtos com picking padrão (é onde o mínimo e o máximo valem)
  const linhas = db.associacoes
    .map((a) => ({ a, e: enderecoPorId(db, a.enderecoId) }))
    .filter(({ e }) => e && e.ativo && e.tipo === "picking")
    .map(({ a, e }) => ({ e, produto: a.produto, saldo: saldoNoEndereco(db, e.id, a.produto), lim: limiteDe(db, a.produto, e.id) }))
    .filter((l) => casaBusca(db, l.produto, f.busca) || l.e.codigo.includes(f.busca.trim().toUpperCase()))
    .filter((l) => !f.situacao || (f.situacao === "abaixo" ? l.lim && precisaAbastecer(l.saldo, l.lim.minimo) : !l.lim))
    .sort((x, y) => compararEnderecos(x.e.codigo, y.e.codigo));
  const { itens, rodape } = tela.paginar(linhas, "movimentacao");
  return `
  <div class="ge-head">
    <div><h1>Movimentação</h1><p class="ge-sub">Mínimo e máximo de cada produto no seu picking. Reposição = máximo − saldo. No mínimo (ou abaixo), a tarefa nasce sozinha.</p></div>
  </div>
  ${abas}
  <div class="ge-filtros">
    <label class="gx-search ge-busca-larga"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
      <input data-f="busca" value="${esc(f.busca)}" placeholder="Produto (código ou descrição) ou picking (R3001-P1…)" autocomplete="off"></label>
    <select data-f="situacao"><option value="">Todos</option>
      <option value="abaixo" ${f.situacao === "abaixo" ? "selected" : ""}>No mínimo ou abaixo</option>
      <option value="sem" ${f.situacao === "sem" ? "selected" : ""}>Sem mínimo/máximo</option></select>
    <button class="ge-limpar" data-limpar>Limpar filtros</button>
  </div>
  <div class="ge-card">
    <table class="ge-tab">
      <thead><tr><th>Picking</th><th>Produto</th><th class="r">Saldo</th><th class="r">Mínimo</th><th class="r">Máximo</th><th class="r">Reposição</th><th></th></tr></thead>
      <tbody>${itens.map(({ e, produto, saldo, lim }) => {
        const p = produtoPorCodigo(db, produto);
        const baixo = lim && precisaAbastecer(saldo, lim.minimo);
        return `<tr data-limite="${esc(produto)}|${e.id}">
          <td><span class="gaddr">${e.codigo}</span></td>
          <td><b class="mono">${esc(p.codigo)}</b> <span class="ge-desc">${esc(p.descricao)}</span></td>
          <td class="r ${baixo ? "ge-neg" : ""}">${num(saldo)}</td>
          <td class="r"><input class="ge-num-in" type="number" min="0" step="1" name="minimo" value="${lim ? lim.minimo : ""}"></td>
          <td class="r"><input class="ge-num-in" type="number" min="1" step="1" name="maximo" value="${lim ? lim.maximo : ""}"></td>
          <td class="r">${lim ? num(Math.max(0, lim.maximo - saldo)) : "—"}</td>
          <td class="r"><button class="ge-link" data-salvarlimite>Salvar</button></td>
        </tr>`;
      }).join("") || `<tr><td colspan="7" class="ge-vazio">Nenhum picking com esses filtros.</td></tr>`}</tbody>
    </table>
    ${rodape}
  </div>`;
}

// =====================================================================
// cliques e formulários (chamados por gestao-estoque.js); devolvem true quando trataram
// =====================================================================
export function cliqueMovimentacao(t, db, f) {
  if (t.dataset.sub) { f.sub = t.dataset.sub; f.busca = ""; tela.voltarPagina(); tela.render(); return true; }
  if (t.id === "btGerarTarefa") { modalGerar(db); return true; }
  if (t.dataset.prioridade) {
    const tarefa = tarefaPorId(db, +t.dataset.prioridade);
    const nova = tarefa.prioridade === "urgente" ? "normal" : "urgente";
    const r = alterarPrioridade(tarefa.id, nova);
    tela.render(); tela.toast(r.ok ? `Tarefa ${tarefa.id}: ${PRIORIDADES[nova]}` : r.msg);
    return true;
  }
  if (t.dataset.canceltarefa) {
    tela.abrirModal(`<h2>Cancelar tarefa ${t.dataset.canceltarefa}</h2><p class="ge-msg">DESEJA REALMENTE CANCELAR ESTA TAREFA?</p>
      <p>O que já foi abastecido continua no picking.</p>
      <div class="m-act"><button class="btn ghost" data-fechar>Não</button><button class="btn primary" data-confcanceltarefa="${t.dataset.canceltarefa}">Sim, cancelar</button></div>`);
    return true;
  }
  if (t.dataset.salvarlimite !== undefined) {
    const tr = t.closest("tr"), [produto, enderecoId] = tr.dataset.limite.split("|");
    const r = salvarLimite(produto, +enderecoId, { minimo: tr.querySelector("[name=minimo]").value, maximo: tr.querySelector("[name=maximo]").value });
    if (!r.ok) { tela.toast(r.msg); tr.classList.add("ge-erro"); return true; }
    tela.render(); tela.toast(r.tarefaCriada ? "Salvo · picking no mínimo: tarefa de abastecimento criada" : "Mínimo e máximo salvos");
    return true;
  }
  return false;
}

export function cliqueModalMovimentacao(t, db) {
  if (t.dataset.confcanceltarefa) {
    const r = cancelarTarefa(+t.dataset.confcanceltarefa);
    tela.fecharModal(); tela.render(); tela.toast(r.ok ? "Tarefa cancelada" : r.msg);
    return true;
  }
  if (t.dataset.escolherprod) { modalGerar(db, t.dataset.escolherprod); return true; }
  return false;
}

export function enviarModalMovimentacao(form, db) {
  if (form.id !== "fGerar") return false;
  const lido = form.produto.value.trim();
  const p = produtoPorCodigo(db, lido);
  // ainda escolhendo o produto: busca e mostra os achados
  if (!p || !form.picking) {
    const unico = p || (buscarProdutos(db.produtos, lido).length === 1 ? buscarProdutos(db.produtos, lido)[0] : null);
    modalGerar(db, unico ? unico.codigo : lido);
    return true;
  }
  const err = form.querySelector("#gerarErr");
  if (!form.picking.value) { err.hidden = false; err.textContent = "PRODUTO SEM PICKING PADRÃO."; return true; }
  const r = criarTarefa(p.codigo, +form.picking.value, { prioridade: form.prioridade.value, quem: "gestor", usuario: session()?.login });
  if (!r.ok) { err.hidden = false; err.textContent = r.msg; return true; }
  tela.fecharModal(); tela.render();
  tela.toast(`Tarefa ${r.tarefa.id} criada · ${num(planejadoDaTarefa(r.tarefa))} un em ${r.tarefa.origens.length} origem(ns)`);
  return true;
}
