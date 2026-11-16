// WMS Beach Bike — Gestão de Estoque (WEB): cadastro de endereços, produtos/embalagens e endereçamento.
// A aba Entrada (notas do recebimento) fica em gestao-entrada.js e a Movimentação (abastecimento) em gestao-movimentacao.js.
// As regras ficam em compartilhado/regras/ e os dados passam por js/dados/estoque.js.
import { session, logout, PERFIS } from "./js/sessao.js";
import { $, $$, esc } from "./js/util.js";
import { qrSvg } from "./js/qr.js";
import {
  lerEstoque, aoMudarEstoque, reiniciarDemonstracao, enderecoPorId, produtoPorCodigo, embalagensDoProduto,
  enderecosPadraoDoProduto, saldoDoEndereco, criarEndereco, criarEnderecos, desativarEndereco, reativarEndereco,
  importarProdutosDoErp, salvarEmbalagem, excluirEmbalagem, removerAssociacao,
} from "./js/dados/estoque.js";
import {
  TIPOS_ENDERECO, compararEnderecos, codigoEmUso, podeDesativar, partesDoEndereco, codigoDoEndereco, validarPartes,
  gerarLote, contarLote, andaresDoLote, aptosDoAndar,
} from "./compartilhado/regras/enderecos.js";
import { buscarProdutos, validarEmbalagem, MSG_EXCLUIR_EMBALAGEM } from "./compartilhado/regras/embalagens.js";
import { FILTROS_ENTRADA, iniciarEntrada, telaEntrada, cliqueEntrada, cliqueModalEntrada, sairDaEntrada } from "./gestao-entrada.js";
import {
  FILTROS_MOVIMENTACAO, iniciarMovimentacao, telaMovimentacao, cliqueMovimentacao, cliqueModalMovimentacao, enviarModalMovimentacao,
} from "./gestao-movimentacao.js";

const sess = session();
let db = lerEstoque();
let aba = sessionStorage.getItem("ge-aba") || "enderecos";
let produtoAberto = null; // código do produto mostrado na gaveta

// filtros e paginação de cada tela (aplicados enquanto digita; "Limpar filtros" volta ao padrão)
const FILTROS_PADRAO = {
  enderecos: { busca: "", rua: "", predio: "", tipo: "", situacao: "todos" },
  produtos: { busca: "" },
  enderecamento: { busca: "", tipo: "" },
  entrada: FILTROS_ENTRADA,
  movimentacao: FILTROS_MOVIMENTACAO,
};
const filtros = structuredClone(FILTROS_PADRAO);
const pagina = { enderecos: 1, produtos: 1, enderecamento: 1, entrada: 1, movimentacao: 1 };
let porPagina = 20;
const selecionados = new Set(); // IDs de endereços marcados para imprimir o QR

// ---------- utilitários desta tela ----------
let toastT;
function toast(m) { const t = $("#toast"); t.textContent = m; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 2800); }
function abrirModal(html) { $("#modal").innerHTML = html; $("#modal").hidden = false; $("#mScrim").hidden = false; $("#modal").querySelector("input, select, button")?.focus(); }
function fecharModal() { $("#modal").hidden = true; $("#mScrim").hidden = true; }
const semInfo = (v) => (v === null || v === undefined || v === "" ? `<i class="ge-nd">Sem informação</i>`
  : typeof v === "number" && !Number.isInteger(v) ? v.toLocaleString("pt-BR") : esc(v)); // 0.394 → 0,394 (códigos inteiros ficam sem ponto)
const simNao = (v) => (v ? "Sim" : "Não");
const num = (n) => Number(n).toLocaleString("pt-BR");
const tipoTag = (t) => `<span class="ge-tipo ${t}">${TIPOS_ENDERECO[t]}</span>`;

// rodapé com "Mostrando x–y de z", registros por página (10, 20, 30, 50) e páginas
function paginar(lista, chave) {
  const total = lista.length, paginas = Math.max(1, Math.ceil(total / porPagina));
  pagina[chave] = Math.min(pagina[chave], paginas);
  const ini = (pagina[chave] - 1) * porPagina;
  const itens = lista.slice(ini, ini + porPagina);
  const rodape = `<div class="ge-pag">
    <span>${total ? `Mostrando ${ini + 1}–${ini + itens.length} de ${num(total)}` : "Nenhum registro"}</span>
    <label>Por página <select data-porpagina>${[10, 20, 30, 50].map((n) => `<option ${n === porPagina ? "selected" : ""}>${n}</option>`).join("")}</select></label>
    <span class="ge-pag-nav">
      <button class="btn ghost" data-pag="-1" ${pagina[chave] === 1 ? "disabled" : ""}>Anterior</button>
      <b>${pagina[chave]} / ${paginas}</b>
      <button class="btn ghost" data-pag="1" ${pagina[chave] === paginas ? "disabled" : ""}>Próxima</button>
    </span>
  </div>`;
  return { itens, rodape };
}

