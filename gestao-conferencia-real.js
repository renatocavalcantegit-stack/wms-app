// WMS Beach Bike — Gestão (WEB), quadro da CONFERÊNCIA de verdade, com o servidor (Fase 2, v67).
// Só liga quando o app é aberto pelo servidor e o coordenador entrou com o servidor (como o da Separação).
// No GitHub Pages (demonstração), a aba Conferência continua a simulação de sempre (gestao.js).
//
// É o mesmo quadro da demonstração: "Separados" (caixa de entrada) + uma coluna por conferente.
//   - arrastar da caixa para um conferente, de um para outro, de volta para a caixa, ou mudar a ordem da fila;
//     o posto do conferente mostra a fila na mesma ordem;
//   - quem está conferindo aparece ao vivo (itens e unidades conferidos), e não muda mais de fila;
//   - na Montagem: "Pular conferência" (no card, marcando vários, ou soltando em "Entregues à montagem")
//     e a coluna "Entregues à montagem" com o que foi entregue hoje;
//   - clicar no card abre a mesma gaveta da demonstração (#drawer), com Separado e Conferido de cada item.
// As travas valem no servidor (server/src/consultas/quadro-conferencia.js), com a regra pura
// compartilhado/regras/fila-do-conferente.js. Os dados vêm de js/dados/quadro.js.
import { esc as escapar } from "./js/util.js";
import { marcaDaObservacao, secaoDaObservacao } from "./js/ui-observacao.js";
import { temObservacao } from "./compartilhado/regras/observacao.js";
import { temServidor } from "./js/sessao.js";
import { buscarQuadroDaConferencia, moverNaConferencia, pularConferencia, ouvirQuadro } from "./js/dados/quadro.js";
import { situacaoNoQuadro } from "./compartilhado/regras/fila-do-separador.js";
import { FINALIZADA } from "./compartilhado/regras/fila-do-conferente.js";
import { AGUARDANDO, ehPrioridade } from "./compartilhado/regras/aguardando.js";
import { rota as rotaPeloId } from "./compartilhado/regras/rotas.js";

const esc = (s) => escapar(s ?? "");
const RESERVA_MS = 60_000;
const RELOGIO_MS = 15_000;
const CHECK = '<svg viewBox="0 0 24 24"><path d="M5 12l5 5 9-10"/></svg>';
const AV = ["#E10600", "#0E0E10", "#2563EB", "#EA580C", "#16A34A", "#7C3AED", "#0891B2", "#A16207", "#DB2777", "#475569"];
const SITUACAO = {
  separando: ["work", "Conferindo"],
  aguardando: ["wait", "Aguardando início"],
  livre: ["", "Livre"],
  "sem-contato": ["gq-off", "Sem contato"],
  desconectado: ["away", "Não conectado"],
};

const estado = { quadro: null, diferenca: 0, erro: "", filtro: "todos", marcados: new Set() };
let ctx = null; // { sess, setor, container, ativa, toast, aoMudar }
let arrastando = null, redesenharDepois = false;

const agora = () => Date.now() + estado.diferenca;
const doServidor = (iso) => Date.parse(iso) - estado.diferenca;
const iniciais = (n) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0].toUpperCase()).join("");
const MONT = () => ctx.setor === "mont";
const haQuanto = (ms) => { const m = Math.floor(Math.max(0, ms) / 60_000); return m < 1 ? "agora" : m < 60 ? `há ${m} min` : `há ${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`; };
const numero = (n) => Number(n).toLocaleString("pt-BR");
const finalizada = (c) => FINALIZADA.includes(c.status);
const prio = (c) => ehPrioridade({ aguardando: c.aguardando, prio: c.prioridade }, ctx.setor);

export async function ligarQuadroDaConferencia({ sess, setor, container, ativa, toast, aoMudar = () => {} }) {
  if (!sess?.token || !(await temServidor())) return false;
  ctx = { sess, setor, container, ativa, toast, aoMudar };
  await recarregar();
  let espera = null;
  ouvirQuadro(sess, (evento) => {
    if (evento === "dispositivos") return;
    clearTimeout(espera); espera = setTimeout(recarregar, 300);
  });
  setInterval(recarregar, RESERVA_MS);
  setInterval(() => ctx.ativa() && desenhar(), RELOGIO_MS);
  ligarEventos();
  return true;
}

async function recarregar() {
  const r = await buscarQuadroDaConferencia(ctx.sess, ctx.setor);
  if (r.ok) {
    estado.quadro = { agora: r.agora, pedidos: r.pedidos, conferentes: r.conferentes };
    estado.diferenca = Date.parse(r.agora) - Date.now();
    estado.erro = "";
    const naCaixa = new Set(r.pedidos.filter((c) => !c.designado_para && c.status === "aguardando").map((c) => c.pedido));
    [...estado.marcados].forEach((id) => { if (!naCaixa.has(id)) estado.marcados.delete(id); });
  } else estado.erro = r.erro;
  desenhar();
  desenharGaveta();
}

