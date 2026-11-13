// WMS Beach Bike — Embarque (mobile): leitura dos volumes etiquetados no caminhão
import { seedEmbarque } from "./js/demo-dados.js";
import { obsLinhas } from "./compartilhado/regras/volumes.js";
import { parseVolume } from "./compartilhado/regras/etiqueta-volume.js";
import { lerPedidosDaConferencia } from "./js/dados/conferencia.js";
import { $, $$, esc } from "./js/util.js";
import { show, openSheet, closeSheets, toast, beep, vibrate, openCam, getUser, CHECK } from "./js/ui-coletor.js";

export const Embarque = (() => {
  "use strict";

  const STORE = "wms-bb-emb-v1";

  let cargas = load();
  let filter = "abertas";
  let cur = null;

  function load() {
    let d;
    try { d = JSON.parse(localStorage.getItem(STORE)); } catch {}
    if (!Array.isArray(d) || !d.length) d = seedEmbarque();
    else {
      // dados salvos antes da observação dos volumes: completa com a do cenário de demonstração
      const seed = new Map(seedEmbarque().flatMap((c) => c.pedidos).map((p) => [p.id, p.obs]));
      d.forEach((c) => c.pedidos.forEach((p) => { if (p.obs === undefined) p.obs = seed.get(p.id) || null; }));
    }
    importConferidos(d);
    return d;
  }
  const save = () => localStorage.setItem(STORE, JSON.stringify(cargas));

  // pedidos conferidos neste aparelho/navegador que ainda não estão em carga → carga avulsa
  function importConferidos(d) {
    const conf = lerPedidosDaConferencia("exp");
    const inCarga = new Set(d.flatMap((c) => c.pedidos.map((p) => p.id)));
    // observação dos volumes informada na conferência vale também para pedidos que já estão em carga
    // (a quantidade de volumes acompanha enquanto o pedido ainda não começou a ser bipado)
    const confObs = new Map(conf.filter((o) => o.conf && o.conf.obs).map((o) => [o.id, o.conf]));
    d.forEach((c) => c.pedidos.forEach((p) => {
      const k = confObs.get(p.id); if (!k) return;
      p.obs = k.obs;
      if (!p.lidos.length && k.volumes) p.volumes = k.volumes;
    }));
    const novos = conf.filter((o) => (o.conf.status === "conferido" || o.conf.status === "divergente") && !inCarga.has(o.id));
    if (!novos.length) return;
    let av = d.find((c) => c.id === "CG-AVULSA" && c.status !== "embarcada" && c.status !== "parcial");
    if (!av) {
      av = { id: "CG-AVULSA", rota: "Avulsa", veiculo: "A definir", placa: "—", motorista: "—", doca: "01", saida: "—", pedidos: [], status: "aberta", inicio: null, fim: null, operador: null, log: [], obs: "" };
      d.unshift(av);
    }
    novos.forEach((o) => av.pedidos.push({ id: o.id, cliente: o.cliente, cidade: o.cidade, volumes: o.conf.volumes || 1, lidos: [], obs: o.conf.obs || null }));
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
    // lista enxuta: número da carga, motorista e veículo
    return `<button class="order carga ${done(c) ? "is-done" : ""}" data-id="${c.id}">
      <div class="order-top">
        <p class="order-id">${c.id}</p>${tagOf(c)}
      </div>
      <div class="carga-row">
        <span class="carga-mot">
          <svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/></svg>${esc(c.motorista)}
        </span>
        <span class="carga-veic"><span class="plate">${esc(c.placa)}</span>${esc(c.veiculo)}</span>
      </div>
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
      ${obsBtn(p)}<span class="line-q">${p.lidos.length}/${p.volumes} vol.</span></div>`).join("");
    obsBack = "sheetCarga";
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
          <p class="lp-t"><b>${p.id}</b>${obsBtn(p)}<span>${p.lidos.length}/${p.volumes}</span></p>
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
    const v = parseVolume(raw);
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

  // ---------- observação dos volumes (informada na conferência) ----------
  let obsBack = null;
  const ICON_OBS = '<svg viewBox="0 0 24 24"><path d="M5 4h14v12H9l-4 4z"/><path d="M9 9h6M9 12h4"/></svg>';
  const obsBtn = (p) => p.obs ? `<button type="button" class="obs-btn ${p.obs.atencao ? "warn" : ""}" data-obs="${p.id}" aria-label="Observações do pedido ${p.id}">${ICON_OBS}Obs.</button>` : "";
  function openObs(id, back) {
    const c = cur && cur.pedidos.some((x) => x.id === id) ? cur : cargas.find((x) => x.pedidos.some((p) => p.id === id));
    const p = c.pedidos.find((x) => x.id === id), o = p.obs;
    obsBack = back;
    $("#soId").textContent = `${p.id} · ${p.volumes} volume${p.volumes > 1 ? "s" : ""}`;
    $("#soCli").textContent = `${p.cliente} · ${p.cidade}`;
    $("#soList").innerHTML = obsLinhas(o).map(([n, nome]) => `<div class="so-row"><b>${n}</b><span>${esc(nome)}</span></div>`).join("");
    $("#soAt").hidden = !o.atencao;
    $("#soAtT").textContent = o.atencao || "";
    const em = o.em ? new Date(o.em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "";
    $("#soPor").textContent = `Conferido por ${o.por || "—"}${em ? ` às ${em}` : ""}`;
    openSheet("sheetObs");
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-obs]"); if (!b) return;
    e.stopPropagation();
    openObs(b.dataset.obs, $("#sheetCarga").hidden ? null : "sheetCarga");
  }, true);
  $("#soClose").addEventListener("click", () => (obsBack ? openSheet(obsBack) : closeSheets()));

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
    $("#sfSub").textContent = parcial ? `${falt.length} volume(s) não foram lidos e ficarão na doca.` : `${totVol(c)} volumes no veículo ${c.placa}.`;
    $("#sfMissing").innerHTML = falt.map(({ p, v }) => `<div class="line"><span class="dot falta">!</span>
      <span class="line-desc"><b>${p.id}</b> · volume ${v}/${p.volumes}<small>${esc(p.cliente)}</small></span></div>`).join("");
    $("#sfObsWrap").hidden = !parcial;
    const go = $("#sfGo");
    go.className = "btn block " + (parcial ? "danger" : "primary");
    go.textContent = parcial ? "Embarcar parcial" : "Confirmar embarque";
    openSheet("sheetFinish");
  });

  $("#sfGo").addEventListener("click", () => {
    const c = cur, parcial = lidos(c) < totVol(c);
    Object.assign(c, { status: parcial ? "parcial" : "embarcada", fim: Date.now(), obs: $("#sfObs").value.trim() });
    save(); closeSheets();
    const mins = Math.max(1, Math.round((c.fim - c.inicio) / 60000));
    $("#ldTitle").textContent = parcial ? "Embarque parcial registrado" : "Carga embarcada";
    $("#ldSub").textContent = `${c.id} · ${c.rota} · ${c.veiculo} ${c.placa}`;
    $("#ldTime").textContent = mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, "0")}`;
    $("#ldVol").textContent = `${lidos(c)}/${totVol(c)}`;
    $("#ldPed").textContent = c.pedidos.length;
    $("#ldMissing").innerHTML = parcial ? $("#sfMissing").innerHTML : "";
    $("#viewLoadDone .done-check").classList.toggle("warn", parcial);
    vibrate([40, 60, 120]);
    show("viewLoadDone");
  });
  $("#ldBack").addEventListener("click", home);

  return { home };
})();
