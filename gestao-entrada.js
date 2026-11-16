// WMS Beach Bike — Gestão de Estoque (WEB), aba ENTRADA: notas do recebimento, detalhe da nota e volumes.
// Só o gestor reimprime etiqueta de volume e cancela pendente (o coletor apenas consulta).
// As regras ficam em compartilhado/regras/recebimento.js e os dados passam por js/dados/recebimento.js.
import { esc } from "./js/util.js";
import { etiquetaVolumeHtml } from "./js/etiqueta-recebimento.js";
import { produtoPorCodigo, enderecoPorId } from "./js/dados/estoque.js";
import { notaPorId, volumesDoItem, cancelarPendente, importarNotasDoErp } from "./js/dados/recebimento.js";
import { statusDaNota, resumoDaNota, resumoDoItem, STATUS_CONFERENCIA, STATUS_DIVERGENCIA, STATUS_ARMAZENAMENTO } from "./compartilhado/regras/recebimento.js";

export const FILTROS_ENTRADA = { nf: "", fornecedor: "", de: "", ate: "", conferencia: "", divergencia: "", armazenamento: "" };

// funções da tela principal (modal, toast, paginação…), entregues por gestao-estoque.js
let tela;
export function iniciarEntrada(funcoes) { tela = funcoes; }

let notaAberta = null; // id da nota mostrada no detalhe (null = lista)
export const sairDaEntrada = () => { notaAberta = null; };

const num = (n) => Number(n).toLocaleString("pt-BR");
const dataBr = (iso) => iso.split("-").reverse().join("/");
// cores dos status (mesmas do coletor): cinza = aguardando/pendente, amarelo = em andamento/divergência,
// verde = conferida/sem divergência, azul = armazenado
const COR = { aguardando: "g", aberta: "y", conferida: "v", sem: "v", com: "y", pendente: "g", parcial: "y", armazenado: "b" };
// divergência só depois de finalizar a conferência; antes disso a falta é só "ainda não conferido"
const divergenciaHtml = (nota, d) => (!nota.finalizada ? `<span class="ge-nd">—</span>` : `<span class="${d < 0 ? "ge-neg" : ""}">${num(d)}</span>`);
const pilula = (chave, texto) => `<span class="ge-st ${COR[chave]}">${texto}</span>`;
const pilulasDoStatus = (s) => ({
  conferencia: pilula(s.conferencia, STATUS_CONFERENCIA[s.conferencia]),
  // a divergência só existe depois de finalizar a conferência
  divergencia: s.divergencia ? pilula(s.divergencia, STATUS_DIVERGENCIA[s.divergencia]) : `<span class="ge-nd">—</span>`,
  armazenamento: pilula(s.armazenamento, STATUS_ARMAZENAMENTO[s.armazenamento]),
});

export function telaEntrada(db, filtros) {
  if (notaAberta && notaPorId(db, notaAberta)) return detalhe(db, notaPorId(db, notaAberta));
  notaAberta = null;
  return lista(db, filtros);
}

// =====================================================================
// LISTA DE NOTAS
// =====================================================================
function notasFiltradas(db, f) {
  const nf = f.nf.trim(), forn = f.fornecedor.trim().toLowerCase();
  return db.notas
    .map((n) => ({ n, s: statusDaNota(n, db.conferencias) }))
    .filter(({ n }) => !nf || n.numero.includes(nf))
    .filter(({ n }) => !forn || n.fornecedor.nome.toLowerCase().includes(forn) || String(n.fornecedor.codigo) === forn)
    .filter(({ n }) => (!f.de || n.data >= f.de) && (!f.ate || n.data <= f.ate))
    .filter(({ s }) => !f.conferencia || s.conferencia === f.conferencia)
    .filter(({ s }) => !f.divergencia || s.divergencia === f.divergencia)
    .filter(({ s }) => !f.armazenamento || s.armazenamento === f.armazenamento)
    // as mais recentes primeiro
    .sort((a, b) => b.n.data.localeCompare(a.n.data) || b.n.id - a.n.id);
}