// caixa ("Separados"), fila de cada conferente e, na Montagem, os entregues hoje
function colunas() {
  const ps = estado.quadro ? estado.quadro.pedidos : [];
  const abertos = ps.filter((c) => !finalizada(c));
  const caixa = abertos.filter((c) => !c.designado_para)
    .sort((a, b) => prio(b) - prio(a) || Date.parse(a.chegou_em) - Date.parse(b.chegou_em));
  const filas = Map.groupBy(abertos.filter((c) => c.designado_para), (c) => c.designado_para);
  for (const [k, l] of filas) filas.set(k, l.sort((a, b) => ((b.status === "andamento") - (a.status === "andamento"))
    || (a.ordem_fila ?? Infinity) - (b.ordem_fila ?? Infinity) || Date.parse(a.chegou_em) - Date.parse(b.chegou_em)));
  const entregues = ps.filter(finalizada).sort((a, b) => Date.parse(b.fim) - Date.parse(a.fim));
  return { caixa, filas, entregues };
}

// ---------- o que a Gestão pergunta ----------
export function resumoDaConferenciaReal() {
  const q = estado.quadro;
  if (!q) return { caixa: 0, conferindo: 0, naFila: 0, hoje: 0, entregues: 0, semConferencia: 0, aqui: 0 };
  const { caixa, entregues } = colunas();
  return {
    caixa: caixa.length,
    conferindo: q.pedidos.filter((c) => c.status === "andamento").length,
    naFila: q.pedidos.filter((c) => c.designado_para && c.status === "aguardando").length,
    hoje: q.conferentes.reduce((t, x) => t + x.conferidos_hoje, 0),
    entregues: entregues.length,
    semConferencia: entregues.filter((c) => c.status === "dispensada").length,
    aqui: q.conferentes.filter((x) => x.conectado).length,
  };
}
export function textoDaBuscaDaConferencia(id) {
  const c = (estado.quadro?.pedidos || []).find((x) => x.pedido === id);
  return c ? `${c.pedido} ${c.cliente || ""} ${c.cidade || ""} ${c.aguardando ? "aguardando" : rotaPeloId(c.rota)?.nome || ""} ${c.separador_nome || ""} ${c.conferente_nome || ""} montagem` : "";
}

// ---------- desenho ----------
const pedidoDe = (id) => estado.quadro.pedidos.find((c) => c.pedido === id);
const corDe = (c) => (c.aguardando ? AGUARDANDO.cor : rotaPeloId(c.rota)?.cor || null);
const destinoTag = (c) => {
  if (MONT()) return `<span class="rt op">MONTAGEM</span>`;
  if (c.aguardando) return `<span class="rt aguard" style="--rc:${AGUARDANDO.cor}"><i></i>AGUARDANDO</span>`;
  const r = rotaPeloId(c.rota);
  return r ? `<span class="rt" style="--rc:${r.cor}"><i></i>${esc(r.nome)}</span>` : `<span class="rt none">SEM ROTA</span>`;
};
// onde buscar a mercadoria: a doca do separador (pedido dividido: uma doca por parte; v72: a parte que ainda
// está em separação não tem doca e aparece na faixa amarela do card)
const prontas = (c) => (c.partes || []).filter((x) => x.pronta !== false);
const emSeparacao = (c) => (c.partes || []).filter((x) => x.pronta === false);
const docasHtml = (c) => (c.partes?.length
  ? prontas(c).map((x) => `<span class="dchip" title="Parte ${x.numero}/${x.de} · ${esc(x.separador_nome || "")}">${x.numero}/${x.de} ${esc(x.doca || "—")}</span>`).join("")
  : c.doca ? `<span class="dchip">${esc(c.doca)}</span>` : "");
const faixaDasPartes = (c) => (c.status === "cancelado" ? [] : emSeparacao(c)).map((x) =>
  `<p class="gc-parte-espera">⏳ Parte ${x.numero}/${x.de} em separação${x.separador_nome ? ` · ${esc(x.separador_nome)}` : ""}</p>`).join("");
// v75: o que o gestor pediu e ainda espera o conferente (cancelado: entregar ao estoque, em vermelho; corte: tirar
// da caixa). Cancelado não mostra "parte em separação": as partes foram canceladas.
const faixaDaOcorrencia = (c) => (c.status === "cancelado" && c.entregar
  ? `<p class="gc-parte-espera gc-cancelado">Cancelado · entregar ao estoque (DEV ${esc(c.entregar.numero)})</p>`
  : (c.itens || []).some((i) => !i.em_separacao && Number(i.qtd_devolver) > 0) ? `<p class="gc-parte-espera">Item a devolver ao estoque</p>` : "");

