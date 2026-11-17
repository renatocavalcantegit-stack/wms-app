// WMS Beach Bike — Gestão de Estoque (WEB), aba INVENTÁRIO (Auditoria).
// O gestor cria (completo ou rotativo), acompanha a contagem em tempo real, aprova/rejeita divergências,
// finaliza e sincroniza. A contagem em si é no coletor. Histórico dos sincronizados só para consulta.
// O relatório de Inventário (PDF/Excel) fica para quando os relatórios entrarem.
import { $, esc } from "./js/util.js";
import { session } from "./js/sessao.js";
import { enderecoPorId, produtoPorCodigo } from "./js/dados/estoque.js";
import { inventarioPorId, itensDoEndereco, situacaoDoEndereco, saldoDoItem, criarInventario, decidir, finalizarInventario, sincronizar } from "./js/dados/inventario.js";
import { TIPOS_ENDERECO, compararEnderecos } from "./compartilhado/regras/enderecos.js";
import {
  TIPOS_INVENTARIO, STATUS_INVENTARIO, STATUS_ITEM, MAXIMO_CONTAGENS, enderecoInventariavel, statusDoItem, quantidadeConsiderada,
  diferenca, indicadores, itemEncerrado, planejarSincronizacao,
} from "./compartilhado/regras/inventario.js";

export const FILTROS_INVENTARIO = { sub: "abertos", invId: null, busca: "", endereco: "", rua: "", status: "", situacao: "", operador: "", ordem: "endereco" };

let tela;
export function iniciarInventario(funcoes) {
  tela = funcoes;
  // modal "Novo inventário": marcar ruas / pares e filtrar a lista do rotativo sem perder o que já foi marcado
  $("#modal").addEventListener("change", (ev) => {
    const f = ev.target.form; if (f?.id !== "fNovoInv") return;
    const t = ev.target;
    if (t.name === "tipo") { novo.tipo = t.value; return modalNovo(tela.db()); }
    if (t.name === "rua") return t.checked ? novo.ruas.add(+t.value) : novo.ruas.delete(+t.value);
    if (t.name === "par") return t.checked ? novo.marcados.add(t.value) : novo.marcados.delete(t.value);
    if (t.name === "todos") { paresFiltrados(tela.db()).forEach((p) => (t.checked ? novo.marcados.add(p.chave) : novo.marcados.delete(p.chave))); return modalNovo(tela.db()); }
    if (["fRua", "fTipo"].includes(t.name)) { novo[t.name] = t.value; return modalNovo(tela.db()); }
  });
  $("#modal").addEventListener("input", (ev) => {
    if (ev.target.form?.id !== "fNovoInv") return;
    if (ev.target.name === "descricao") novo.descricao = ev.target.value;
    if (ev.target.name === "fBusca") { novo.fBusca = ev.target.value; clearTimeout(novo.t); novo.t = setTimeout(() => modalNovo(tela.db(), "fBusca"), 250); }
  });
}

