// WMS Beach Bike — Gestão de Estoque (WEB), aba ENTRADA: notas do recebimento, detalhe da nota e volumes.
// Só o gestor reimprime etiqueta de volume e cancela pendente (o coletor apenas consulta).
// As regras ficam em compartilhado/regras/recebimento.js e os dados passam por js/dados/recebimento.js.
//
// Duas fontes, a MESMA tela:
//   - demonstração (GitHub Pages): as notas do localStorage deste computador;
//   - servidor (v77, Estoque no servidor · entrega A): as notas do banco. A lista vem filtrada e paginada pelo
//     servidor (nunca todas as notas de uma vez) e se atualiza sozinha quando outra tela muda uma nota.
import { esc } from "./js/util.js";
import { etiquetaVolumeHtml, etiquetaVolumeDaNotaHtml } from "./js/etiqueta-recebimento.js";
import { produtoPorCodigo, enderecoPorId } from "./js/dados/estoque.js";
import {
  notaPorId, volumesDoItem, cancelarPendente, importarNotasDoErp, volumesEntradaDaNota,
  buscarNotasNoServidor, buscarNotaNoServidor, cancelarPendenteNoServidor, importarNotasNoServidor, ouvirNotas,
} from "./js/dados/recebimento.js";
import {
  statusDaNota, resumoDaNota, resumoDoItem, STATUS_CONFERENCIA, STATUS_DIVERGENCIA, STATUS_ARMAZENAMENTO, rotuloDaNota, TIPOS_DE_VOLUME,
} from "./compartilhado/regras/recebimento.js";

export const FILTROS_ENTRADA = { nf: "", fornecedor: "", de: "", ate: "", conferencia: "", divergencia: "", armazenamento: "" };

// funções da tela principal (modal, toast, paginação…), entregues por gestao-estoque.js
let tela;
export function iniciarEntrada(funcoes) { tela = funcoes; }

let notaAberta = null; // id da nota mostrada no detalhe (null = lista)
export const sairDaEntrada = () => { notaAberta = null; };

// ---------- com servidor ----------
// lista = a última resposta do servidor · pedida = a consulta (filtros + página) que ela responde
let servidor = null; // { sess, lista, pedida, pedindo, detalhe, erro }
let espera = null;
export function ligarEntradaNoServidor(sess) {
  servidor = { sess, lista: null, pedida: "", pedindo: "", detalhe: null, erro: "" };
  // outra tela mudou uma nota (outro gestor, o coletor, uma devolução entregue): relê o que está aberto
  ouvirNotas(sess, () => {
    servidor.pedida = "";
    if (notaAberta) carregarDetalhe(notaAberta); else tela.render();
  });
}
export const entradaNoServidor = () => !!servidor;

function pedirLista(filtros) {
  const { pagina, porPagina } = tela.paginaDe("entrada");
  const consulta = JSON.stringify({ filtros, pagina, porPagina });
  if (consulta === servidor.pedida || consulta === servidor.pedindo) return;
  servidor.pedindo = consulta;
  clearTimeout(espera);
  // espera a digitação parar um pouco antes de perguntar ao servidor
  espera = setTimeout(async () => {
    const r = await buscarNotasNoServidor(servidor.sess, filtros, pagina, porPagina);
    if (servidor.pedindo !== consulta) return; // já mudaram os filtros: esta resposta não vale mais
    servidor.pedindo = "";
    servidor.pedida = consulta;
    servidor.erro = r.ok ? "" : r.erro;
    if (r.ok) {
      servidor.lista = r;
      if (r.pagina !== pagina) tela.corrigirPagina("entrada", r.pagina); // pediu uma página além do fim
    }
    if (!notaAberta) tela.render();
  }, 250);
}
async function carregarDetalhe(id) {
  const r = await buscarNotaNoServidor(servidor.sess, id);
  if (notaAberta !== id) return;
  servidor.erro = r.ok ? "" : r.erro;
  if (r.ok) servidor.detalhe = r;
  tela.render();
}