function lista(db, f) {
  const linhas = notasFiltradas(db, f);
  const { itens, rodape } = tela.paginar(linhas, "entrada");
  const todos = db.notas.map((n) => statusDaNota(n, db.conferencias));
  const conta = (fn) => todos.filter(fn).length;
  // indicadores clicáveis: cada um aplica o filtro de status (e limpa os outros dois)
  const kpi = (rotulo, n, filtro) => {
    const alvo = { conferencia: "", divergencia: "", armazenamento: "", ...filtro };
    const ativo = Object.keys(alvo).every((k) => f[k] === alvo[k]);
    return `<button class="gx-kpi ge-kpi ${ativo ? "on" : ""}" data-kpi='${JSON.stringify(alvo)}'>${rotulo} <b>${num(n)}</b></button>`;
  };
  const opcoes = (chave, mapa, rotulo) => `<select data-f="${chave}"><option value="">${rotulo}</option>${Object.entries(mapa).map(([k, l]) =>
    `<option value="${k}" ${f[chave] === k ? "selected" : ""}>${l}</option>`).join("")}</select>`;

  return `
  <div class="ge-head">
    <div><h1>Entrada</h1><p class="ge-sub">Notas fiscais de entrada. A conferência e o armazenamento são feitos no coletor; aqui se acompanha, reimprime e cancela pendente.</p></div>
    <div class="ge-actions"><button class="btn primary" id="btNotasErp">Buscar notas do ERP</button></div>
  </div>
  <div class="gx-kpis ge-kpis">
    ${kpi("Total", todos.length, {})}
    ${kpi("Aguardando", conta((s) => s.conferencia === "aguardando"), { conferencia: "aguardando" })}
    ${kpi("Em aberto", conta((s) => s.conferencia === "aberta"), { conferencia: "aberta" })}
    ${kpi("Conferidas", conta((s) => s.conferencia === "conferida"), { conferencia: "conferida" })}
    ${kpi("Com divergência", conta((s) => s.divergencia === "com"), { divergencia: "com" })}
    ${kpi("Armazenamento parcial", conta((s) => s.armazenamento === "parcial"), { armazenamento: "parcial" })}
    ${kpi("Armazenadas", conta((s) => s.armazenamento === "armazenado"), { armazenamento: "armazenado" })}
  </div>
  <div class="ge-filtros">
    <label class="gx-search ge-curto nf"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
      <input data-f="nf" value="${esc(f.nf)}" placeholder="Número da NF" autocomplete="off" inputmode="numeric"></label>
    <label class="gx-search ge-curto"><input data-f="fornecedor" value="${esc(f.fornecedor)}" placeholder="Fornecedor (nome ou código)" autocomplete="off"></label>
    <label class="ge-periodo">De <input type="date" data-f="de" value="${f.de}"> até <input type="date" data-f="ate" value="${f.ate}"></label>
    ${opcoes("conferencia", STATUS_CONFERENCIA, "Conferência: todas")}
    ${opcoes("divergencia", STATUS_DIVERGENCIA, "Divergência: todas")}
    ${opcoes("armazenamento", STATUS_ARMAZENAMENTO, "Armazenamento: todos")}
    <button class="ge-limpar" data-limpar>Limpar filtros</button>
  </div>
  <div class="ge-card">
    <table class="ge-tab click">
      <thead><tr><th>NF</th><th>Fornecedor</th><th>Data</th><th>Tipo</th><th class="r">Produtos</th><th>Conferência</th><th>Divergência</th><th>Armazenamento</th></tr></thead>
      <tbody>${itens.map(({ n, s }) => {
        const p = pilulasDoStatus(s);
        return `<tr data-nota="${n.id}">
          <td><b class="ge-nf">${esc(n.numero)}</b></td><td>${esc(n.fornecedor.nome)} <small class="ge-cod">${n.fornecedor.codigo}</small></td>
          <td>${dataBr(n.data)}</td><td>${esc(n.tipo)}</td><td class="r">${n.itens.length}</td>
          <td>${p.conferencia}</td><td>${p.divergencia}</td><td>${p.armazenamento}</td></tr>`;
      }).join("") || `<tr><td colspan="8" class="ge-vazio">Nenhuma nota com esses filtros.</td></tr>`}</tbody>
    </table>
    ${rodape}
  </div>`;
}

// =====================================================================
// DETALHE DA NOTA (tela própria)
// =====================================================================
function detalhe(db, nota) {
  const p = pilulasDoStatus(statusDaNota(nota, db.conferencias));
  const itens = resumoDaNota(nota, db.conferencias);
  return `
  <div class="ge-head">
    <div>
      <button class="ge-voltar" data-voltarlista><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg> Entrada</button>
      <h1>NF ${esc(nota.numero)}</h1>
      <p class="ge-sub">${esc(nota.fornecedor.nome)} · fornecedor ${nota.fornecedor.codigo} · ${dataBr(nota.data)} · ${esc(nota.tipo)}</p>
    </div>
    <div class="ge-nota-st">
      <div><small>Conferência</small>${p.conferencia}</div>
      <div><small>Divergência</small>${p.divergencia}</div>
      <div><small>Armazenamento</small>${p.armazenamento}</div>
    </div>
  </div>
  <div class="ge-card">
    <table class="ge-tab">
      <thead><tr><th>Código</th><th>Descrição</th><th>Un</th><th class="r">Nota</th><th class="r">Conferido</th><th class="r">Divergência</th><th class="r">Armazenado</th><th class="r">Volumes</th><th></th></tr></thead>
      <tbody>${itens.map((i) => {
        const prod = produtoPorCodigo(db, i.produto);
        return `<tr>
          <td class="mono">${esc(i.produto)}</td><td>${esc(prod.descricao)}</td><td>${esc(prod.un)}</td>
          <td class="r">${num(i.qtdNota)}</td>
          <td class="r">${i.conferido ? `<button class="ge-link ge-num" data-conferido="${esc(i.produto)}">${num(i.conferido)}</button>` : "0"}</td>
          <td class="r">${divergenciaHtml(nota, i.divergencia)}</td>
          <td class="r">${num(i.armazenado)}</td>
          <td class="r">${i.volumes ? `<button class="ge-link ge-num" data-volumes="${esc(i.produto)}">${num(i.volumes)}</button>` : "0"}</td>
          <td class="r">${i.pendenteArmazenar > 0 ? `<button class="ge-link red" data-cancelar="${esc(i.produto)}">Cancelar pendente (${num(i.pendenteArmazenar)})</button>` : ""}</td>
        </tr>`;
      }).join("")}</tbody>
    </table>
  </div>
  <p class="ge-sub">Divergência = conferido − nota (negativo é falta). Aparece depois de a conferência ser finalizada no coletor.
    Cancelar pendente tira o produto da lista de armazenamento; o saldo continua na doca.</p>`;
}

