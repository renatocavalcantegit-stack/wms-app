// WMS Beach Bike — Gestão (WEB), quadro da SEPARAÇÃO de verdade, com o servidor (Fase 1e).
// Só liga quando o app é aberto pelo servidor (modo.json diz servidor: true) e o coordenador entrou com o servidor.
// No GitHub Pages (demonstração), a aba Separação continua a simulação de sempre (gestao.js).
//
// É o mesmo quadro da demonstração (caixa de entrada + uma coluna por separador), agora com os pedidos do banco:
//   - arrastar da caixa para um separador, de um separador para outro, de volta para a caixa, ou mudar a ordem;
//   - pedido sem rota: o coordenador escolhe a rota antes de mandar para um separador;
//   - marcar pedidos da caixa e agrupar em lote; desfazer o lote antes de começar;
//   - o andamento de quem está separando, e "Sem contato" quando o coletor não dá sinal há 90 s.
// As travas valem no servidor (server/src/consultas/quadro.js). As decisões de tela (colunas, ordem, situação)
// estão em compartilhado/regras/fila-do-separador.js. Os dados vêm de js/dados/quadro.js.
// Ainda NÃO estão aqui (seguem só na demonstração): dividir pedido, sugerir lotes e a distribuição inteligente.
import { esc as escapar } from "./js/util.js";
import { temServidor } from "./js/sessao.js";
import { buscarQuadro, moverNoQuadro, definirRota, criarLote, desfazerLote, buscarPedido, ouvirQuadro } from "./js/dados/quadro.js";
import { unidadesDoQuadro, colunasDoQuadro, situacaoNoQuadro } from "./compartilhado/regras/fila-do-separador.js";
import { precisaDeRota, AGUARDANDO } from "./compartilhado/regras/aguardando.js";
import { ROTAS, rota as rotaPeloId } from "./compartilhado/regras/rotas.js";
import { MAX_PEDIDOS_LOTE } from "./compartilhado/regras/separacao.js";

const esc = (s) => escapar(s ?? "");
const RESERVA_MS = 60_000;   // relê o quadro mesmo sem aviso (se um aviso se perder)
const RELOGIO_MS = 15_000;   // redesenha para "Sem contato" aparecer sozinho
const CHECK = '<svg viewBox="0 0 24 24"><path d="M5 12l5 5 9-10"/></svg>';
const AV = ["#E10600", "#0E0E10", "#2563EB", "#EA580C", "#16A34A", "#7C3AED", "#0891B2", "#A16207", "#DB2777", "#475569"];
const SITUACAO = {
  separando: ["work", "Separando"],
  aguardando: ["wait", "Aguardando início"],
  livre: ["", "Livre"],
  "sem-contato": ["gq-off", "Sem contato"],
  desconectado: ["away", "Não conectado"],
};

// quadro = o que veio do servidor · diferenca = relógio do servidor − relógio deste computador
const estado = { quadro: null, diferenca: 0, erro: "", filtro: "todos", marcados: new Set() };
let ctx = null; // { sess, setor, container, ativa, toast, aoMudar }
let arrastando = null, redesenharDepois = false;

const agora = () => Date.now() + estado.diferenca;
const doServidor = (iso) => Date.parse(iso) - estado.diferenca; // hora do servidor no relógio deste computador
const iniciais = (n) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0].toUpperCase()).join("");
const MONT = () => ctx.setor === "mont";
const semRota = (p) => !MONT() && precisaDeRota(p);
const haQuanto = (ms) => { const m = Math.floor(Math.max(0, ms) / 60_000); return m < 1 ? "agora" : m < 60 ? `há ${m} min` : `há ${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`; };

// Liga o quadro real. Devolve true se há servidor (o quadro da aba Separação passa a ser este).
export async function ligarQuadroReal({ sess, setor, container, ativa, toast, aoMudar = () => {} }) {
  if (!sess?.token || !(await temServidor())) return false;
  ctx = { sess, setor, container, ativa, toast, aoMudar };
  await recarregar();
  let espera = null;
  ouvirQuadro(sess, (evento) => {
    if (evento === "dispositivos") return; // a tela de Dispositivos cuida desse
    clearTimeout(espera); espera = setTimeout(recarregar, 300);
  });
  setInterval(recarregar, RESERVA_MS);
  setInterval(() => ctx.ativa() && desenhar(), RELOGIO_MS);
  ligarEventos();
  return true;
}

