// WMS Beach Bike — Gestão (WEB), aba AO VIVO (Fase 1c): a separação de verdade, vinda do servidor.
// Só aparece quando o app é aberto pelo servidor (modo.json diz servidor: true) e o coordenador entrou
// com o servidor (sessão com token). No GitHub Pages (demonstração), a aba fica escondida.
//
// Diferente dos outros quadros (simulação), esta aba não guarda nada no aparelho: lê o painel do servidor
// (js/dados/painel.js) e atualiza sozinha quando o canal de tempo real avisa. As decisões (sem contato,
// ordem da lista, progresso) ficam em compartilhado/regras/painel.js.
import { esc as escapar } from "./js/util.js";
import { temServidor } from "./js/sessao.js";
import { buscarPainel, marcarVista, ouvirTempoReal } from "./js/dados/painel.js";
import { separadoresDoPainel, progressoDoPedido, haQuantoTempo, resumoDoPainel } from "./compartilhado/regras/painel.js";

const esc = (s) => escapar(s ?? "");
const ATUALIZAR_MS = 60_000;  // reserva: relê o painel mesmo sem aviso (se um aviso se perder)
const RELOGIO_MS = 15_000;    // redesenha para o "há X min" andar sozinho
const MAX_LISTA = 12;         // pendentes e concluídos: só os primeiros (o resto vira "e mais N")
const ERROS = {
  "sem-rede": "Sem conexão com o servidor",
  "sessao-vencida": "Sessão vencida: saia e entre de novo",
  servidor: "O servidor respondeu com erro",
};
const ACAO = {
  "separacao.iniciar": "Iniciar o pedido",
  "separacao.item": "Separar item",
  "separacao.concluir": "Concluir na doca",
  "separacao.reabrir": "Separar novamente",
};

// painel = o que veio do servidor · diferenca = relógio do servidor − relógio deste computador
const estado = { painel: null, diferenca: 0, erro: "", lidoEm: null };
let ctx = null; // { sess, setor, container, ativa, toast }

const agora = () => Date.now() + estado.diferenca;
const hora = (iso) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
const iniciais = (nome) => nome.split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0].toUpperCase()).join("");

// Liga a aba. Devolve true se há servidor (a aba aparece), false na demonstração.
export async function ligarAoVivo({ sess, setor, container, ativa, toast }) {
  if (!sess?.token || !(await temServidor())) return false;
  ctx = { sess, setor, container, ativa, toast };
  document.querySelector("#tabVivo").hidden = false;

  await atualizar();
  // cada aviso do servidor relê o painel; vários avisos juntos (vários coletores) viram uma leitura só
  let espera = null;
  ouvirTempoReal(sess, () => { clearTimeout(espera); espera = setTimeout(atualizar, 300); });
  setInterval(atualizar, ATUALIZAR_MS);
  // o relógio anda mesmo sem aviso novo: quem passou de 90 s sem sinal fica "sem contato" sozinho,
  // na lista e no número vermelho da aba (este aparece mesmo com o coordenador em outra aba)
  setInterval(() => { marcarAba(); if (ctx.ativa()) desenhar(); }, RELOGIO_MS);

  container.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-vivo-visto]");
    if (!b) return;
    b.disabled = true;
    if (await marcarVista(sess, b.dataset.vivoVisto)) await atualizar();
    else { b.disabled = false; toast("Não deu para marcar: confira a conexão com o servidor"); }
  });
  return true;
}

async function atualizar() {
  const r = await buscarPainel(ctx.sess, ctx.setor);
  if (r.ok) {
    estado.painel = r.painel;
    estado.diferenca = Date.parse(r.painel.agora) - Date.now();
    estado.erro = "";
    estado.lidoEm = agora();
  } else estado.erro = ERROS[r.erro];
  marcarAba();
  if (ctx.ativa()) desenhar();
}

// número vermelho na aba: separadores sem contato + ações não aplicadas (visível mesmo em outra aba)
function marcarAba() {
  const el = document.querySelector("#tbVivo");
  const n = estado.painel ? resumo().semContato + estado.painel.naoAplicadas.length : 0;
  el.textContent = n; el.hidden = !n;
}

const separadores = () => separadoresDoPainel(estado.painel.separadores, estado.painel.pedidos, agora());
const resumo = () => resumoDoPainel(estado.painel.pedidos, separadores(), estado.painel.naoAplicadas);

// chamada pelo gestao.js ao entrar na aba
export function telaAoVivo() {
  return `<div class="vivo-wrap">${conteudo()}</div>`;
}
function desenhar() {
  const w = ctx.container.querySelector(".vivo-wrap");
  if (w) w.innerHTML = conteudo();
}