function card(c, { col, pos = "", primeiro = false }) {
  const vivo = c.status === "andamento", a = c.andamento;
  const marcavel = MONT() && col === "inbox", marcado = marcavel && estado.marcados.has(c.pedido);
  const cls = ["card", MONT() && "op", vivo && "live", primeiro && !vivo && col !== "inbox" && "waiting", marcado && "sel"].filter(Boolean).join(" ");
  const topo = `${marcavel ? `<span class="cb" data-gcsel="${esc(c.pedido)}" title="Selecionar">${marcado ? CHECK : ""}</span>` : ""}${destinoTag(c)}`
    + (c.partes?.length ? `<span class="c-parte" title="Pedido dividido na separação">${c.partes.length} PARTES</span>` : "")
    + (MONT() && c.prioridade === "alta" ? `<span class="c-prio">PRIORIDADE</span>` : "") + (pos ? `<span class="c-pos">${pos}</span>` : "");
  const idade = col === "inbox" ? `<span class="c-age">${haQuanto(agora() - Date.parse(c.chegou_em))}</span>` : "";
  let vivoHtml = "";
  if (vivo) {
    vivoHtml = `<div class="c-live">
      <div class="cl-row"><span class="cl-tag"><i></i>Conferindo agora</span>${c.inicio ? `<span class="timer" data-since="${doServidor(c.inicio)}">00:00</span>` : ""}</div>
      <div class="cl-bar"><i style="width:${a.pc}%"></i></div>
      <div class="cl-row small"><b>${a.pc}%</b><span>${a.itensFeitos}/${a.itens} itens · ${numero(a.unidadesFeitas)}/${numero(a.unidades)} un.</span></div>
      ${(() => { const x = itemDaVez(c); return x ? `<p class="cl-cur"><span class="gaddr">${esc(x.endereco)}</span>${esc(x.descricao)}</p>` : ""; })()}
    </div>`;
  } else if (primeiro && col !== "inbox") {
    vivoHtml = `<div class="c-live"><div class="cl-row"><span class="cl-tag"><i></i>Aguardando início</span></div></div>`;
  }
  const docas = docasHtml(c);
  return `<article class="${cls}" draggable="${!vivo}" data-id="${esc(c.pedido)}" style="--rc:${MONT() ? "var(--ink)" : corDe(c) || "var(--red-brand)"}">
    <div class="c-top">${topo}</div>
    <div class="c-main"><p class="c-id">${esc(c.pedido)}</p>${MONT() ? `<span class="c-age">chegou ${hora(c.chegada)}</span>` : ""}</div>
    ${MONT() ? "" : `<p class="c-cli">${esc(c.cliente)}</p><p class="c-vend">${esc(c.cidade)}</p>`}
    <div class="c-nums"><span><b>${a.itens}</b> SKUs</span><span><b>${numero(a.unidades)}</b> un.</span>${idade}</div>
    ${!vivo && c.separador_nome ? `<p class="c-from">Separado por ${esc(c.separador_nome)}</p>` : ""}
    ${docas ? `<p class="c-doca">${c.partes?.length ? "Docas" : "Doca"} ${docas}</p>` : ""}
    ${faixaDasPartes(c)}${faixaDaOcorrencia(c)}${marcaDaObservacao(temObservacao(c.observacao_pedido))}
    ${marcavel ? `<button class="c-skip" data-gcpular="${esc(c.pedido)}">Pular conferência</button>` : ""}
    ${vivoHtml}
  </article>`;
}