async function recarregar() {
  const r = await buscarQuadro(ctx.sess, ctx.setor);
  if (r.ok) {
    estado.quadro = { agora: r.agora, pedidos: r.pedidos, separadores: r.separadores };
    estado.diferenca = Date.parse(r.agora) - Date.now();
    estado.erro = "";
    // marcado que saiu da caixa (outro coordenador mexeu) sai da seleção
    const naCaixa = new Set(r.pedidos.filter((p) => !p.designado_para && !p.lote).map((p) => p.id));
    [...estado.marcados].forEach((id) => { if (!naCaixa.has(id)) estado.marcados.delete(id); });
  } else estado.erro = r.erro;
  desenhar();
}

function colunas() {
  const q = estado.quadro;
  return colunasDoQuadro(unidadesDoQuadro(q ? q.pedidos : []), ctx.setor);
}

// ---------- o que a Gestão pergunta ----------
export function resumoDoQuadroReal() {
  const q = estado.quadro;
  if (!q) return { caixa: 0, semRota: 0, separando: 0, naFila: 0, hoje: 0 };
  const { caixa } = colunas();
  return {
    caixa: caixa.length,
    semRota: caixa.filter((u) => u.pedidos.some(semRota)).length,
    separando: q.pedidos.filter((p) => p.status === "andamento").length,
    naFila: q.pedidos.filter((p) => p.designado_para && p.status === "pendente").length,
    hoje: q.separadores.reduce((t, s) => t + s.separados_hoje, 0),
  };
}
// texto da busca do topo (o card some quando não tem o que foi digitado)
export function textoDaBusca(id) {
  const ps = (estado.quadro?.pedidos || []).filter((p) => p.id === id || p.lote === id);
  return ps.map((p) => `${p.id} ${p.lote || ""} ${p.cliente} ${p.cidade} ${p.aguardando ? "aguardando" : rotaPeloId(p.rota)?.nome || "sem rota"} ${p.separador_nome || ""}`).join(" ");
}

// ---------- desenho ----------
const pedidoDe = (id) => estado.quadro.pedidos.find((p) => p.id === id);
const corDe = (p) => (p.aguardando ? AGUARDANDO.cor : rotaPeloId(p.rota)?.cor || null);
const destinoTag = (p) => {
  if (MONT()) return `<span class="rt op">MONTAGEM</span>`;
  if (p.aguardando) return `<span class="rt aguard" style="--rc:${AGUARDANDO.cor}"><i></i>AGUARDANDO</span>`;
  const r = rotaPeloId(p.rota);
  return r ? `<span class="rt" style="--rc:${r.cor}"><i></i>${esc(r.nome)}</span>` : `<span class="rt none">SEM ROTA</span>`;
};
const numero = (n) => Number(n).toLocaleString("pt-BR");