const num = (n) => Number(n).toLocaleString("pt-BR");
const hora = (iso) => (iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");
const pilula = (cor, texto) => `<span class="ge-st ${cor}">${texto}</span>`;
const tipoTag = (t) => `<span class="ge-tipo ${t}">${TIPOS_ENDERECO[t]}</span>`;
const COR_INV = { aberto: "y", finalizado: "g", sincronizado: "v" };
const COR_ITEM = { nao_contado: "x", contando: "y", ok: "v", divergente: "r", aprovado: "v", rejeitado: "g" };

// todos os itens de um inventário, com o que a tela precisa (saldo agora, situação, última contagem)
function itensDetalhados(db, inv) {
  return inv.itens.map((i, idx) => {
    // depois de sincronizado, o "sistema" é o saldo do momento da sincronização (o de hoje já mudou com a operação)
    const saldo = saldoComparado(db, inv, i);
    const ult = i.contagens[i.contagens.length - 1];
    return { ...i, idx, saldo, st: statusDoItem(i, saldo), e: enderecoPorId(db, i.enderecoId), p: produtoPorCodigo(db, i.produto), ult };
  });
}

export function telaInventario(db, f) {
  const inv = f.invId ? inventarioPorId(db, f.invId) : null;
  if (inv) return telaPainel(db, f, inv);
  const abas = `<div class="ge-subabas">
    <button class="${f.sub === "abertos" ? "on" : ""}" data-sub="abertos">Inventários</button>
    <button class="${f.sub === "historico" ? "on" : ""}" data-sub="historico">Histórico</button></div>`;
  return f.sub === "historico" ? telaHistorico(db, f, abas) : telaLista(db, f, abas);
}

// =====================================================================
// LISTA (em aberto e finalizados aguardando sincronização)
// =====================================================================
const saldoComparado = (db, inv, i) => (inv.status === "sincronizado" && i.saldoSinc != null ? i.saldoSinc : saldoDoItem(db, i));
const resumo = (db, inv) => indicadores(inv.itens, inv.enderecos, (i) => saldoComparado(db, inv, i), inv.contados);
function telaLista(db, f, abas) {
  const lista = db.inventarios.filter((i) => i.status !== "sincronizado").sort((a, b) => b.id - a.id);
  const { itens, rodape } = tela.paginar(lista, "inventario");
  return `
  <div class="ge-head">
    <div><h1>Inventário</h1><p class="ge-sub">A contagem não altera o estoque. Divergências vão para aprovação, e o saldo só muda na sincronização.</p></div>
    <div class="ge-actions"><button class="btn primary" id="btNovoInv">Novo inventário</button></div>
  </div>
  ${abas}
  <div class="ge-card">
    <table class="ge-tab">
      <thead><tr><th class="r">Nº</th><th>Descrição</th><th>Tipo</th><th>Abrangência</th><th class="r">Concluído</th><th class="r">Endereços</th>
        <th class="r">Aguardando aprovação</th><th>Status</th><th>Criado</th></tr></thead>
      <tbody>${itens.map((inv) => {
        const k = resumo(db, inv);
        return `<tr class="ge-click" data-inv="${inv.id}">
          <td class="r mono">${inv.id}</td><td><b>${esc(inv.descricao)}</b></td><td>${TIPOS_INVENTARIO[inv.tipo]}</td>
          <td>${inv.tipo === "completo" ? `Rua ${inv.ruas.join(", ")}` : `${num(inv.itens.length)} produto(s) selecionado(s)`}</td>
          <td class="r"><div class="iv-barra"><i style="width:${k.pct}%"></i></div>${k.pct}%</td>
          <td class="r">${num(k.concluidos)} / ${num(k.enderecos)}</td>
          <td class="r ${k.aguardando ? "ge-neg" : ""}">${num(k.aguardando)}</td>
          <td>${pilula(COR_INV[inv.status], STATUS_INVENTARIO[inv.status])}${inv.sincErro ? ` ${pilula("r", "Erro na sincronização")}` : ""}</td>
          <td class="ge-quando">${hora(inv.criado)}<small>${esc(inv.criadoPor || "")}</small></td></tr>`;
      }).join("") || `<tr><td colspan="9" class="ge-vazio">Nenhum inventário em andamento. Clique em Novo inventário.</td></tr>`}</tbody>
    </table>
    ${rodape}
  </div>`;
}

// =====================================================================
// HISTÓRICO (sincronizados, só consulta)
// =====================================================================
function telaHistorico(db, f, abas) {
  const lista = db.inventarios.filter((i) => i.status === "sincronizado").sort((a, b) => b.id - a.id);
  const { itens, rodape } = tela.paginar(lista, "inventario");
  return `
  <div class="ge-head">
    <div><h1>Inventário</h1><p class="ge-sub">Inventários sincronizados. Somente consulta: clique para ver C1 a C5, decisões e ajustes.</p></div>
  </div>
  ${abas}
  <div class="ge-card">
    <table class="ge-tab">
      <thead><tr><th class="r">Nº</th><th>Descrição</th><th>Tipo</th><th>Criado</th><th>Finalizado</th><th>Sincronizado</th>
        <th class="r">Endereços / produtos</th><th class="r">Divergências</th><th class="r">Aprov. / rejeit.</th><th class="r">Ajustes</th><th>Resultado</th></tr></thead>
      <tbody>${itens.map((inv) => {
        const k = resumo(db, inv), ajustes = inv.itens.filter((i) => i.ajuste).length;
        return `<tr class="ge-click" data-inv="${inv.id}">
          <td class="r mono">${inv.id}</td><td><b>${esc(inv.descricao)}</b></td><td>${TIPOS_INVENTARIO[inv.tipo]}</td>
          <td class="ge-quando">${hora(inv.criado)}<small>${esc(inv.criadoPor || "")}</small></td>
          <td class="ge-quando">${hora(inv.finalizado)}<small>${esc(inv.finalizadoPor || "")}</small></td>
          <td class="ge-quando">${hora(inv.sincronizado)}<small>${esc(inv.sincronizadoPor || "")}</small></td>
          <td class="r">${num(inv.enderecos.length)} / ${num(inv.itens.length)}</td>
          <td class="r">${num(k.divergencias)}</td><td class="r">${num(k.aprovados)} / ${num(k.rejeitados)}</td><td class="r">${num(ajustes)}</td>
          <td>${pilula("v", "Sincronizado")}</td></tr>`;
      }).join("") || `<tr><td colspan="11" class="ge-vazio">Nenhum inventário sincronizado ainda.</td></tr>`}</tbody>
    </table>
    ${rodape}
  </div>`;
}

// =====================================================================
// PAINEL DO INVENTÁRIO (acompanhamento, divergências, finalizar, sincronizar)
// =====================================================================
function telaPainel(db, f, inv) {
  const todos = itensDetalhados(db, inv);
  const k = resumo(db, inv);
  const sit = (i) => situacaoDoEndereco(inv, i.enderecoId);
  const busca = f.busca.trim().toLowerCase(), end = f.endereco.trim().toUpperCase();
  const lista = todos
    .filter((i) => !f.rua || i.e.rua === +f.rua)
    .filter((i) => !end || i.e.codigo.includes(end) || String(i.e.id) === end)
    .filter((i) => !busca || i.produto.toLowerCase().includes(busca) || i.p.descricao.toLowerCase().includes(busca))
    .filter((i) => !f.status || (f.status === "contados" ? itemEncerrado(i.contagens) : f.status === "naocontados" ? !itemEncerrado(i.contagens)
      : f.status === "divergencias" ? ["divergente", "aprovado", "rejeitado"].includes(i.st) : i.st === f.status))
    .filter((i) => !f.situacao || (f.situacao === "pendente" ? sit(i) !== "concluido" : sit(i) === f.situacao))
    .filter((i) => !f.operador || i.contagens.some((c) => c.operador === f.operador))
    .sort(f.ordem === "recentes" ? (a, b) => (b.ult?.quando || "").localeCompare(a.ult?.quando || "") : (a, b) => compararEnderecos(a.e.codigo, b.e.codigo));
  const { itens, rodape } = tela.paginar(lista, "inventario");
  const kpi = (rotulo, n, filtro, cor = "") => {
    const alvo = { status: "", situacao: "", ...filtro };
    // indicador só de informação (sem filtro próprio) nunca fica marcado
    const ativo = Object.keys(filtro).length && f.status === alvo.status && f.situacao === alvo.situacao;
    return `<button class="gx-kpi ge-kpi ${cor} ${ativo ? "on" : ""}" data-kpi='${JSON.stringify(alvo)}'>${rotulo} <b>${n}</b></button>`;
  };
  const ruas = [...new Set(inv.enderecos.map((id) => enderecoPorId(db, id).rua))].sort((a, b) => a - b); // numérica: a rua 802 antes da 1000
  const operadores = [...new Set(inv.itens.flatMap((i) => i.contagens.map((c) => c.operador)))].sort();
  const sel = (chave, pares, rotulo) => `<select data-f="${chave}"><option value="">${rotulo}</option>${pares.map(([v, l]) =>
    `<option value="${v}" ${String(f[chave]) === String(v) ? "selected" : ""}>${l}</option>`).join("")}</select>`;
  const aberto = inv.status === "aberto", fin = inv.status === "finalizado", sinc = inv.status === "sincronizado";
  const acoes = aberto ? `<button class="btn primary" data-finalizarinv="${inv.id}">Finalizar inventário</button>`
    : fin ? `<button class="btn primary" data-sincinv="${inv.id}">Sincronizar ajustes aprovados</button>` : "";
  // quem está contando agora (quantidades incluídas e ainda não finalizadas)
  const agora = Object.entries(inv.rascunhos).filter(([, l]) => l.length).map(([id, l]) =>
    `<span class="iv-agora"><span class="gaddr">${enderecoPorId(db, +id).codigo}</span> ${esc(l[l.length - 1].operador)} · ${l.length} inclusão(ões) · ${hora(l[l.length - 1].quando)}</span>`).join("");
  const sincTxt = sinc ? "Sincronizado" : inv.sincErro ? "Erro: tentar de novo" : fin ? "Aguardando" : "Após finalizar";

  return `
  <div class="ge-head">
    <div><button class="ge-link" data-voltarinv>← Inventários</button>
      <h1>INV ${inv.id} · ${esc(inv.descricao)}</h1>
      <p class="ge-sub">${TIPOS_INVENTARIO[inv.tipo]}${inv.tipo === "completo" ? ` · rua ${inv.ruas.join(", ")}` : ""} · criado ${hora(inv.criado)} por ${esc(inv.criadoPor || "—")}
        ${inv.finalizado ? ` · finalizado ${hora(inv.finalizado)}` : ""}${inv.sincronizado ? ` · sincronizado ${hora(inv.sincronizado)}` : ""}
        &nbsp;${pilula(COR_INV[inv.status], STATUS_INVENTARIO[inv.status])}</p></div>
    <div class="ge-actions">${acoes}</div>
  </div>
  ${inv.sincErro ? `<p class="ge-msg iv-erro">${esc(inv.sincErro)} O inventário continua pendente para nova tentativa.</p>` : ""}
  ${sinc ? `<p class="ge-lote-info ok">Inventário sincronizado: bloqueado e disponível só para consulta.${inv.novosPadrao.length ? ` ${inv.novosPadrao.length} endereço(s) passaram a ser padrão.` : ""}</p>` : ""}
  <div class="gx-kpis ge-kpis iv-kpis">
    <span class="gx-kpi ge-kpi iv-pct">Concluído <b>${k.pct}%</b></span>
    ${kpi("Endereços", num(k.enderecos), {})}
    ${kpi("Concluídos", num(k.concluidos), { situacao: "concluido" })}
    ${kpi("Pendentes", num(k.pendentes), { situacao: "pendente" })}
    ${kpi("Previstos", num(k.previstos), {})}
    ${kpi("Contados", num(k.contados), { status: "contados" })}
    ${kpi("Não contados", num(k.naoContados), { status: "naocontados" })}
    ${kpi("Contagens", num(k.contagens), {})}
    ${kpi("Divergências", num(k.divergencias), { status: "divergencias" })}
    ${kpi("Aguardando aprovação", num(k.aguardando), { status: "divergente" }, "red")}
    ${kpi("Aprovados", num(k.aprovados), { status: "aprovado" })}
    ${kpi("Rejeitados", num(k.rejeitados), { status: "rejeitado" })}
    <span class="gx-kpi ge-kpi">Sincronização <b class="iv-sinc">${sincTxt}</b></span>
  </div>
  ${agora ? `<div class="iv-agoras"><b>Contando agora</b>${agora}</div>` : ""}
  <div class="ge-filtros">
    <label class="gx-search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
      <input data-f="busca" value="${esc(f.busca)}" placeholder="Produto (código ou descrição)" autocomplete="off"></label>
    <label class="gx-search ge-curto"><input data-f="endereco" value="${esc(f.endereco)}" placeholder="Endereço (R3003-P1… ou ID)" autocomplete="off"></label>
    ${ruas.length > 1 ? sel("rua", ruas.map((r) => [r, `Rua ${r}`]), "Rua: todas") : ""}
    ${sel("status", Object.entries(STATUS_ITEM), "Status: todos")}
    ${sel("operador", operadores.map((o) => [o, o]), "Operador: todos")}
    ${sel("ordem", [["recentes", "Mais recentes primeiro"]], "Ordem: endereço")}
    <button class="ge-limpar" data-limpar>Limpar filtros</button>
  </div>
  <div class="ge-card">
    <table class="ge-tab iv-tab">
      <thead><tr><th>Endereço</th><th>Produto</th><th class="r">Sistema</th>
        ${Array.from({ length: MAXIMO_CONTAGENS }, (_, n) => `<th class="r">C${n + 1}</th>`).join("")}
        <th class="r">Considerada</th><th class="r">Diferença</th><th>Última contagem</th><th>Status</th><th></th></tr></thead>
      <tbody>${itens.map((i) => linhaItem(inv, i)).join("") || `<tr><td colspan="${8 + MAXIMO_CONTAGENS}" class="ge-vazio">Nenhum item com esses filtros.</td></tr>`}</tbody>
    </table>
    ${rodape}
  </div>`;
}

function linhaItem(inv, i) {
  const dif = diferenca(i, i.saldo), cons = quantidadeConsiderada(i.contagens);
  const pode = inv.status !== "sincronizado" && ["divergente", "aprovado", "rejeitado"].includes(i.st);
  const acoes = !pode ? "" : i.st === "divergente"
    ? `<button class="ge-link" data-aprovar="${i.idx}">Aprovar</button> <button class="ge-link red" data-rejeitar="${i.idx}">Rejeitar</button>`
    : `<button class="ge-link" data-${i.st === "aprovado" ? "rejeitar" : "aprovar"}="${i.idx}">${i.st === "aprovado" ? "Rejeitar" : "Aprovar"}</button>`;
  const ajuste = i.ajuste ? `<small class="iv-ajuste">${num(i.ajuste.antes)} → ${num(i.ajuste.depois)}</small>` : "";
  return `<tr>
    <td>${tipoTag(i.e.tipo)} <span class="gaddr">${i.e.codigo}</span></td>
    <td><b class="mono">${esc(i.produto)}</b> <span class="ge-desc">${esc(i.p.descricao)}</span>${i.previsto ? "" : ` <span class="ge-st y">Fora da previsão</span>`}</td>
    <td class="r">${num(i.saldo)}</td>
    ${Array.from({ length: MAXIMO_CONTAGENS }, (_, n) => {
      const c = i.contagens[n];
      return `<td class="r iv-c" title="${c ? `${esc(c.operador)} · ${hora(c.quando)}` : ""}">${c ? num(c.qtd) : ""}</td>`;
    }).join("")}
    <td class="r"><b>${cons === null ? "—" : num(cons)}</b></td>
    <td class="r ${dif < 0 ? "ge-neg" : dif > 0 ? "iv-pos" : ""}">${dif === null ? "—" : dif > 0 ? "+" + num(dif) : num(dif)}${ajuste}</td>
    <td class="ge-quando">${i.ult ? `C${i.ult.n} · ${esc(i.ult.operador)}<small>${hora(i.ult.quando)}</small>` : "—"}</td>
    <td>${pilula(COR_ITEM[i.st], STATUS_ITEM[i.st])}${i.decididoPor ? `<small class="iv-quem">${esc(i.decididoPor)}</small>` : ""}</td>
    <td class="r ge-acoes">${acoes}</td>
  </tr>`;
}

// =====================================================================
// NOVO INVENTÁRIO (modal)
// =====================================================================
const novo = { tipo: "completo", descricao: "", ruas: new Set(), marcados: new Set(), fRua: "", fTipo: "", fBusca: "" };
// pares produto + endereço que podem entrar no rotativo: o que tem saldo ou é padrão em picking/aéreo ativos
function todosOsPares(db) {
  const m = new Map();
  const add = (enderecoId, produto) => {
    const e = enderecoPorId(db, enderecoId);
    if (!enderecoInventariavel(e)) return;
    const chave = `${enderecoId}|${produto}`;
    if (!m.has(chave)) m.set(chave, { chave, e, produto, p: produtoPorCodigo(db, produto) });
  };
  db.saldos.filter((s) => s.qtd > 0).forEach((s) => add(s.enderecoId, s.produto));
  db.associacoes.forEach((a) => add(a.enderecoId, a.produto));
  return [...m.values()].sort((a, b) => compararEnderecos(a.e.codigo, b.e.codigo));
}
function paresFiltrados(db) {
  const b = novo.fBusca.trim().toLowerCase();
  return todosOsPares(db).filter((x) => (!novo.fRua || x.e.rua === +novo.fRua) && (!novo.fTipo || x.e.tipo === novo.fTipo)
    && (!b || x.produto.toLowerCase().includes(b) || x.p.descricao.toLowerCase().includes(b) || x.e.codigo.includes(b.toUpperCase())));
}

function modalNovo(db, foco) {
  const ruas = [...new Set(db.enderecos.filter(enderecoInventariavel).map((e) => e.rua))].sort((a, b) => a - b);
  const contaRua = (r) => db.enderecos.filter((e) => enderecoInventariavel(e) && e.rua === r).length;
  const pares = novo.tipo === "rotativo" ? paresFiltrados(db) : [];
  const mostra = pares.slice(0, 200);
  const todosMarcados = pares.length && pares.every((p) => novo.marcados.has(p.chave));
  tela.abrirModal(`<h2>Novo inventário</h2>
    <form id="fNovoInv" class="ge-form iv-novo">
      <div class="iv-tipos">${Object.entries(TIPOS_INVENTARIO).map(([k, l]) => `<label class="iv-tipo ${novo.tipo === k ? "on" : ""}">
        <input type="radio" name="tipo" value="${k}" ${novo.tipo === k ? "checked" : ""}><b>${l}</b>
        <small>${k === "completo" ? "Todos os produtos e endereços das ruas escolhidas. Aceita produto não previsto." : "Você seleciona os produtos/endereços. Só aceita o produto previsto."}</small></label>`).join("")}</div>
      <label class="field"><span>Descrição</span><input name="descricao" value="${esc(novo.descricao)}" placeholder="Ex.: Inventário geral da rua 3001" autocomplete="off"></label>
      ${novo.tipo === "completo" ? `<div class="field"><span>Ruas (picking e aéreo ativos)</span><div class="iv-ruas">${ruas.map((r) =>
        `<label><input type="checkbox" name="rua" value="${r}" ${novo.ruas.has(r) ? "checked" : ""}> Rua ${r} <small>${contaRua(r)} end.</small></label>`).join("")}</div></div>`
      : `<div class="ge-filtros iv-filtros">
          <input name="fBusca" value="${esc(novo.fBusca)}" placeholder="Produto ou endereço" autocomplete="off">
          <select name="fRua"><option value="">Rua: todas</option>${ruas.map((r) => `<option ${+novo.fRua === r ? "selected" : ""}>${r}</option>`).join("")}</select>
          <select name="fTipo"><option value="">Tipo: todos</option><option value="picking" ${novo.fTipo === "picking" ? "selected" : ""}>Picking</option><option value="aereo" ${novo.fTipo === "aereo" ? "selected" : ""}>Aéreo</option></select>
        </div>
        <div class="iv-pares">
          <label class="iv-par iv-todos"><input type="checkbox" name="todos" ${todosMarcados ? "checked" : ""}> Selecionar todos os ${num(pares.length)} filtrados</label>
          ${mostra.map((x) => `<label class="iv-par"><input type="checkbox" name="par" value="${x.chave}" ${novo.marcados.has(x.chave) ? "checked" : ""}>
            <span class="gaddr">${x.e.codigo}</span> <b class="mono">${esc(x.produto)}</b> <span class="ge-desc">${esc(x.p.descricao)}</span></label>`).join("")}
          ${pares.length > mostra.length ? `<p class="ge-sub">Mostrando 200 de ${num(pares.length)}. Filtre para ver os outros (ou use Selecionar todos).</p>` : ""}
        </div>
        <p class="ge-sub"><b>${num(novo.marcados.size)}</b> selecionado(s)</p>`}
      <p id="novoInvErr" class="ge-msg" hidden></p>
      <div class="m-act"><button type="button" class="btn ghost" data-fechar>Cancelar</button><button class="btn primary">Criar inventário</button></div>
    </form>`);
  if (foco) { const el = $(`#fNovoInv [name="${foco}"]`); el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
}

// =====================================================================
// cliques e formulários (chamados por gestao-estoque.js); devolvem true quando trataram
// =====================================================================
export function cliqueInventario(t, db, f) {
  if (t.dataset.sub) { f.sub = t.dataset.sub; tela.voltarPagina(); tela.render(); return true; }
  if (t.dataset.inv) { Object.assign(f, structuredClone(FILTROS_INVENTARIO), { sub: f.sub, invId: +t.dataset.inv }); tela.voltarPagina(); tela.render(); return true; }
  if (t.dataset.voltarinv !== undefined) { Object.assign(f, structuredClone(FILTROS_INVENTARIO), { sub: f.sub }); tela.voltarPagina(); tela.render(); return true; }
  if (t.id === "btNovoInv") {
    Object.assign(novo, { tipo: "completo", descricao: "", ruas: new Set(), marcados: new Set(), fRua: "", fTipo: "", fBusca: "" });
    modalNovo(db); return true;
  }
  if (t.dataset.aprovar || t.dataset.rejeitar) {
    const aprovar = !!t.dataset.aprovar;
    const r = decidir(f.invId, +(t.dataset.aprovar || t.dataset.rejeitar), aprovar ? "aprovado" : "rejeitado", session()?.login);
    tela.render(); tela.toast(r.ok ? (aprovar ? "Ajuste aprovado · aplica na sincronização" : "Ajuste rejeitado · o saldo fica como está") : r.msg);
    return true;
  }
  if (t.dataset.finalizarinv) {
    const inv = inventarioPorId(db, +t.dataset.finalizarinv), k = resumo(db, inv);
    tela.abrirModal(`<h2>Finalizar inventário ${inv.id}?</h2>
      <p>Novas contagens ficam bloqueadas na hora e o inventário some do coletor.</p>
      ${k.pendentes ? `<p class="ge-msg">${num(k.pendentes)} endereço(s) ainda pendente(s). Os itens sem contagem encerrada não geram ajuste e mantêm o saldo.</p>` : ""}
      <p>O saldo NÃO muda agora: depois de finalizar, analise as divergências e clique em Sincronizar.</p>
      <div class="m-act"><button class="btn ghost" data-fechar>Cancelar</button><button class="btn primary" data-conffinalizarinv="${inv.id}">Finalizar</button></div>`);
    return true;
  }
  if (t.dataset.sincinv) {
    const inv = inventarioPorId(db, +t.dataset.sincinv);
    const det = itensDetalhados(db, inv);
    const plano = planejarSincronizacao(inv, det.map((i) => ({ ...i, endereco: i.e })));
    const semDecisao = det.filter((i) => i.st === "divergente").length;
    tela.abrirModal(`<h2>Sincronizar inventário ${inv.id}?</h2>
      ${plano.ok ? `<p>Aplica <b>${num(plano.ajustes.length)}</b> ajuste(s) aprovado(s) de uma só vez. Se algum falhar, nenhum é aplicado.</p>` : `<p class="ge-msg">${esc(plano.msg)}</p>`}
      ${semDecisao ? `<p class="ge-msg">${num(semDecisao)} divergência(s) sem decisão não serão ajustadas.</p>` : ""}
      <p>Depois de sincronizado, o inventário fica bloqueado e só para consulta.</p>
      <div class="m-act"><button class="btn ghost" data-fechar>Cancelar</button><button class="btn primary" data-confsincinv="${inv.id}">Sincronizar</button></div>`);
    return true;
  }
  return false;
}

export function cliqueModalInventario(t) {
  if (t.dataset.conffinalizarinv) {
    const r = finalizarInventario(+t.dataset.conffinalizarinv, session()?.login);
    tela.fecharModal(); tela.render(); tela.toast(r.ok ? "Inventário finalizado · contagens bloqueadas" : r.msg);
    return true;
  }
  if (t.dataset.confsincinv) {
    const r = sincronizar(+t.dataset.confsincinv, session()?.login);
    tela.fecharModal(); tela.render();
    tela.toast(r.ok ? `Sincronizado · ${r.ajustes} ajuste(s) aplicado(s)${r.novosPadrao ? ` · ${r.novosPadrao} novo(s) endereço(s) padrão` : ""}` : r.msg);
    return true;
  }
  return false;
}

export function enviarModalInventario(form, db, f) {
  if (form.id !== "fNovoInv") return false;
  const pares = [...novo.marcados].map((c) => { const [enderecoId, produto] = c.split("|"); return { enderecoId: +enderecoId, produto }; });
  const r = criarInventario({ tipo: novo.tipo, descricao: novo.descricao, ruas: [...novo.ruas], pares, usuario: session()?.login });
  if (!r.ok) { const err = form.querySelector("#novoInvErr"); err.hidden = false; err.textContent = r.msg; return true; }
  tela.fecharModal();
  Object.assign(f, structuredClone(FILTROS_INVENTARIO), { invId: r.inventario.id });
  tela.voltarPagina(); tela.render();
  tela.toast(`Inventário ${r.inventario.id} criado · já aparece no coletor`);
  return true;
}
