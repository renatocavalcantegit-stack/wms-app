// WMS Beach Bike — Conferência (desktop, leitor de código de barras tipo "caixa")
(() => {
  "use strict";

  const STORE = "wms-bb-conf-v1";
  const USER = "wms-bb-conf-user";
  const W = window.WMS;

  // ---------- estado ----------
  let db = load();
  let user = localStorage.getItem(USER) || "";
  let queueFilter = "aguardando";
  let cur = null; // pedido aberto

  function load() {
    let d;
    try { d = JSON.parse(localStorage.getItem(STORE)); } catch {}
    if (!d || !Array.isArray(d.orders)) d = { orders: W.seedConferencia().map(prep) };
    importFromSeparacao(d);
    return d;
  }
  const save = () => localStorage.setItem(STORE, JSON.stringify(db));

  function prep(o) {
    o.conf = { status: "aguardando", itens: {}, fora: [], log: [], inicio: null, fim: null, volumes: 0, conferente: null };
    o.itens.forEach((i) => (o.conf.itens[i.sku] = 0));
    return o;
  }

  // traz pedidos concluídos na Separação (mesmo navegador)
  function importFromSeparacao(d) {
    let sep;
    try { sep = JSON.parse(localStorage.getItem(W.SEP_STORE)) || []; } catch { sep = []; }
    sep.filter((o) => o.status === "concluido").forEach((o) => {
      const ex = d.orders.find((x) => x.id === o.id);
      if (ex && ex.fim === o.fim) return;
      const copy = prep(JSON.parse(JSON.stringify(o)));
      if (ex) d.orders[d.orders.indexOf(ex)] = copy; else d.orders.unshift(copy);
    });
  }

  // ---------- utils ----------
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
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
  $("#station").value = localStorage.getItem("wms-bb-posto") || "01";
  $("#station").addEventListener("change", (e) => localStorage.setItem("wms-bb-posto", e.target.value));

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
      un: sum(o.itens, (i) => o.conf.itens[i.sku] || 0) + sum(o.conf.fora, (f) => f.q),
      unT: sum(o.itens, (i) => i.sep),
      div: st.filter((s) => s === "excesso").length + o.conf.fora.length,
      pend: st.filter((s) => s === "pendente" || s === "parcial").length,
    };
  }

  // ---------- fila ----------
  function renderQueue() {
    const ag = db.orders.filter((o) => o.conf.status === "aguardando" || o.conf.status === "andamento");
    const cf = db.orders.filter((o) => o.conf.status === "conferido" || o.conf.status === "divergente");
    $("#qCountA").textContent = ag.length;
    $("#qCountC").textContent = cf.length;
    const list = (queueFilter === "aguardando" ? ag : cf).sort((a, b) =>
      (a.conf.status === "andamento" ? -1 : 0) - (b.conf.status === "andamento" ? -1 : 0) || (a.prio === "alta" ? -1 : 1) - (b.prio === "alta" ? -1 : 1));

    $("#queueBody").innerHTML = list.map((o) => {
      const faltaSep = o.itens.some((i) => i.status === "falta");
      const tag = o.conf.status === "andamento" ? `<span class="tag andamento">Em conferência</span>`
        : o.conf.status === "conferido" ? `<span class="tag ok">Conferido · ${o.conf.volumes} vol.</span>`
        : o.conf.status === "divergente" ? `<span class="tag div">Com divergência · ${o.conf.volumes} vol.</span>`
        : faltaSep ? `<span class="tag parcial">Falta na separação</span>`
        : o.prio === "alta" ? `<span class="tag alta">Prioridade</span>` : `<span class="tag">Aguardando</span>`;
      return `<tr data-id="${o.id}">
        <td class="pid">${o.id}</td><td>${esc(o.cliente)}</td><td class="muted">${o.cidade}</td>
        <td class="r">${o.itens.length}</td><td class="r strong">${sum(o.itens, (i) => i.sep)}</td>
        <td>${esc(o.operador || "—")}</td><td>${tag}${o.conf.volumes && o.conf.fim ? `<button class="lb-btn" data-print="${o.id}">Etiquetas</button>` : ""}</td></tr>`;
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
    cur = null;
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
      Object.assign(o, prep(o));
    }
    if (o.conf.status === "aguardando") { o.conf.status = "andamento"; o.conf.inicio = Date.now(); o.conf.conferente = user; save(); }
    cur = o;
    $("#queue").hidden = true; $("#order").hidden = false;
    $("#oId").textContent = o.id;
    $("#oClient").textContent = o.cliente;
    $("#oSub").textContent = `${o.cidade} · separado por ${o.operador || "—"} · ${o.itens.length} itens`;
    const t = $("#oTag");
    t.className = "tag " + (o.prio === "alta" ? "alta" : "");
    t.textContent = o.prio === "alta" ? "Prioridade" : "Normal";
    $("#scan").placeholder = "Bipe o produto…";
    setLast({ label: "Pedido aberto", desc: `${o.cliente}`, code: o.id, conf: "—", exp: "—" });
    setMsg(`Pedido ${o.id} carregado · bipe os produtos`, "ok");
    beep(true);
    renderItems(); renderTotals(); focusScan();
  }

  function renderItems(flashSku) {
    const o = cur;
    const rows = o.itens.map((i) => {
      const s = itemState(o, i), c = o.conf.itens[i.sku] || 0;
      const label = { ok: "Conferido", parcial: `Faltam ${i.sep - c}`, excesso: `Excesso +${c - i.sep}`, pendente: "Pendente" }[s];
      const sepWarn = i.sep < i.qtd ? `<span class="sub-warn">falta na separação (${i.motivo || "—"})</span>` : "";
      return `<tr class="${s} ${flashSku === i.sku ? "flash" : ""}" data-sku="${i.sku}">
        <td><span class="s-dot"></span></td>
        <td class="code"><b>${i.sku}</b>${i.ean}</td>
        <td>${esc(i.desc)}${sepWarn}</td>
        <td><span class="addr-chip">${i.end}</span></td>
        <td class="r">${i.qtd}</td><td class="r strong">${i.sep}</td>
        <td class="r conf">${c}</td>
        <td>${s === "pendente" ? `<span class="tag">${label}</span>` : `<span class="tag ${s}">${label}</span>`}</td></tr>`;
    });
    const fora = o.conf.fora.map((f) => `<tr class="fora ${flashSku === f.sku ? "flash" : ""}">
        <td><span class="s-dot"></span></td><td class="code"><b>${f.sku}</b>${f.ean}</td><td>${esc(f.desc)}</td>
        <td>—</td><td class="r">0</td><td class="r strong">0</td><td class="r conf">${f.q}</td>
        <td><span class="tag fora">Fora do pedido</span></td></tr>`);
    $("#itemsBody").innerHTML = rows.concat(fora).join("");
    const fl = $("#itemsBody tr.flash"); if (fl) fl.scrollIntoView({ block: "nearest", behavior: "smooth" });
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
    let q = Math.max(1, parseInt($("#mult").value, 10) || 1);
    const m = code.match(/^(\d{1,3})\*(.+)$/);
    if (m) { q = +m[1]; code = m[2].trim(); }
    resetMult();

    // código de pedido?
    const pid = code.split("|")[0].trim().toUpperCase().replace(/^PV-?/, "");
    const ord = db.orders.find((o) => o.id.replace("PV-", "") === pid);
    if (ord && (!cur || !W.find(code))) {
      if (cur && cur !== ord) { setMsg(`Finalize ou volte à fila (F2) antes de abrir ${ord.id}.`, "err"); beep(false); return; }
      if (!cur) return openOrder(ord);
      if (cur === ord) { setMsg(`Pedido ${ord.id} já está aberto.`); return; }
    }

    if (!cur) { setMsg("Bipe primeiro o código do pedido.", "err"); beep(false); errLast("Código não é um pedido", code); return; }

    const p = W.find(code);
    if (!p) { setMsg("Código não cadastrado.", "err"); beep(false); errLast("Código não cadastrado", code); return; }

    const it = cur.itens.find((i) => i.sku === p.sku);
    if (it) {
      cur.conf.itens[p.sku] = (cur.conf.itens[p.sku] || 0) + q;
      cur.conf.log.push({ sku: p.sku, q, fora: false });
      const c = cur.conf.itens[p.sku], s = itemState(cur, it);
      const okish = s === "ok" || s === "parcial";
      setLast({
        label: s === "ok" ? "Item completo ✓" : s === "excesso" ? "Excesso — retire do volume" : `Lido +${q}`,
        desc: p.desc, code: `${p.sku} · ${p.ean}`, conf: c, exp: it.sep, kind: okish ? "ok" : "err",
      });
      setMsg(s === "excesso" ? `Excesso de ${c - it.sep} un. em ${p.sku}` : s === "ok" ? "Item conferido" : `Faltam ${it.sep - c} un.`, okish ? "ok" : "err");
      beep(okish);
    } else {
      let f = cur.conf.fora.find((x) => x.sku === p.sku);
      if (!f) cur.conf.fora.push((f = { sku: p.sku, ean: p.ean, desc: p.desc, q: 0 }));
      f.q += q;
      cur.conf.log.push({ sku: p.sku, q, fora: true });
      setLast({ label: "Produto fora do pedido", desc: p.desc, code: `${p.sku} · ${p.ean}`, conf: f.q, exp: 0, kind: "err" });
      setMsg("Este produto não pertence ao pedido — separe para devolução.", "err");
      beep(false);
    }
    save(); renderItems(p.sku); renderTotals();
  }

  function errLast(label, code) { setLast({ label, desc: "Verifique a etiqueta e bipe novamente", code, conf: "—", exp: "—", kind: "err" }); }

  $("#scanForm").addEventListener("submit", (e) => { e.preventDefault(); const v = $("#scan").value; $("#scan").value = ""; handle(v); });

  // multiplicador (F4)
  function resetMult() { $("#mult").value = 1; $(".pos-mult").classList.remove("on"); }
  $("#mult").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); $(".pos-mult").classList.toggle("on", +$("#mult").value > 1); focusScan(); }
  });

  // estornar (F6)
  function undo() {
    if (!cur || !cur.conf.log.length) { setMsg("Nada para estornar.", "err"); return; }
    const l = cur.conf.log.pop();
    if (l.fora) {
      const f = cur.conf.fora.find((x) => x.sku === l.sku);
      f.q -= l.q; if (f.q <= 0) cur.conf.fora.splice(cur.conf.fora.indexOf(f), 1);
    } else cur.conf.itens[l.sku] = Math.max(0, cur.conf.itens[l.sku] - l.q);
    save(); renderItems(); renderTotals();
    const p = W.find(l.sku);
    setLast({ label: `Estornado −${l.q}`, desc: p.desc, code: p.sku, conf: l.fora ? "—" : cur.conf.itens[l.sku], exp: l.fora ? 0 : cur.itens.find((i) => i.sku === l.sku).sep });
    setMsg(`Última leitura estornada (${l.sku} −${l.q})`);
  }

  function restart() {
    if (!cur || !confirm(`Zerar todas as leituras de ${cur.id}?`)) return focusScan();
    const keep = { ...cur.conf, itens: {}, fora: [], log: [] };
    cur.itens.forEach((i) => (keep.itens[i.sku] = 0));
    cur.conf = keep; save(); renderItems(); renderTotals();
    setMsg("Conferência reiniciada"); focusScan();
  }

  // ---------- finalizar ----------
  function openFinish() {
    if (!cur) return;
    const s = stats(cur);
    const rows = [];
    cur.itens.forEach((i) => {
      const c = cur.conf.itens[i.sku] || 0, st = itemState(cur, i);
      if (st === "ok") return;
      rows.push(`<div class="f-row"><span class="tag ${st === "pendente" ? "parcial" : st}">${st === "excesso" ? "Excesso" : "Falta"}</span><span>${esc(i.desc)}</span><b>${c}/${i.sep}</b></div>`);
    });
    cur.conf.fora.forEach((f) => rows.push(`<div class="f-row"><span class="tag fora">Fora</span><span>${esc(f.desc)}</span><b>+${f.q}</b></div>`));
    const div = rows.length > 0;
    $("#fTitle").textContent = div ? "Finalizar com divergência?" : "Finalizar conferência";
    $("#fSub").textContent = `${cur.id} · ${cur.cliente} · ${s.un} de ${s.unT} unidades conferidas`;
    $("#fDiv").innerHTML = rows.join("");
    $("#fGo").className = "btn " + (div ? "danger" : "primary");
    $("#fGo").innerHTML = (div ? "Finalizar com divergência" : "Confirmar") + " <kbd>Enter</kbd>";
    $("#fVol").value = cur.conf.volumes || Math.max(1, Math.ceil(s.un / 10));
    openModal("mFinish");
    setTimeout(() => $("#fVol").select(), 30);
  }
  $("#btnFinish").addEventListener("click", openFinish);

  function doFinish() {
    const s = stats(cur), div = s.div > 0 || s.pend > 0;
    Object.assign(cur.conf, { status: div ? "divergente" : "conferido", fim: Date.now(), posto: $("#station").value, conferente: user, volumes: Math.max(1, parseInt($("#fVol").value, 10) || 1) });
    save();
    const mins = Math.max(1, Math.round((cur.conf.fim - cur.conf.inicio) / 60000));
    $("#dTitle").textContent = div ? "Conferido com divergência" : "Pedido conferido";
    $("#dSub").textContent = `${cur.id} · ${cur.conf.volumes} volume(s) · ${s.un} un. · ${mins} min`;
    $("#dPrint").innerHTML = `Imprimir ${cur.conf.volumes} etiqueta${cur.conf.volumes > 1 ? "s" : ""} <kbd>Enter</kbd>`;
    $("#mDone .done-check").style.filter = div ? "hue-rotate(-110deg) saturate(1.6)" : "";
    openModal("mDone");
    beep(true);
  }
  $("#fGo").addEventListener("click", doFinish);
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
    $("#pVol").value = o.conf.volumes || 1;
    renderPreview();
    openModal("mPrint");
  }
  function renderPreview() {
    const o = printOrder;
    $("#pSub").textContent = `${o.id} · ${o.cliente} · 80 × 60 mm`;
    $("#pPreview").innerHTML = Etiqueta.render(o);
  }
  $("#pVol").addEventListener("input", () => {
    const v = Math.min(99, Math.max(1, parseInt($("#pVol").value, 10) || 1));
    printOrder.conf.volumes = v; save(); renderPreview();
  });
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
  $("#modalScrim").addEventListener("click", () => modal !== "mOp" && closeModal());

  // conferente
  function askOp() { $("#opInput").value = user; openModal("mOp"); setTimeout(() => $("#opInput").focus(), 30); }
  $("#opBtn").addEventListener("click", askOp);
  $("#opForm").addEventListener("submit", (e) => {
    e.preventDefault(); user = $("#opInput").value.trim(); if (!user) return;
    localStorage.setItem(USER, user); $("#opName").textContent = user; closeModal();
  });

  // ---------- foco do leitor + atalhos ----------
  function focusScan() { if (!modal) $("#scan").focus(); }
  document.addEventListener("click", (e) => {
    if (modal) return;
    if (e.target.closest("input, select, button, a, tr")) { if (!e.target.closest("input, select")) setTimeout(focusScan, 0); return; }
    focusScan();
  });

  document.addEventListener("keydown", (e) => {
    if (modal) {
      if (e.key === "Escape" && modal !== "mOp") {
        e.preventDefault();
        const back = modal === "mDone" || (modal === "mPrint" && printThenQueue);
        closeModal(); if (back) showQueue();
      }
      if (e.key === "Enter" && modal === "mFinish") { e.preventDefault(); doFinish(); }
      else if (e.key === "Enter" && modal === "mDone") { e.preventDefault(); printDone(); }
      else if (e.key === "Enter" && modal === "mPrint" && !e.target.closest("button")) { e.preventDefault(); doPrint(); }
      return;
    }
    switch (e.key) {
      case "F2": e.preventDefault(); showQueue(); break;
      case "F4": e.preventDefault(); $("#mult").select(); $("#mult").focus(); break;
      case "F6": e.preventDefault(); undo(); break;
      case "F8": e.preventDefault(); restart(); break;
      case "F10": e.preventDefault(); openFinish(); break;
      case "Escape": $("#scan").value = ""; resetMult(); focusScan(); break;
      default:
        // leitor digitando sem foco no campo: redireciona
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && !e.target.closest("input, select")) focusScan();
    }
  });

  // ---------- início ----------
  $("#opName").textContent = user || "—";
  const open = db.orders.find((o) => o.conf.status === "andamento");
  showQueue();
  if (!user) askOp();
  else if (open) toast(`${open.id} está em conferência — clique para continuar`);
})();