function card(u, { col, pos = "", primeiro = false }) {
  const p = u.pedidos[0], vivo = u.andamento;
  const itens = u.pedidos.reduce((t, x) => t + x.itens, 0), feitos = u.pedidos.reduce((t, x) => t + x.itens_feitos, 0);
  const un = u.pedidos.reduce((t, x) => t + x.unidades, 0), unFeitas = u.pedidos.reduce((t, x) => t + x.unidades_feitas, 0);
  const marcavel = col === "inbox" && !u.ehLote && !p.pedido_pai && p.status === "pendente";
  const marcado = marcavel && estado.marcados.has(p.id);
  const cls = ["card", u.ehLote && "lote", u.pedidos.some(semRota) && "no-route", MONT() && "op", vivo && "live", primeiro && !vivo && col !== "inbox" && "waiting", marcado && "sel"].filter(Boolean).join(" ");
  const destinos = [...new Map(u.pedidos.map((x) => [x.aguardando ? "ag" : x.rota, x])).values()].map(destinoTag).join("");
  const topo = `${marcavel ? `<span class="cb" data-gqsel="${esc(p.id)}" title="Marcar para agrupar em lote">${marcado ? CHECK : ""}</span>` : ""}${destinos}`
    + (u.ehLote ? `<span class="c-lote">LOTE</span>` : "") + (p.pedido_pai ? `<span class="c-parte">PARTE ${p.parte_numero}/${p.partes_total}</span>` : "")
    + (MONT() && p.prioridade === "alta" ? `<span class="c-prio">PRIORIDADE</span>` : "") + (pos ? `<span class="c-pos">${pos}</span>` : "");
  const titulo = u.ehLote ? `${esc(u.id)} · ${u.pedidos.length} pedidos` : esc(p.pedido_pai ? `${p.pedido_pai} · ${p.parte_numero}/${p.partes_total}` : p.id);
  const corpo = u.ehLote
    ? `<div class="c-peds">${u.pedidos.map((x) => `<span><b class="lpos">${esc(x.posicao_lote)}</b>${esc(x.id)}</span>`).join("")}</div>`
    : `<p class="c-cli">${esc(p.cliente)}</p><p class="c-vend">${esc(p.cidade)}</p>`;
  let vivoHtml = "";
  if (vivo) {
    const pc = itens ? Math.round((100 * feitos) / itens) : 0;
    const atual = u.pedidos.find((x) => x.status === "andamento" && x.item_atual)?.item_atual;
    const inicio = Math.min(...u.pedidos.filter((x) => x.inicio).map((x) => doServidor(x.inicio)));
    vivoHtml = `<div class="c-live">
      <div class="cl-row"><span class="cl-tag"><i></i>${u.ehLote ? "Separando o lote" : "Separando agora"}</span><span class="timer" data-since="${inicio}">00:00</span></div>
      <div class="cl-bar"><i style="width:${pc}%"></i></div>
      <div class="cl-row small"><b>${pc}%</b><span>${feitos}/${itens} itens · ${numero(unFeitas)}/${numero(un)} un.</span></div>
      ${atual ? `<p class="cl-cur"><span class="gaddr">${esc(atual.endereco)}</span>${esc(atual.descricao)}</p>` : ""}
    </div>`;
  } else if (primeiro && col !== "inbox") {
    vivoHtml = `<div class="c-live"><div class="cl-row"><span class="cl-tag"><i></i>Aguardando início</span></div></div>`;
  }
  const idade = col === "inbox" ? `<span class="c-age">${haQuanto(agora() - u.chegada)}</span>` : "";
  return `<article class="${cls}" draggable="${!vivo}" data-id="${esc(u.id)}" style="--rc:${MONT() ? "var(--ink)" : corDe(p) || "var(--red-brand)"}">
    <div class="c-top">${topo}</div>
    <div class="c-main"><p class="c-id">${titulo}</p></div>
    ${corpo}
    <div class="c-nums"><span><b>${itens}</b> SKUs</span><span><b>${numero(un)}</b> un.</span>${idade}</div>
    ${vivoHtml}
  </article>`;
}

