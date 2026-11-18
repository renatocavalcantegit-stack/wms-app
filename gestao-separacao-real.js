// WMS Beach Bike — Gestão (WEB), quadro da SEPARAÇÃO de verdade, com o servidor (Fase 1e).
// Só liga quando o app é aberto pelo servidor (modo.json diz servidor: true) e o coordenador entrou com o servidor.
// No GitHub Pages (demonstração), a aba Separação continua a simulação de sempre (gestao.js).
//
// É o mesmo quadro da demonstração (caixa de entrada + uma coluna por separador), agora com os pedidos do banco:
//   - arrastar da caixa para um separador, de um separador para outro, de volta para a caixa, ou mudar a ordem;
//   - pedido sem rota: o coordenador escolhe a rota antes de mandar para um separador;
//   - marcar pedidos da caixa e agrupar em lote; desfazer o lote antes de começar;
//   - o andamento de quem está separando, e "Sem contato" quando o coletor não dá sinal há 90 s;
//   - clicar no card abre a mesma gaveta da demonstração (#drawer), com os itens, a rota e "Mover para…".
// As travas valem no servidor (server/src/consultas/quadro.js). As decisões de tela (colunas, ordem, situação)
// estão em compartilhado/regras/fila-do-separador.js. Os dados vêm de js/dados/quadro.js.
// Ainda NÃO estão aqui (seguem só na demonstração): dividir pedido, sugerir lotes e a distribuição inteligente.
import { esc as escapar } from "./js/util.js";
import { temServidor } from "./js/sessao.js";
import { buscarQuadro, moverNoQuadro, definirRota, criarLote, desfazerLote, buscarPedido, ouvirQuadro } from "./js/dados/quadro.js";
import { unidadesDoQuadro, colunasDoQuadro, situacaoNoQuadro } from "./compartilhado/regras/fila-do-separador.js";
import { precisaDeRota, AGUARDANDO } from "./compartilhado/regras/aguardando.js";
import { ROTAS, rota as rotaPeloId } from "./compartilhado/regras/rotas.js";
import { MAX_PEDIDOS_LOTE, montarParadas } from "./compartilhado/regras/separacao.js";

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
  desenharGaveta();
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

// ---------- gaveta do pedido e do lote (a mesma #drawer da demonstração, com os dados do servidor) ----------
// O que o servidor ainda não tem (vendedor, embarque, carga, volumes, nota fiscal) aparece com "—" até a integração
// com o Sankhya. Dividir pedido continua só na demonstração.
let aberto = null;   // { tipo: "p" | "l", id }
let pedidoDaVez = 0; // descarta a resposta de uma gaveta que já foi trocada
const gaveta = () => document.querySelector("#drawer");
const hora = (iso) => new Date(doServidor(iso)).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
const ha = (iso) => haQuanto(agora() - Date.parse(iso));
const pad = (n) => String(n).padStart(2, "0");
const duracao = (ms) => { const t = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(t / 3600); return (h ? `${h}:${pad(Math.floor(t / 60) % 60)}` : pad(Math.floor(t / 60))) + ":" + pad(t % 60); };
const cronometro = (iso) => `<span class="timer" data-gqdesde="${Date.parse(iso)}">${duracao(agora() - Date.parse(iso))}</span>`;
const nomeDe = (login) => estado.quadro?.separadores.find((x) => x.login === login)?.nome || login || "";
const porcento = (feito, total) => (total ? Math.round((feito / total) * 100) : 0);
const AGUARDANDO_TAG = `<span class="rt aguard" style="--rc:${AGUARDANDO.cor}"><i></i>AGUARDANDO</span>`;
const pontinho = (i) => i.status !== "pendente" && i.qtd_separada >= i.qtd ? `<span class="sdot ok">${CHECK}</span>`
  : i.qtd_separada > 0 ? `<span class="sdot part" style="--p:${porcento(i.qtd_separada, i.qtd)}%"></span>` : `<span class="sdot"></span>`;