function colunaDaCaixa(caixa) {
  const conta = (fn) => caixa.filter(fn).length;
  const ehAg = (c) => c.aguardando, ehPrio = (c) => prio(c);
  if (estado.filtro === "aguardando" && !conta(ehAg)) estado.filtro = "todos";
  if (estado.filtro === "prio" && !conta(ehPrio)) estado.filtro = "todos";
  const lista = estado.filtro === "aguardando" ? caixa.filter(ehAg) : estado.filtro === "prio" ? caixa.filter(ehPrio) : caixa;
  const chip = (id, rotulo, n, extra = "", estilo = "") =>
    `<button class="gchip ${extra} ${estado.filtro === id ? "active" : ""}" data-gcfiltro="${id}" ${estilo}>${rotulo} <b>${n}</b></button>`;
  const chips = chip("todos", "Todos", caixa.length)
    + (MONT() ? chip("prio", "Prioridade", conta(ehPrio))
      : conta(ehAg) ? chip("aguardando", `<i></i>${AGUARDANDO.nome}`, conta(ehAg), "", `style="--rc:${AGUARDANDO.cor}"`) : "");
  let extra = "";
  if (MONT() && lista.length) {
    const todos = lista.every((c) => estado.marcados.has(c.pedido));
    extra += `<button class="lib-all" data-gcselall="1"><span class="cb ${todos ? "on" : ""}">${todos ? CHECK : ""}</span>${todos ? "Limpar seleção" : `Selecionar todos (${lista.length})`}</button>`;
  }
  if (MONT() && estado.marcados.size) {
    extra += `<div class="lib-bar"><p><span>${estado.marcados.size} selecionado(s)</span><button class="x" data-gclimpar="1">Limpar</button></p><div><button data-gcpular="sel">Pular conferência</button></div></div>`;
  }
  return `<section class="col inbox">
    <header class="col-head">
      <div class="ch-row"><h3>Separados</h3><span class="count">${caixa.length}</span></div>
      <p class="ch-sub">${MONT() ? "Aguardando conferente ou conferência dispensada" : "Aguardando conferente"}</p>
      <div class="gchips">${chips}</div>
      ${extra}
    </header>
    <div class="gx-list" data-col="inbox" data-lista="${lista.map((c) => esc(c.pedido)).join(",")}">${lista.map((c) => card(c, { col: "inbox" })).join("") || `<div class="col-empty">Nada por aqui 🎉</div>`}</div>
  </section>`;
}

function colunaDoConferente(conf, fila, n) {
  const sit = situacaoNoQuadro(conf, fila.map((c) => ({ andamento: c.status === "andamento" })), agora());
  const [cls, rotulo] = SITUACAO[sit];
  const contato = sit === "sem-contato" && conf.ultimo_contato ? ` ${haQuanto(agora() - Date.parse(conf.ultimo_contato))}` : "";
  const pendentes = fila.reduce((t, c) => t + c.andamento.unidades - c.andamento.unidadesFeitas, 0);
  const vivo = fila[0]?.status === "andamento";
  const cards = fila.map((c, i) => card(c, { col: conf.login, primeiro: i === 0, pos: vivo && i === 0 ? "" : `${vivo ? i : i + 1}º` })).join("");
  return `<section class="col ${sit === "desconectado" ? "away" : ""}">
    <header class="col-head">
      <div class="person">
        <span class="avatar" style="--av:${AV[n % AV.length]}">${esc(iniciais(conf.nome))}</span>
        <div class="person-n"><div class="ch-row"><h3>${esc(conf.nome)}</h3></div><span class="st ${cls}"><i></i>${rotulo}${contato}</span></div>
      </div>
      <div class="metrics">
        <div><b>${fila.length}</b><small>pedidos</small></div>
        <div><b>${numero(Math.round(pendentes * 1000) / 1000)}</b><small>un. pendentes</small></div>
        <div><b>${conf.conferidos_hoje}</b><small>hoje</small></div>
      </div>
    </header>
    <div class="gx-list" data-col="${esc(conf.login)}">${cards || `<div class="col-empty">Arraste pedidos para cá</div>`}</div>
  </section>`;
}

// Montagem: entregues à montagem hoje (soltar aqui = pular a conferência)
function colunaDosEntregues(entregues) {
  const cards = entregues.map((c) => `<article class="card cc fin" draggable="false" data-id="${esc(c.pedido)}">
      <span class="cc-pos">${CHECK}</span>
      <span class="cc-id">${esc(c.pedido)}${c.prioridade === "alta" ? `<span class="c-prio">PRIOR.</span>` : ""}</span><span class="cc-vol">${c.fim ? hora(c.fim) : ""}</span>
      <span class="cc-sub">${c.status === "dispensada" ? `<em class="skip">Sem conferência</em>` : `Conferido por ${esc(c.conferente_nome || "—")}`} · sep. ${esc(c.separador_nome || "—")}</span>
    </article>`).join("");
  return `<section class="col done-col">
    <header class="col-head">
      <div class="ch-row"><h3>Entregues à montagem</h3><span class="count">${entregues.length}</span></div>
      <p class="ch-sub">Hoje · solte um pedido aqui para pular a conferência</p>
    </header>
    <div class="gx-list compact" data-col="done">${cards || `<div class="col-empty">Nenhum pedido entregue hoje</div>`}</div>
  </section>`;
}

export function desenhar() {
  if (!ctx) return;
  if (!ctx.ativa()) return ctx.aoMudar();
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
  const { caixa, filas, entregues } = colunas();
  b.classList.remove("list");
  b.innerHTML = (estado.erro ? `<div class="gq-aviso erro">${esc(estado.erro)}</div>` : "")
    + colunaDaCaixa(caixa) + estado.quadro.conferentes.map((x, n) => colunaDoConferente(x, filas.get(x.login) || [], n)).join("")
    + (MONT() ? colunaDosEntregues(entregues) : "");
  b.querySelectorAll(".gx-list").forEach((l) => { if (rolagem[l.dataset.col]) l.scrollTop = rolagem[l.dataset.col]; });
  b.scrollLeft = bx;
}