function colunaDaCaixa(caixa) {
  const conta = (fn) => caixa.filter(fn).length;
  const ehSemRota = (u) => u.pedidos.some(semRota), ehAg = (u) => u.pedidos.every((p) => p.aguardando);
  if (estado.filtro === "semrota" && !conta(ehSemRota)) estado.filtro = "todos";
  if (estado.filtro === "aguardando" && !conta(ehAg)) estado.filtro = "todos";
  const lista = estado.filtro === "semrota" ? caixa.filter(ehSemRota) : estado.filtro === "aguardando" ? caixa.filter(ehAg) : caixa;
  const chip = (id, rotulo, n, extra = "", estilo = "") =>
    `<button class="gchip ${extra} ${estado.filtro === id ? "active" : ""}" data-gqfiltro="${id}" ${estilo}>${rotulo} <b>${n}</b></button>`;
  const chips = chip("todos", "Todos", caixa.length)
    + (MONT() ? "" : chip("semrota", "Sem rota", conta(ehSemRota), "red")
      + (conta(ehAg) ? chip("aguardando", `<i></i>${AGUARDANDO.nome}`, conta(ehAg), "", `style="--rc:${AGUARDANDO.cor}"`) : ""));
  const marcados = [...estado.marcados].map(pedidoDe).filter(Boolean);
  const barra = marcados.length
    ? `<div class="lib-bar"><p><span>${marcados.length} marcado(s) · ${numero(marcados.reduce((t, p) => t + p.unidades, 0))} un.</span><button class="x" data-gqlimpar="1">Limpar</button></p><div><button data-gqagrupar="1">Agrupar em lote</button></div></div>`
    : "";
  return `<section class="col inbox">
    <header class="col-head">
      <div class="ch-row"><h3>Caixa de entrada</h3><span class="count">${caixa.length}</span></div>
      <p class="ch-sub">${MONT() ? "Pedidos de montagem aguardando separador" : "Pedidos recebidos aguardando separador"}</p>
      <div class="gchips">${chips}</div>
      ${barra}
    </header>
    <div class="gx-list" data-col="inbox">${lista.map((u) => card(u, { col: "inbox" })).join("") || `<div class="col-empty">Nada por aqui 🎉</div>`}</div>
  </section>`;
}

function colunaDoSeparador(sep, fila, n) {
  const sit = situacaoNoQuadro(sep, fila, agora());
  const [cls, rotulo] = SITUACAO[sit];
  const contato = sit === "sem-contato" && sep.ultimo_contato ? ` ${haQuanto(agora() - Date.parse(sep.ultimo_contato))}` : "";
  const pendentes = fila.reduce((t, u) => t + u.pedidos.reduce((s, p) => s + p.unidades - p.unidades_feitas, 0), 0);
  const vivo = fila[0]?.andamento;
  const cards = fila.map((u, i) => card(u, { col: sep.login, primeiro: i === 0, pos: vivo && i === 0 ? "" : `${vivo ? i : i + 1}º` })).join("");
  return `<section class="col ${sit === "desconectado" ? "away" : ""}">
    <header class="col-head">
      <div class="person">
        <span class="avatar" style="--av:${AV[n % AV.length]}">${esc(iniciais(sep.nome))}</span>
        <div class="person-n"><div class="ch-row"><h3>${esc(sep.nome)}</h3></div><span class="st ${cls}"><i></i>${rotulo}${contato}</span></div>
      </div>
      <div class="metrics">
        <div><b>${fila.reduce((t, u) => t + u.pedidos.length, 0)}</b><small>pedidos</small></div>
        <div><b>${numero(pendentes)}</b><small>un. pendentes</small></div>
        <div><b>${sep.separados_hoje}</b><small>hoje</small></div>
      </div>
    </header>
    <div class="gx-list" data-col="${esc(sep.login)}">${cards || `<div class="col-empty">Arraste pedidos para cá</div>`}</div>
  </section>`;
}

// desenha o quadro no lugar do quadro da simulação (só com a aba Separação aberta)
export function desenhar() {
  if (!ctx) return;
  if (!ctx.ativa()) return ctx.aoMudar(); // só o número da aba
  if (arrastando) { redesenharDepois = true; return; }
  desenharNoQuadro();
  ctx.aoMudar();
}
function desenharNoQuadro() {
  const b = ctx.container;
  if (!estado.quadro) {
    b.innerHTML = `<div class="gq-aviso ${estado.erro ? "erro" : ""}">${esc(estado.erro || "Carregando o quadro do servidor…")}</div>`;
    return;
  }
  const rolagem = {};
  b.querySelectorAll(".gx-list").forEach((l) => (rolagem[l.dataset.col] = l.scrollTop));
  const bx = b.scrollLeft;
  const { caixa, filas } = colunas();
  b.classList.remove("list");
  b.innerHTML = (estado.erro ? `<div class="gq-aviso erro">${esc(estado.erro)}</div>` : "")
    + colunaDaCaixa(caixa) + estado.quadro.separadores.map((s, n) => colunaDoSeparador(s, filas.get(s.login) || [], n)).join("");
  b.querySelectorAll(".gx-list").forEach((l) => { if (rolagem[l.dataset.col]) l.scrollTop = rolagem[l.dataset.col]; });
  b.scrollLeft = bx;
}