// =====================================================================
// ENDEREÇOS
// =====================================================================
function enderecosFiltrados() {
  const f = filtros.enderecos;
  const busca = f.busca.trim().toUpperCase();
  return db.enderecos
    .filter((e) => !busca || String(e.id) === busca || e.codigo.includes(busca))
    .filter((e) => !f.rua || e.rua === +f.rua)
    .filter((e) => !f.predio || e.predio === +f.predio)
    .filter((e) => !f.tipo || e.tipo === f.tipo)
    .filter((e) => f.situacao === "todos" || (f.situacao === "ativos" ? e.ativo : !e.ativo))
    .sort((a, b) => compararEnderecos(a.codigo, b.codigo) || a.id - b.id);
}

function telaEnderecos() {
  const f = filtros.enderecos;
  const lista = enderecosFiltrados();
  const { itens, rodape } = paginar(lista, "enderecos");
  const ruas = [...new Set(db.enderecos.map((e) => e.rua))].sort((a, b) => a - b);
  const predios = [...new Set(db.enderecos.filter((e) => !f.rua || e.rua === +f.rua).map((e) => e.predio))].sort((a, b) => a - b);
  const conta = (fn) => db.enderecos.filter(fn).length;
  // indicadores clicáveis: cada um aplica o filtro correspondente
  const kpi = (rotulo, n, filtro, ativo) => `<button class="gx-kpi ge-kpi ${ativo ? "on" : ""}" data-kpi='${JSON.stringify(filtro)}'>${rotulo} <b>${num(n)}</b></button>`;
  const imprimir = selecionados.size ? `${selecionados.size} selecionado${selecionados.size > 1 ? "s" : ""}` : `${num(lista.filter((e) => e.ativo).length)} filtrados`;
  const todosDaPagina = itens.length && itens.every((e) => selecionados.has(e.id));

  return `
  <div class="ge-head">
    <div><h1>Endereços</h1><p class="ge-sub">Cadastro único, usado por todos os módulos. Nunca se exclui um endereço: só se desativa.</p></div>
    <div class="ge-actions">
      <button class="btn ghost" id="btQr">Imprimir QR · ${imprimir}</button>
      <button class="btn ghost" id="btNovo">Novo endereço</button>
      <button class="btn primary" id="btLote">Criar em lote</button>
    </div>
  </div>
  <div class="gx-kpis ge-kpis">
    ${kpi("Todos", db.enderecos.length, { situacao: "todos", tipo: "" }, f.situacao === "todos" && !f.tipo)}
    ${kpi("Ativos", conta((e) => e.ativo), { situacao: "ativos", tipo: "" }, f.situacao === "ativos" && !f.tipo)}
    ${kpi("Inativos", conta((e) => !e.ativo), { situacao: "inativos", tipo: "" }, f.situacao === "inativos")}
    ${Object.entries(TIPOS_ENDERECO).map(([k, l]) => kpi(l, conta((e) => e.ativo && e.tipo === k), { situacao: "ativos", tipo: k }, f.tipo === k)).join("")}
  </div>
  <div class="ge-filtros">
    <label class="gx-search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
      <input data-f="busca" value="${esc(f.busca)}" placeholder="Bipe o QR ou digite o ID / código (R3001-P1…)" autocomplete="off"></label>
    <select data-f="rua"><option value="">Todas as ruas</option>${ruas.map((r) => `<option value="${r}" ${+f.rua === r ? "selected" : ""}>Rua ${r}</option>`).join("")}</select>
    <select data-f="predio"><option value="">Todos os prédios</option>${predios.map((p) => `<option value="${p}" ${+f.predio === p ? "selected" : ""}>Prédio ${p}</option>`).join("")}</select>
    <select data-f="tipo"><option value="">Todos os tipos</option>${Object.entries(TIPOS_ENDERECO).map(([k, l]) => `<option value="${k}" ${f.tipo === k ? "selected" : ""}>${l}</option>`).join("")}</select>
    <select data-f="situacao">${[["todos", "Ativos e inativos"], ["ativos", "Ativos"], ["inativos", "Inativos"]].map(([k, l]) => `<option value="${k}" ${f.situacao === k ? "selected" : ""}>${l}</option>`).join("")}</select>
    <button class="ge-limpar" data-limpar>Limpar filtros</button>
  </div>
  <div class="ge-card">
    <table class="ge-tab">
      <thead><tr>
        <th class="ck"><input type="checkbox" data-selpag ${todosDaPagina ? "checked" : ""} title="Selecionar a página"></th>
        <th>ID</th><th class="r">Rua</th><th class="r">Prédio</th><th class="r">Andar</th><th class="r">Apto</th><th>Código</th><th>Tipo</th><th>Depósito</th><th>Situação</th><th></th>
      </tr></thead>
      <tbody>${itens.map(linhaEndereco).join("") || `<tr><td colspan="11" class="ge-vazio">Nenhum endereço com esses filtros.</td></tr>`}</tbody>
    </table>
    ${rodape}
  </div>`;
}