function abrirGaveta(id) {
  const u = unidadesDoQuadro(estado.quadro.pedidos).find((x) => x.id === id);
  aberto = u?.ehLote ? { tipo: "l", id } : { tipo: "p", id };
  gaveta().hidden = false; document.querySelector("#drScrim").hidden = false;
  gaveta().scrollTop = 0;
  desenharGaveta();
}
function fecharGaveta() { aberto = null; gaveta().hidden = true; document.querySelector("#drScrim").hidden = true; }

// a unidade (pedido ou lote) no quadro: em que coluna está e em que posição da fila
function ondeEsta(id) {
  const { caixa, filas } = colunas();
  if (caixa.some((u) => u.id === id)) return { col: "inbox", lista: caixa };
  for (const [login, fila] of filas) if (fila.some((u) => u.id === id)) return { col: login, lista: fila };
  return null;
}
const posicaoNaFila = (onde, id) => { const i = onde.lista.findIndex((u) => u.id === id); return onde.lista[0]?.andamento ? i : i + 1; };

// "Mover para…" e "Passar para o próximo da fila" (as mesmas ações da demonstração)
function acoesDeMover(u, onde, extra = "") {
  if (!onde || u.andamento) return extra ? `<section><h4 class="dr-h">Ações</h4><div class="dr-act">${extra}</div></section>` : "";
  const outros = estado.quadro.separadores.filter((x) => x.login !== onde.col);
  const i = onde.lista.findIndex((x) => x.id === u.id);
  const podeSubir = onde.col !== "inbox" && i > (onde.lista[0]?.andamento ? 1 : 0);
  return `<section><h4 class="dr-h">Ações</h4><div class="dr-act">
    <select id="gqMover"><option value="">Mover para…</option>${onde.col !== "inbox" ? `<option value="inbox">Caixa de entrada</option>` : ""}
      ${outros.map((x) => `<option value="${esc(x.login)}">${esc(x.nome)} (fim da fila)</option>`).join("")}</select>
    <button class="btn primary" id="gqMoverOk">Mover</button>
    ${podeSubir ? `<button class="btn ghost" data-gqtopo="${esc(u.id)}">Passar para o próximo da fila</button>` : ""}
    ${extra}
  </div></section>`;
}

async function desenharGaveta() {
  if (!aberto) return;
  if (gaveta().hidden) { aberto = null; return; } // fechada pela Gestão (fundo escuro)
  if (gaveta().contains(document.activeElement) && document.activeElement.tagName === "SELECT") return; // não atrapalha quem está escolhendo
  const vez = ++pedidoDaVez, { tipo, id } = aberto;
  const ids = tipo === "l" ? estado.quadro.pedidos.filter((p) => p.lote === id).map((p) => p.id) : [id];
  if (!ids.length) return fecharGaveta(); // o lote terminou (saiu do quadro)
  const respostas = await Promise.all(ids.map((x) => buscarPedido(ctx.sess, x)));
  if (vez !== pedidoDaVez || !aberto) return;
  const falhou = respostas.find((r) => !r.ok);
  if (falhou) { ctx.toast(falhou.erro); return fecharGaveta(); }
  gaveta().innerHTML = tipo === "l" ? htmlDoLote(id, respostas) : htmlDoPedido(respostas[0]);
}