// A nota aberta, no formato que o detalhe e os modais usam (o mesmo nas duas fontes):
// { nota, conferencias, produto(codigo) → { codigo, descricao, un }, doca(id) → código, volumes(produto) → [...],
//   novo(codigo) → o produto foi cadastrado por esta nota? (v77: o produto novo nasce da nota do ERP),
//   recusas → o que o coletor mandou e o servidor não aplicou (v78; só com servidor), comServidor,
//   volumesEntrada → os volumes da conferência por volume, palete ou caixa, com os produtos (v80) }
function fonteDaDemo(db, nota) {
  return {
    nota, conferencias: db.conferencias,
    produto: (c) => produtoPorCodigo(db, c) || { codigo: c, descricao: "", un: "" },
    doca: (id) => enderecoPorId(db, id)?.codigo,
    volumes: (p) => volumesDoItem(db, nota.id, p),
    novo: (c) => produtoPorCodigo(db, c)?.cadastradoPorNota === nota.id,
    recusas: [], comServidor: false, volumesEntrada: volumesEntradaDaNota(db, nota.id),
  };
}
function fonteDoServidor(d) {
  const produtos = new Map(d.produtos.map((p) => [p.codigo, p]));
  const docas = new Map(d.docas.map((x) => [x.id, x.codigo]));
  return {
    nota: d.nota, conferencias: d.conferencias,
    produto: (c) => produtos.get(c) || { codigo: c, descricao: "", un: "" },
    doca: (id) => docas.get(id),
    volumes: (p) => d.volumes.filter((v) => v.produto === p),
    novo: (c) => produtos.get(c)?.cadastrado_por_nota === d.nota.id,
    recusas: d.recusas || [], comServidor: true, volumesEntrada: d.volumesEntrada || [],
  };
}
const fonteAberta = (db) => {
  if (!notaAberta) return null;
  if (servidor) return servidor.detalhe?.nota.id === notaAberta ? fonteDoServidor(servidor.detalhe) : null;
  const nota = notaPorId(db, notaAberta);
  return nota ? fonteDaDemo(db, nota) : null;
};

const num = (n) => Number(n).toLocaleString("pt-BR");
const dataBr = (iso) => iso.split("-").reverse().join("/");
const dataHora = (iso) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
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
const avisoDeErro = () => (servidor?.erro ? `<p class="ge-msg">${esc(servidor.erro)}</p>` : "");
const carregando = (titulo) => `<div class="ge-head"><div><h1>${titulo}</h1><p class="ge-sub">Carregando do servidor…</p></div></div>${avisoDeErro()}`;

export function telaEntrada(db, filtros) {
  if (servidor) return telaDoServidor(filtros);
  if (notaAberta && notaPorId(db, notaAberta)) return detalhe(fonteDaDemo(db, notaPorId(db, notaAberta)));
  notaAberta = null;
  return listaDaDemo(db, filtros);
}
function telaDoServidor(filtros) {
  if (notaAberta) {
    const f = fonteAberta(null);
    return f ? avisoDeErro() + detalhe(f) : carregando("Entrada");
  }
  pedirLista(filtros);
  const r = servidor.lista;
  if (!r) return carregando("Entrada");
  return lista(filtros, {
    linhas: r.notas.map((n) => ({ n, s: n.status, produtos: n.produtos })),
    contagens: r.contagens,
    rodape: tela.rodape(r.total, "entrada"),
  });
}

// =====================================================================
// LISTA DE NOTAS
// =====================================================================
function notasFiltradas(db, f) {
  const nf = f.nf.trim(), forn = f.fornecedor.trim().toLowerCase();
  return db.notas
    .map((n) => ({ n, s: statusDaNota(n, db.conferencias), produtos: n.itens.length }))
    .filter(({ n }) => !nf || n.numero.includes(nf))
    .filter(({ n }) => !forn || n.fornecedor.nome.toLowerCase().includes(forn) || String(n.fornecedor.codigo) === forn)
    .filter(({ n }) => (!f.de || n.data >= f.de) && (!f.ate || n.data <= f.ate))
    .filter(({ s }) => !f.conferencia || s.conferencia === f.conferencia)
    .filter(({ s }) => !f.divergencia || s.divergencia === f.divergencia)
    .filter(({ s }) => !f.armazenamento || s.armazenamento === f.armazenamento)
    // as mais recentes primeiro
    .sort((a, b) => b.n.data.localeCompare(a.n.data) || b.n.id - a.n.id);
}
function listaDaDemo(db, f) {
  const { itens, rodape } = tela.paginar(notasFiltradas(db, f), "entrada");
  const todos = db.notas.map((n) => statusDaNota(n, db.conferencias));
  const conta = (fn) => todos.filter(fn).length;
  const contagens = {
    total: todos.length, aguardando: conta((s) => s.conferencia === "aguardando"), aberta: conta((s) => s.conferencia === "aberta"),
    conferida: conta((s) => s.conferencia === "conferida"), com: conta((s) => s.divergencia === "com"),
    parcial: conta((s) => s.armazenamento === "parcial"), armazenado: conta((s) => s.armazenamento === "armazenado"),
  };
  return lista(f, { linhas: itens, contagens, rodape });
}