function linhaEndereco(e) {
  const situacao = e.ativo ? `<span class="ge-sit ok">Ativo</span>`
    : `<span class="ge-sit off">Inativo</span>${e.substituidoPor ? `<small class="ge-subst">reativado como ${e.substituidoPor}</small>` : ""}`;
  const acao = e.ativo ? `<button class="ge-link" data-desativar="${e.id}">Desativar</button>`
    : e.substituidoPor ? "" : `<button class="ge-link" data-reativar="${e.id}">Reativar</button>`;
  return `<tr class="${e.ativo ? "" : "off"}">
    <td class="ck"><input type="checkbox" data-sel="${e.id}" ${selecionados.has(e.id) ? "checked" : ""} ${e.ativo ? "" : "disabled"}></td>
    <td class="mono">${e.id}</td><td class="r">${e.rua}</td><td class="r">${e.predio}</td><td class="r">${e.andar}</td><td class="r">${e.apto}</td>
    <td><span class="gaddr">${e.codigo}</span></td><td>${tipoTag(e.tipo)}</td><td>${esc(e.deposito)}</td><td>${situacao}</td><td class="r">${acao}</td>
  </tr>`;
}

// ---------- formulário de endereço (novo e reativar) ----------
// Os números são digitados exatamente como estão na prateleira: andar 100, apto 101 → A100-AP101.
function formEndereco(id, v, tipo, deposito, botao, dataId = "") {
  return `<form id="${id}" class="ge-lote" ${dataId}>
    ${[["rua", "Rua", "3001"], ["predio", "Prédio", "7"], ["andar", "Andar", "100"], ["apto", "Apartamento", "101"]].map(([k, l, ex]) =>
      `<span class="ge-lote-l">${l}</span><input name="${k}" type="number" min="1" inputmode="numeric" value="${v[k] ?? ""}" placeholder="Ex.: ${ex}" required><span></span>`).join("")}
    <span class="ge-lote-l">Tipo</span>
    <select name="tipo" required><option value="">Escolha…</option>${Object.entries(TIPOS_ENDERECO).map(([k, l]) => `<option value="${k}" ${tipo === k ? "selected" : ""}>${l}</option>`).join("")}</select>
    <input name="deposito" value="${esc(deposito)}" placeholder="Depósito" required>
    <p id="endInfo" class="ge-lote-info"></p>
    <div class="m-act"><button type="button" class="btn ghost" data-fechar>Fechar</button><button class="btn primary">${botao}</button></div>
  </form>`;
}

// mostra, enquanto digita, o código que vai sair (ou o motivo de não poder)
function previaEndereco(form) {
  const d = Object.fromEntries(new FormData(form));
  const info = $("#endInfo");
  if (["rua", "predio", "andar", "apto"].some((k) => d[k] === "")) {
    info.className = "ge-lote-info"; info.textContent = "Preencha rua, prédio, andar e apartamento para ver o código."; return;
  }
  const erro = validarPartes(d);
  const partes = erro ? null : partesDoEndereco(d);
  const emUso = partes && codigoEmUso(db.enderecos, partes, +form.dataset.id || null);
  info.className = "ge-lote-info" + (erro || emUso ? " err" : " ok");
  info.innerHTML = erro || (emUso ? `${codigoDoEndereco(partes)} · JÁ EXISTE UM ENDEREÇO ATIVO COM ESTE CÓDIGO.`
    : `Código na prateleira: <span class="gaddr">${codigoDoEndereco(partes)}</span>`);
}

// cadastro individual (no MVP, um endereço por vez). A janela fica aberta para cadastrar o próximo.
function abrirNovoEndereco() {
  abrirModal(`<h2>Novo endereço</h2>
    ${formEndereco("fNovo", {}, "", "Principal", "Cadastrar")}
    <p id="endOk" class="ge-imp ok" hidden></p>`);
  $("#modal").classList.add("wide");
  previaEndereco($("#fNovo"));
}

// ---------- criar em lote ----------
// Tudo com os números da placa: andar 100 a 300 de 100 em 100 e os aptos do 1º andar (101 a 106);
// o sistema repete os aptos na mesma posição nos outros andares (201–206, 301–306).
function abrirLote() {
  const par = (k, l, ini, fim) => `<span class="ge-lote-l">${l}</span>
    <input name="${k}Ini" type="number" min="1" inputmode="numeric" placeholder="Inicial (ex.: ${ini})" required>
    <input name="${k}Fim" type="number" min="1" inputmode="numeric" placeholder="Final (ex.: ${fim})" required>`;
  abrirModal(`<h2>Criar endereços em lote</h2>
    <p>Digite os números como estão nas placas. Endereços que já existem são pulados.</p>
    <form id="fLote" class="ge-lote">
      ${par("rua", "Rua", 3001, 3001)}
      ${par("predio", "Prédio", 1, 6)}
      ${par("andar", "Andar", 100, 300)}
      <span class="ge-lote-l">Andar de … em …</span>
      <input name="andarPasso" type="number" min="1" inputmode="numeric" value="100" required>
      <span class="ge-lote-x">ex.: 100 → A100, A200, A300</span>
      ${par("apto", "Apto (1º andar)", 101, 106)}
      <span class="ge-lote-l">Tipo</span>
      <select name="tipo" required><option value="">Escolha…</option>${Object.entries(TIPOS_ENDERECO).map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select>
      <input name="deposito" value="Principal" placeholder="Depósito" required>
      <p id="loteInfo" class="ge-lote-info"></p>
      <div class="m-act"><button type="button" class="btn ghost" data-fechar>Cancelar</button><button class="btn primary">Criar endereços</button></div>
    </form>`);
  $("#modal").classList.add("wide");
  previaLote();
}