function htmlDoPedido(p) {
  const itens = p.itens, un = itens.reduce((t, i) => t + i.qtd, 0), unFeitas = itens.reduce((t, i) => t + (i.status !== "pendente" ? i.qtd_separada : 0), 0);
  const feitos = itens.filter((i) => i.status !== "pendente").length, pc = porcento(unFeitas, un);
  const onde = ondeEsta(p.lote || p.id), vivo = p.status === "andamento";
  const atual = vivo ? itens.find((i) => i.status === "pendente") : null;
  const etapa = p.status === "concluido" ? { txt: `Separado${p.doca ? ` · doca ${p.doca}` : ""}`, cls: "" }
    : vivo ? { txt: `Em separação · ${pc}%`, cls: "live" }
    : onde && onde.col !== "inbox" ? { txt: `Aguardando início da separação · ${posicaoNaFila(onde, p.lote || p.id)}º na fila`, cls: "wait" }
    : { txt: `Aguardando designar separador${semRota(p) ? " · sem rota" : ""}`, cls: "wait" };
  const r = rotaPeloId(p.rota);
  const travada = p.status !== "pendente" || !!p.lote || !!p.pedido_pai;
  const grade = MONT() ? `
      <div class="dr-f"><small>Tipo de operação</small><b>Montagem (OP)</b><span>Pedido do Sankhya · não entra na expedição</span></div>
      <div class="dr-f"><small>Chegou</small><b>${hora(p.chegada)}</b><span>${ha(p.chegada)}${p.prioridade === "alta" ? " · prioridade" : ""}</span></div>` : `
      <div class="dr-f"><small>Cliente</small><b>${esc(p.cliente)}</b><span>${esc(p.cidade)}</span></div>
      <div class="dr-f"><small>Vendedor</small><b>—</b><span>Chegou ${ha(p.chegada)} · ${hora(p.chegada)}</span></div>
      ${p.aguardando ? `
      <div class="dr-f"><small>Rota</small><b>${AGUARDANDO_TAG}</b><span>o cliente retira na empresa</span></div>
      <div class="dr-f"><small>Embarque</small><b>—</b><span>sem horário de corte e sem embarque</span></div>
      <div class="dr-f"><small>Retirada</small><b>—</b><span>não entra em carga · depois do faturamento</span></div>` : `
      <div class="dr-f"><small>Rota</small>${travada ? `<b>${esc(r ? r.nome : "—")}</b>` : `<select id="gqDrRota" class="${p.rota ? "" : "warn"}"><option value="">— Sem rota —</option>${ROTAS.map((x) => `<option value="${x.id}" ${x.id === p.rota ? "selected" : ""}>${esc(x.nome)}</option>`).join("")}</select>`}</div>
      <div class="dr-f"><small>Embarque</small><b>—</b><span>${r ? "o horário de corte ainda não vem do servidor" : "Defina a rota"}</span></div>
      <div class="dr-f"><small>Carga</small><b>—</b><span>ainda não faturado</span></div>`}`;
  const extras = [
    p.lote ? `<div class="dr-f"><small>Lote</small><b><a href="#" data-gqgoto="${esc(p.lote)}">${esc(p.lote)}</a> · caixa ${esc(p.posicao_lote)}</b><span>${estado.quadro.pedidos.filter((x) => x.lote === p.lote).length || "—"} pedidos numa viagem</span></div>` : "",
    p.pedido_pai ? `<div class="dr-f"><small>Pedido dividido</small><b>Parte ${p.parte_numero} de ${p.partes_total} · ${esc(p.pedido_pai)}</b><span>${esc(p.parte_ruas || "")}</span></div>` : "",
    p.doca ? `<div class="dr-f"><small>Doca de expedição</small><b class="dr-docas"><span class="dchip">${esc(p.doca)}</span></b><span>lida pelo separador ao terminar</span></div>` : "",
  ].join("");
  const aoVivo = vivo ? `<div class="dr-live">
      <div class="cl-row"><span class="cl-tag"><i></i>Separando agora · ${esc(nomeDe(p.separador))}</span>${p.inicio ? cronometro(p.inicio) : ""}</div>
      <div class="cl-row"><span class="big">${pc}%</span><span><b>${feitos}</b>/${itens.length} itens · <b>${numero(unFeitas)}</b>/${numero(un)} unidades</span></div>
      <div class="cl-bar"><i style="width:${pc}%"></i></div>
      ${atual ? `<div class="now"><span class="gaddr">${esc(atual.endereco_codigo)}</span><p>${esc(atual.descricao)}<small>${esc(atual.produto)} · ${atual.qtd_separada}/${atual.qtd} un. separadas</small></p></div>` : ""}
    </div>` : "";
  // pedido de lote: as ações ficam na gaveta do lote (o lote anda inteiro)
  const acoes = p.lote ? "" : acoesDeMover({ id: p.id, andamento: vivo }, p.status === "pendente" ? onde : null);
  const linhas = itens.map((i) => `<tr class="${i.status !== "pendente" && i.qtd_separada >= i.qtd ? "ok" : ""} ${atual === i ? "now" : ""}">
      <td>${pontinho(i)}</td><td><span class="gaddr">${esc(i.endereco_codigo)}</span></td>
      <td>${esc(i.descricao)}${atual === i ? `<span class="now-tag">agora</span>` : ""}<small>${esc(i.produto)}${i.status === "falta" ? ` · falta${i.motivo ? `: ${esc(i.motivo)}` : ""}` : ""}</small></td>
      <td class="r">${i.qtd}</td><td class="r">${i.status === "pendente" && !i.qtd_separada ? 0 : i.qtd_separada}</td></tr>`).join("");
  return `
    <header class="dr-head">
      <div><p class="dr-k">${p.pedido_pai ? "Parte de pedido dividido" : MONT() ? "Pedido de montagem" : "Pedido"}</p><h2>${esc(p.id)}</h2></div>
      <span class="stage ${etapa.cls}">${esc(etapa.txt)}</span>
      <button class="dr-x" data-gqfechar="1" aria-label="Fechar">×</button>
    </header>
    <div class="dr-body">
      <div class="dr-grid">${grade}</div>
      ${extras ? `<div class="dr-grid">${extras}</div>` : ""}
      <div class="dr-nums">
        <div><b>${itens.length}</b><small>SKUs</small></div>
        <div><b>${numero(un)}</b><small>unidades</small></div>
        ${MONT() ? `<div><b>${numero(unFeitas)}</b><small>separadas</small></div><div><b>—</b><small>conferidas</small></div>`
          : `<div><b>—</b><small>volumes</small></div><div><b>—</b><small>nota fiscal</small></div>`}
      </div>
      ${aoVivo}
      ${acoes}
      <section>
        <h4 class="dr-h">Itens · ordem de coleta</h4>
        <table class="dr-items"><thead><tr><th></th><th>Endereço</th><th>Produto</th><th class="r">Pedido</th><th class="r">Separado</th></tr></thead><tbody>${linhas}</tbody></table>
      </section>
      <section><h4 class="dr-h">Histórico</h4>${historico(p)}</section>
    </div>`;
}