// clique na área da aba Entrada; devolve true quando tratou
export function cliqueEntrada(t, db) {
  if (t.dataset.nota) { notaAberta = +t.dataset.nota; tela.render(); scrollTo(0, 0); return true; }
  if (t.dataset.voltarlista !== undefined) { notaAberta = null; tela.render(); return true; }
  if (t.id === "btNotasErp") {
    const r = importarNotasDoErp(); tela.render();
    tela.abrirModal(`<h2>Notas do ERP</h2>
      <p>${r.importadas.length ? `<b>${r.importadas.length}</b> nota(s) importada(s):` : "Nenhuma nota nova."}</p>
      ${r.importadas.map((n) => `<p class="ge-imp ok">NF ${esc(n.numero)} · ${esc(n.fornecedor.nome)} · ${n.itens.length} produto(s)</p>`).join("")}
      ${r.bloqueadas.map((b) => `<p class="ge-imp err">NF ${esc(b.nota.numero)} · ${esc(b.nota.fornecedor.nome)} · <b>${b.msg}</b></p>`).join("")}
      <div class="m-act"><button class="btn primary" data-fechar>Fechar</button></div>`);
    return true;
  }
  const nota = notaAberta ? notaPorId(db, notaAberta) : null;
  if (!nota) return false;
  if (t.dataset.conferido) { modalConferido(db, nota, t.dataset.conferido); return true; }
  if (t.dataset.volumes) { modalVolumes(db, nota, t.dataset.volumes); return true; }
  // sem confirmação (definido no documento); o saldo fica na doca para ser transferido depois
  if (t.dataset.cancelar) { cancelarPendente(nota.id, t.dataset.cancelar); tela.render(); tela.toast("Pendente cancelado · o saldo continua na doca"); return true; }
  return false;
}

// Conferido: nota × conferido × divergência, com cada confirmação feita no coletor
function modalConferido(db, nota, produto) {
  const i = resumoDoItem(nota, nota.itens.find((x) => x.produto === produto), db.conferencias);
  const confs = db.conferencias.filter((c) => c.notaId === nota.id && c.produto === produto);
  tela.abrirModal(`<h2>${esc(produto)} · conferido</h2>
    <div class="ge-tres"><div><small>Nota</small><b>${num(i.qtdNota)}</b></div><div><small>Conferido</small><b>${num(i.conferido)}</b></div>
      <div><small>Divergência</small><b>${divergenciaHtml(nota, i.divergencia)}</b></div></div>
    <table class="ge-tab ge-mini-tab"><thead><tr><th>Dia</th><th>Doca</th><th class="r">Qtd</th><th class="r">Volumes</th></tr></thead>
      <tbody>${confs.map((c) => `<tr><td>${dataBr(c.dia)}</td><td><span class="gaddr">${enderecoPorId(db, c.docaId)?.codigo || "—"}</span></td><td class="r">${num(c.qtd)}</td><td class="r">${c.volumes.length}</td></tr>`).join("")}</tbody></table>
    <div class="m-act"><button class="btn primary" data-fechar>Fechar</button></div>`);
}

// Volumes: só os códigos e o botão de reimprimir (a reimpressão é só pelo WEB)
function modalVolumes(db, nota, produto) {
  const vols = volumesDoItem(db, nota.id, produto);
  tela.abrirModal(`<h2>${esc(produto)} · volumes</h2>
    <div class="ge-vols">${vols.map((v) => `<span class="gaddr">${v.codigo} <small>${v.seq}/${v.total}</small></span>`).join("")}</div>
    <div class="m-act"><button class="btn ghost" data-fechar>Fechar</button><button class="btn primary" data-reimprimir="${esc(produto)}">Reimprimir ${vols.length} etiqueta(s)</button></div>`);
}

// clique dentro do modal (reimprimir); devolve true quando tratou
export function cliqueModalEntrada(t, db) {
  if (!t.dataset.reimprimir || !notaAberta) return false;
  const nota = notaPorId(db, notaAberta), produto = produtoPorCodigo(db, t.dataset.reimprimir);
  document.querySelector("#printArea").innerHTML = volumesDoItem(db, nota.id, produto.codigo).map((v) => etiquetaVolumeHtml(v, nota, produto)).join("");
  tela.fecharModal();
  window.print();
  return true;
}