// mostra, enquanto digita, quantos endereços vão sair e os apartamentos de cada andar (ou o motivo de não poder)
function previaLote() {
  const f = Object.fromEntries(new FormData($("#fLote")));
  const info = $("#loteInfo");
  const campos = ["ruaIni", "ruaFim", "predioIni", "predioFim", "andarIni", "andarFim", "aptoIni", "aptoFim"];
  if (campos.some((k) => f[k] === "")) {
    info.className = "ge-lote-info"; info.textContent = "Preencha os intervalos para ver os endereços que serão criados."; return null;
  }
  const r = gerarLote(f);
  if (r.erro) { info.className = "ge-lote-info err"; info.textContent = r.erro; return null; }
  const ativos = new Set(db.enderecos.filter((e) => e.ativo).map((e) => e.codigo));
  const existentes = r.enderecos.filter((e) => ativos.has(e.codigo)).length;
  const andares = andaresDoLote(f);
  const porAndar = andares.slice(0, 4).map((a) => { const ap = aptosDoAndar(f, a); return `A${a}: AP${ap[0]}–AP${ap.at(-1)}`; }).join(" · ")
    + (andares.length > 4 ? ` · … (${andares.length} andares)` : "");
  info.className = "ge-lote-info ok";
  info.innerHTML = `Vai criar <b>${num(contarLote(f) - existentes)}</b> endereço(s)`
    + (existentes ? ` · <b>${num(existentes)}</b> já existem e serão pulados` : "")
    + `<br><span class="gaddr">${r.enderecos[0].codigo}</span> até <span class="gaddr">${r.enderecos.at(-1).codigo}</span>`
    + `<br>${porAndar}`;
  return { enderecos: r.enderecos, deposito: f.deposito };
}

// ---------- desativar / reativar ----------
function pedirDesativar(id) {
  const e = enderecoPorId(db, id);
  const pode = podeDesativar({ saldo: saldoDoEndereco(db, id) });
  if (!pode.ok) return abrirModal(`<h2>Não foi possível desativar</h2><p class="ge-msg">${pode.msg}</p><p><span class="gaddr">${e.codigo}</span></p>
    <div class="m-act"><button class="btn primary" data-fechar>Entendi</button></div>`);
  abrirModal(`<h2>Desativar endereço?</h2>
    <p><span class="gaddr">${e.codigo}</span> · ID ${e.id}</p>
    <p>O endereço deixa de receber movimentações e o QR dele passa a ser bloqueado no coletor. O histórico continua guardado.</p>
    <div class="m-act"><button class="btn ghost" data-fechar>Cancelar</button><button class="btn primary" data-confdesativar="${id}">Desativar</button></div>`);
}

function pedirReativar(id) {
  const e = enderecoPorId(db, id);
  // o formulário já vem com os números atuais da prateleira
  abrirModal(`<h2>Reativar endereço</h2>
    <p>Pode reutilizar com os mesmos dados ou mudar o que precisar. Ele volta com <b>ID e QR novos</b>; o QR antigo (ID ${e.id}) continua bloqueado.</p>
    ${formEndereco("fReativar", e, e.tipo, e.deposito, "Reativar", `data-id="${id}"`)}`);
  $("#modal").classList.add("wide");
  previaEndereco($("#fReativar"));
}

// ---------- impressão dos QR ----------
function imprimirQr() {
  const lista = selecionados.size ? db.enderecos.filter((e) => selecionados.has(e.id)) : enderecosFiltrados().filter((e) => e.ativo);
  if (!lista.length) return toast("Nenhum endereço ativo para imprimir");
  // uma etiqueta de 80 × 60 mm por endereço. O QR leva só o ID do endereço:
  // reconfigurado, ele ganha outro ID e o QR antigo para de valer
  $("#printArea").innerHTML = lista.sort((a, b) => compararEnderecos(a.codigo, b.codigo)).map((e) => `
    <div class="qe">
      <b class="qe-cod">${e.codigo}</b>
      <div class="qe-meio">${qrSvg(String(e.id), "qe-qr")}
        <dl class="qe-partes"><dt>Rua</dt><dd>${e.rua}</dd><dt>Prédio</dt><dd>${e.predio}</dd><dt>Andar</dt><dd>${e.andar}</dd><dt>Apto</dt><dd>${e.apto}</dd></dl>
      </div>
      <small class="qe-rod">ID ${e.id} · ${TIPOS_ENDERECO[e.tipo]} · ${esc(e.deposito)}</small>
    </div>`).join("");
  window.print();
}