// o histórico com o que o servidor já guarda (a demonstração anota cada passo; aqui: chegada, fila, início e fim)
function historico(p) {
  const h = [{ t: p.chegada, txt: MONT() ? "Pedido de montagem recebido do Sankhya" : "Pedido recebido do Sankhya" }];
  if (p.designado_em && p.designado_para) h.push({ t: p.designado_em, txt: `Separação atribuída a ${nomeDe(p.designado_para)}` });
  if (p.inicio) h.push({ t: p.inicio, txt: `Separação iniciada por ${nomeDe(p.separador)}` });
  if (p.fim) h.push({ t: p.fim, txt: `Separação finalizada por ${nomeDe(p.separador)}${p.doca ? ` · doca ${p.doca}` : ""}` });
  return `<ol class="timeline">${h.sort((a, b) => Date.parse(a.t) - Date.parse(b.t)).map((x) => `<li><time>${hora(x.t)}</time>${esc(x.txt)}</li>`).join("")}</ol>`;
}

function htmlDoLote(id, membros) {
  const u = unidadesDoQuadro(estado.quadro.pedidos).find((x) => x.id === id) || { id, andamento: membros.some((p) => p.status === "andamento") };
  const onde = ondeEsta(id), vivo = u.andamento;
  const posicoes = Object.fromEntries(membros.map((p) => [p.id, p.posicao_lote]));
  membros.sort((a, b) => String(a.posicao_lote).localeCompare(String(b.posicao_lote)));
  const todos = membros.flatMap((p) => p.itens);
  const un = todos.reduce((t, i) => t + i.qtd, 0), unFeitas = todos.reduce((t, i) => t + (i.status !== "pendente" ? i.qtd_separada : 0), 0), pc = porcento(unFeitas, un);
  const quem = membros.find((p) => p.separador)?.separador, inicio = membros.map((p) => p.inicio).filter(Boolean).sort()[0];
  const etapa = vivo ? { txt: `Separando · ${nomeDe(quem)}`, cls: "live" }
    : onde && onde.col !== "inbox" ? { txt: `Na fila de ${nomeDe(onde.col)} · ${posicaoNaFila(onde, id)}º`, cls: "wait" } : { txt: "Aguardando separador", cls: "wait" };
  const pedidos = membros.map((p) => {
    const t = p.itens.reduce((s, i) => s + i.qtd, 0), f = p.itens.reduce((s, i) => s + (i.status !== "pendente" ? i.qtd_separada : 0), 0);
    return `<tr class="click" data-gqgoto="${esc(p.id)}"><td><b class="lpos">${esc(p.posicao_lote)}</b></td><td><b>${esc(p.id)}</b><small>${MONT() ? "Montagem" : esc(p.cliente)}</small></td>
      <td>${MONT() ? "—" : destinoTag(p)}</td><td class="r">${p.itens.length}</td><td class="r">${f}/${t}</td></tr>`;
  }).join("");
  const paradas = montarParadas(membros.map((p) => ({ id: p.id, itens: p.itens.map((i) => ({ end: i.endereco_codigo, sku: i.produto, desc: i.descricao, qtd: i.qtd, sep: i.status !== "pendente" ? i.qtd_separada : 0, status: i.status })) })), posicoes);
  const linhas = paradas.map((x) => `<tr class="${x.lido >= x.total ? "ok" : ""}"><td><span class="gaddr">${esc(x.end)}</span></td><td>${esc(x.desc)}<small>${esc(x.sku)}</small></td>
      <td>${x.linhas.map((y) => `<span class="lq"><b class="lpos">${esc(y.pos)}</b>${y.qtd}</span>`).join("")}</td><td class="r">${x.lido}/${x.total}</td></tr>`).join("");
  const desfazer = !vivo && !inicio ? `<button class="btn ghost" data-gqdesfazer="${esc(id)}">Desfazer lote</button>` : "";
  const doca = membros.find((p) => p.doca)?.doca;
  return `
    <header class="dr-head">
      <div><p class="dr-k">Lote · uma viagem só</p><h2>${esc(id)}</h2></div>
      <span class="stage ${etapa.cls}">${esc(etapa.txt)}</span>
      <button class="dr-x" data-gqfechar="1" aria-label="Fechar">×</button>
    </header>
    <div class="dr-body">
      <div class="dr-grid">
        <div class="dr-f"><small>Montado por</small><b>—</b><span>ainda não fica gravado no servidor</span></div>
        <div class="dr-f"><small>Separador</small><b>${quem ? esc(nomeDe(quem)) : onde && onde.col !== "inbox" ? esc(nomeDe(onde.col)) : "—"}</b><span>${inicio ? `desde ${hora(inicio)}` : "não iniciado"}</span></div>
        <div class="dr-f"><small>Doca de expedição</small><b>${doca ? `<span class="dchip">${esc(doca)}</span>` : "—"}</b><span>uma doca para o lote inteiro</span></div>
        <div class="dr-f"><small>Depois da separação</small><b>Cada pedido sozinho</b><span>vai para a conferência separado</span></div>
      </div>
      <div class="dr-nums">
        <div><b>${membros.length}</b><small>pedidos</small></div>
        <div><b>${paradas.length}</b><small>paradas</small></div>
        <div><b>${numero(un)}</b><small>unidades</small></div>
        <div><b>${pc}%</b><small>separado</small></div>
      </div>
      ${vivo ? `<div class="dr-live"><div class="cl-row"><span class="cl-tag"><i></i>Separando agora · ${esc(nomeDe(quem))}</span>${inicio ? cronometro(inicio) : ""}</div><div class="cl-bar"><i style="width:${pc}%"></i></div></div>` : ""}
      ${acoesDeMover(u, onde, desfazer)}
      <section><h4 class="dr-h">Pedidos · caixa no carrinho</h4>
        <table class="dr-items"><thead><tr><th>Caixa</th><th>Pedido</th><th>Rota</th><th class="r">Itens</th><th class="r">Separado</th></tr></thead><tbody>${pedidos}</tbody></table></section>
      <section><h4 class="dr-h">Paradas · ordem da viagem</h4>
        <table class="dr-items"><thead><tr><th>Endereço</th><th>Produto</th><th>Por caixa</th><th class="r">Total</th></tr></thead><tbody>${linhas}</tbody></table></section>
    </div>`;
}