function conteudo() {
  if (!estado.painel) {
    return `<div class="vivo-head"><h1>Separação ao vivo</h1></div>
      <p class="vivo-aviso err">${esc(estado.erro || "Carregando…")}</p>`;
  }
  const { pedidos, naoAplicadas } = estado.painel;
  const seps = separadores(), r = resumo();
  const nomeDe = Object.fromEntries(estado.painel.separadores.map((s) => [s.login, s.nome]));
  const kpi = (n, t, cls = "") => `<span class="gx-kpi ${cls}"><b>${n}</b>${t}</span>`;
  const aviso = estado.erro
    ? `<p class="vivo-aviso err">${esc(estado.erro)} · mostrando o que foi lido às ${hora(estado.lidoEm)}</p>` : "";

  return `
  <div class="vivo-head">
    <div><h1>Separação ao vivo</h1>
      <p>Os pedidos e os separadores de verdade, como estão no servidor. Atualiza sozinho quando um coletor manda ações.</p></div>
    <div class="gx-kpis">
      ${kpi(r.emSeparacao, "em separação")}${kpi(r.pendentes, "aguardando")}${kpi(r.concluidosHoje, "concluídos hoje", "green")}
      ${r.semContato ? kpi(r.semContato, "sem contato", "red") : ""}${r.naoAplicadas ? kpi(r.naoAplicadas, "não aplicadas", "red") : ""}
    </div>
  </div>
  ${aviso}
  ${naoAplicadas.length ? blocoNaoAplicadas(naoAplicadas) : ""}
  <div class="vivo-grade">
    <section class="vivo-bloco">
      <h2>Separadores</h2>
      ${seps.map(linhaSeparador).join("") || `<p class="vivo-vazio">Nenhum separador cadastrado.</p>`}
    </section>
    <section class="vivo-bloco">
      <h2>Pedidos</h2>
      ${grupo("Em separação", pedidos.filter((p) => p.status === "andamento"), nomeDe, Infinity)}
      ${grupo("Aguardando separação", pedidos.filter((p) => p.status === "pendente"), nomeDe, MAX_LISTA)}
      ${grupo("Concluídos hoje", pedidos.filter((p) => p.status === "concluido"), nomeDe, MAX_LISTA)}
    </section>
  </div>`;
}

function linhaSeparador(s) {
  const pedidosTxt = s.pedidos.join(", ");
  const contato = s.semContatoMs === null ? "" : haQuantoTempo(s.semContatoMs);
  const acao = s.ultima_acao ? ` · última ação ${haQuantoTempo(agora() - Date.parse(s.ultima_acao))}` : "";
  const texto = {
    separando: `Separando ${esc(pedidosTxt)}${acao}`,
    livre: `Livre · último contato ${contato}`,
    "sem-contato": `Sem contato ${contato || "desde o login"}${s.pedidos.length ? ` · está com ${esc(pedidosTxt)}` : ""}`,
    fora: "Não entrou no turno",
  }[s.situacao];
  return `<div class="vivo-sep" data-situacao="${s.situacao}">
    <span class="vivo-av">${esc(iniciais(s.nome))}</span>
    <div><b>${esc(s.nome)}</b><small>${texto}</small></div>
  </div>`;
}

function grupo(titulo, lista, nomeDe, max) {
  if (!lista.length) return "";
  const resto = lista.length - Math.min(max, lista.length);
  return `<h3>${titulo} <span>${lista.length}</span></h3>
    ${lista.slice(0, max).map((p) => linhaPedido(p, nomeDe)).join("")}
    ${resto ? `<p class="vivo-vazio">e mais ${resto}</p>` : ""}`;
}

function linhaPedido(p, nomeDe) {
  const pct = progressoDoPedido(p);
  const quem = p.separador ? esc(nomeDe[p.separador] || p.separador) : "—";
  const tags = (p.prioridade === "alta" ? `<span class="vivo-tag red">Prioridade</span>` : "")
    + (p.lote ? `<span class="vivo-tag">${esc(p.lote)} · caixa ${esc(p.posicao_lote)}</span>` : "")
    + (p.itens_com_falta ? `<span class="vivo-tag warn">${p.itens_com_falta} com falta</span>` : "");
  const quando = p.status === "concluido" ? `concluído ${hora(p.fim)} · doca ${esc(p.doca)}`
    : p.status === "andamento" ? `desde ${hora(p.inicio)}` : esc(p.cidade);
  return `<div class="vivo-ped" data-status="${p.status}">
    <div class="vivo-ped-top"><b>${esc(p.id)}</b><span>${esc(p.cliente)}</span>${tags}</div>
    <div class="vivo-ped-meio">
      <span class="vivo-barra"><i style="width:${pct}%"></i></span>
      <small>${p.itens_feitos}/${p.itens} itens</small>
    </div>
    <small class="vivo-ped-pe">${quem} · ${quando}</small>
  </div>`;
}

function blocoNaoAplicadas(lista) {
  return `<section class="vivo-bloco vivo-nao">
    <h2>Não aplicadas <span>${lista.length}</span></h2>
    <p class="vivo-ajuda">O servidor recebeu, mas não mudou o pedido. Fale com o separador, resolva e marque como visto.</p>
    ${lista.map((a) => `<div class="vivo-nao-linha">
      <div><b>${esc(a.pedido || "—")}</b> · ${esc(a.nome)} · ${esc(ACAO[a.tipo] || a.tipo)} às ${hora(a.feita_em)}
        ${hora(a.recebida_em) !== hora(a.feita_em) ? `<small>(chegou ${hora(a.recebida_em)})</small>` : ""}
        <p>${esc(a.motivo)}</p></div>
      <button class="btn ghost" data-vivo-visto="${esc(a.id)}">Marcar visto</button>
    </div>`).join("")}
  </section>`;
}