// =====================================================================
// PRODUTOS E EMBALAGENS
// =====================================================================
function telaProdutos() {
  const lista = buscarProdutos(db.produtos, filtros.produtos.busca).slice().sort((a, b) => a.codigo.localeCompare(b.codigo));
  const { itens, rodape } = paginar(lista, "produtos");
  return `
  <div class="ge-head">
    <div><h1>Produtos</h1><p class="ge-sub">Os produtos vêm do ERP; não há cadastro manual. Saldo fica nas consultas próprias.</p></div>
    <div class="ge-actions"><button class="btn primary" id="btImportar">Importar do ERP</button></div>
  </div>
  <div class="ge-filtros">
    <label class="gx-search ge-busca-larga"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
      <input data-f="busca" value="${esc(filtros.produtos.busca)}" placeholder="Código interno ou descrição" autocomplete="off"></label>
    <button class="ge-limpar" data-limpar>Limpar filtros</button>
  </div>
  <div class="ge-card">
    <table class="ge-tab click">
      <thead><tr><th>Código</th><th>Descrição</th><th>Un.</th><th class="r">Fornecedor</th><th class="r">Grupo</th><th class="r">Embalagens</th><th class="r">Endereços padrão</th></tr></thead>
      <tbody>${itens.map((p) => `<tr data-produto="${esc(p.codigo)}">
        <td class="mono">${esc(p.codigo)}</td><td>${esc(p.descricao)}</td><td>${esc(p.un)}</td><td class="r">${p.fornecedor}</td><td class="r">${p.grupo}</td>
        <td class="r">${embalagensDoProduto(db, p.codigo).length}</td><td class="r">${db.associacoes.filter((a) => a.produto === p.codigo).length}</td>
      </tr>`).join("") || `<tr><td colspan="7" class="ge-vazio">Nenhum produto encontrado.</td></tr>`}</tbody>
    </table>
    ${rodape}
  </div>`;
}

// gaveta do produto: dados do ERP, embalagens e endereços padrão
function abrirProduto(codigo) {
  produtoAberto = codigo;
  const p = produtoPorCodigo(db, codigo);
  if (!p) return fecharProduto();
  const embs = embalagensDoProduto(db, codigo);
  const ends = enderecosPadraoDoProduto(db, codigo).filter(Boolean).sort((a, b) => compararEnderecos(a.codigo, b.codigo));
  const campo = (rotulo, valor) => `<div class="dr-f"><small>${rotulo}</small><b>${valor}</b></div>`;
  $("#drawer").innerHTML = `
    <div class="dr-head"><div><p class="dr-k">Produto · ${esc(p.codigo)}</p><h2 class="ge-dr-t">${esc(p.descricao)}</h2></div><button class="dr-x" data-fechardr>×</button></div>
    <div class="dr-body">
      <section><p class="dr-h">Dados recebidos do ERP</p>
        <div class="dr-grid ge-grid3">
          ${campo("Fornecedor", semInfo(p.fornecedor))}${campo("Grupo", semInfo(p.grupo))}${campo("SubGrupo", semInfo(p.subgrupo))}
          ${campo("Un. padrão", semInfo(p.un))}${campo("Estoque mínimo", semInfo(p.estoqueMin))}${campo("Estoque máximo", semInfo(p.estoqueMax))}
          ${campo("Controla validade", simNao(p.controlaValidade))}${campo("Controla lote", simNao(p.controlaLote))}${campo("Controla série", simNao(p.controlaSerie))}
          ${campo("Peso bruto", semInfo(p.pesoBruto))}${campo("Peso líquido", semInfo(p.pesoLiquido))}${campo("Shelflife", semInfo(p.shelflife))}
        </div>
      </section>
      <section>
        <div class="ge-sec-h"><p class="dr-h">Embalagens</p><button class="btn ghost ge-mini" data-novaemb>Adicionar embalagem</button></div>
        <table class="dr-items">
          <thead><tr><th>Código de barras</th><th>Descrição</th><th class="r">Quantidade</th><th></th></tr></thead>
          <tbody>${embs.map((e) => `<tr>
            <td class="mono">${e.codigo ? esc(e.codigo) : `<i class="ge-nd">sem código</i>`}</td><td>${esc(e.descricao)}</td><td class="r">${num(e.qtd)}</td>
            <td class="r"><button class="ge-link" data-editemb="${e.id}">Editar</button> <button class="ge-link red" data-delemb="${e.id}">Excluir</button></td>
          </tr>`).join("") || `<tr><td colspan="4" class="ge-vazio">Nenhuma embalagem. Sem embalagem, o operador acha o produto pelo código interno.</td></tr>`}</tbody>
        </table>
      </section>
      <section><p class="dr-h">Endereços padrão</p>
        ${ends.length ? `<div class="ge-chips">${ends.map((e) => `<span class="ge-chip">${tipoTag(e.tipo)}<span class="gaddr">${e.codigo}</span><button title="Remover associação" data-remassoc="${e.id}">×</button></span>`).join("")}</div>`
          : `<p class="ge-sub">Nenhum. A associação é feita no coletor, em Cadastro › Endereçar produto.</p>`}
      </section>
    </div>`;
  $("#drawer").hidden = false; $("#drScrim").hidden = false;
}
function fecharProduto() { produtoAberto = null; $("#drawer").hidden = true; $("#drScrim").hidden = true; }