// ---------- mudar de fila / pular ----------
// muda na tela na hora e confirma no servidor; se a trava recusar, volta como estava
async function mover(pedido, para, ordem) {
  const q = estado.quadro, antes = structuredClone(q.pedidos);
  for (const c of q.pedidos) {
    if (c.pedido === pedido) { c.designado_para = para; c.ordem_fila = para ? ordem.indexOf(pedido) + 1 : null; }
    else if (para && c.designado_para === para) { const i = ordem.indexOf(c.pedido); if (i >= 0) c.ordem_fila = i + 1; }
  }
  estado.marcados.delete(pedido);
  desenhar();
  const r = await moverNaConferencia(ctx.sess, ctx.setor, pedido, para, ordem);
  if (!r.ok) { q.pedidos = antes; ctx.toast(r.erro); desenhar(); }
  else ctx.toast(`${pedido} → ${para ? q.conferentes.find((x) => x.login === para)?.nome || para : "Separados"}`);
  recarregar();
}
async function pular(ids) {
  if (!ids.length) return;
  const r = await pularConferencia(ctx.sess, ctx.setor, ids);
  if (!r.ok) { ctx.toast(r.erro); return recarregar(); }
  ids.forEach((id) => estado.marcados.delete(id));
  const erro = r.erros?.length ? ` · ${r.erros[0]}` : "";
  ctx.toast(r.feitos.length === 1 ? `${r.feitos[0]} entregue à montagem · conferência dispensada${erro}` : `${r.feitos.length} pedidos entregues à montagem · conferência dispensada${erro}`);
  recarregar();
}

// ---------- gaveta do pedido (a mesma #drawer da demonstração) ----------
let aberto = null; // id do pedido aberto na gaveta
const gaveta = () => document.querySelector("#drawer");
const hora = (iso) => new Date(doServidor(iso)).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
const ha = (iso) => haQuanto(agora() - Date.parse(iso));
const pad = (n) => String(n).padStart(2, "0");
const duracao = (ms) => { const t = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(t / 3600); return (h ? `${h}:${pad(Math.floor(t / 60) % 60)}` : pad(Math.floor(t / 60))) + ":" + pad(t % 60); };
const cronometro = (iso) => `<span class="timer" data-gcdesde="${Date.parse(iso)}">${duracao(agora() - Date.parse(iso))}</span>`;
const nomeDe = (login) => estado.quadro?.conferentes.find((x) => x.login === login)?.nome || login || "";

function abrirGaveta(id) {
  aberto = id;
  gaveta().hidden = false; document.querySelector("#drScrim").hidden = false;
  gaveta().scrollTop = 0;
  desenharGaveta();
}
function fecharGaveta() { aberto = null; gaveta().hidden = true; document.querySelector("#drScrim").hidden = true; }

function ondeEsta(id) {
  const { caixa, filas } = colunas();
  if (caixa.some((c) => c.pedido === id)) return { col: "inbox", lista: caixa };
  for (const [login, fila] of filas) if (fila.some((c) => c.pedido === id)) return { col: login, lista: fila };
  return null;
}
const posicaoNaFila = (onde, id) => { const i = onde.lista.findIndex((c) => c.pedido === id); return onde.lista[0]?.status === "andamento" ? i : i + 1; };

function desenharGaveta() {
  if (!aberto || !estado.quadro) return;
  if (gaveta().hidden) { aberto = null; return; }
  if (gaveta().contains(document.activeElement) && document.activeElement.tagName === "SELECT") return;
  const c = pedidoDe(aberto);
  if (!c) { ctx.toast(`${aberto} saiu do quadro da conferência`); return fecharGaveta(); }
  gaveta().innerHTML = htmlDoPedido(c);
}

// os itens por produto (a conferência conta por produto; pedido dividido: as linhas das partes juntas)
function itensPorProduto(c) {
  const contado = new Map((c.contagens || []).filter((x) => !x.fora).map((x) => [x.produto, Number(x.qtd)]));
  const m = new Map();
  for (const i of c.itens) {
    const x = m.get(i.produto) || { produto: i.produto, descricao: i.descricao, endereco: i.endereco_codigo, qtd: 0, sep: 0, espera: [] };
    x.qtd += Number(i.qtd);
    // parte ainda em separação (v72): o separado ainda não vale
    if (i.em_separacao) x.espera.push(i.parte); else x.sep += Number(i.qtd_separada || 0);
    m.set(i.produto, x);
  }
  return [...m.values()].map((x) => ({ ...x, conf: contado.get(x.produto) || 0 }));
}