// ---------- mudar de fila ----------
// muda na tela na hora (o coordenador não espera a rede) e confirma no servidor; se a trava recusar, volta como estava
async function mover(unidade, para, ordem) {
  const q = estado.quadro, antes = structuredClone(q.pedidos);
  const dela = (p) => p.id === unidade || p.lote === unidade;
  for (const p of q.pedidos) if (dela(p)) { p.designado_para = para; p.ordem_fila = para ? ordem.indexOf(unidade) + 1 : null; }
  if (para) for (const p of q.pedidos) if (p.designado_para === para && !dela(p)) { const i = ordem.indexOf(p.lote || p.id); if (i >= 0) p.ordem_fila = i + 1; }
  estado.marcados.delete(unidade);
  desenhar();
  const r = await moverNoQuadro(ctx.sess, ctx.setor, unidade, para, ordem);
  if (!r.ok) { q.pedidos = antes; ctx.toast(r.erro); desenhar(); }
  else {
    const nome = para ? q.separadores.find((s) => s.login === para)?.nome : null;
    ctx.toast(`${unidade} → ${nome || "caixa de entrada"}`);
  }
  recarregar();
}

// pedido sem rota solto num separador: primeiro a rota (fica salva no pedido), depois a fila
function pedirRota(pedidos, depois) {
  const p = pedidos.find(semRota);
  abrirJanela(`<h2>Defina a rota de ${esc(p.id)}</h2>
    <p><b>${esc(p.cliente)}</b> (${esc(p.cidade)}) chegou sem rota. Escolha a rota para liberar a separação.</p>
    <label class="field"><span>Rota</span><select id="gqRota"><option value="">Selecione…</option>${ROTAS.map((r) => `<option value="${r.id}">${esc(r.nome)}</option>`).join("")}</select></label>
    <div class="m-act"><button class="btn ghost" data-close>Cancelar</button><button class="btn primary" id="gqRotaOk">Salvar e continuar</button></div>`);
  document.querySelector("#gqRotaOk").onclick = async () => {
    const rota = document.querySelector("#gqRota").value;
    if (!rota) return ctx.toast("Escolha uma rota");
    const r = await definirRota(ctx.sess, ctx.setor, p.id, rota);
    if (!r.ok) return ctx.toast(r.erro);
    p.rota = rota; fecharJanela();
    if (pedidos.some(semRota)) return pedirRota(pedidos, depois);
    depois && depois();
  };
}

// ---------- janela (o mesmo #modal da Gestão) ----------
function abrirJanela(html) {
  const m = document.querySelector("#modal");
  m.innerHTML = html; m.hidden = false; document.querySelector("#mScrim").hidden = false;
}
function fecharJanela() { document.querySelector("#modal").hidden = true; document.querySelector("#mScrim").hidden = true; }