function abrirEmbalagem(id = null) {
  const e = id ? db.embalagens.find((x) => x.id === id) : { codigo: "", descricao: "", qtd: "" };
  abrirModal(`<h2>${id ? "Editar embalagem" : "Adicionar embalagem"}</h2>
    <form id="fEmb" data-id="${id || ""}" class="ge-form">
      <label class="field"><span>Código de barras (opcional)</span><input name="codigo" value="${esc(e.codigo)}" placeholder="Digite ou leia com o scanner" autocomplete="off"></label>
      <label class="field"><span>Descrição</span><input name="descricao" value="${esc(e.descricao)}" placeholder="Ex.: Caixa com 12" required></label>
      <label class="field"><span>Quantidade</span><input name="qtd" value="${e.qtd === "" ? "" : String(e.qtd).replace(".", ",")}" inputmode="decimal" placeholder="Ex.: 12 ou 0,5" required></label>
      <p id="embErr" class="ge-msg" hidden></p>
      <div class="m-act"><button type="button" class="btn ghost" data-fechar>Cancelar</button><button class="btn primary">Salvar</button></div>
    </form>`);
}

// =====================================================================
// ENDEREÇAMENTO (consulta e remoção; a associação é feita no coletor)
// =====================================================================
function telaEnderecamento() {
  const f = filtros.enderecamento;
  const busca = f.busca.trim().toLowerCase();
  const linhas = db.associacoes
    .map((a) => ({ p: produtoPorCodigo(db, a.produto), e: enderecoPorId(db, a.enderecoId) }))
    .filter((l) => l.p && l.e)
    .filter((l) => !busca || l.p.codigo.toLowerCase().includes(busca) || l.p.descricao.toLowerCase().includes(busca) || l.e.codigo.toLowerCase().includes(busca) || String(l.e.id) === busca)
    .filter((l) => !f.tipo || l.e.tipo === f.tipo)
    .sort((a, b) => a.p.codigo.localeCompare(b.p.codigo) || compararEnderecos(a.e.codigo, b.e.codigo));
  const { itens, rodape } = paginar(linhas, "enderecamento");
  return `
  <div class="ge-head">
    <div><h1>Endereçamento</h1><p class="ge-sub">Endereço padrão de cada produto. A associação é feita no coletor; aqui o gestor consulta e remove. Não movimenta estoque.</p></div>
  </div>
  <div class="ge-filtros">
    <label class="gx-search ge-busca-larga"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
      <input data-f="busca" value="${esc(f.busca)}" placeholder="Produto, descrição ou endereço" autocomplete="off"></label>
    <select data-f="tipo"><option value="">Picking e aéreo</option>${["picking", "aereo"].map((k) => `<option value="${k}" ${f.tipo === k ? "selected" : ""}>${TIPOS_ENDERECO[k]}</option>`).join("")}</select>
    <button class="ge-limpar" data-limpar>Limpar filtros</button>
  </div>
  <div class="ge-card">
    <table class="ge-tab">
      <thead><tr><th>Produto</th><th>Descrição</th><th>Endereço padrão</th><th>Tipo</th><th></th></tr></thead>
      <tbody>${itens.map(({ p, e }) => `<tr>
        <td class="mono">${esc(p.codigo)}</td><td>${esc(p.descricao)}</td><td><span class="gaddr">${e.codigo}</span>${e.ativo ? "" : ` <span class="ge-sit off">Inativo</span>`}</td><td>${tipoTag(e.tipo)}</td>
        <td class="r"><button class="ge-link red" data-remassoc="${e.id}" data-prod="${esc(p.codigo)}">Remover</button></td>
      </tr>`).join("") || `<tr><td colspan="5" class="ge-vazio">Nenhuma associação encontrada.</td></tr>`}</tbody>
    </table>
    ${rodape}
  </div>`;
}

// =====================================================================
// desenho da tela e eventos
// =====================================================================
const TELAS = { enderecos: telaEnderecos, produtos: telaProdutos, enderecamento: telaEnderecamento, entrada: () => telaEntrada(db, filtros.entrada),
  movimentacao: () => telaMovimentacao(db, filtros.movimentacao) };
iniciarEntrada({ paginar, render, abrirModal, fecharModal, toast });
iniciarMovimentacao({ paginar, render, abrirModal, fecharModal, toast, voltarPagina: () => (pagina.movimentacao = 1) });