// linhas = [{ n: nota, s: status, produtos }] da página · contagens = os indicadores do topo (todas as notas)
function lista(f, { linhas, contagens: c, rodape }) {
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
  ${avisoDeErro()}
  <div class="gx-kpis ge-kpis">
    ${kpi("Total", c.total, {})}
    ${kpi("Aguardando", c.aguardando, { conferencia: "aguardando" })}
    ${kpi("Em aberto", c.aberta, { conferencia: "aberta" })}
    ${kpi("Conferidas", c.conferida, { conferencia: "conferida" })}
    ${kpi("Com divergência", c.com, { divergencia: "com" })}
    ${kpi("Armazenamento parcial", c.parcial, { armazenamento: "parcial" })}
    ${kpi("Armazenadas", c.armazenado, { armazenamento: "armazenado" })}
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
      <tbody>${linhas.map(({ n, s, produtos }) => {
        const p = pilulasDoStatus(s);
        return `<tr data-nota="${n.id}">
          <td><b class="ge-nf">${esc(n.numero)}</b></td><td>${esc(n.fornecedor.nome)} <small class="ge-cod">${n.fornecedor.codigo ?? ""}</small></td>
          <td>${dataBr(n.data)}</td><td>${esc(n.tipo)}</td><td class="r">${produtos}</td>
          <td>${p.conferencia}</td><td>${p.divergencia}</td><td>${p.armazenamento}</td></tr>`;
      }).join("") || `<tr><td colspan="8" class="ge-vazio">Nenhuma nota com esses filtros.</td></tr>`}</tbody>
    </table>
    ${rodape}
  </div>`;
}

// =====================================================================
// DETALHE DA NOTA (tela própria)
// =====================================================================
function detalhe(fonte) {
  const { nota } = fonte;
  const p = pilulasDoStatus(statusDaNota(nota, fonte.conferencias));
  const itens = resumoDaNota(nota, fonte.conferencias);
  return `
  <div class="ge-head">
    <div>
      <button class="ge-voltar" data-voltarlista><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg> Entrada</button>
      <h1>${esc(rotuloDaNota(nota))}</h1>
      <p class="ge-sub">${esc(nota.fornecedor.nome)}${nota.fornecedor.codigo != null ? ` · fornecedor ${nota.fornecedor.codigo}` : ""} · ${dataBr(nota.data)} · ${esc(nota.tipo)}</p>
    </div>
    <div class="ge-nota-st">
      <div><small>Conferência</small>${p.conferencia}</div>
      <div><small>Divergência</small>${p.divergencia}</div>
      <div><small>Armazenamento</small>${p.armazenamento}</div>
    </div>
  </div>
  ${(nota.avisos || []).map((a) => `<p class="ge-msg">${esc(a)}</p>`).join("")}
  ${fonte.recusas.map((r) => `<p class="ge-msg">${r.tipo === "recepcao.finalizar" ? "Finalização" : r.tipo === "recepcao.enderecarVolume" ? `Volume ${esc(r.volume || "")}` : "Conferência"} recusada pelo servidor · ${esc(r.quem)} · ${dataHora(r.quando)}${r.produto ? ` · ${esc(r.produto)} +${num(r.qtd)}` : ""}: ${esc(r.motivo)}</p>`).join("")}
  <div class="ge-card">
    <table class="ge-tab">
      <thead><tr><th>Código</th><th>Descrição</th><th>Un</th><th class="r">Nota</th><th class="r">Conferido</th><th class="r">Divergência</th><th class="r">Armazenado</th><th class="r">Volumes</th><th></th></tr></thead>
      <tbody>${itens.map((i) => {
        const prod = fonte.produto(i.produto);
        return `<tr>
          <td class="mono">${esc(i.produto)}</td><td>${esc(prod.descricao)}${fonte.novo(i.produto) ? ` <span class="ge-st b" title="Cadastrado por esta nota">Produto novo</span>` : ""}</td><td>${esc(prod.un)}</td>
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
    Cancelar pendente tira o produto da lista de armazenamento; o saldo continua na doca.</p>
  ${htmlDosVolumesDaNota(fonte)}`;
}

// v80: os volumes (palete ou caixa) da conferência por volume, com os produtos de cada um e a reimpressão
function htmlDosVolumesDaNota(fonte) {
  if (!fonte.volumesEntrada.length) return "";
  return `<h2 class="ge-vol-h">Volumes (palete ou caixa) · ${fonte.volumesEntrada.length}</h2>
  <div class="ge-card">
    <table class="ge-tab">
      <thead><tr><th>Volume</th><th>Tipo</th><th>Doca</th><th>Dia</th>${fonte.comServidor ? "<th>Conferiu</th>" : ""}<th>Produtos</th><th></th></tr></thead>
      <tbody>${fonte.volumesEntrada.map((v) => `<tr>
        <td class="mono">${esc(v.codigo)}</td><td>${esc(TIPOS_DE_VOLUME[v.tipo] || v.tipo)}</td>
        <td><span class="gaddr">${fonte.doca(v.docaId) || "—"}</span></td><td>${dataBr(v.dia)}</td>
        ${fonte.comServidor ? `<td>${esc(v.usuario || "—")}</td>` : ""}
        <td>${v.itens.map((i) => `<span class="mono">${esc(i.produto)}</span> × ${num(i.qtd)}`).join(" · ")}</td>
        <td class="r"><button class="ge-link" data-reimprimirvol="${esc(v.codigo)}">Reimprimir etiqueta</button></td>
      </tr>`).join("")}</tbody>
    </table>
  </div>`;
}

// clique na área da aba Entrada; devolve true quando tratou
export function cliqueEntrada(t, db) {
  if (t.dataset.nota) {
    notaAberta = +t.dataset.nota;
    if (servidor) { servidor.detalhe = null; carregarDetalhe(notaAberta); }
    tela.render(); scrollTo(0, 0); return true;
  }
  if (t.dataset.voltarlista !== undefined) { notaAberta = null; if (servidor) servidor.pedida = ""; tela.render(); return true; }
  if (t.id === "btNotasErp") { buscarNotasDoErp(); return true; }
  const fonte = fonteAberta(db);
  if (!fonte) return false;
  if (t.dataset.conferido) { modalConferido(fonte, t.dataset.conferido); return true; }
  if (t.dataset.volumes) { modalVolumes(fonte, t.dataset.volumes); return true; }
  if (t.dataset.reimprimirvol) {
    const v = fonte.volumesEntrada.find((x) => x.codigo === t.dataset.reimprimirvol);
    if (!v) return true;
    document.querySelector("#printArea").innerHTML = etiquetaVolumeDaNotaHtml(v, fonte.nota, TIPOS_DE_VOLUME[v.tipo] || v.tipo);
    window.print();
    return true;
  }
  // sem confirmação (definido no documento); o saldo fica na doca para ser transferido depois
  if (t.dataset.cancelar) { cancelar(fonte.nota.id, t.dataset.cancelar); return true; }
  return false;
}

async function cancelar(notaId, produto) {
  if (!servidor) {
    cancelarPendente(notaId, produto); tela.render();
    return tela.toast("Pendente cancelado · o saldo continua na doca");
  }
  const r = await cancelarPendenteNoServidor(servidor.sess, notaId, produto);
  if (!r.ok) return tela.toast(r.erro);
  tela.toast("Pendente cancelado · o saldo continua na doca");
  carregarDetalhe(notaId);
}

async function buscarNotasDoErp() {
  let r;
  if (servidor) {
    r = await importarNotasNoServidor(servidor.sess);
    if (!r.ok) return tela.toast(r.erro);
    servidor.pedida = "";
  } else r = importarNotasDoErp();
  tela.render();
  tela.abrirModal(`<h2>Notas do ERP</h2>
    ${servidor ? `<p class="ge-sub">Simulação: até o Sankhya ser ligado, a busca traz notas de exemplo.</p>` : ""}
    <p>${r.importadas.length ? `<b>${r.importadas.length}</b> nota(s) importada(s):` : "Nenhuma nota nova."}</p>
    ${r.importadas.map((n) => `<p class="ge-imp ok">NF ${esc(n.numero)} · ${esc(n.fornecedor.nome)} · ${n.itens.length} produto(s)${n.produtosNovos?.length
      ? ` · <b>${n.produtosNovos.length} produto(s) novo(s) cadastrado(s)</b>: ${n.produtosNovos.map(esc).join(", ")}` : ""}</p>
      ${(n.avisos || []).map((a) => `<p class="ge-imp err">${esc(a)}</p>`).join("")}`).join("")}
    ${r.bloqueadas.map((b) => `<p class="ge-imp err">NF ${esc(b.nota.numero)} · ${esc(b.nota.fornecedor.nome)} · <b>${esc(b.msg)}</b></p>`).join("")}
    <div class="m-act"><button class="btn primary" data-fechar>Fechar</button></div>`);
}

// Conferido: nota × conferido × divergência, com cada confirmação feita no coletor
function modalConferido(fonte, produto) {
  const { nota } = fonte;
  const i = resumoDoItem(nota, nota.itens.find((x) => x.produto === produto), fonte.conferencias);
  const confs = fonte.conferencias.filter((c) => c.notaId === nota.id && c.produto === produto);
  tela.abrirModal(`<h2>${esc(produto)} · conferido</h2>
    <div class="ge-tres"><div><small>Nota</small><b>${num(i.qtdNota)}</b></div><div><small>Conferido</small><b>${num(i.conferido)}</b></div>
      <div><small>Divergência</small><b>${divergenciaHtml(nota, i.divergencia)}</b></div></div>
    <table class="ge-tab ge-mini-tab"><thead><tr><th>Dia</th><th>Doca</th>${fonte.comServidor ? "<th>Conferiu</th>" : ""}<th class="r">Qtd</th><th class="r">Volumes</th></tr></thead>
      <tbody>${confs.map((c) => `<tr><td>${dataBr(c.dia)}</td><td><span class="gaddr">${fonte.doca(c.docaId) || "—"}</span></td>${fonte.comServidor ? `<td>${esc(c.usuario || "—")}</td>` : ""}<td class="r">${num(c.qtd)}</td><td class="r">${c.volumes.length}</td></tr>`).join("")}</tbody></table>
    <div class="m-act"><button class="btn primary" data-fechar>Fechar</button></div>`);
  // com servidor a tabela tem a coluna "Conferiu": o modal largo (volta ao normal sozinho ao fechar)
  if (fonte.comServidor) document.querySelector("#modal").classList.add("wide");
}

// Volumes: só os códigos e o botão de reimprimir (a reimpressão é só pelo WEB)
function modalVolumes(fonte, produto) {
  const vols = fonte.volumes(produto);
  tela.abrirModal(`<h2>${esc(produto)} · volumes</h2>
    <div class="ge-vols">${vols.map((v) => `<span class="gaddr">${v.codigo} <small>${v.seq}/${v.total}</small></span>`).join("")}</div>
    <div class="m-act"><button class="btn ghost" data-fechar>Fechar</button><button class="btn primary" data-reimprimir="${esc(produto)}">Reimprimir ${vols.length} etiqueta(s)</button></div>`);
}

// clique dentro do modal (reimprimir); devolve true quando tratou
export function cliqueModalEntrada(t, db) {
  const fonte = fonteAberta(db);
  if (!t.dataset.reimprimir || !fonte) return false;
  const produto = fonte.produto(t.dataset.reimprimir);
  document.querySelector("#printArea").innerHTML = fonte.volumes(produto.codigo).map((v) => etiquetaVolumeHtml(v, fonte.nota, produto)).join("");
  tela.fecharModal();
  window.print();
  return true;
}