// detalhe do pedido (ou do lote): itens, rota e as ações que o coordenador pode fazer
async function abrirDetalhe(unidade) {
  const u = unidadesDoQuadro(estado.quadro.pedidos).find((x) => x.id === unidade);
  if (!u) return;
  const comItens = await Promise.all(u.pedidos.map(async (p) => ({ ...p, detalhe: (await buscarPedido(ctx.sess, p.id)) })));
  const sep = u.para ? estado.quadro.separadores.find((s) => s.login === u.para) : null;
  const pendente = !u.andamento;
  const linhas = (p) => (p.detalhe.ok ? p.detalhe.itens : []).map((i) =>
    `<li><span class="gaddr">${esc(i.endereco_codigo)}</span>${esc(i.descricao)} · <b>${numero(i.qtd)} ${esc(i.un)}</b>${i.status === "ok" ? " ✓" : i.status === "falta" ? ` · falta (${esc(i.motivo)})` : ""}</li>`).join("");
  const blocos = comItens.map((p) => `<h3 class="gq-sub">${u.ehLote ? `<b class="lpos">${esc(p.posicao_lote)}</b> ` : ""}${esc(p.id)} · ${esc(p.cliente)}</h3>
    <p class="gq-meta">${destinoTag(p)} ${esc(p.cidade)}${p.separador_nome ? ` · com ${esc(p.separador_nome)}` : ""}</p>
    ${!MONT() && !p.aguardando && pendente && !u.ehLote ? `<label class="field"><span>Rota</span><select data-gqrota="${esc(p.id)}"><option value="">Sem rota</option>${ROTAS.map((r) => `<option value="${r.id}" ${r.id === p.rota ? "selected" : ""}>${esc(r.nome)}</option>`).join("")}</select></label>` : ""}
    <ol class="gq-itens">${linhas(p)}</ol>`).join("");
  const acoes = [
    u.para && pendente ? `<button class="btn ghost" data-gqcaixa="${esc(u.id)}">Devolver para a caixa</button>` : "",
    u.ehLote && pendente ? `<button class="btn ghost" data-gqdesfazer="${esc(u.id)}">Desfazer lote</button>` : "",
    `<button class="btn primary" data-close>Fechar</button>`,
  ].join("");
  abrirJanela(`<h2>${u.ehLote ? `Lote ${esc(u.id)} · ${u.pedidos.length} pedidos` : esc(u.id)}</h2>
    <p>${u.andamento ? `Em separação com ${esc(sep?.nome || "")}` : sep ? `Na fila de ${esc(sep.nome)}` : "Na caixa de entrada"}</p>
    ${blocos}
    <div class="m-act">${acoes}</div>`);
  document.querySelector("#modal").classList.add("wide");
}

// ---------- eventos ----------
const BORDA = 90, VEL_MAX = 24;
const velocidade = (d) => (d < BORDA ? Math.ceil(Math.min(1, (BORDA - Math.max(0, d)) / BORDA) * VEL_MAX) : 0);