// mover pelo "Mover para…" da gaveta: vai para o fim da fila escolhida (como na demonstração)
function moverPelaGaveta(unidade, destino) {
  const para = destino === "inbox" ? null : destino;
  const { filas } = colunas();
  const ordem = para ? [...(filas.get(para) || []).filter((u) => !u.andamento && u.id !== unidade).map((u) => u.id), unidade] : [];
  const u = unidadesDoQuadro(estado.quadro.pedidos).find((x) => x.id === unidade);
  if (para && u && u.pedidos.some(semRota)) return pedirRota(u.pedidos, () => mover(unidade, para, ordem));
  mover(unidade, para, ordem);
}
// "Passar para o próximo da fila": logo depois do que está em separação
function passarParaProximo(unidade) {
  const onde = ondeEsta(unidade);
  if (!onde || onde.col === "inbox") return;
  const resto = onde.lista.filter((u) => !u.andamento && u.id !== unidade).map((u) => u.id);
  mover(unidade, onde.col, [unidade, ...resto]);
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
    if (c) abrirGaveta(c.dataset.id);
  });

  // ações dentro da gaveta
  const g = gaveta();
  g.addEventListener("click", async (e) => {
    if (!aberto) return;
    if (e.target.closest("[data-gqfechar]")) return fecharGaveta();
    const ir = e.target.closest("[data-gqgoto]");
    if (ir) { e.preventDefault(); return abrirGaveta(ir.dataset.gqgoto); }
    if (e.target.closest("#gqMoverOk")) {
      const destino = g.querySelector("#gqMover").value;
      if (!destino) return ctx.toast("Escolha para onde mover");
      return moverPelaGaveta(aberto.id, destino);
    }
    const topo = e.target.closest("[data-gqtopo]");
    if (topo) return passarParaProximo(topo.dataset.gqtopo);
    const dz = e.target.closest("[data-gqdesfazer]");
    if (dz) {
      const r = await desfazerLote(ctx.sess, ctx.setor, dz.dataset.gqdesfazer);
      if (!r.ok) return ctx.toast(r.erro);
      fecharGaveta(); ctx.toast(`Lote ${dz.dataset.gqdesfazer} desfeito · os pedidos voltaram para a caixa de entrada`);
      return recarregar();
    }
  });
  g.addEventListener("change", async (e) => {
    if (!aberto || e.target.id !== "gqDrRota") return;
    const rota = e.target.value;
    e.target.blur();
    if (!rota) { ctx.toast("Escolha uma rota"); return desenharGaveta(); }
    const r = await definirRota(ctx.sess, ctx.setor, aberto.id, rota);
    if (!r.ok) { ctx.toast(r.erro); return desenharGaveta(); }
    ctx.toast(`Rota de ${aberto.id}: ${rotaPeloId(rota).nome}`);
    recarregar();
  });
  document.querySelector("#drScrim").addEventListener("click", () => { aberto = null; });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && aberto && document.querySelector("#modal").hidden) fecharGaveta(); });
  setInterval(() => g.querySelectorAll(".timer[data-gqdesde]").forEach((el) => (el.textContent = duracao(agora() - +el.dataset.gqdesde))), 1000);
}
