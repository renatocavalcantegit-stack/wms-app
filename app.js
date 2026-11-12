// WMS Beach Bike — MVP de Separação (dados locais de demonstração)
(() => {
  "use strict";

  const STORE = "wms-bb-sep-v1";
  const USER = "wms-bb-user";

  const { seedSeparacao: seed } = window.WMS;

  // ---------- estado ----------
  let orders = load();
  let user = localStorage.getItem(USER) || "";
  let filter = "abertos";
  let current = null; // pedido em separação

  function load() {
    try { const d = JSON.parse(localStorage.getItem(STORE)); if (Array.isArray(d) && d.length) return d; } catch {}
    return seed();
  }
  const save = () => localStorage.setItem(STORE, JSON.stringify(orders));

  // ---------- utils ----------
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const units = (o) => o.itens.reduce((t, i) => t + i.qtd, 0);
  const doneCount = (o) => o.itens.filter((i) => i.status !== "pendente").length;
  const vibrate = (p) => navigator.vibrate && navigator.vibrate(p);
  const CHECK = '<svg viewBox="0 0 24 24"><path d="M5 12l5 5 9-10"/></svg>';
  const ICONS = {
    bike: '<svg viewBox="0 0 24 24"><circle cx="5.5" cy="16" r="3.5"/><circle cx="18.5" cy="16" r="3.5"/><path d="M5.5 16l4-8h6l3 8M9.5 8L12 16h-2M14 5h3"/></svg>',
    peca: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/></svg>',
    acess: '<svg viewBox="0 0 24 24"><path d="M4 8h16v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"/><path d="M8 8V6a4 4 0 0 1 8 0v2"/></svg>',
  };

  let toastT;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 2200);
  }

  // feedback sonoro curto (bipe)
  let actx;
  function beep(ok = true) {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const o = actx.createOscillator(), g = actx.createGain();
      o.frequency.value = ok ? 1320 : 220; o.type = ok ? "sine" : "square";
      g.gain.setValueAtTime(0.12, actx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + (ok ? 0.12 : 0.3));
      o.connect(g).connect(actx.destination); o.start(); o.stop(actx.currentTime + (ok ? 0.12 : 0.3));
    } catch {}
  }

  const HOMES = { viewHome: "sep", viewEmbHome: "emb" };
  function show(id) {
    $$(".view").forEach((v) => (v.hidden = v.id !== id));
    const mod = HOMES[id];
    $("#tabbar").hidden = !mod;
    if (mod) {
      localStorage.setItem("wms-bb-mod", mod);
      $$("#tabbar .tb").forEach((b) => b.classList.toggle("active", b.dataset.mod === mod));
    }
    window.scrollTo(0, 0);
    document.querySelector('meta[name="theme-color"]').content = id === "viewLogin" ? "#ffffff" : "#F5F5F7";
  }

  // ---------- sheets ----------
  function openSheet(id) {
    $$(".sheet").forEach((s) => (s.hidden = s.id !== id));
    $("#scrim").hidden = false;
  }
  function closeSheets() {
    $$(".sheet").forEach((s) => (s.hidden = true));
    $("#scrim").hidden = true;
  }
  $("#scrim").addEventListener("click", closeSheets);

  // ---------- login ----------
  $("#loginForm").addEventListener("submit", (e) => {
    e.preventDefault();
    user = $("#loginName").value.trim();
    if (!user) return;
    localStorage.setItem(USER, user);
    goHome();
  });

  // ---------- módulos (barra inferior) ----------
  function goHome(mod = localStorage.getItem("wms-bb-mod") || "sep") {
    if (mod === "emb" && window.Embarque) window.Embarque.home();
    else { renderHome(); show("viewHome"); }
  }
  $("#tabbar").addEventListener("click", (e) => {
    const b = e.target.closest(".tb"); if (b) goHome(b.dataset.mod);
  });

  // ---------- home ----------
  function renderHome() {
    $("#helloName").textContent = user.split(" ")[0];
    const dt = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
    $("#helloDate").textContent = dt.charAt(0).toUpperCase() + dt.slice(1);
    $("#kpiPend").textContent = orders.filter((o) => o.status === "pendente").length;
    $("#kpiAnd").textContent = orders.filter((o) => o.status === "andamento").length;
    $("#kpiDone").textContent = orders.filter((o) => o.status === "concluido").length;

    const list = orders
      .filter((o) => filter === "todos" || (filter === "concluido" ? o.status === "concluido" : o.status !== "concluido"))
      .sort((a, b) => rank(a) - rank(b));

    $("#orderList").innerHTML = list.length ? list.map(orderCard).join("") :
      `<p class="empty">${filter === "concluido" ? "Nenhum pedido concluído ainda." : "Tudo separado por aqui. 🎉"}</p>`;
  }
  const rank = (o) => ({ andamento: 0, pendente: 1, concluido: 2 }[o.status] * 10 + (o.prio === "alta" ? 0 : 1));

  function orderCard(o) {
    const pct = Math.round((doneCount(o) / o.itens.length) * 100);
    const tag = o.status === "concluido" ? `<span class="tag concluido">Concluído</span>`
      : o.status === "andamento" ? `<span class="tag andamento">Em separação</span>`
      : o.prio === "alta" ? `<span class="tag alta">Prioridade</span>` : `<span class="tag">Pendente</span>`;
    return `<button class="order ${o.status === "concluido" ? "is-done" : ""}" data-id="${o.id}">
      <div class="order-top">
        <div><p class="order-id">${o.id}</p><p class="order-client">${esc(o.cliente)}</p></div>${tag}
      </div>
      <div class="order-meta"><span><b>${o.itens.length}</b> itens</span><span><b>${units(o)}</b> un.</span><span>${o.cidade}</span><span>${o.hora}</span></div>
      ${o.status !== "pendente" ? `<div class="order-bar"><i style="width:${pct}%"></i></div>` : ""}
    </button>`;
  }

  $(".tabs").addEventListener("click", (e) => {
    const b = e.target.closest(".tab"); if (!b) return;
    filter = b.dataset.filter;
    $$(".tab").forEach((t) => t.classList.toggle("active", t === b));
    renderHome();
  });

  $("#orderList").addEventListener("click", (e) => {
    const card = e.target.closest(".order"); if (!card) return;
    const o = orders.find((x) => x.id === card.dataset.id);
    $("#startOrder").textContent = o.id;
    $("#startClient").textContent = `${o.cliente} · ${o.itens.length} itens · ${units(o)} un.`;
    const pr = $("#startPrio");
    pr.className = "tag " + (o.status === "concluido" ? "concluido" : o.status === "andamento" ? "andamento" : o.prio === "alta" ? "alta" : "");
    pr.textContent = o.status === "concluido" ? "Concluído" : o.status === "andamento" ? "Em separação" : o.prio === "alta" ? "Prioridade" : "Normal";
    $("#startItems").innerHTML = o.itens.map((i) => lineHtml(i)).join("");
    const go = $("#startGo");
    go.textContent = o.status === "andamento" ? "Continuar separação" : o.status === "concluido" ? "Separar novamente" : "Iniciar separação";
    go.dataset.id = o.id;
    openSheet("sheetStart");
  });

  function lineHtml(i, idx, cur) {
    const dot = i.status === "ok" ? `<span class="dot ok">${CHECK}</span>`
      : i.status === "falta" ? `<span class="dot falta">!</span>` : `<span class="dot"></span>`;
    return `<button class="line ${cur ? "current" : ""}" ${idx != null ? `data-idx="${idx}"` : ""}>
      ${dot}<span class="line-addr">${i.end}</span>
      <span class="line-desc">${esc(i.desc)}<small>${i.sku}${i.status === "falta" ? " · " + esc(i.motivo) : ""}</small></span>
      <span class="line-q">${i.status === "pendente" ? i.qtd : i.sep + "/" + i.qtd}</span>
    </button>`;
  }

  $("#startGo").addEventListener("click", () => {
    const o = orders.find((x) => x.id === $("#startGo").dataset.id);
    if (o.status === "concluido") {
      o.itens.forEach((i) => Object.assign(i, { sep: 0, status: "pendente", motivo: "" }));
      o.status = "pendente"; o.atual = 0;
    }
    if (o.status === "pendente") { o.status = "andamento"; o.inicio = Date.now(); o.operador = user; }
    current = o; save(); closeSheets();
    show("viewPick"); renderPick(true);
  });

  // ---------- separação ----------
  function item() { return current.itens[current.atual]; }

  function renderPick(anim) {
    const o = current, i = item();
    $("#pickOrder").textContent = o.id;
    $("#pickClient").textContent = o.cliente;
    $("#pickProgress").style.width = (doneCount(o) / o.itens.length) * 100 + "%";
    $("#pickStep").textContent = `Item ${o.atual + 1} de ${o.itens.length}` + (i.status === "ok" ? " · confirmado" : i.status === "falta" ? " · falta registrada" : "");

    const [rua, pred, niv, pos] = i.end.split("-");
    $("#addrParts").innerHTML = [["Rua", rua], ["Prédio", pred], ["Nível", niv], ["Posição", pos]]
      .map(([l, v]) => `<div class="addr-part"><b>${v}</b><small>${l}</small></div>`).join("");

    $("#prodThumb").innerHTML = ICONS[i.tipo] || ICONS.peca;
    $("#prodDesc").textContent = i.desc;
    $("#prodSku").textContent = i.sku;
    $("#prodEan").textContent = "EAN " + i.ean;
    renderQty();
    setMsg("");
    $("#scanInput").value = "";

    if (anim) { const c = $("#pickCard"); c.classList.remove("enter"); void c.offsetWidth; c.classList.add("enter"); }
  }

  function renderQty(bump) {
    const i = item();
    $("#qtySep").textContent = i.sep;
    $("#qtyReq").textContent = i.qtd;
    const q = $(".qty");
    q.classList.toggle("full", i.sep === i.qtd);
    q.classList.toggle("over", i.sep > i.qtd);
    if (bump) { const v = $(".qty-val"); v.classList.remove("bump"); void v.offsetWidth; v.classList.add("bump"); }
    $("#btnConfirm").disabled = i.sep === 0 || i.sep > i.qtd;
    $("#btnConfirm").textContent = i.sep < i.qtd && i.sep > 0 ? `Confirmar ${i.sep} de ${i.qtd}` : "Confirmar item";
  }

  function setMsg(txt, kind = "") {
    const m = $("#scanMsg"); m.textContent = txt; m.className = "scan-msg " + kind;
  }

  function changeQty(d) {
    const i = item();
    i.sep = Math.max(0, i.sep + d);
    if (i.status !== "pendente") i.status = "pendente";
    save(); renderQty(true);
  }
  $("#qtyMinus").addEventListener("click", () => changeQty(-1));
  $("#qtyPlus").addEventListener("click", () => changeQty(1));

  function handleCode(raw) {
    const code = raw.trim().toUpperCase();
    if (!code) return;
    const i = item();
    $("#scanInput").value = "";
    if (code === i.ean || code === i.sku.toUpperCase()) {
      if (i.sep >= i.qtd) { setMsg("Quantidade já atingida para este item.", "err"); beep(false); vibrate([60, 40, 60]); return; }
      i.sep++; i.status = "pendente"; save();
      beep(true); vibrate(30);
      renderQty(true);
      setMsg(i.sep === i.qtd ? "Quantidade completa ✓" : `Leitura ok · faltam ${i.qtd - i.sep}`, "ok");
      if (i.sep === i.qtd) setTimeout(() => item() === i && confirmItem(), 450);
    } else {
      const other = current.itens.find((x) => x.ean === code || x.sku.toUpperCase() === code);
      setMsg(other ? `Produto de outro endereço (${other.end}).` : "Código não pertence a este item.", "err");
      beep(false); vibrate([80, 50, 80]);
      const f = $("#scanForm"); f.classList.remove("err"); void f.offsetWidth; f.classList.add("err");
    }
  }
  $("#scanForm").addEventListener("submit", (e) => { e.preventDefault(); handleCode($("#scanInput").value); });

  function confirmItem() {
    const i = item();
    if (i.sep === 0 || i.sep > i.qtd) return;
    if (i.sep < i.qtd) { openShort(i.sep); return; }
    i.status = "ok"; save();
    next();
  }
  $("#btnConfirm").addEventListener("click", confirmItem);

  function next() {
    const o = current;
    const pend = o.itens.findIndex((x, k) => k > o.atual && x.status === "pendente");
    const any = pend >= 0 ? pend : o.itens.findIndex((x) => x.status === "pendente");
    if (any < 0) return finish();
    o.atual = any; save(); renderPick(true);
  }

  // falta
  let reason = "Endereço vazio";
  function openShort(qtd) {
    const i = item();
    $("#shortDesc").textContent = `${i.desc} · solicitado ${i.qtd} un.`;
    $("#shortQty").value = qtd ?? i.sep;
    $("#shortQty").max = i.qtd - 1;
    openSheet("sheetShort");
  }
  $("#btnShort").addEventListener("click", () => openShort());
  $("#shortReasons").addEventListener("click", (e) => {
    const c = e.target.closest(".chip"); if (!c) return;
    reason = c.dataset.r;
    $$("#shortReasons .chip").forEach((x) => x.classList.toggle("active", x === c));
  });
  $("#shortGo").addEventListener("click", () => {
    const i = item();
    const q = Math.max(0, Math.min(i.qtd - 1, parseInt($("#shortQty").value, 10) || 0));
    Object.assign(i, { sep: q, status: "falta", motivo: reason });
    save(); closeSheets(); vibrate(40);
    toast(`Falta registrada · ${q}/${i.qtd}`);
    next();
  });

  // lista de itens
  $("#pickListBtn").addEventListener("click", () => {
    $("#pickItems").innerHTML = current.itens.map((i, k) => lineHtml(i, k, k === current.atual)).join("");
    openSheet("sheetList");
  });
  $("#pickItems").addEventListener("click", (e) => {
    const l = e.target.closest(".line"); if (!l) return;
    current.atual = +l.dataset.idx; save(); closeSheets(); renderPick(true);
  });

  $("#pickBack").addEventListener("click", () => {
    current = null; renderHome(); show("viewHome");
    toast("Separação pausada · continue quando quiser");
  });

  function finish() {
    const o = current;
    o.status = "concluido"; o.fim = Date.now(); save();
    const mins = Math.max(1, Math.round((o.fim - o.inicio) / 60000));
    const faltas = o.itens.filter((i) => i.status === "falta");
    $("#doneOrder").textContent = `${o.id} · ${o.cliente}`;
    $("#doneTime").textContent = mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, "0")}`;
    $("#doneOk").textContent = o.itens.length - faltas.length;
    $("#doneShort").textContent = faltas.length;
    $("#doneShortList").innerHTML = faltas.map((i) => lineHtml(i)).join("");
    vibrate([40, 60, 120]);
    current = null;
    show("viewDone");
  }
  $("#doneBack").addEventListener("click", () => { renderHome(); show("viewHome"); });

  // ---------- câmera (BarcodeDetector, quando disponível) ----------
  let stream, detecting = false;
  $$(".cam-btn").forEach((b) => (b.hidden = !("BarcodeDetector" in window)));
  $("#camBtn").addEventListener("click", () => openCam(handleCode));
  async function openCam(onCode) {
    try {
      const det = new window.BarcodeDetector({ formats: ["ean_13", "ean_8", "code_128", "code_39", "qr_code", "upc_a"] });
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      const v = $("#camVideo"); v.srcObject = stream; await v.play();
      $("#camView").hidden = false; detecting = true;
      const loop = async () => {
        if (!detecting) return;
        try {
          const r = await det.detect(v);
          if (r.length) { stopCam(); onCode(r[0].rawValue); return; }
        } catch {}
        requestAnimationFrame(loop);
      };
      loop();
    } catch { toast("Não foi possível abrir a câmera"); stopCam(); }
  }
  function stopCam() {
    detecting = false;
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null; $("#camView").hidden = true;
  }
  $("#camClose").addEventListener("click", stopCam);

  // ---------- menu ----------
  $$(".menu-btn").forEach((b) => b.addEventListener("click", () => { $("#menuName").textContent = user; openSheet("sheetMenu"); }));
  $("#menuReset").addEventListener("click", () => {
    orders = seed(); save(); closeSheets();
    document.dispatchEvent(new Event("wms:reset"));
    goHome(); toast("Dados de demonstração reiniciados");
  });
  $("#menuLogout").addEventListener("click", () => {
    localStorage.removeItem(USER); user = ""; closeSheets();
    $("#loginName").value = ""; show("viewLogin");
  });

  // ---------- início ----------
  // utilitários compartilhados com os outros módulos (embarque.js)
  window.UI = { $, $$, esc, show, openSheet, closeSheets, toast, beep, vibrate, openCam, getUser: () => user, CHECK };

  // inicia depois que todos os scripts carregarem
  document.addEventListener("DOMContentLoaded", () => { if (user) goHome(); else show("viewLogin"); });

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }
})();
