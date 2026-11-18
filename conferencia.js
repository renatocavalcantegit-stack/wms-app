// WMS Beach Bike — Conferência (desktop, leitor de código de barras tipo "caixa")
import { SETORES, session, setSetor } from "./js/sessao.js";
import { sairDoAparelho } from "./js/sair.js";
import { find } from "./js/demo-dados.js";
import { consultaDeCheckout } from "./js/dados/estoque.js";
import { validarQuantidadeLida } from "./compartilhado/regras/produtos.js";
import { VOL_TIPOS, obsTotal, obsErp, obsResumo } from "./compartilhado/regras/volumes.js";
import { carregarConferencia, salvarConferencia, prepararParaConferencia, lerPosto, salvarPosto, aoMudarConferencia } from "./js/dados/conferencia.js";
import { registrarDevolucao } from "./js/dados/movimentacao.js";
import { lerEstoque } from "./js/dados/estoque.js";
import { acharEndereco } from "./compartilhado/regras/enderecos.js";
import { ehAguardando, ehPrioridade } from "./compartilhado/regras/aguardando.js";
import { lerDevolucao, faltaTirar, faltaPostar, devolucaoPendente, validarDocaDevolucao, MOTIVOS_OCORRENCIA } from "./compartilhado/regras/ocorrencias.js";
import { Etiqueta } from "./etiqueta.js";
import { lerQuantidade, quantidadePositiva, arredondarQtd as arr, formatarQtd as fq } from "./compartilhado/regras/quantidade.js";
import { $, $$, esc } from "./js/util.js";