function render() {
  db = lerEstoque();
  $$(".gx-tab[data-aba]").forEach((b) => b.classList.toggle("active", b.dataset.aba === aba));
  // guarda o foco do campo de busca para não perder o que está sendo digitado
  const foco = document.activeElement?.dataset?.f;
  const pos = document.activeElement?.selectionStart;
  $("#tela").innerHTML = TELAS[aba]();
  if (foco) { const el = $(`#tela [data-f="${foco}"]`); if (el) { el.focus(); if (pos != null && el.setSelectionRange) el.setSelectionRange(pos, pos); } }
  if (produtoAberto) abrirProduto(produtoAberto);
}

$("#userName").textContent = sess ? sess.nome : "";
$("#tabs").addEventListener("click", (ev) => {
  const b = ev.target.closest(".gx-tab"); if (!b) return;
  if (b.dataset.soon) return toast(`Em breve: ${b.dataset.soon}`);
  aba = b.dataset.aba; sessionStorage.setItem("ge-aba", aba);
  fecharProduto(); sairDaEntrada(); render();
});

// filtros: aplicados na hora, enquanto digita ou ao escolher
$("#tela").addEventListener("input", (ev) => {
  const k = ev.target.dataset.f; if (!k) return;
  filtros[aba][k] = ev.target.value;
  if (k === "rua") filtros[aba].predio = "";
  pagina[aba] = 1; render();
});
$("#tela").addEventListener("change", (ev) => {
  const t = ev.target;
  if (t.matches("[data-porpagina]")) { porPagina = +t.value; pagina[aba] = 1; return render(); }
  if (t.matches("[data-sel]")) { const id = +t.dataset.sel; t.checked ? selecionados.add(id) : selecionados.delete(id); return render(); }
  if (t.matches("[data-selpag]")) {
    const { itens } = paginar(enderecosFiltrados(), "enderecos");
    itens.filter((e) => e.ativo).forEach((e) => (t.checked ? selecionados.add(e.id) : selecionados.delete(e.id)));
    return render();
  }
});

$("#tela").addEventListener("click", (ev) => {
  const t = ev.target.closest("button, tr[data-produto], tr[data-nota]"); if (!t) return;
  if (t.dataset.kpi) { Object.assign(filtros[aba], JSON.parse(t.dataset.kpi)); pagina[aba] = 1; return render(); }
  if (t.dataset.limpar !== undefined) {
    const sub = filtros[aba].sub; // "Limpar filtros" não troca a sub-aba (ex.: Mínimo e máximo)
    filtros[aba] = structuredClone(FILTROS_PADRAO[aba]); if (sub) filtros[aba].sub = sub;
    selecionados.clear(); pagina[aba] = 1; return render();
  }
  if (t.dataset.pag) { pagina[aba] += +t.dataset.pag; return render(); }
  if (aba === "entrada" && cliqueEntrada(t, db)) return;
  if (aba === "movimentacao" && cliqueMovimentacao(t, db, filtros.movimentacao)) return;
  if (t.id === "btNovo") return abrirNovoEndereco();
  if (t.id === "btLote") return abrirLote();
  if (t.id === "btQr") return imprimirQr();
  if (t.dataset.desativar) return pedirDesativar(+t.dataset.desativar);
  if (t.dataset.reativar) return pedirReativar(+t.dataset.reativar);
  if (t.id === "btImportar") {
    const r = importarProdutosDoErp(); render();
    return abrirModal(`<h2>Importação do ERP</h2>
      <p>${r.importados.length ? `<b>${r.importados.length}</b> produto(s) importado(s):` : "Nenhum produto novo."}</p>
      ${r.importados.map((p) => `<p class="ge-imp ok">${esc(p.codigo)} · ${esc(p.descricao)}</p>`).join("")}
      ${r.bloqueados.map((b) => `<p class="ge-imp err">${esc(b.produto.codigo)} · <b>${b.msg}</b></p>`).join("")}
      <div class="m-act"><button class="btn primary" data-fechar>Fechar</button></div>`);
  }
  if (t.dataset.produto) return abrirProduto(t.dataset.produto);
  if (t.dataset.remassoc) { removerAssociacao(t.dataset.prod, +t.dataset.remassoc); toast("Associação removida"); return render(); }
});

// gaveta do produto
$("#drScrim").addEventListener("click", fecharProduto);
$("#drawer").addEventListener("click", (ev) => {
  const t = ev.target.closest("button"); if (!t) return;
  if (t.dataset.fechardr !== undefined) return fecharProduto();
  if (t.dataset.novaemb !== undefined) return abrirEmbalagem();
  if (t.dataset.editemb) return abrirEmbalagem(+t.dataset.editemb);
  if (t.dataset.delemb) return abrirModal(`<h2>Excluir embalagem</h2><p class="ge-msg">${MSG_EXCLUIR_EMBALAGEM}</p>
    <div class="m-act"><button class="btn ghost" data-fechar>Não</button><button class="btn primary" data-confdelemb="${t.dataset.delemb}">Sim, excluir</button></div>`);
  // remoção pelo WEB é direta, sem confirmação (definido no documento)
  if (t.dataset.remassoc) { removerAssociacao(produtoAberto, +t.dataset.remassoc); toast("Associação removida"); return render(); }
});

