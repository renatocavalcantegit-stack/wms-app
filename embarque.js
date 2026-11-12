// WMS Beach Bike — Embarque (mobile): leitura dos volumes etiquetados no caminhão
window.Embarque = (() => {
  "use strict";

  const STORE = "wms-bb-emb-v1";
  const W = window.WMS;
  const { $, $$, esc, show, openSheet, closeSheets, toast, beep, vibrate, openCam, getUser, CHECK } = window.UI;

  let cargas = load();
  let filter = "abertas";
  let cur = null;

  function load() {
    let d;
    try { d = JSON.parse(localStorage.getItem(STORE)); } catch {}
    if (!Array.isArray(d) || !d.length) d = W.seedEmbarque();
    importConferidos(d);
    return d;
  }
  const save = () => localStorage.setItem(STORE, JSON.stringify(cargas));

  // pedidos conferidos neste aparelho/navegador que ainda não estão em carga → carga avulsa
  function importConferidos(d) {
    let conf;
    try { conf = (JSON.parse(localStorage.getItem(W.CONF_STORE)) || {}).orders || []; } catch { conf = []; }
    const inCarga = new Set(d.flatMap((c) => c.pedidos.map((p) => p.id)));
    const novos = conf.filter((o) => (o.conf.status === "conferido" || o.conf.status === "divergente") && !inCarga.has(o.id));
    if (!novos.length) return;
    let av = d.find((c) => c.id === "CG-AVULSA" && c.status !== "embarcada" && c.status !== "parcial");
    if (!av) {
      av = { id: "CG-AVULSA", rota: "Avulsa", veiculo: "A definir", placa: "—", motorista: "—", doca: "01", saida: "—", pedidos: [], status: "aberta", inicio: null, fim: null, lacre: "", operador: null, log: [], obs: "" };
      d.unshift(av);
    }
    novos.forEach((o) => av.pedidos.push({ id: o.id, cliente: o.cliente, cidade: o.cidade, volumes: o.conf.volumes || 1, lidos: [] }));
  }

  document.addEventListener("wms:reset", () => {
    localStorage.removeItem(STORE);
    cargas = load(); save();
  });

  // ---------- cálculos ----------
  const totVol = (c) => c.pedidos.reduce((t, p) => t + p.volumes, 0);
  const lidos = (c) => c.pedidos.reduce((t, p) => t + p.lidos.length, 0);
  const done = (c) => c.status === "embarcada" || c.status === "parcial";
  const loadOrder = (c) => [...c.pedidos].reverse(); // última entrega entra primeiro

  // ---------- lista de cargas ----------
  function home() {
    cur = null;
    const ab = cargas.filter((c) => !done(c));
    $("#eKpiAb").textContent = ab.length;
    $("#eKpiVol").textContent = ab.reduce((t, c) => t + totVol(c) - lidos(c), 0);
    $("#eKpiOk").textContent = cargas.filter(done).length;

    const list = filter === "abertas" ? ab.sort((a, b) => (b.status === "carregando") - (a.status === "carregando")) : cargas.filter(done);
    $("#cargaList").innerHTML = list.length ? list.map(card).join("")
      : `<p class="empty">${filter === "abertas" ? "Nenhuma carga aguardando embarque. 🚚" : "Nenhuma carga embarcada ainda."}</p>`;
    show("viewEmbHome");
  }

  function tagOf(c) {
    return c.status === "carregando" ? `<span class="tag andamento">Carregando</span>`
      : c.status === "embarcada" ? `<span class="tag concluido">Embarcada</span>`
      : c.status === "parcial" ? `<span class="tag alta">Parcial</span>`
      : `<span class="tag">Aberta</span>`;
  }

  function card(c) {
    const t = totVol(c), l = lidos(c);
    return `<button class="order carga ${done(c) ? "is-done" : ""}" data-id="${c.id}">
      <div class="order-top">
        <div><p class="order-id">${c.id}</p><p class="order-client">${esc(c.rota)}</p></div>${tagOf(c)}
      </div>
      <div class="carga-row">
        <span class="plate">${esc(c.placa)}</span>
        <span>${esc(c.veiculo)}</span><span>Doca <b>${c.doca}</b></span><span>Saída <b>${c.saida}</b></span>
      </div>
      <div class="order-meta"><span><b>${c.pedidos.length}</b> pedidos</span><span><b>${l}</b>/${t} volumes</span><span>${esc(c.motorista)}</span></div>
      <div class="order-bar"><i style="width:${t ? (l / t) * 100 : 0}%"></i></div>
    </button>`;
  }

  $("#eTabs").addEventListener("click", (e) => {
    const b = e.target.closest(".tab"); if (!b) return;
    filter = b.dataset.filter;
    $$("#eTabs .tab").forEach((t) => t.classList.toggle("active", t === b));
    home();
  });

  $("#cargaList").addEventListener("click", (e) => {
    const el = e.target.closest(".carga"); if (!el) return;
    const c = cargas.find((x) => x.id === el.dataset.id);
    $("#scId").textContent = c.id;
    $("#scSub").textContent = `${c.rota} · ${c.pedidos.length} pedidos · ${totVol(c)} volumes`;
    $("#scTag").outerHTML = tagOf(c).replace('class="tag', 'id="scTag" class="tag');
    $("#scVeic").textContent = `${c.veiculo} · ${c.placa}`;
    $("#scMot").textContent = c.motorista;
    $("#scDoca").textContent = c.doca;
    $("#scSaida").textContent = c.saida;
    $("#scList").innerHTML = loadOrder(c).map((p, k) => `<div class="line">
      <span class="load-n">${k + 1}º</span>
      <span class="line-desc"><b>${p.id}</b> · ${esc(p.cliente)}<small>${esc(p.cidade)}</small></span>
      <span class="line-q">${p.lidos.length}/${p.volumes} vol.</span></div>`).join("");
    const go = $("#scGo");
    go.dataset.id = c.id;
    go.hidden = done(c);
    go.textContent = c.status === "carregando" ? "Continuar embarque" : "Iniciar embarque";
    openSheet("sheetCarga");
  });

  $("#scGo").addEventListener("click", () => {
    const c = cargas.find((x) => x.id === $("#scGo").dataset.id);
    if (c.status === "aberta") Object.assign(c, { status: "carregando", inicio: Date.now(), operador: getUser() });
    cur = c; save(); closeSheets();
    setLast("idle");
    render(); show("viewLoad");
  });

  // ---------- carregamento ----------
  function render(flash) {
    const c = cur, t = totVol(c), l = lidos(c);
    $("#lId").textContent = c.id;
    $("#lRota").textContent = `${c.rota} · ${c.motorista}`;
    $("#lDoca").textContent = c.doca;
    $("#lPlaca").textContent = c.placa;
    $("#lVeic").textContent = `${c.veiculo} · saída ${c.saida}`;
    $("#lLidos").textContent = l;
    $("#lTotal").textContent = t;
    $("#lProgress").style.width = (t ? (l / t) * 100 : 0) + "%";
    $(".truck").classList.toggle("full", l === t);
    $("#loadFinish").textContent = l === t ? "Finalizar embarque" : `Finalizar embarque (${t - l} pendentes)`;

    const next = loadOrder(c).find((p) => p.lidos.length < p.volumes);
    $("#loadList").innerHTML = loadOrder(c).map((p, k) => {
      const ok = p.lidos.length === p.volumes;
      const chips = Array.from({ length: p.volumes }, (_, i) => {
        const v = i + 1, on = p.lidos.includes(v);
        return `<button class="vchip ${on ? "on" : ""} ${flash && flash.id === p.id && flash.vol === v ? "pop" : ""}" data-id="${p.id}" data-vol="${v}">${on ? CHECK : v}</button>`;
      }).join("");
      return `<div class="lp ${ok ? "ok" : ""} ${next === p ? "next" : ""}">
        <span class="load-n">${ok ? CHECK : k + 1 + "º"}</span>
        <div class="lp-body">
          <p class="lp-t"><b>${p.id}</b> <span>${p.lidos.length}/${p.volumes}</span></p>
          <p class="lp-s">${esc(p.cliente)} · ${esc(p.cidade)}</p>
          <div class="vchips">${chips}</div>
        </div>
      </div>`;
    }).join("");
  }

  function setLast(kind, title, sub) {
    const el = $("#lLast");
    el.className = "last-read " + (kind === "idle" ? "" : kind);
    $("#lLastT").textContent = title || "Bipe a etiqueta do volume";
    $("#lLastS").textContent = sub || "QR da etiqueta 80×60 ou digite pedido e volume (ex.: 10404 1)";
    $("#lLastIco").innerHTML = kind === "ok" ? `<svg viewBox="0 0 24 24"><path d="M5 12l5 5 9-10"/></svg>`
      : kind === "err" ? `<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>`
      : kind === "warn" ? `<svg viewBox="0 0 24 24"><path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17v.5"/></svg>`
      : `<svg viewBox="0 0 24 24"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 8v8M10 8v8M13 8v8M17 8v8"/></svg>`;
    if (kind !== "idle") { void el.offsetWidth; el.classList.add("in"); }
  }

  function fail(title, sub) {
    setLast("err", title, sub);
    beep(false); vibrate([90, 60, 90]);
    const f = $("#loadForm"); f.classList.remove("err"); void f.offsetWidth; f.classList.add("err");
  }

  function handle(raw) {
    if (!cur || !String(raw).trim()) return;
    const v = W.parseVolume(raw);
    if (!v) return fail("Etiqueta inválida", `Código lido: ${String(raw).slice(0, 40)}`);

    const p = cur.pedidos.find((x) => x.id === v.id);
    if (!p) {
      const other = cargas.find((c) => c !== cur && c.pedidos.some((x) => x.id === v.id));
      return fail(`${v.id} não é desta carga`, other ? `Pertence à ${other.id} · ${other.rota} (doca ${other.doca}). Não embarque.` : "Pedido não está programado em nenhuma carga.");
    }
    if (v.total && v.total !== p.volumes) return fail("Etiqueta desatualizada", `Etiqueta indica ${v.total} volumes, pedido tem ${p.volumes}. Reimprima na conferência.`);
    if (v.vol < 1 || v.vol > p.volumes) return fail(`Volume ${v.vol} não existe`, `${p.id} tem ${p.volumes} volume(s).`);
    if (p.lidos.includes(v.vol)) return fail("Volume já embarcado", `${p.id} · volume ${v.vol}/${p.volumes} foi lido antes.`);

    // aviso de ordem de carregamento (aceita, mas alerta)
    const order = loadOrder(cur);
    const next = order.find((x) => x.lidos.length < x.volumes);
    const outOfOrder = next && order.indexOf(p) > order.indexOf(next);

    $("#loadForm").classList.remove("err");
    p.lidos.push(v.vol);
    cur.log.push({ id: p.id, vol: v.vol });
    save();

    const complete = p.lidos.length === p.volumes;
    if (outOfOrder) {
      setLast("warn", `${p.id} · vol. ${v.vol}/${p.volumes} embarcado`, `Atenção: ${next.id} deveria entrar antes (entrega posterior).`);
      beep(true); vibrate([30, 40, 30]);
    } else {
      setLast("ok", `${p.id} · vol. ${v.vol}/${p.volumes} embarcado`, complete ? `${p.cliente} — pedido completo ✓` : `${p.cliente} — faltam ${p.volumes - p.lidos.length}`);
      beep(true); vibrate(30);
    }
    render({ id: p.id, vol: v.vol });
    if (lidos(cur) === totVol(cur)) setTimeout(() => toast("Todos os volumes embarcados — finalize a carga"), 400);
  }

  $("#loadForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const i = $("#loadInput"); const v = i.value; i.value = ""; handle(v);
  });
  $("#loadCam").addEventListener("click", () => openCam(handle));

  // lançamento manual (etiqueta danificada)
  $("#loadList").addEventListener("click", (e) => {
    const b = e.target.closest(".vchip"); if (!b || b.classList.contains("on")) return;
    if (!confirm(`Lançar manualmente ${b.dataset.id} volume ${b.dataset.vol}?\nUse apenas se a etiqueta estiver ilegível.`)) return;
    handle(`${b.dataset.id}|${b.dataset.vol}`);
  });

  $("#loadUndo").addEventListener("click", () => {
    const l = cur.log.pop();
    if (!l) return toast("Nada para estornar");
    const p = cur.pedidos.find((x) => x.id === l.id);
    p.lidos = p.lidos.filter((x) => x !== l.vol);
    save(); render();
    setLast("idle", `Estornado: ${l.id} · vol. ${l.vol}`, "Volume retirado do caminhão");
    vibrate(40);
  });

  $("#loadBack").addEventListener("click", () => { home(); toast("Embarque pausado · continue quando quiser"); });

  // ---------- finalizar ----------
  $("#loadFinish").addEventListener("click", () => {
    const c = cur, falt = c.pedidos.flatMap((p) => Array.from({ length: p.volumes }, (_, i) => i + 1).filter((v) => !p.lidos.includes(v)).map((v) => ({ p, v })));
    if (lidos(c) === 0) return toast("Nenhum volume lido ainda");
    const parcial = falt.length > 0;
    $("#sfTitle").textContent = parcial ? "Embarque parcial?" : "Finalizar embarque";
    $("#sfSub").textContent = parcial ? `${falt.length} volume(s) não foram lidos e ficarão na doca.` : `${totVol(c)} volumes no veículo ${c.placa}. Informe o lacre.`;
    $("#sfMissing").innerHTML = falt.map(({ p, v }) => `<div class="line"><span class="dot falta">!</span>
      <span class="line-desc"><b>${p.id}</b> · volume ${v}/${p.volumes}<small>${esc(p.cliente)}</small></span></div>`).join("");
    $("#sfObsWrap").hidden = !parcial;
    $("#sfLacre").value = c.lacre || "";
    const go = $("#sfGo");
    go.className = "btn block " + (parcial ? "danger" : "primary");
    go.textContent = parcial ? "Embarcar parcial" : "Confirmar embarque";
    openSheet("sheetFinish");
  });

  $("#sfGo").addEventListener("click", () => {
    const c = cur, parcial = lidos(c) < totVol(c);
    const lacre = $("#sfLacre").value.trim();
    if (!lacre) { toast("Informe o número do lacre"); $("#sfLacre").focus(); return; }
    Object.assign(c, { status: parcial ? "parcial" : "embarcada", fim: Date.now(), lacre, obs: $("#sfObs").value.trim() });
    save(); closeSheets();
    const mins = Math.max(1, Math.round((c.fim - c.inicio) / 60000));
    $("#ldTitle").textContent = parcial ? "Embarque parcial registrado" : "Carga embarcada";
    $("#ldSub").textContent = `${c.id} · ${c.rota} · ${c.veiculo} ${c.placa}`;
    $("#ldTime").textContent = mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, "0")}`;
    $("#ldVol").textContent = `${lidos(c)}/${totVol(c)}`;
    $("#ldLacre").textContent = lacre;
    $("#ldMissing").innerHTML = parcial ? $("#sfMissing").innerHTML : "";
    $("#viewLoadDone .done-check").classList.toggle("warn", parcial);
    vibrate([40, 60, 120]);
    show("viewLoadDone");
  });
  $("#ldBack").addEventListener("click", home);

  return { home };
})();