// o primeiro produto que ainda falta conferir (o "agora" do card, como na demonstração)
const itemDaVez = (c) => itensPorProduto(c).find((i) => i.sep > 0 && i.conf < i.sep) || null;

function htmlDoPedido(c) {
  const a = c.andamento, vivo = c.status === "andamento", onde = ondeEsta(c.pedido), fim = finalizada(c);
  const etapa = fim ? (MONT() ? { txt: c.status === "dispensada" ? "Entregue à montagem · sem conferência" : "Entregue à montagem", cls: "" }
      : { txt: c.status === "divergente" ? "Conferido com divergência" : "Conferido", cls: "" })
    : vivo ? { txt: `Em conferência · ${a.pc}%`, cls: "live" }
    : onde && onde.col !== "inbox" ? { txt: `Aguardando início da conferência · ${posicaoNaFila(onde, c.pedido)}º na fila`, cls: "wait" }
    : { txt: "Aguardando designar conferente", cls: "wait" };
  const r = rotaPeloId(c.rota);
  const confTxt = c.status === "dispensada" ? `dispensada${c.designado_por_nome ? ` por ${esc(c.designado_por_nome)}` : ""} às ${hora(c.fim)}`
    : c.fim ? `conferido às ${hora(c.fim)}` : vivo ? "conferindo agora" : c.designado_para ? "na fila" : "a designar ou dispensar";
  const grade = MONT() ? `
      <div class="dr-f"><small>Tipo de operação</small><b>Montagem (OP)</b><span>Pedido do Sankhya · não entra na expedição</span></div>
      <div class="dr-f"><small>Separação</small><b>${esc(c.separador_nome || "—")}</b><span>${c.separado_em ? `separado às ${hora(c.separado_em)}` : "—"}</span></div>
      <div class="dr-f"><small>Conferência</small><b>${esc(c.conferente_nome || (c.designado_para ? nomeDe(c.designado_para) : "—"))}</b><span>${confTxt}</span></div>
      <div class="dr-f"><small>Chegou</small><b>${hora(c.chegada)}</b><span>${ha(c.chegada)}${c.prioridade === "alta" ? " · prioridade" : ""}</span></div>` : `
      <div class="dr-f"><small>Cliente</small><b>${esc(c.cliente)}</b><span>${esc(c.cidade)}</span></div>
      <div class="dr-f"><small>Vendedor</small><b>—</b><span>Chegou ${ha(c.chegada)} · ${hora(c.chegada)}</span></div>
      ${c.aguardando ? `
      <div class="dr-f"><small>Rota</small><b><span class="rt aguard" style="--rc:${AGUARDANDO.cor}"><i></i>AGUARDANDO</span></b><span>o cliente retira na empresa</span></div>
      <div class="dr-f"><small>Embarque</small><b>—</b><span>sem horário de corte e sem embarque</span></div>
      <div class="dr-f"><small>Retirada</small><b>—</b><span>não entra em carga · depois do faturamento</span></div>` : `
      <div class="dr-f"><small>Rota</small><b>${esc(r ? r.nome : "—")}</b></div>
      <div class="dr-f"><small>Embarque</small><b>—</b><span>o horário de corte ainda não vem do servidor</span></div>
      <div class="dr-f"><small>Carga</small><b>—</b><span>ainda não faturado</span></div>`}`;
  const docas = docasHtml(c);
  const extras = [
    c.partes?.length ? `<div class="dr-f"><small>Pedido dividido</small><b>${c.partes.length} partes${emSeparacao(c).length ? ` · ${prontas(c).length} pronta${prontas(c).length === 1 ? "" : "s"}` : ""}</b><span>${c.partes.map((x) => `${x.numero}/${x.de} · ${esc(x.separador_nome || "—")}${x.pronta === false ? " · em separação" : ""}`).join("<br>")}</span></div>` : "",
    docas ? `<div class="dr-f"><small>Doca de expedição</small><b class="dr-docas">${docas}</b><span>${c.partes?.length ? "uma doca por parte · lida pelo separador" : "lida pelo separador ao terminar"}</span></div>` : "",
  ].join("");
  const aoVivo = vivo ? `<div class="dr-live">
      <div class="cl-row"><span class="cl-tag"><i></i>Conferindo agora · ${esc(c.conferente_nome || "")}</span>${c.inicio ? cronometro(c.inicio) : ""}</div>
      <div class="cl-row"><span class="big">${a.pc}%</span><span><b>${a.itensFeitos}</b>/${a.itens} itens · <b>${numero(a.unidadesFeitas)}</b>/${numero(a.unidades)} unidades</span></div>
      <div class="cl-bar"><i style="width:${a.pc}%"></i></div>
    </div>` : "";
  let acoes = "";
  if (!vivo && !fim && onde) {
    const outros = estado.quadro.conferentes.filter((x) => x.login !== onde.col);
    const i = onde.lista.findIndex((x) => x.pedido === c.pedido);
    const podeSubir = onde.col !== "inbox" && i > (onde.lista[0]?.status === "andamento" ? 1 : 0);
    acoes = `<section><h4 class="dr-h">Ações</h4><div class="dr-act">
      <select id="gcMover"><option value="">Mover para…</option>${onde.col !== "inbox" ? `<option value="inbox">Separados (caixa de entrada)</option>` : ""}
        ${outros.map((x) => `<option value="${esc(x.login)}">${esc(x.nome)} (fim da fila)</option>`).join("")}</select>
      <button class="btn primary" id="gcMoverOk">Mover</button>
      ${podeSubir ? `<button class="btn ghost" data-gctopo="${esc(c.pedido)}">Passar para o próximo da fila</button>` : ""}
      ${MONT() ? `<button class="btn ghost" data-gcpular="${esc(c.pedido)}">Pular conferência</button>` : ""}
    </div></section>`;
  }
  const daVez = vivo ? itemDaVez(c) : null;
  const linhas = itensPorProduto(c).map((i) => {
    const ok = i.conf >= i.sep && (i.sep > 0 || i.conf > 0), agoraEste = daVez && daVez.produto === i.produto;
    const dot = ok ? `<span class="sdot ok">${CHECK}</span>` : i.conf > 0 && i.sep ? `<span class="sdot part" style="--p:${Math.round((i.conf / i.sep) * 100)}%"></span>` : `<span class="sdot"></span>`;
    const espera = !i.sep && i.espera.length; // só existe na parte em separação
    return `<tr class="${ok ? "ok" : ""} ${agoraEste ? "now" : ""} ${espera ? "gc-espera" : ""}"><td>${dot}</td><td><span class="gaddr">${esc(i.endereco)}</span></td>
      <td>${esc(i.descricao)}${agoraEste ? `<span class="now-tag">agora</span>` : ""}<small>${esc(i.produto)}${i.espera.length ? ` · parte ${i.espera.join(" e ")} em separação` : ""}</small></td><td class="r">${numero(i.qtd)}</td><td class="r">${espera ? "—" : numero(i.sep)}</td><td class="r">${espera ? "—" : numero(i.conf)}</td></tr>`;
  }).join("");
  return `
    <header class="dr-head">
      <div><p class="dr-k">${MONT() ? "Pedido de montagem" : "Pedido"}</p><h2>${esc(c.pedido)}</h2></div>
      <span class="stage ${etapa.cls}">${esc(etapa.txt)}</span>
      <button class="dr-x" data-gcfechar="1" aria-label="Fechar">×</button>
    </header>
    <div class="dr-body">
      ${secaoDaObservacao({ texto: c.observacao_pedido, para: c.observacao_para, ciencias: c.ciencias })}
      <div class="dr-grid">${grade}</div>
      ${extras ? `<div class="dr-grid">${extras}</div>` : ""}
      <div class="dr-nums">
        <div><b>${a.itens}</b><small>SKUs</small></div>
        <div><b>${numero(a.unidades)}</b><small>unidades</small></div>
        ${MONT() ? `<div><b>${numero(a.unidades)}</b><small>separadas</small></div><div><b>${c.status === "dispensada" ? "—" : numero(a.unidadesFeitas)}</b><small>${c.status === "dispensada" ? "sem conferência" : "conferidas"}</small></div>`
          : `<div><b>${c.volumes || "—"}</b><small>volumes</small></div><div><b>—</b><small>nota fiscal</small></div>`}
      </div>
      ${aoVivo}
      ${acoes}
      <section>
        <h4 class="dr-h">Itens · ordem de coleta</h4>
        <table class="dr-items"><thead><tr><th></th><th>Endereço</th><th>Produto</th><th class="r">Pedido</th><th class="r">Separado</th><th class="r">Conferido</th></tr></thead><tbody>${linhas}</tbody></table>
      </section>
      <section><h4 class="dr-h">Histórico</h4>${historico(c)}</section>
    </div>`;
}