// modais
$("#mScrim").addEventListener("click", fecharModal);
document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") { if (!$("#modal").hidden) fecharModal(); else fecharProduto(); } });
$("#modal").addEventListener("click", (ev) => {
  const t = ev.target.closest("button"); if (!t) return;
  if (t.dataset.fechar !== undefined) return fecharModal();
  if (cliqueModalEntrada(t, db)) return;
  if (cliqueModalMovimentacao(t, db)) return;
  if (t.dataset.confdesativar) {
    const r = desativarEndereco(+t.dataset.confdesativar);
    fecharModal(); render(); return toast(r.ok ? "Endereço desativado" : r.msg);
  }
  if (t.dataset.confdelemb) { excluirEmbalagem(+t.dataset.confdelemb); fecharModal(); render(); return toast("Embalagem excluída"); }
});
$("#modal").addEventListener("input", (ev) => {
  if (ev.target.form?.id === "fLote") previaLote();
  // novo endereço e reativação: mostra o código que vai sair do que foi digitado
  if (ev.target.form?.id === "fNovo" || ev.target.form?.id === "fReativar") { $("#endOk") && ($("#endOk").hidden = true); previaEndereco(ev.target.form); }
  // embalagem: código repetido é avisado enquanto digita (e conferido de novo ao salvar)
  if (ev.target.form?.id === "fEmb") {
    const f = ev.target.form, id = +f.dataset.id || null;
    const r = validarEmbalagem({ codigo: f.codigo.value, descricao: f.descricao.value || "x", qtd: f.qtd.value || 1 }, db.embalagens, id);
    $("#embErr").hidden = r.ok; $("#embErr").textContent = r.ok ? "" : r.msg;
  }
});
$("#modal").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const f = ev.target;
  if (enviarModalMovimentacao(f, db)) return;
  if (f.id === "fNovo") {
    const r = criarEndereco(Object.fromEntries(new FormData(f)));
    if (!r.ok) { $("#endInfo").className = "ge-lote-info err"; $("#endInfo").textContent = r.msg; return; }
    render();
    // deixa pronto para o próximo: mesmo andar, apartamento seguinte
    $("#endOk").hidden = false;
    $("#endOk").innerHTML = `Cadastrado <b>${r.endereco.codigo}</b> · ID ${r.endereco.id}`;
    f.apto.value = +f.apto.value + 1; previaEndereco(f); f.apto.focus(); f.apto.select();
    return;
  }
  if (f.id === "fLote") {
    const lote = previaLote(); if (!lote) return;
    const r = criarEnderecos(lote.enderecos, lote.deposito);
    fecharModal(); render();
    return toast(`${num(r.criados)} endereço(s) criado(s)` + (r.ignorados ? ` · ${num(r.ignorados)} já existiam` : ""));
  }
  if (f.id === "fReativar") {
    const r = reativarEndereco(+f.dataset.id, Object.fromEntries(new FormData(f)));
    if (!r.ok) { $("#endInfo").className = "ge-lote-info err"; $("#endInfo").textContent = r.msg; return; }
    fecharModal(); render(); return toast(`Reativado como ${r.endereco.codigo} · ID ${r.endereco.id}`);
  }
  if (f.id === "fEmb") {
    const r = salvarEmbalagem(produtoAberto, Object.fromEntries(new FormData(f)), +f.dataset.id || null);
    if (!r.ok) { $("#embErr").hidden = false; $("#embErr").textContent = r.msg; return; }
    fecharModal(); render(); return toast("Embalagem salva");
  }
});
// a janela larga (formulário de endereço) volta ao normal ao fechar
new MutationObserver(() => { if ($("#modal").hidden) $("#modal").classList.remove("wide"); }).observe($("#modal"), { attributes: true, attributeFilter: ["hidden"] });

// usuário: sair ou reiniciar a demonstração
$("#userBtn").addEventListener("click", () => abrirModal(`<h2>${esc(sess.nome)}</h2><p>Perfil: ${PERFIS[sess.perfil]}</p>
  <div class="m-act"><button class="btn ghost" id="btReset">Reiniciar demonstração</button><button class="btn primary" id="btSair">Sair</button></div>`));
$("#modal").addEventListener("click", (ev) => {
  if (ev.target.id === "btSair") { logout(); location.replace("./"); }
  if (ev.target.id === "btReset") { reiniciarDemonstracao(); selecionados.clear(); fecharModal(); fecharProduto(); render(); toast("Demonstração reiniciada"); }
});

// tempo real: o que o coletor gravar aparece aqui na hora
aoMudarEstoque(render);
render();