(() => {
  "use strict";

  // acesso exclusivo do perfil Conferência
  const sess = session();
  if (!sess || sess.perfil !== "conf") { location.replace("./"); return; }
  const user = sess.nome;

  // setor: Expedição (volumes, observação, etiquetas) ou Montagem (pedidos OP, sem volumes/etiquetas)
  const SEM_SETOR = !sess.setor;
  const SETOR = sess.setor || "exp", MONT = SETOR === "mont";
  // prioridade: na expedição só o aguardando; na Montagem, a do Sankhya (compartilhado/regras/aguardando.js)
  const prioridade = (o) => ehPrioridade(o, SETOR);
  document.body.classList.toggle("setor-mont", MONT);

  // aparelho de toque (celular/tablet): sem foco automático e com câmera
  const TOUCH = matchMedia("(pointer: coarse)").matches;

  // ---------- estado ----------
  let db = load();
  let queueFilter = "aguardando";
  let cur = null; // pedido aberto

  // onde os pedidos ficam guardados é assunto da camada de dados (js/dados/conferencia.js),
  // que também traz os pedidos concluídos na Separação
  function load() { return carregarConferencia(SETOR); }
  const save = () => salvarConferencia(SETOR, db);

  // ---------- utils ----------
  // $, $$ e esc vêm de js/util.js; aviso e bipe da conferência têm duração e tom próprios
  const sum = (a, f) => a.reduce((t, x) => t + f(x), 0);

  let toastT;
  function toast(m) { const t = $("#toast"); t.textContent = m; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 2400); }

  let actx;
  function beep(ok = true) {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const o = actx.createOscillator(), g = actx.createGain(), d = ok ? 0.09 : 0.35;
      o.frequency.value = ok ? 1500 : 200; o.type = ok ? "sine" : "square";
      g.gain.setValueAtTime(0.1, actx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + d);
      o.connect(g).connect(actx.destination); o.start(); o.stop(actx.currentTime + d);
    } catch {}
  }

  setInterval(() => ($("#clock").textContent = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })), 1000);
  $("#clock").textContent = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  $("#station").value = lerPosto();
  $("#station").addEventListener("change", (e) => salvarPosto(e.target.value));

  // ---------- cálculo por item ----------
  function itemState(o, i) {
    const c = o.conf.itens[i.sku] || 0;
    if (c === i.sep) return i.sep === 0 ? "ok" : "ok";
    if (c > i.sep) return "excesso";
    return c === 0 ? "pendente" : "parcial";
  }
  function stats(o) {
    const st = o.itens.map((i) => itemState(o, i));
    return {
      itensOk: st.filter((s) => s === "ok").length,
      itens: o.itens.length,
      un: arr(sum(o.itens, (i) => o.conf.itens[i.sku] || 0) + sum(o.conf.fora, (f) => f.q)),
      unT: arr(sum(o.itens, (i) => i.sep)),
      div: st.filter((s) => s === "excesso").length + o.conf.fora.length,
      pend: st.filter((s) => s === "pendente" || s === "parcial").length,
    };
  }

  // ---------- fila ----------
  // onde o separador deixou a mercadoria. Pedido dividido: uma doca por parte.
  function docasDo(o) {
    if (o.partes && o.partes.length) return o.partes.map((p) => `<span class="doca-chip" title="Parte ${p.n}/${p.de} · ${esc(p.operador || "")}">${p.n}/${p.de} ${p.doca ? p.doca.codigo : "—"}</span>`).join("");
    return o.doca ? `<span class="doca-chip">${o.doca.codigo}</span>` : `<span class="muted">—</span>`;
  }
  function renderQueue() {
    const ag = db.orders.filter((o) => o.conf.status === "aguardando" || o.conf.status === "andamento");
    const cf = db.orders.filter((o) => o.conf.status === "conferido" || o.conf.status === "divergente");
    $("#qCountA").textContent = ag.length;
    $("#qCountC").textContent = cf.length;
    const list = (queueFilter === "aguardando" ? ag : cf).sort((a, b) =>
      (a.conf.status === "andamento" ? -1 : 0) - (b.conf.status === "andamento" ? -1 : 0) || (prioridade(a) ? -1 : 1) - (prioridade(b) ? -1 : 1));

    $("#queueBody").innerHTML = list.map((o) => {
      const faltaSep = o.itens.some((i) => i.status === "falta");
      const tag = o.cancelado ? `<span class="tag div">Cancelado · devolver</span>`
        : o.conf.reaberto && o.conf.status === "aguardando" ? `<span class="tag parcial">Reaberto pelo gestor</span>`
        : o.conf.status === "andamento" ? `<span class="tag andamento">Em conferência</span>`
        : o.conf.status === "conferido" ? `<span class="tag ok">Conferido${MONT ? " · p/ montagem" : ` · ${o.conf.volumes} vol.`}</span>`
        : o.conf.status === "divergente" ? `<span class="tag div">Com divergência${MONT ? "" : ` · ${o.conf.volumes} vol.`}</span>`
        : faltaSep ? `<span class="tag parcial">Falta na separação</span>`
        : ehAguardando(o) ? `<span class="tag alta">Aguardando · cliente retira</span>`
        : prioridade(o) ? `<span class="tag alta">Prioridade</span>` : `<span class="tag">Na fila</span>`;
      return `<tr data-id="${o.id}">
        <td class="pid">${o.id}</td><td>${esc(o.cliente)}</td><td class="muted">${o.cidade}</td>
        <td class="r">${o.itens.length}</td><td class="r strong">${sum(o.itens, (i) => i.sep)}</td>
        <td>${esc(o.operador || "—")}</td><td class="doca-cel">${docasDo(o)}</td><td>${tag}${o.conf.volumes && o.conf.fim ? `<button class="lb-btn" data-print="${o.id}">Etiquetas</button>` : ""}</td></tr>`;
    }).join("");
    $("#queueEmpty").hidden = list.length > 0;
    $("#queueEmpty").textContent = queueFilter === "aguardando" ? "Nenhum pedido aguardando conferência." : "Nenhum pedido conferido ainda.";
  }

  $(".seg").addEventListener("click", (e) => {
    const b = e.target.closest(".seg-b"); if (!b) return;
    queueFilter = b.dataset.q;
    $$(".seg-b").forEach((x) => x.classList.toggle("active", x === b));
    renderQueue(); focusScan();
  });
  $("#queueBody").addEventListener("click", (e) => {
    const pb = e.target.closest("[data-print]");
    if (pb) return openPrint(db.orders.find((o) => o.id === pb.dataset.print));
    const tr = e.target.closest("tr"); if (!tr) return;
    openOrder(db.orders.find((o) => o.id === tr.dataset.id));
  });

  function showQueue() {
    cur = null; devolvendo = false; document.body.classList.remove("cf-devolvendo");
    $("#queue").hidden = false; $("#order").hidden = true;
    $("#scan").placeholder = "Bipe o pedido…";
    setLast({ label: "Aguardando leitura", desc: "Bipe o código do pedido para começar", code: " ", conf: "—", exp: "—" });
    setMsg("Leitor pronto");
    renderTotals();
    renderQueue(); focusScan();
  }

  // ---------- pedido ----------
  function openOrder(o) {
    if (!o) return;
    if (o.conf.status === "conferido" || o.conf.status === "divergente") {
      if (!confirm(`${o.id} já foi conferido. Conferir novamente?`)) return focusScan();
      Object.assign(o, prepararParaConferencia(o));
    }
    if (o.conf.status === "aguardando") { o.conf.status = "andamento"; o.conf.inicio = Date.now(); o.conf.conferente = user; save(); }
    cur = o; devolvendo = false; document.body.classList.remove("cf-devolvendo");
    $("#queue").hidden = true; $("#order").hidden = false;
    $("#oId").textContent = o.id;
    $("#oClient").textContent = o.cliente;
    $("#oSub").innerHTML = `${esc(o.cidade)} · separado por ${esc(o.operador || "—")} · ${o.itens.length} itens · ${o.partes && o.partes.length ? "pegar nas docas " : "pegar na doca "}${docasDo(o)}`;
    const t = $("#oTag");
    t.className = "tag " + (prioridade(o) ? "alta" : "");
    t.textContent = ehAguardando(o) ? "Aguardando · cliente retira" : prioridade(o) ? "Prioridade" : "Normal";
    $("#scan").placeholder = "Bipe o produto…";
    setLast({ label: "Pedido aberto", desc: `${o.cliente}`, code: o.id, conf: "—", exp: "—" });
    const dev = devolucaoPendente(o.itens, o.conf.postado);
    setMsg(dev ? `Pedido ${o.id}: tem mercadoria para devolver (F9)` : `Pedido ${o.id} carregado · bipe os produtos`, dev ? "err" : "ok");
    beep(true);
    renderItems(); renderTotals(); focusScan();
  }

  function renderItems(flashSku) {
    const o = cur, checkout = consultaDeCheckout();
    const rows = o.itens.map((i) => {
      const s = itemState(o, i), c = o.conf.itens[i.sku] || 0;
      const label = { ok: "Conferido", parcial: `Faltam ${fq(arr(i.sep - c))}`, excesso: `Excesso +${fq(arr(c - i.sep))}`, pendente: "Pendente" }[s];
      const sepWarn = (i.sep < i.qtd ? `<span class="sub-warn">falta na separação (${i.motivo || "—"})</span>` : "")
        + (i.devolver > 0 ? `<span class="sub-warn">sai da caixa: ${fq(i.devolver)} un. (devolução)</span>` : "");
      return `<tr class="${s} ${flashSku === i.sku ? "flash" : ""}" data-sku="${i.sku}">
        <td><span class="s-dot"></span></td>
        <td class="code"><b>${i.sku}</b>${i.ean}</td>
        <td>${esc(i.desc)}${checkout(i.sku) ? `<span class="ck-tag">Checkout</span>` : `<span class="ck-tag granel">Granel · digite a quantidade</span>`}${sepWarn}</td>
        <td><span class="addr-chip">${i.end}</span></td>
        <td class="r">${fq(i.qtd)}</td><td class="r strong">${fq(i.sep)}</td>
        <td class="r conf">${fq(c)}</td>
        <td>${s === "pendente" ? `<span class="tag">${label}</span>` : `<span class="tag ${s}">${label}</span>`}</td></tr>`;
    });
    const fora = o.conf.fora.map((f) => `<tr class="fora ${flashSku === f.sku ? "flash" : ""}">
        <td><span class="s-dot"></span></td><td class="code"><b>${f.sku}</b>${f.ean}</td><td>${esc(f.desc)}</td>
        <td>—</td><td class="r">0</td><td class="r strong">0</td><td class="r conf">${fq(f.q)}</td>
        <td><span class="tag fora">Fora do pedido</span></td></tr>`);
    $("#itemsBody").innerHTML = rows.concat(fora).join("");
    const fl = $("#itemsBody tr.flash"); if (fl) fl.scrollIntoView({ block: "nearest", behavior: "smooth" });
    renderDevolucao();
  }

  function renderTotals() {
    const s = cur ? stats(cur) : { itensOk: 0, itens: 0, un: 0, unT: 0, div: 0, pend: 0 };
    $("#tItens").textContent = s.itensOk; $("#tItensT").textContent = s.itens;
    $("#tUn").textContent = s.un; $("#tUnT").textContent = s.unT;
    $("#tDiv").textContent = s.div;
    $(".tot.warn").classList.toggle("has", s.div > 0);
    const pct = s.itens ? (s.itensOk / s.itens) * 100 : 0;
    $("#prog").style.width = pct + "%";
    $(".pos-prog").classList.toggle("full", s.itens > 0 && pct === 100);
    $("#btnFinish").disabled = !cur;
    $("#btnFinishM").disabled = !cur;
  }

  function setLast({ label, desc, code, conf, exp, kind = "" }) {
    $("#lastLabel").textContent = label; $("#lastDesc").textContent = desc; $("#lastCode").textContent = code;
    $("#lastConf").textContent = conf; $("#lastExp").textContent = exp;
    const l = $(".last"); l.classList.remove("ok", "err"); void l.offsetWidth; if (kind) l.classList.add(kind);
  }
  function setMsg(t, k = "") { const m = $("#scanMsg"); m.textContent = t; m.className = "pos-msg " + k; }

  // ---------- leitura ----------
  function handle(raw) {
    let code = raw.trim(); if (!code) return;
    // quantidade informada pode ser quebrada (granel): F4 com 2,5 ou "2,5*código"
    const mult = lerQuantidade($("#mult").value);
    let q = quantidadePositiva(mult) ? mult : 1;
    const m = code.match(/^(\d{1,3}(?:[.,]\d{1,3})?)\*(.+)$/);
    if (m) { q = lerQuantidade(m[1]); code = m[2].trim(); }
    if (!quantidadePositiva(q)) { setMsg("Quantidade inválida. Use até 3 casas depois da vírgula (ex.: 2,5).", "err"); beep(false); resetMult(); return; }
    const informada = !!m || q !== 1; // o conferente informou quantidade (F4 ou 5*código)?
    resetMult();
    if (cur && devolvendo) return lerNaDevolucao(code, q);

    // código de pedido?
    const num = (x) => x.trim().toUpperCase().replace(/^(PV|OP)-?/, "");
    const pid = num(code.split("|")[0]);
    const ord = db.orders.find((o) => num(o.id) === pid);
    if (ord && (!cur || !find(code))) {
      if (cur && cur !== ord) { setMsg(`Finalize ou volte à fila (F2) antes de abrir ${ord.id}.`, "err"); beep(false); return; }
      if (!cur) return openOrder(ord);
      if (cur === ord) { setMsg(`Pedido ${ord.id} já está aberto.`); return; }
    }

    if (!cur) { setMsg("Bipe primeiro o código do pedido.", "err"); beep(false); errLast("Código não é um pedido", code); return; }

    const p = find(code);
    if (!p) { setMsg("Código não cadastrado.", "err"); beep(false); errLast("Código não cadastrado", code); return; }

    // CHECKOUT (padrão): cada bipe é 1 unidade, quantidade informada é recusada.
    // GRANEL (checkout desligado pelo gestor): sem quantidade informada, o sistema pede a quantidade.
    const checkout = consultaDeCheckout()(p.sku);
    const recusa = validarQuantidadeLida(checkout, q);
    if (recusa) {
      setMsg(recusa, "err"); beep(false);
      setLast({ label: "Checkout: bipe cada unidade", desc: p.desc, code: `${p.sku} · ${p.ean || "sem EAN"}`, conf: cur.conf.itens[p.sku] || 0, exp: cur.itens.find((i) => i.sku === p.sku)?.sep ?? 0, kind: "err" });
      return;
    }
    if (!checkout && !informada) return pedirQuantidade(p);
    aplicar(p, q);
  }

  // produto a granel: o campo de quantidade abre com o que falta conferir; Enter lança
  let granel = null;
  function pedirQuantidade(p) {
    granel = p;
    const it = cur.itens.find((i) => i.sku === p.sku);
    const resta = it ? arr(it.sep - (cur.conf.itens[p.sku] || 0)) : 0;
    $("#mult").value = fq(resta > 0 ? resta : 1); $(".pos-mult").classList.add("on", "granel");
    setLast({ label: "Granel: digite a quantidade", desc: p.desc, code: `${p.sku} · ${p.ean || "sem EAN"}`, conf: cur.conf.itens[p.sku] || 0, exp: it ? it.sep : 0, kind: "" });
    setMsg(`Produto a granel: digite a quantidade de ${p.sku} e tecle Enter.`);
    $("#mult").focus(); $("#mult").select();
  }

  function aplicar(p, q) {
    const it = cur.itens.find((i) => i.sku === p.sku);
    if (it) {
      cur.conf.itens[p.sku] = arr((cur.conf.itens[p.sku] || 0) + q);
      cur.conf.log.push({ sku: p.sku, q, fora: false });
      const c = cur.conf.itens[p.sku], s = itemState(cur, it);
      const okish = s === "ok" || s === "parcial";
      setLast({
        label: s === "ok" ? "Item completo ✓" : s === "excesso" ? "Excesso — retire do volume" : `Lido +${fq(q)}`,
        desc: p.desc, code: `${p.sku} · ${p.ean || "sem EAN"}`, conf: c, exp: it.sep, kind: okish ? "ok" : "err",
      });
      setMsg(s === "excesso" ? `Excesso de ${fq(arr(c - it.sep))} un. em ${p.sku}` : s === "ok" ? "Item conferido" : `Faltam ${fq(arr(it.sep - c))} un.`, okish ? "ok" : "err");
      beep(okish);
    } else {
      let f = cur.conf.fora.find((x) => x.sku === p.sku);
      if (!f) cur.conf.fora.push((f = { sku: p.sku, ean: p.ean, desc: p.desc, q: 0 }));
      f.q = arr(f.q + q);
      cur.conf.log.push({ sku: p.sku, q, fora: true });
      setLast({ label: "Produto fora do pedido", desc: p.desc, code: `${p.sku} · ${p.ean || "sem EAN"}`, conf: f.q, exp: 0, kind: "err" });
      setMsg("Este produto não pertence ao pedido — separe para devolução.", "err");
      beep(false);
    }
    save(); renderItems(p.sku); renderTotals();
  }

  function errLast(label, code) { setLast({ label, desc: "Verifique a etiqueta e bipe novamente", code, conf: "—", exp: "—", kind: "err" }); }

  $("#scanForm").addEventListener("submit", (e) => { e.preventDefault(); const v = $("#scan").value; $("#scan").value = ""; handle(v); });

  // multiplicador (F4)
  function resetMult() { $("#mult").value = 1; $(".pos-mult").classList.remove("on", "granel"); granel = null; }
  $("#mult").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (granel) {
      const p = granel, q = lerQuantidade($("#mult").value); // "2,5" → 2.5
      if (!quantidadePositiva(q)) { setMsg("Digite uma quantidade maior que zero (até 3 casas depois da vírgula).", "err"); beep(false); return; }
      resetMult(); aplicar(p, q); focusScan(); return;
    }
    $(".pos-mult").classList.toggle("on", lerQuantidade($("#mult").value) !== 1); focusScan();
  });

  // estornar (F6)
  function undo() {
    if (!cur || !cur.conf.log.length) { setMsg("Nada para estornar.", "err"); return; }
    const l = cur.conf.log.pop();
    if (l.fora) {
      const f = cur.conf.fora.find((x) => x.sku === l.sku);
      f.q = arr(f.q - l.q); if (f.q <= 0) cur.conf.fora.splice(cur.conf.fora.indexOf(f), 1);
    } else cur.conf.itens[l.sku] = Math.max(0, arr(cur.conf.itens[l.sku] - l.q));
    save(); renderItems(); renderTotals();
    const p = find(l.sku);
    setLast({ label: `Estornado −${fq(l.q)}`, desc: p.desc, code: p.sku, conf: l.fora ? "—" : cur.conf.itens[l.sku], exp: l.fora ? 0 : cur.itens.find((i) => i.sku === l.sku).sep });
    setMsg(`Última leitura estornada (${l.sku} −${fq(l.q)})`);
  }

  // ---------- devolução (item cortado ou pedido cancelado pelo gestor) ----------
  // F9 liga o modo devolução: cada bipe é uma unidade que SAI da caixa. Depois, o QR da doca de devolução
  // registra a entrada no estoque (o estoquista armazena pelo Armazenamento, como uma nota).
  let devolvendo = false;
  const temDevolucao = (o) => o.itens.some((i) => (i.devolver || 0) > 0);
  const tirado = (o, sku) => (o.conf.devolvido || {})[sku] || 0;
  const postado = (o, sku) => (o.conf.postado || {})[sku] || 0;

  function renderDevolucao() {
    const box = $("#cfDev");
    if (!cur || !temDevolucao(cur)) { box.hidden = true; return; }
    const ocorr = cur.cancelado || cur.conf.reaberto;
    const motivo = ocorr ? `${MOTIVOS_OCORRENCIA[ocorr.motivo] || ""} · Sankhya ${esc(ocorr.referencia)}` : "";
    const pend = devolucaoPendente(cur.itens, cur.conf.postado);
    box.hidden = false;
    box.className = "cf-dev" + (pend ? "" : " feito");
    box.innerHTML = `<div class="cf-dev-top"><b>${cur.cancelado ? "Pedido cancelado · tudo sai da caixa" : "Sai da caixa (corte do gestor)"}</b>
      <span>${motivo}</span>
      ${pend ? `<button id="btnDevolver" class="lb-btn">${devolvendo ? "Sair da devolução" : "Devolver"} <kbd>F9</kbd></button>` : `<span class="cf-dev-ok">Devolução registrada</span>`}</div>
      ${cur.itens.filter((i) => i.devolver > 0).map((i) => `<div class="cf-dev-row"><b>${i.sku}</b><span>${esc(i.desc)}</span>
        <span>tirar <b>${i.devolver}</b> · tirado <b>${tirado(cur, i.sku)}</b> · na doca <b>${postado(cur, i.sku)}</b></span></div>`).join("")}`;
  }
  $("#cfDev").addEventListener("click", (e) => { if (e.target.closest("#btnDevolver")) alternarDevolucao(); });

  function alternarDevolucao() {
    if (!cur || !devolucaoPendente(cur.itens, cur.conf.postado)) { setMsg("Este pedido não tem nada a devolver.", "err"); beep(false); return; }
    devolvendo = !devolvendo;
    document.body.classList.toggle("cf-devolvendo", devolvendo);
    $("#scan").placeholder = devolvendo ? "Bipe o que SAI da caixa… depois o QR da doca de devolução" : "Bipe o produto…";
    setMsg(devolvendo ? "Modo devolução: bipe cada unidade que sai da caixa" : "Modo conferência", devolvendo ? "err" : "ok");
    renderDevolucao(); focusScan();
  }

  function lerNaDevolucao(code, q) {
    // QR da doca de devolução (ID ou código R…): o que já saiu da caixa entra no estoque
    const end = /^\d{5,}$/.test(code) || /^R\d+-P/i.test(code) ? acharEndereco(lerEstoque().enderecos, code) : null;
    if (end) return levarParaDoca(end);
    const p = find(code);
    if (!p) { setMsg("Código não cadastrado.", "err"); beep(false); errLast("Código não cadastrado", code); return; }
    const it = cur.itens.find((i) => i.sku === p.sku);
    const r = lerDevolucao(it, tirado(cur, p.sku), q);
    if (!r.ok) { setMsg(r.msg, "err"); beep(false); return; }
    cur.conf.devolvido = { ...(cur.conf.devolvido || {}), [p.sku]: arr(tirado(cur, p.sku) + r.qtd) };
    // a unidade que sai já tinha sido contada como "na caixa"? então desconta da contagem
    const sobra = arr((cur.conf.itens[p.sku] || 0) - it.sep);
    if (sobra > 0) cur.conf.itens[p.sku] = arr(cur.conf.itens[p.sku] - Math.min(sobra, r.qtd));
    save(); renderItems(p.sku); renderTotals();
    const falta = faltaTirar(it, tirado(cur, p.sku));
    setLast({ label: `Saiu da caixa −${fq(r.qtd)}`, desc: p.desc, code: p.sku, conf: tirado(cur, p.sku), exp: it.devolver, kind: "ok" });
    const tudo = cur.itens.every((i) => faltaTirar(i, tirado(cur, i.sku)) === 0);
    setMsg(tudo ? "Tudo separado · leia o QR da doca de devolução" : falta ? `Faltam ${fq(falta)} un. de ${p.sku} para tirar` : `${p.sku} completo`, "ok");
    beep(true);
  }

  function levarParaDoca(end) {
    const erro = validarDocaDevolucao(end);
    if (erro) { setMsg(erro, "err"); beep(false); return; }
    const itens = cur.itens.map((i) => ({ produto: i.sku, qtd: faltaPostar(tirado(cur, i.sku), postado(cur, i.sku)) })).filter((i) => i.qtd > 0);
    if (!itens.length) { setMsg("Nada tirado da caixa ainda. Bipe o que sai antes da doca.", "err"); beep(false); return; }
    const r = registrarDevolucao({ pedido: cur.id, itens, docaId: end.id, usuario: user });
    if (!r.ok) { setMsg(r.msg, "err"); beep(false); return; }
    cur.conf.postado = { ...(cur.conf.postado || {}) };
    itens.forEach((i) => (cur.conf.postado[i.produto] = (cur.conf.postado[i.produto] || 0) + i.qtd));
    save();
    const pend = devolucaoPendente(cur.itens, cur.conf.postado);
    if (!pend) { devolvendo = false; document.body.classList.remove("cf-devolvendo"); $("#scan").placeholder = "Bipe o produto…"; }
    renderItems(); renderTotals();
    setMsg(`${itens.reduce((t, i) => t + i.qtd, 0)} un. na ${end.codigo}${pend ? " · ainda falta devolver" : cur.cancelado ? " · finalize para encerrar o pedido (F10)" : " · continue a conferência"}`, "ok");
    beep(true);
  }

  // pedido cancelado: depois da devolução, encerra sem volumes nem etiquetas (não vai para o embarque)
  function encerrarCancelado() {
    Object.assign(cur.conf, { status: "cancelado", fim: Date.now(), conferente: user });
    const id = cur.id;
    save(); showQueue(); toast(`${id} encerrado como cancelado`);
  }

  // o gestor mudou o pedido em outra tela: recarrega a fila e o pedido aberto
  aoMudarConferencia(SETOR, () => {
    const id = cur?.id;
    db = load();
    if (!id) return renderQueue();
    const o = db.orders.find((x) => x.id === id);
    if (!o || o.conf.status === "cancelado") { showQueue(); toast(`${id} cancelado pelo gestor`); return; }
    cur = o;
    renderItems(); renderTotals();
    setMsg("O gestor alterou este pedido", "err"); beep(false);
  });

  function restart() {
    if (!cur || !confirm(`Zerar todas as leituras de ${cur.id}?`)) return focusScan();
    const keep = { ...cur.conf, itens: {}, fora: [], log: [] };
    cur.itens.forEach((i) => (keep.itens[i.sku] = 0));
    cur.conf = keep; save(); renderItems(); renderTotals();
    setMsg("Conferência reiniciada"); focusScan();
  }

  // ---------- finalizar ----------
  // fin: pedido em finalização { o, fix (correção de volumes já conferidos), vol }
  let fin = null;
  function openFinish() {
    if (!cur) return;
    // o que o gestor cortou tem que sair da caixa e entrar na doca de devolução antes de fechar
    if (devolucaoPendente(cur.itens, cur.conf.postado)) { setMsg("Faça a devolução antes de finalizar (F9).", "err"); beep(false); return; }
    if (cur.cancelado) return encerrarCancelado();
    fin = { o: cur, fix: false, vol: 0 };
    const s = stats(cur);
    const rows = [];
    cur.itens.forEach((i) => {
      const c = cur.conf.itens[i.sku] || 0, st = itemState(cur, i);
      if (st === "ok") return;
      rows.push(`<div class="f-row"><span class="tag ${st === "pendente" ? "parcial" : st}">${st === "excesso" ? "Excesso" : "Falta"}</span><span>${esc(i.desc)}</span><b>${fq(c)}/${fq(i.sep)}</b></div>`);
    });
    cur.conf.fora.forEach((f) => rows.push(`<div class="f-row"><span class="tag fora">Fora</span><span>${esc(f.desc)}</span><b>+${fq(f.q)}</b></div>`));
    const div = rows.length > 0;
    $("#fTitle").textContent = div ? "Finalizar com divergência?" : "Finalizar conferência";
    $("#fSub").textContent = `${cur.id} · ${cur.cliente} · ${fq(s.un)} de ${fq(s.unT)} unidades conferidas${MONT ? " · segue para a montagem" : ""}`;
    $("#fVolF").hidden = MONT;
    $("#fDiv").innerHTML = rows.join("");
    $("#fGo").className = "btn " + (div ? "danger" : "primary");
    $("#fGo").innerHTML = (div ? "Finalizar com divergência" : "Confirmar") + " <kbd>Enter</kbd>";
    $("#fVol").value = cur.conf.volumes || Math.max(1, Math.ceil(s.un / 10));
    openModal("mFinish");
    setTimeout(() => (MONT ? $("#fGo").focus() : $("#fVol").select()), 30);
  }
  $("#btnFinish").addEventListener("click", openFinish);
  $("#btnFinishM").addEventListener("click", openFinish);

  // botões equivalentes às teclas F (uso no celular / sem teclado)
  $("#aQueue").addEventListener("click", showQueue);
  $("#aUndo").addEventListener("click", () => { undo(); focusScan(); });
  $("#aRestart").addEventListener("click", restart);

  // ---------- câmera (celular, quando o navegador suporta) ----------
  let stream, detecting = false;
  $("#camBtn").hidden = !("BarcodeDetector" in window && TOUCH);
  $("#camBtn").addEventListener("click", async () => {
    try {
      const det = new window.BarcodeDetector({ formats: ["ean_13", "ean_8", "code_128", "code_39", "qr_code", "upc_a"] });
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      const v = $("#camVideo"); v.srcObject = stream; await v.play();
      $("#camView").hidden = false; detecting = true;
      const loop = async () => {
        if (!detecting) return;
        try { const r = await det.detect(v); if (r.length) { stopCam(); handle(r[0].rawValue); return; } } catch {}
        requestAnimationFrame(loop);
      };
      loop();
    } catch { toast("Não foi possível abrir a câmera"); stopCam(); }
  });
  function stopCam() {
    detecting = false;
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null; $("#camView").hidden = true;
  }
  $("#camClose").addEventListener("click", stopCam);

  // corrigir volumes de um pedido já conferido (a partir das etiquetas): refaz quantidade + observação
  function openFix(o) {
    fin = { o, fix: true, vol: 0 };
    $("#fTitle").textContent = "Corrigir volumes";
    $("#fSub").textContent = `${o.id} · ${o.cliente} · a observação dos volumes será refeita e reenviada ao Sankhya`;
    $("#fDiv").innerHTML = "";
    $("#fVolF").hidden = false;
    $("#fGo").className = "btn primary";
    $("#fGo").innerHTML = "Continuar <kbd>Enter</kbd>";
    $("#fVol").value = o.conf.volumes || 1;
    openModal("mFinish");
    setTimeout(() => $("#fVol").select(), 30);
  }

  // ---------- observação dos volumes (obrigatória; a soma tem que bater com a quantidade) ----------
  let obsDraft = null;
  function goObs() {
    if (!fin) return;
    // montagem: sem volumes, observação e etiquetas — finaliza direto
    if (MONT && !fin.fix) { fin.vol = 0; return doFinish(); }
    fin.vol = Math.min(99, Math.max(1, parseInt($("#fVol").value, 10) || 1));
    const prev = fin.o.conf.obs;
    // reaproveita o que já foi descrito (voltar / corrigir volumes)
    obsDraft = prev ? { tipos: { ...prev.tipos }, outro: prev.outro || "", atencao: prev.atencao || "" } : { tipos: {}, outro: "", atencao: "" };
    $("#oSub").textContent = `${fin.o.id} · ${fin.o.cliente} · ${fin.vol} volume${fin.vol > 1 ? "s" : ""}`;
    $("#oOutro").value = obsDraft.outro;
    $("#oAt").value = obsDraft.atencao;
    renderObs();
    openModal("mObs");
    // tira o foco do campo de quantidade (senão as teclas 1–9 iriam para ele)
    if (document.activeElement) document.activeElement.blur();
    $("#mObs").focus();
  }
  const obsOk = () => obsTotal(obsDraft) === fin.vol && !(obsDraft.tipos.outro > 0 && !obsDraft.outro.trim());
  function renderObs() {
    const t = obsTotal(obsDraft), v = fin.vol;
    $("#oTipos").innerHTML = VOL_TIPOS.map(([id, nome], i) => {
      const n = obsDraft.tipos[id] || 0;
      return `<div class="o-tipo ${n ? "on" : ""}">
        <button class="o-add" data-add="${id}"><kbd>${i + 1}</kbd><span>${nome}</span></button>
        <div class="o-q"><button class="o-m" data-sub="${id}" ${n ? "" : "disabled"} aria-label="Menos">−</button><b>${n}</b><button class="o-p" data-add="${id}" aria-label="Mais">+</button></div>
      </div>`;
    }).join("");
    const outro = (obsDraft.tipos.outro || 0) > 0;
    $("#oOutroF").hidden = !outro;
    $("#oCount").className = "o-count " + (t === v ? "ok" : t > v ? "over" : "");
    $("#oCount").innerHTML = `<b>${t} de ${v}</b><span>${t === v ? "volumes descritos" : t > v ? `${t - v} a mais que a quantidade` : `falta${v - t > 1 ? "m" : ""} ${v - t}`}</span>`;
    $("#oErp").textContent = t ? obsErp(obsDraft) : "—";
    const ok = obsOk();
    $("#oGo").disabled = !ok;
    $("#oGo").title = ok ? "" : outro && t === v ? 'Descreva o volume "Outro"' : `A soma dos volumes descritos (${t}) tem que ser igual à quantidade de volumes (${v})`;
  }
  function obsStep(id, d) {
    const n = Math.max(0, (obsDraft.tipos[id] || 0) + d);
    if (n) obsDraft.tipos[id] = n; else delete obsDraft.tipos[id];
    renderObs();
    if (id === "outro" && d > 0 && n === 1) setTimeout(() => $("#oOutro").focus(), 0);
  }
  $("#oTipos").addEventListener("click", (e) => {
    const a = e.target.closest("[data-add]"), m = e.target.closest("[data-sub]");
    if (a) obsStep(a.dataset.add, 1); else if (m) obsStep(m.dataset.sub, -1);
  });
  $("#oOutro").addEventListener("input", () => { obsDraft.outro = $("#oOutro").value; renderObs(); });
  $("#oAt").addEventListener("input", () => { obsDraft.atencao = $("#oAt").value; renderObs(); });
  $("#oBack").addEventListener("click", () => openModal("mFinish"));
  $("#oGo").addEventListener("click", confirmObs);

  function confirmObs() {
    if (!obsOk()) { beep(false); toast(obsTotal(obsDraft) !== fin.vol ? `Descreva os ${fin.vol} volumes antes de continuar` : 'Descreva o volume "Outro"'); return; }
    const o = fin.o, tipos = {};
    Object.entries(obsDraft.tipos).forEach(([k, n]) => { if (n > 0) tipos[k] = n; });
    o.conf.obs = { tipos, outro: tipos.outro ? obsDraft.outro.trim() : "", atencao: obsDraft.atencao.trim(), por: user, em: Date.now() };
    o.conf.volumes = fin.vol;
    // integração (simulada): grava o bloco [WMS] na observação do pedido no Sankhya, sem apagar a do vendedor,
    // e a quantidade de volumes no cabeçalho (sai na NF-e)
    o.conf.erp = { observacao: obsErp(o.conf.obs), qtdVolumes: fin.vol, enviado: Date.now() };
    if (fin.fix) {
      save(); fin = null;
      openPrint(o, printThenQueue);
      toast(`Volumes de ${o.id} corrigidos · observação reenviada ao Sankhya`);
      return;
    }
    doFinish();
  }

  function doFinish() {
    const s = stats(cur), div = s.div > 0 || s.pend > 0;
    Object.assign(cur.conf, { status: div ? "divergente" : "conferido", fim: Date.now(), posto: $("#station").value, conferente: user, volumes: fin.vol });
    fin = null;
    save();
    const mins = Math.max(1, Math.round((cur.conf.fim - cur.conf.inicio) / 60000));
    $("#mDone").classList.toggle("mont", MONT);
    if (MONT) {
      $("#dTitle").textContent = div ? "Conferido com divergência" : "Pedido conferido";
      $("#dSub").textContent = `${cur.id} · ${s.un} un. · ${mins} min · liberado para a montagem`;
      $("#dObs").textContent = "";
      $("#mDone .done-check").style.filter = div ? "hue-rotate(-110deg) saturate(1.6)" : "";
      openModal("mDone"); beep(true);
      toast(`${cur.id} liberado para a montagem`);
      return;
    }
    $("#dTitle").textContent = div ? "Conferido com divergência" : "Pedido conferido";
    $("#dSub").textContent = `${cur.id} · ${cur.conf.volumes} volume(s) · ${s.un} un. · ${mins} min`;
    $("#dObs").textContent = obsResumo(cur.conf.obs);
    $("#dPrint").innerHTML = `Imprimir ${cur.conf.volumes} etiqueta${cur.conf.volumes > 1 ? "s" : ""} <kbd>Enter</kbd>`;
    $("#mDone .done-check").style.filter = div ? "hue-rotate(-110deg) saturate(1.6)" : "";
    openModal("mDone");
    beep(true);
    toast("Observação dos volumes gravada no pedido do Sankhya");
  }
  $("#fGo").addEventListener("click", goObs);
  $("#dGo").addEventListener("click", () => { closeModal(); showQueue(); });
  $("#dPrint").addEventListener("click", printDone);
  $("#dPreview").addEventListener("click", () => openPrint(cur, true));

  // ---------- etiquetas ----------
  let printOrder = null, printThenQueue = false;
  function printDone() {
    const o = cur;
    Etiqueta.print(o, () => { closeModal(); showQueue(); toast(`Etiquetas de ${o.id} enviadas para impressão`); });
  }
  function openPrint(o, fromDone = false) {
    if (!o) return;
    printOrder = o; printThenQueue = fromDone;
    $("#pVol").textContent = o.conf.volumes || 1;
    $("#pObs").hidden = !o.conf.obs;
    if (o.conf.obs) $("#pObs").innerHTML = `<b>Volumes:</b> ${esc(obsResumo(o.conf.obs))}${o.conf.obs.atencao ? ` · <b>Atenção:</b> ${esc(o.conf.obs.atencao)}` : ""}`;
    renderPreview();
    openModal("mPrint");
  }
  function renderPreview() {
    const o = printOrder;
    $("#pSub").textContent = `${o.id} · ${o.cliente} · 80 × 60 mm`;
    $("#pPreview").innerHTML = Etiqueta.render(o);
  }
  // a quantidade não é mais editada aqui: corrigir refaz quantidade + observação (a soma tem que bater)
  $("#pFix").addEventListener("click", () => openFix(printOrder));
  function doPrint() {
    const o = printOrder, back = printThenQueue;
    Etiqueta.print(o, () => {
      closeModal();
      if (back) showQueue(); else renderQueue();
      toast(`Etiquetas de ${o.id} enviadas para impressão`);
    });
  }
  $("#pGo").addEventListener("click", doPrint);

  // ---------- modais ----------
  let modal = null;
  function openModal(id) { modal = id; $("#modalScrim").hidden = false; $$(".modal").forEach((m) => (m.hidden = m.id !== id)); }
  function closeModal() { modal = null; $("#modalScrim").hidden = true; $$(".modal").forEach((m) => (m.hidden = true)); focusScan(); }
  $$("[data-close]").forEach((b) => b.addEventListener("click", closeModal));
  $("#modalScrim").addEventListener("click", () => { if (!(modal === "mSetor" && SEM_SETOR)) closeModal(); });

  // usuário logado / sair
  $("#opBtn").addEventListener("click", () => { $("#opUser").textContent = user; $("#opSetor").textContent = SETORES[SETOR]; openModal("mOp"); });

  // ---------- setor ----------
  function openSetor() {
    $$("#mSetor .sx-opt").forEach((b) => b.classList.toggle("cur", !SEM_SETOR && b.dataset.setor === SETOR));
    $("#sxBack").hidden = SEM_SETOR; $("#sxOut").hidden = !SEM_SETOR;
    openModal("mSetor");
  }
  function pickSetor(x) {
    if (!SEM_SETOR && x === SETOR) { closeModal(); return; }
    if (cur && cur.conf.status === "andamento") toast(`${cur.id} fica em conferência na ${SETORES[SETOR]}`);
    setSetor(x); location.reload();
  }
  $("#mSetor .sx-opts").addEventListener("click", (e) => { const b = e.target.closest("[data-setor]"); if (b) pickSetor(b.dataset.setor); });
  // Sair: com servidor, avisa o servidor (login único: libera a entrada em outro aparelho). Ver js/sair.js
  async function sair() {
    const r = await sairDoAparelho({ sessao: session() });
    if (r.ok) location.replace("./"); else if (r.mensagem) toast(r.mensagem);
  }
  $("#sxOut").addEventListener("click", sair);
  $("#setorBtn").addEventListener("click", openSetor);
  $("#opSetorBtn").addEventListener("click", openSetor);
  $("#setorT").textContent = SETORES[SETOR];
  $("#setorBtn").classList.toggle("mont", MONT);
  $("#setorBtn").hidden = SEM_SETOR;
  if (MONT) { $("#dGo").className = "btn primary"; $("#dGo").innerHTML = "Voltar à fila <kbd>Enter</kbd>"; }
  $("#opLogout").addEventListener("click", sair);

  // ---------- foco do leitor + atalhos ----------
  function focusScan() { if (!modal && !TOUCH) $("#scan").focus(); }
  document.addEventListener("click", (e) => {
    if (modal) return;
    if (e.target.closest("input, select, button, a, tr")) { if (!e.target.closest("input, select")) setTimeout(focusScan, 0); return; }
    focusScan();
  });

  document.addEventListener("keydown", (e) => {
    if (modal) {
      if (modal === "mSetor") {
        if (e.key === "1" || e.key === "2") { e.preventDefault(); pickSetor(e.key === "1" ? "exp" : "mont"); }
        else if (e.key === "Escape" && !SEM_SETOR) { e.preventDefault(); closeModal(); }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        if (modal === "mObs") { openModal("mFinish"); return; }
        if (modal === "mFinish" && fin && fin.fix) { const o = fin.o; fin = null; openPrint(o, printThenQueue); return; }
        const back = modal === "mDone" || (modal === "mPrint" && printThenQueue);
        closeModal(); if (back) showQueue();
      }
      if (e.key === "Enter" && modal === "mFinish") { e.preventDefault(); goObs(); }
      else if (e.key === "Enter" && modal === "mObs") { e.preventDefault(); if (e.target.id === "oBack") openModal("mFinish"); else confirmObs(); }
      else if (modal === "mObs" && /^[1-9]$/.test(e.key) && !e.target.closest("input")) {
        e.preventDefault(); const t = VOL_TIPOS[+e.key - 1]; if (t) obsStep(t[0], e.altKey ? -1 : 1);
      }
      else if (e.key === "Enter" && modal === "mDone") { e.preventDefault(); if (MONT) { closeModal(); showQueue(); } else printDone(); }
      else if (e.key === "Enter" && modal === "mPrint" && !e.target.closest("button")) { e.preventDefault(); doPrint(); }
      return;
    }
    switch (e.key) {
      case "F2": e.preventDefault(); showQueue(); break;
      case "F4": e.preventDefault(); $("#mult").select(); $("#mult").focus(); break;
      case "F6": e.preventDefault(); undo(); break;
      case "F8": e.preventDefault(); restart(); break;
      case "F9": e.preventDefault(); alternarDevolucao(); break;
      case "F10": e.preventDefault(); openFinish(); break;
      case "Escape": $("#scan").value = ""; resetMult(); focusScan(); break;
      default:
        // leitor digitando sem foco no campo: redireciona
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && !e.target.closest("input, select")) focusScan();
    }
  });

  // ---------- início ----------
  $("#opName").textContent = user;
  const open = db.orders.find((o) => o.conf.status === "andamento");
  showQueue();
  if (SEM_SETOR) openSetor();
  else if (open) toast(`${open.id} está em conferência — clique para continuar`);
})();