// o histórico com o que o servidor já guarda
function historico(c) {
  const h = [{ t: c.chegada, txt: MONT() ? "Pedido de montagem recebido do Sankhya" : "Pedido recebido do Sankhya" }];
  if (c.separado_em) h.push({ t: c.separado_em, txt: `Separação finalizada por ${c.separador_nome || "—"}${c.doca ? ` · doca ${c.doca}` : ""}` });
  if (c.designado_em && c.designado_para) h.push({ t: c.designado_em, txt: `Conferência atribuída a ${nomeDe(c.designado_para)}` });
  if (c.inicio) h.push({ t: c.inicio, txt: `Conferência iniciada por ${c.conferente_nome || "—"}` });
  if (c.fim) h.push({ t: c.fim, txt: c.status === "dispensada" ? `Conferência dispensada${c.designado_por_nome ? ` por ${c.designado_por_nome}` : ""} · entregue à montagem`
    : `Conferência finalizada por ${c.conferente_nome || "—"}${c.status === "divergente" ? " · com divergência" : ""}${MONT() ? " · entregue à montagem" : c.volumes ? ` · ${c.volumes} vol.` : ""}` });
  return `<ol class="timeline">${h.filter((x) => x.t).sort((a, b) => Date.parse(a.t) - Date.parse(b.t)).map((x) => `<li><time>${hora(x.t)}</time>${esc(x.txt)}</li>`).join("")}</ol>`;
}