function ligarEventos() {
  const b = ctx.container, ph = document.createElement("div");
  ph.className = "ph";
  const ativo = () => ctx.ativa() && estado.quadro;
  let ponteiro = null;

  b.addEventListener("dragstart", (e) => {
    if (!ativo()) return;
    const c = e.target.closest(".card");
    if (!c || c.getAttribute("draggable") !== "true") { e.preventDefault(); return; }
    arrastando = c.dataset.id;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", arrastando);
    ph.style.height = c.offsetHeight + "px";
    setTimeout(() => c.classList.add("dragging"), 0);
    requestAnimationFrame(rolar);
  });
  b.addEventListener("dragover", (e) => {
    if (!ativo() || !arrastando) return;
    const lista = e.target.closest(".gx-list");
    if (!lista) return;
    e.preventDefault();
    const cards = [...lista.querySelectorAll(".card:not(.dragging)")];
    let antes = cards.find((c) => { const r = c.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; }) || null;
    // não passa à frente do que está em separação
    while (antes && antes.classList.contains("live")) antes = cards[cards.indexOf(antes) + 1] || null;
    if (antes) lista.insertBefore(ph, antes); else lista.appendChild(ph);
    b.querySelectorAll(".gx-list.over").forEach((l) => l !== lista && l.classList.remove("over"));
    lista.classList.add("over");
  });
  b.addEventListener("drop", (e) => {
    if (!ativo() || !arrastando) return;
    const lista = e.target.closest(".gx-list");
    if (!lista) return;
    e.preventDefault();
    const unidade = arrastando, col = lista.dataset.col;
    const ordem = [...lista.children].filter((x) => x === ph || (x.classList.contains("card") && !x.classList.contains("dragging") && !x.classList.contains("live")))
      .map((x) => (x === ph ? unidade : x.dataset.id));
    fim();
    const para = col === "inbox" ? null : col;
    const u = unidadesDoQuadro(estado.quadro.pedidos).find((x) => x.id === unidade);
    if (!u || (u.para || null) === para && col === "inbox") return desenhar(); // na caixa a ordem é automática
    if (para && u.pedidos.some(semRota)) return pedirRota(u.pedidos, () => mover(unidade, para, ordem));
    mover(unidade, para, ordem);
  });
  b.addEventListener("dragend", () => arrastando && fim());
  document.addEventListener("dragover", (e) => { if (arrastando) ponteiro = { x: e.clientX, y: e.clientY, alvo: e.target }; });
  function rolar() {
    if (!arrastando) { ponteiro = null; return; }
    if (ponteiro) {
      const r = b.getBoundingClientRect();
      b.scrollLeft += velocidade(r.right - ponteiro.x) - velocidade(ponteiro.x - r.left);
      const l = ponteiro.alvo?.closest?.(".gx-list");
      if (l) { const lr = l.getBoundingClientRect(); l.scrollTop += velocidade(lr.bottom - ponteiro.y) - velocidade(ponteiro.y - lr.top); }
    }
    requestAnimationFrame(rolar);
  }
  function fim() {
    ph.remove();
    b.querySelectorAll(".dragging").forEach((x) => x.classList.remove("dragging"));
    b.querySelectorAll(".gx-list.over").forEach((l) => l.classList.remove("over"));
    arrastando = null;
    if (redesenharDepois) { redesenharDepois = false; desenhar(); }
  }

  b.addEventListener("click", async (e) => {
    if (!ativo()) return;
    const f = e.target.closest("[data-gqfiltro]");
    if (f) { estado.filtro = f.dataset.gqfiltro; return desenhar(); }
    const cb = e.target.closest("[data-gqsel]");
    if (cb) {
      e.stopPropagation();
      const id = cb.dataset.gqsel;
      if (!estado.marcados.has(id) && estado.marcados.size >= MAX_PEDIDOS_LOTE) return ctx.toast(`O lote aceita no máximo ${MAX_PEDIDOS_LOTE} pedidos.`);
      estado.marcados.has(id) ? estado.marcados.delete(id) : estado.marcados.add(id);
      return desenhar();
    }
    if (e.target.closest("[data-gqlimpar]")) { estado.marcados.clear(); return desenhar(); }
    if (e.target.closest("[data-gqagrupar]")) {
      const r = await criarLote(ctx.sess, ctx.setor, [...estado.marcados]);
      if (!r.ok) return ctx.toast(r.erro);
      estado.marcados.clear();
      ctx.toast(`Lote ${r.id} criado · ${Object.entries(r.posicoes).sort((a, b) => a[1].localeCompare(b[1])).map(([id, pos]) => `${pos} ${id}`).join(" · ")}`);
      return recarregar();
    }
    const c = e.target.closest(".card");
    if (c) abrirDetalhe(c.dataset.id);
  });

  // ações dentro da janela de detalhe
  document.querySelector("#modal").addEventListener("click", async (e) => {
    const cx = e.target.closest("[data-gqcaixa]");
    if (cx) { fecharJanela(); return mover(cx.dataset.gqcaixa, null, []); }
    const dz = e.target.closest("[data-gqdesfazer]");
    if (dz) {
      const r = await desfazerLote(ctx.sess, ctx.setor, dz.dataset.gqdesfazer);
      if (!r.ok) return ctx.toast(r.erro);
      fecharJanela(); ctx.toast(`Lote ${dz.dataset.gqdesfazer} desfeito`);
      return recarregar();
    }
  });
  document.querySelector("#modal").addEventListener("change", async (e) => {
    const s = e.target.closest("[data-gqrota]");
    if (!s || !s.value) return;
    const r = await definirRota(ctx.sess, ctx.setor, s.dataset.gqrota, s.value);
    if (!r.ok) return ctx.toast(r.erro);
    ctx.toast(`Rota de ${s.dataset.gqrota}: ${rotaPeloId(s.value).nome}`);
    recarregar();
  });
}