function moverPelaGaveta(pedido, destino) {
  const para = destino === "inbox" ? null : destino;
  const { filas } = colunas();
  const ordem = para ? [...(filas.get(para) || []).filter((c) => c.status !== "andamento" && c.pedido !== pedido).map((c) => c.pedido), pedido] : [];
  mover(pedido, para, ordem);
}
function passarParaProximo(pedido) {
  const onde = ondeEsta(pedido);
  if (!onde || onde.col === "inbox") return;
  mover(pedido, onde.col, [pedido, ...onde.lista.filter((c) => c.status !== "andamento" && c.pedido !== pedido).map((c) => c.pedido)]);
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
    if (lista.dataset.col === "done") { ph.remove(); b.querySelectorAll(".gx-list.over").forEach((l) => l !== lista && l.classList.remove("over")); lista.classList.add("over"); return; }
    const cards = [...lista.querySelectorAll(".card:not(.dragging)")];
    let antes = cards.find((c) => { const r = c.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; }) || null;
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
    const pedido = arrastando, col = lista.dataset.col;
    const ordem = [...lista.children].filter((x) => x === ph || (x.classList.contains("card") && !x.classList.contains("dragging") && !x.classList.contains("live")))
      .map((x) => (x === ph ? pedido : x.dataset.id));
    fim();
    if (col === "done") return MONT() ? pular([pedido]) : desenhar();
    const para = col === "inbox" ? null : col;
    const c = pedidoDe(pedido);
    if (!c || (!c.designado_para && !para)) return desenhar(); // na caixa a ordem é automática
    mover(pedido, para, ordem);
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

  b.addEventListener("click", (e) => {
    if (!ativo()) return;
    const f = e.target.closest("[data-gcfiltro]");
    if (f) { estado.filtro = f.dataset.gcfiltro; return desenhar(); }
    const cb = e.target.closest("[data-gcsel]");
    if (cb) {
      e.stopPropagation();
      const id = cb.dataset.gcsel;
      estado.marcados.has(id) ? estado.marcados.delete(id) : estado.marcados.add(id);
      return desenhar();
    }
    if (e.target.closest("[data-gcselall]")) {
      const visiveis = (b.querySelector('.gx-list[data-col="inbox"]')?.dataset.lista || "").split(",").filter(Boolean);
      const todos = visiveis.every((id) => estado.marcados.has(id));
      visiveis.forEach((id) => (todos ? estado.marcados.delete(id) : estado.marcados.add(id)));
      return desenhar();
    }
    if (e.target.closest("[data-gclimpar]")) { estado.marcados.clear(); return desenhar(); }
    const pl = e.target.closest("[data-gcpular]");
    if (pl) {
      e.stopPropagation();
      const { caixa } = colunas();
      return pular(pl.dataset.gcpular === "sel" ? caixa.map((c) => c.pedido).filter((id) => estado.marcados.has(id)) : [pl.dataset.gcpular]);
    }
    const c = e.target.closest(".card");
    if (c) abrirGaveta(c.dataset.id);
  });

  const g = gaveta();
  g.addEventListener("click", (e) => {
    if (!aberto) return;
    if (e.target.closest("[data-gcfechar]")) return fecharGaveta();
    if (e.target.closest("#gcMoverOk")) {
      const destino = g.querySelector("#gcMover").value;
      if (!destino) return ctx.toast("Escolha para onde mover");
      return moverPelaGaveta(aberto, destino);
    }
    const topo = e.target.closest("[data-gctopo]");
    if (topo) return passarParaProximo(topo.dataset.gctopo);
    const pl = e.target.closest("[data-gcpular]");
    if (pl) return pular([pl.dataset.gcpular]);
  });
  document.querySelector("#drScrim").addEventListener("click", () => { aberto = null; });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && aberto && document.querySelector("#modal").hidden) fecharGaveta(); });
  setInterval(() => g.querySelectorAll(".timer[data-gcdesde]").forEach((el) => (el.textContent = duracao(agora() - +el.dataset.gcdesde))), 1000);
}
