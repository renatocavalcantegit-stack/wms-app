// WMS Beach Bike — Gestão de Expedição (web)
// Quadros estilo kanban: caixa de entrada à esquerda, uma coluna por separador/conferente/carga à direita.
(() => {
  "use strict";

  const W = window.WMS;
  const sess = W.session();
  if (!sess || sess.perfil !== "coord") { location.replace("./"); return; }

  const STORE = "wms-bb-gestao-v1";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const now = () => Date.now();
  const MIN = 60000;

  // ---------- cadastros de demonstração ----------
  const SEPS = [
    { id: "s1", nome: "Marcos Silva" }, { id: "s2", nome: "Joana Lima" }, { id: "s3", nome: "Rafael Souza" },
    { id: "s4", nome: "Bruno Alves" }, { id: "s5", nome: "Larissa Melo" }, { id: "s6", nome: "Thiago Nunes" },
  ];
  const CONFS = [
    { id: "c1", nome: "Ana Paula" }, { id: "c2", nome: "Carla Dias" }, { id: "c3", nome: "Diego Rocha" }, { id: "c4", nome: "Vanessa Reis" },
  ];
  const PEOPLE = [...SEPS, ...CONFS];
  const AV = ["#E10600", "#0E0E10", "#2563EB", "#EA580C", "#16A34A", "#7C3AED", "#0891B2", "#A16207", "#DB2777", "#475569"];
  const ROTAS = { "Recife / RMR": "#2563EB", "Agreste": "#EA580C", "Sertão": "#A16207", "Zona da Mata": "#16A34A", "Litoral Sul": "#0891B2" };
  const VEICULOS = { VUC: 40, Toco: 80, Truck: 140 };
  const MOTORISTAS = ["José Carlos", "Severino Lima", "Antônio Neto", "Cícero Gomes", "Edilson Ramos"];
  const VENDEDORES = ["Paulo Henrique", "Fernanda Costa", "Lucas Martins", "Patrícia Rocha"];
  const CLIENTES = [
    { cod: "C0412", nome: "Casa do Ciclista", cidade: "Recife · PE", rota: "Recife / RMR" },
    { cod: "C0388", nome: "Speed Bikes Boa Viagem", cidade: "Recife · PE", rota: "Recife / RMR" },
    { cod: "C0291", nome: "Pedal & Cia Bikes", cidade: "Olinda · PE", rota: "Recife / RMR" },
    { cod: "C0517", nome: "Mundo Pedal", cidade: "Jaboatão · PE", rota: "Recife / RMR" },
    { cod: "C0144", nome: "Rota Bike Caruaru", cidade: "Caruaru · PE", rota: "Agreste" },
    { cod: "C0203", nome: "Pedala Garanhuns", cidade: "Garanhuns · PE", rota: "Agreste" },
    { cod: "C0655", nome: "Bike Center Gravatá", cidade: "Gravatá · PE", rota: "Agreste" },
    { cod: "C0078", nome: "Trilha Livre Bike Shop", cidade: "Petrolina · PE", rota: "Sertão" },
    { cod: "C0731", nome: "Sertão Bikes", cidade: "Serra Talhada · PE", rota: "Sertão" },
    { cod: "C0349", nome: "Ciclo Mata Sul", cidade: "Palmares · PE", rota: "Zona da Mata" },
    { cod: "C0462", nome: "Vitória Bikes", cidade: "Vitória de Sto. Antão · PE", rota: "Zona da Mata" },
    { cod: "C0590", nome: "Porto Bike Store", cidade: "Ipojuca · PE", rota: "Litoral Sul" },
    { cod: "C0611", nome: "Bike Praia Tamandaré", cidade: "Tamandaré · PE", rota: "Litoral Sul" },
  ];

  // ---------- aleatório (semente fixa nos dados iniciais) ----------
  let rnd = Math.random;
  const mulberry32 = (a) => () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const rint = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const shuffle = (a) => { const c = [...a]; for (let i = c.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [c[i], c[j]] = [c[j], c[i]]; } return c; };

  // ---------- helpers de pedido ----------
  let db;
  const P = (id) => db.pedidos[id];
  const units = (p) => p.itens.reduce((t, i) => t + i.qtd, 0);
  const doneU = (p, k) => p.itens.reduce((t, i) => t + Math.min(i[k], i.qtd), 0);
  const itensOk = (p, k) => p.itens.filter((i) => i[k] >= i.qtd).length;
  const pct = (p, k) => Math.round((doneU(p, k) / units(p)) * 100);
  const live = (p, k) => !!(p[k] && p[k].inicio && !p[k].fim);
  const curItem = (p, k) => p.itens.find((i) => i[k] < i.qtd);
  const nameOf = (id) => (PEOPLE.find((x) => x.id === id) || {}).nome || "—";
  const initials = (n) => n.split(" ").map((x) => x[0]).slice(0, 2).join("");
  const avColor = (id) => AV[PEOPLE.findIndex((x) => x.id === id) % AV.length];
  const log = (p, txt, t = now()) => p.hist.push({ t, txt });
  const fillUnits = (p, k, frac) => { let n = Math.round(units(p) * frac); p.itens.forEach((i) => { const a = Math.min(i.qtd, n); i[k] = a; n -= a; }); };
  const cargaVol = (c) => c.pedidos.reduce((t, id) => t + (P(id).volumes || 0), 0);
  const placa = () => { const L = "ABCDEFGHJKLMNPQRSTUVWXYZ"; return `${pick(L)}${pick(L)}${pick(L)}-${rint(1, 9)}${pick(L)}${rint(10, 99)}`; };

  function makePedido({ semRota = false, prio = false, criado = now(), rota = null } = {}) {
    const cli = rota ? pick(CLIENTES.filter((c) => c.rota === rota)) : pick(CLIENTES);
    const prods = shuffle(W.PRODUTOS).slice(0, rint(2, 6));
    const itens = prods.map((x) => ({ sku: x.sku, ean: x.ean, desc: x.desc, tipo: x.tipo, end: W.ENDERECOS[x.sku], qtd: x.tipo === "bike" ? rint(1, 4) : rint(2, 12), sep: 0, conf: 0 }))
      .sort((a, b) => a.end.localeCompare(b.end, "pt-BR", { numeric: true }));
    const p = {
      id: "PV-" + db.seq++, cli: { cod: cli.cod, nome: cli.nome, cidade: cli.cidade }, vendedor: pick(VENDEDORES),
      rota: semRota ? null : cli.rota, prio: prio ? "alta" : "normal", criado, itens, etapa: "sep",
      sep: { resp: null, atrib: null, inicio: null, fim: null }, conf: { resp: null, atrib: null, inicio: null, fim: null },
      volumes: 0, carga: null, hist: [],
    };
    log(p, "Pedido recebido via integração", criado);
    if (semRota) log(p, "Cliente sem rota cadastrada — aguardando definição", criado);
    db.pedidos[p.id] = p;
    return p;
  }

  function newCarga({ rota, veiculo = "VUC", motorista, doca }) {
    const c = {
      id: "CG-" + String(db.cargaSeq++).padStart(4, "0"), rota, veiculo, cap: VEICULOS[veiculo], placa: placa(),
      motorista: motorista || pick(MOTORISTAS), doca: doca || String(rint(1, 4)).padStart(2, "0"),
      status: "montando", pedidos: [], lidos: 0, inicio: null, fim: null, lacre: "", criado: now(),
    };
    db.emb.cargas.push(c);
    return c;
  }

  // ---------- dados iniciais: cenário com operação em andamento ----------
  function seed() {
    rnd = mulberry32(2026);
    db = { seq: 10431, cargaSeq: 240, pedidos: {}, sep: { inbox: [], cols: {} }, conf: { inbox: [], cols: {} }, emb: { inbox: [], cargas: [] }, done: [], stats: { embarcadas: 3 }, tick: 0 };
    SEPS.forEach((s) => { db.sep.cols[s.id] = []; db.stats[s.id] = rint(4, 11); });
    CONFS.forEach((c) => { db.conf.cols[c.id] = []; db.stats[c.id] = rint(6, 14); });
    const t = now();

    const assign = (p, k, resp, minsAgo) => { p[k].resp = resp; p[k].atrib = t - minsAgo * MIN; log(p, `${k === "sep" ? "Separação" : "Conferência"} atribuída a ${nameOf(resp)}`, p[k].atrib); };
    const startAt = (p, k, frac, minsAgo) => { p[k].inicio = t - minsAgo * MIN; fillUnits(p, k, frac); log(p, `${k === "sep" ? "Separação" : "Conferência"} iniciada por ${nameOf(p[k].resp)}`, p[k].inicio); };
    const sepDone = (p, minsAgo) => {
      const r = pick(SEPS).id; assign(p, "sep", r, minsAgo + rint(18, 30)); startAt(p, "sep", 1, minsAgo + rint(8, 15));
      p.sep.fim = t - minsAgo * MIN; p.volumes = Math.max(1, Math.ceil(units(p) / 10)); p.etapa = "conf";
      log(p, `Separação finalizada por ${nameOf(r)} · ${p.volumes} volume(s)`, p.sep.fim);
    };
    const confDone = (p, minsAgo) => {
      sepDone(p, minsAgo + rint(15, 25)); const r = pick(CONFS).id; assign(p, "conf", r, minsAgo + 12); startAt(p, "conf", 1, minsAgo + 8);
      p.conf.fim = t - minsAgo * MIN; p.etapa = "emb"; log(p, `Conferência finalizada por ${nameOf(r)} · pronto para carga`, p.conf.fim);
    };

    // caixa de entrada da separação (2 sem rota, 2 prioritários)
    [{ prio: true, criado: t - 3 * MIN }, { semRota: true, criado: t - 6 * MIN }, { criado: t - 9 * MIN }, { prio: true, criado: t - 14 * MIN },
     { criado: t - 18 * MIN }, { semRota: true, criado: t - 25 * MIN }, { criado: t - 31 * MIN }]
      .forEach((o) => db.sep.inbox.push(makePedido(o).id));

    // separadores: andamento em vários estágios + filas
    const sepPlan = { s1: [[0.92, 14], 0, 0], s2: [[0.65, 8], 1, 0], s3: [[0.35, 4], 0, 0, 0], s4: [[0.1, 1]], s5: ["wait", 0], s6: [] };
    Object.entries(sepPlan).forEach(([sid, plan]) => plan.forEach((step, i) => {
      const p = makePedido({ criado: t - rint(35, 80) * MIN, prio: step === 1 });
      assign(p, "sep", sid, Array.isArray(step) ? step[1] + 2 : rint(2, 10));
      if (Array.isArray(step)) startAt(p, "sep", step[0], step[1]);
      if (step === "wait") p.sep.atrib = t; // acabou de ser atribuído, ainda não começou
      db.sep.cols[sid].push(p.id);
    }));

    // caixa de entrada da conferência (separados)
    [3, 6, 9, 12].forEach((m) => { const p = makePedido({ criado: t - 90 * MIN }); sepDone(p, m); db.conf.inbox.push(p.id); });

    // conferentes
    const confPlan = { c1: [[0.8, 6], 0], c2: [[0.4, 3]], c3: [[0.05, 1], 0, 0], c4: [] };
    Object.entries(confPlan).forEach(([cid, plan]) => plan.forEach((step) => {
      const p = makePedido({ criado: t - 100 * MIN }); sepDone(p, rint(10, 30));
      assign(p, "conf", cid, Array.isArray(step) ? step[1] + 1 : rint(2, 6));
      if (Array.isArray(step)) startAt(p, "conf", step[0], step[1]);
      db.conf.cols[cid].push(p.id);
    }));

    // embarque: conferidos aguardando carga
    ["Recife / RMR", "Litoral Sul", "Litoral Sul", "Agreste", "Zona da Mata", "Sertão"].forEach((r, i) => {
      const p = makePedido({ rota: r, criado: t - 140 * MIN }); confDone(p, 4 + i * 3); db.emb.inbox.push(p.id);
    });

    // cargas em estados diferentes
    const fill = (c, rota, n) => { for (let i = 0; i < n; i++) { const p = makePedido({ rota, criado: t - 160 * MIN }); confDone(p, 20 + i * 4); p.carga = c.id; c.pedidos.push(p.id); log(p, `Incluído na carga ${c.id}`, t - 15 * MIN); } };
    const c0 = newCarga({ rota: "Zona da Mata", veiculo: "VUC", motorista: "Cícero Gomes", doca: "04" }); fill(c0, "Zona da Mata", 2);
    Object.assign(c0, { status: "embarcada", lidos: cargaVol(c0), inicio: t - 40 * MIN, fim: t - 22 * MIN, lacre: "004498" });
    const c1 = newCarga({ rota: "Recife / RMR", veiculo: "VUC", motorista: "José Carlos", doca: "02" }); fill(c1, "Recife / RMR", 3);
    const c2 = newCarga({ rota: "Agreste", veiculo: "Toco", motorista: "Severino Lima", doca: "03" }); fill(c2, "Agreste", 4);
    Object.assign(c2, { status: "carregando", inicio: t - 7 * MIN, lidos: Math.floor(cargaVol(c2) * 0.4) });
    const c3 = newCarga({ rota: "Sertão", veiculo: "Truck", motorista: "Antônio Neto", doca: "01" }); fill(c3, "Sertão", 2);

    rnd = Math.random;
    save();
  }

  function load() {
    try { const d = JSON.parse(localStorage.getItem(STORE)); if (d && d.pedidos && d.sep) { db = d; return; } } catch {}
    seed();
  }
  const save = () => localStorage.setItem(STORE, JSON.stringify(db));

  // ---------- estado de tela ----------
  let board = localStorage.getItem("wms-bb-gx-board") || "sep";
  let filters = { sep: "todos", conf: "todos", emb: "todas" };
  let query = "";
  let openId = null;
  let sim = localStorage.getItem("wms-bb-gx-sim") !== "off";
  let flashId = null;
  let dragId = null, pendingRender = false;

  // ---------- formatação ----------
  const fmtDur = (ms) => {
    const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return (h ? h + ":" + String(m).padStart(2, "0") : String(m).padStart(2, "0")) + ":" + String(x).padStart(2, "0");
  };
  const fmtAge = (ts) => { const m = Math.floor((now() - ts) / MIN); return m < 1 ? "agora" : m < 60 ? `há ${m} min` : `há ${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`; };
  const fmtTime = (ts) => new Date(ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const rotaTag = (r) => (r ? `<span class="rt" style="--rc:${ROTAS[r] || "#999"}"><i></i>${esc(r)}</span>` : `<span class="rt none">SEM ROTA</span>`);
  const ICON_USER = '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/></svg>';
  const CHECK = '<svg viewBox="0 0 24 24"><path d="M5 12l5 5 9-10"/></svg>';

  let toastT;
  function toast(m) { const t = $("#toast"); t.textContent = m; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 2600); }

  // ---------- localização / movimento ----------
  function locate(id) {
    const p = P(id);
    if (p.etapa === "sep" || p.etapa === "conf") {
      const B = db[p.etapa];
      if (B.inbox.includes(id)) return { list: B.inbox, col: "inbox" };
      for (const [k, l] of Object.entries(B.cols)) if (l.includes(id)) return { list: l, col: k };
    }
    if (p.etapa === "emb") {
      if (db.emb.inbox.includes(id)) return { list: db.emb.inbox, col: "inbox" };
      const c = db.emb.cargas.find((x) => x.pedidos.includes(id));
      if (c) return { list: c.pedidos, col: c.id, carga: c };
    }
    return null;
  }

  // núcleo do movimento (sem render); retorna mensagem de erro ou null
  function moveCore(id, toCol, idx) {
    const p = P(id), from = locate(id), k = p.etapa;
    if (!from) return "Pedido não encontrado";
    if (k === "sep" || k === "conf") {
      if (live(p, k)) return "Pedido em andamento não pode ser movido";
      const B = db[k], to = toCol === "inbox" ? B.inbox : B.cols[toCol];
      const label = k === "sep" ? "Separação" : "Conferência";
      from.list.splice(from.list.indexOf(id), 1);
      if (idx == null) idx = to.length;
      if (toCol !== "inbox" && to[0] && live(P(to[0]), k)) idx = Math.max(1, idx);
      idx = Math.min(Math.max(0, idx), to.length);
      to.splice(idx, 0, id);
      if (from.col !== toCol) {
        p[k].resp = toCol === "inbox" ? null : toCol;
        p[k].atrib = toCol === "inbox" ? null : now();
        log(p, toCol === "inbox" ? "Devolvido à caixa de entrada" : `${label} atribuída a ${nameOf(toCol)} · ${idx + 1}º da fila`);
      } else if (toCol !== "inbox") log(p, `Prioridade alterada na fila de ${nameOf(toCol)} · ${idx + 1}º`);
      return null;
    }
    if (k === "emb") {
      const toC = toCol === "inbox" ? null : db.emb.cargas.find((c) => c.id === toCol);
      if (from.carga && from.carga.status !== "montando" && from.carga !== toC) return "Carga já liberada — não é possível retirar pedidos";
      if (toC && toC.status !== "montando") return "Carga já liberada para carregamento";
      if (toC && from.carga !== toC && cargaVol(toC) + p.volumes > toC.cap) return `Capacidade excedida: ${toC.veiculo} comporta ${toC.cap} volumes`;
      const to = toC ? toC.pedidos : db.emb.inbox;
      from.list.splice(from.list.indexOf(id), 1);
      if (idx == null) idx = to.length;
      to.splice(Math.min(Math.max(0, idx), to.length), 0, id);
      if (from.col !== toCol) { p.carga = toC ? toC.id : null; log(p, toC ? `Incluído na carga ${toC.id} (${toC.rota})` : "Retirado da carga"); }
      else if (toC) log(p, `Ordem de entrega alterada na carga ${toC.id}`);
      return null;
    }
    return "Etapa encerrada";
  }

  function move(id, toCol, idx, checked = false) {
    const p = P(id), k = p.etapa;
    // regra: pedido sem rota não vai para separador sem antes definir a rota
    if (!checked && k === "sep" && toCol !== "inbox" && !p.rota) return askRota(id, () => move(id, toCol, idx, true));
    // embarque: alerta de rota diferente da carga
    if (!checked && k === "emb" && toCol !== "inbox") {
      const c = db.emb.cargas.find((x) => x.id === toCol), from = locate(id);
      if (c && from.carga !== c && c.status === "montando" && p.rota !== c.rota)
        return confirmBox("Rota diferente da carga", `${p.id} é da rota <b>${esc(p.rota || "sem rota")}</b> e a carga ${c.id} atende <b>${esc(c.rota)}</b>. Incluir mesmo assim?`, "Incluir na carga", () => move(id, toCol, idx, true));
    }
    const err = moveCore(id, toCol, idx);
    if (err) { toast(err); render(); return; }
    flashId = id;
    save(); render(); if (openId) renderDrawer();
    const dest = toCol === "inbox" ? "caixa de entrada" : k === "emb" ? `carga ${toCol}` : nameOf(toCol);
    toast(`${id} → ${dest}`);
  }

  // ---------- render ----------
  function render() {
    if (dragId) { pendingRender = true; return; }
    const scrolls = {}; $$(".gx-list").forEach((l) => (scrolls[l.dataset.col] = l.scrollTop));
    const bx = $("#board").scrollLeft;
    $("#board").innerHTML = board === "emb" ? renderEmb() : renderPeople(board);
    $$(".gx-list").forEach((l) => { if (scrolls[l.dataset.col]) l.scrollTop = scrolls[l.dataset.col]; });
    $("#board").scrollLeft = bx;
    renderTop(); applySearch(); tickTimers();
    flashId = null;
  }

  function renderTop() {
    $$(".gx-tab").forEach((b) => b.classList.toggle("active", b.dataset.board === board));
    $("#tbSep").textContent = db.sep.inbox.length;
    $("#tbConf").textContent = db.conf.inbox.length;
    $("#tbEmb").textContent = db.emb.inbox.length;
    $("#simBtn").classList.toggle("on", sim);
    $("#simBtn span").textContent = sim ? "Simulação ao vivo" : "Simulação pausada";

    const kp = (n, l, cls = "") => `<span class="gx-kpi ${cls}"><b>${n}</b>${l}</span>`;
    if (board === "emb") {
      const vol = db.emb.inbox.reduce((t, id) => t + P(id).volumes, 0), cs = db.emb.cargas;
      $("#boardTitle").textContent = "Montagem de cargas";
      $("#kpis").innerHTML = kp(db.emb.inbox.length, "aguardando carga") + kp(vol, "volumes") + kp(cs.filter((c) => c.status === "montando").length, "montando")
        + kp(cs.filter((c) => c.status === "carregando" || c.status === "liberada").length, "carregando") + kp(db.stats.embarcadas + cs.filter((c) => c.status === "embarcada").length, "embarcadas hoje", "green");
      $("#actions").innerHTML = `<span class="hint">Cargas liberadas aparecem no app de Embarque</span>
        <button class="btn ghost" data-act="autoCargas">Montar cargas automaticamente</button>
        <button class="btn primary" data-act="novaCarga">+ Nova carga</button>`;
    } else {
      const B = db[board], k = board, cols = Object.values(B.cols);
      const liveN = cols.filter((l) => l[0] && live(P(l[0]), k)).length;
      const filaN = cols.reduce((t, l) => t + l.filter((id) => !live(P(id), k)).length, 0);
      const people = k === "sep" ? SEPS : CONFS;
      const hoje = people.reduce((t, x) => t + db.stats[x.id], 0);
      $("#boardTitle").textContent = k === "sep" ? "Distribuição da separação" : "Distribuição da conferência";
      $("#kpis").innerHTML = kp(B.inbox.length, "na caixa de entrada")
        + (k === "sep" ? kp(B.inbox.filter((id) => !P(id).rota).length, "sem rota", "red") : "")
        + kp(liveN, k === "sep" ? "em separação" : "em conferência") + kp(filaN, "na fila") + kp(hoje, k === "sep" ? "separados hoje" : "conferidos hoje", "green");
      $("#actions").innerHTML = (k === "sep" ? `<button class="btn ghost" data-act="novoPedido">+ Pedido de teste</button>` : "")
        + `<button class="btn primary" data-act="autoDist">Distribuir automaticamente</button>`;
    }
  }

  // card de pedido
  function card(p, k, opts = {}) {
    const isLive = k !== "emb" && live(p, k);
    const waiting = opts.first && !isLive && k !== "emb" && opts.col !== "inbox";
    const cls = ["card", !p.rota && "no-route", isLive && "live", waiting && "waiting", flashId === p.id && "flash"].filter(Boolean).join(" ");
    const draggable = !isLive && !opts.locked;
    const nums = `<span><b>${p.itens.length}</b> SKUs</span><span><b>${units(p)}</b> un.</span>${p.volumes ? `<span><b>${p.volumes}</b> vol.</span>` : ""}`;
    let liveHtml = "";
    if (isLive) {
      const c = curItem(p, k), pc = pct(p, k);
      liveHtml = `<div class="c-live">
        <div class="cl-row"><span class="cl-tag"><i></i>${k === "sep" ? "Separando agora" : "Conferindo agora"}</span><span class="timer" data-since="${p[k].inicio}">00:00</span></div>
        <div class="cl-bar"><i style="width:${pc}%"></i></div>
        <div class="cl-row small"><b>${pc}%</b><span>${itensOk(p, k)}/${p.itens.length} itens · ${doneU(p, k)}/${units(p)} un.</span></div>
        ${c ? `<p class="cl-cur"><span class="gaddr">${c.end}</span>${esc(c.desc)}</p>` : ""}
      </div>`;
    } else if (waiting) {
      liveHtml = `<div class="c-live"><div class="cl-row"><span class="cl-tag"><i></i>Aguardando início</span><span class="timer" data-since="${p[k].atrib || now()}">00:00</span></div></div>`;
    }
    return `<article class="${cls}" draggable="${draggable}" data-id="${p.id}" style="--rc:${p.rota ? ROTAS[p.rota] : "var(--red-brand)"}">
      <div class="c-top">${rotaTag(p.rota)}${p.prio === "alta" ? `<span class="c-prio">PRIORIDADE</span>` : ""}${opts.pos ? `<span class="c-pos">${opts.pos}</span>` : ""}</div>
      <div class="c-main"><p class="c-id">${p.id}</p><span class="c-age">${opts.col === "inbox" ? fmtAge(k === "sep" ? p.criado : k === "conf" ? p.sep.fim : p.conf.fim) : ""}</span></div>
      <p class="c-cli"><b>${p.cli.cod}</b>${esc(p.cli.nome)}</p>
      <p class="c-vend">${ICON_USER}Vend.: ${esc(p.vendedor)}</p>
      <div class="c-nums">${nums}</div>
      ${k === "conf" && !isLive && p.sep.resp ? `<p class="c-from">Separado por ${esc(nameOf(p.sep.resp))}</p>` : ""}
      ${liveHtml}
    </article>`;
  }

  const sortInbox = (ids, k) => [...ids].sort((a, b) => {
    const A = P(a), B = P(b);
    if (k === "sep" && !A.rota !== !B.rota) return !A.rota ? -1 : 1; // sem rota primeiro (precisa de ação)
    if (A.prio !== B.prio) return A.prio === "alta" ? -1 : 1;
    return 0; // mantém a ordem manual
  });

  function inboxCol(k) {
    const B = db[k];
    const f = filters[k];
    let ids = sortInbox(B.inbox, k);
    if (k === "sep" && f === "semrota") ids = ids.filter((id) => !P(id).rota);
    if (f === "prio") ids = ids.filter((id) => P(id).prio === "alta");
    if (k === "emb" && f !== "todas") ids = ids.filter((id) => P(id).rota === f);
    let chips;
    if (k === "emb") {
      const rotas = [...new Set(B.inbox.map((id) => P(id).rota).filter(Boolean))];
      chips = `<button class="gchip ${f === "todas" ? "active" : ""}" data-filter="todas">Todas <b>${B.inbox.length}</b></button>`
        + rotas.map((r) => `<button class="gchip ${f === r ? "active" : ""}" data-filter="${esc(r)}" style="--rc:${ROTAS[r]}"><i></i>${esc(r)} <b>${B.inbox.filter((id) => P(id).rota === r).length}</b></button>`).join("");
    } else {
      const sr = B.inbox.filter((id) => !P(id).rota).length, pr = B.inbox.filter((id) => P(id).prio === "alta").length;
      chips = `<button class="gchip ${f === "todos" ? "active" : ""}" data-filter="todos">Todos <b>${B.inbox.length}</b></button>`
        + (k === "sep" ? `<button class="gchip red ${f === "semrota" ? "active" : ""}" data-filter="semrota">Sem rota <b>${sr}</b></button>` : "")
        + `<button class="gchip ${f === "prio" ? "active" : ""}" data-filter="prio">Prioridade <b>${pr}</b></button>`;
    }
    const title = { sep: "Caixa de entrada", conf: "Separados", emb: "Conferidos" }[k];
    const sub = { sep: "Pedidos recebidos aguardando separador", conf: "Aguardando conferente", emb: "Aguardando carga" }[k];
    return `<section class="col inbox">
      <header class="col-head">
        <div class="ch-row"><h3>${title}</h3><span class="count">${B.inbox.length}</span></div>
        <p class="ch-sub">${sub}</p>
        <div class="gchips">${chips}</div>
      </header>
      <div class="gx-list" data-col="inbox">${ids.map((id) => card(P(id), k, { col: "inbox" })).join("") || `<div class="col-empty">Nada por aqui 🎉</div>`}</div>
    </section>`;
  }

  function personCol(k, person) {
    const l = db[k].cols[person.id];
    const first = l[0] && P(l[0]);
    const busy = first && live(first, k);
    const pend = l.reduce((t, id) => t + units(P(id)) - doneU(P(id), k), 0);
    const st = busy ? `<span class="st work"><i></i>${k === "sep" ? "Separando" : "Conferindo"}</span>`
      : l.length ? `<span class="st wait"><i></i>Aguardando início</span>` : `<span class="st"><i></i>Livre</span>`;
    const cards = l.map((id, i) => card(P(id), k, { col: person.id, first: i === 0, pos: busy && i === 0 ? "" : `${busy ? i : i + 1}º` })).join("");
    return `<section class="col">
      <header class="col-head">
        <div class="person">
          <span class="avatar" style="--av:${avColor(person.id)}">${initials(person.nome)}</span>
          <div class="person-n"><div class="ch-row"><h3>${esc(person.nome)}</h3></div>${st}</div>
        </div>
        <div class="metrics">
          <div><b>${l.length}</b><small>pedidos</small></div>
          <div><b>${pend}</b><small>un. pendentes</small></div>
          <div><b>${db.stats[person.id]}</b><small>hoje</small></div>
        </div>
      </header>
      <div class="gx-list" data-col="${person.id}">${cards || `<div class="col-empty">Arraste pedidos para cá</div>`}</div>
    </section>`;
  }

  const renderPeople = (k) => inboxCol(k) + (k === "sep" ? SEPS : CONFS).map((x) => personCol(k, x)).join("");

  function cargaCol(c) {
    const vol = cargaVol(c), capPct = Math.min(100, (vol / c.cap) * 100);
    const label = { montando: "Montando", liberada: "Liberada", carregando: "Carregando", embarcada: "Embarcada" }[c.status];
    const locked = c.status !== "montando";
    const cards = c.pedidos.map((id, i) => card(P(id), "emb", { col: c.id, locked, pos: `${i + 1}ª entrega` })).join("");
    let foot;
    if (c.status === "montando") foot = `<button class="btn primary block" data-act="liberar" data-carga="${c.id}" ${c.pedidos.length ? "" : "disabled"}>Liberar para carregamento</button>`;
    else if (c.status === "liberada") foot = `<p>Liberada · aguardando início no app de Embarque (doca ${c.doca})</p>`;
    else {
      const lp = vol ? Math.round((c.lidos / vol) * 100) : 0;
      foot = `<div class="load-prog">
        <div class="cl-row"><span class="cl-tag" style="color:${c.status === "embarcada" ? "var(--ok)" : "var(--warn)"}">${c.status === "embarcada" ? "Embarcada" : "Carregando"}</span>
          <span class="timer" ${c.status === "embarcada" ? "" : `data-since="${c.inicio}"`}>${c.status === "embarcada" ? fmtDur(c.fim - c.inicio) : "00:00"}</span></div>
        <div class="cl-bar"><i style="width:${lp}%"></i></div>
        <div class="cl-row small"><b>${c.lidos}/${vol}</b><span>volumes${c.lacre ? ` · lacre ${c.lacre}` : ""}</span></div>
      </div>${c.status === "embarcada" ? `<button class="btn ghost block" data-act="arquivar" data-carga="${c.id}">Arquivar carga</button>` : ""}`;
    }
    return `<section class="col carga st-${c.status}">
      <header class="col-head">
        <div class="ch-row"><h3>${c.id}</h3><span class="count">${c.pedidos.length}</span><span class="cst ${c.status}">${label}</span></div>
        <div class="ch-row">${rotaTag(c.rota)}<span class="doca">Doca ${c.doca}</span></div>
        <div class="truck-line"><span class="plate">${c.placa}</span><span>${c.veiculo} · ${esc(c.motorista)}</span></div>
        <div class="cap"><div class="cap-bar ${vol > c.cap * 0.9 ? "hi" : ""}"><i style="width:${capPct}%"></i></div><span><b>${vol}</b>/${c.cap} vol.</span></div>
      </header>
      <div class="gx-list" data-col="${c.id}">${cards || `<div class="col-empty">Arraste pedidos conferidos para cá</div>`}</div>
      <footer class="col-foot">${foot}</footer>
    </section>`;
  }

  const renderEmb = () => inboxCol("emb") + db.emb.cargas.map(cargaCol).join("") + `<button class="col-new" data-act="novaCarga">+ Nova carga</button>`;

  // ---------- busca ----------
  function applySearch() {
    const q = query.trim().toLowerCase();
    $$(".card").forEach((c) => {
      const p = P(c.dataset.id);
      const hay = `${p.id} ${p.cli.cod} ${p.cli.nome} ${p.vendedor} ${p.rota || "sem rota"} ${p.cli.cidade}`.toLowerCase();
      c.classList.toggle("q-miss", !!q && !hay.includes(q));
    });
  }
  $("#search").addEventListener("input", (e) => { query = e.target.value; applySearch(); });

  // ---------- cronômetros ----------
  function tickTimers() {
    $$(".timer[data-since]").forEach((el) => (el.textContent = fmtDur(now() - +el.dataset.since)));
  }
  setInterval(tickTimers, 1000);

  // ---------- arrastar e soltar ----------
  const ph = document.createElement("div"); ph.className = "ph";
  const boardEl = $("#board");
  boardEl.addEventListener("dragstart", (e) => {
    const c = e.target.closest(".card");
    if (!c || c.getAttribute("draggable") !== "true") { e.preventDefault(); return; }
    dragId = c.dataset.id;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", dragId);
    ph.style.height = c.offsetHeight + "px";
    requestAnimationFrame(() => c.classList.add("dragging"));
  });
  boardEl.addEventListener("dragover", (e) => {
    const list = e.target.closest(".gx-list");
    if (!list || !dragId) return;
    e.preventDefault();
    const cards = $$(".card:not(.dragging)", list);
    let before = null;
    for (const c of cards) { const r = c.getBoundingClientRect(); if (e.clientY < r.top + r.height / 2) { before = c; break; } }
    if (before && before.classList.contains("live")) before = cards[cards.indexOf(before) + 1] || null; // não passa à frente do que está em andamento
    if (before) list.insertBefore(ph, before); else list.appendChild(ph);
    $$(".gx-list.over").forEach((l) => l !== list && l.classList.remove("over"));
    list.classList.add("over");
  });
  boardEl.addEventListener("drop", (e) => {
    const list = e.target.closest(".gx-list");
    if (!list || !dragId) return;
    e.preventDefault();
    const seq = [...list.children].filter((x) => x === ph || (x.classList.contains("card") && !x.classList.contains("dragging")));
    let idx = seq.indexOf(ph);
    const id = dragId, col = list.dataset.col;
    // na caixa de entrada a lista exibida pode estar filtrada/ordenada: índice relativo à lista real
    if (col === "inbox") {
      const real = (board === "emb" ? db.emb.inbox : db[board].inbox).filter((x) => x !== id);
      const after = seq[idx + 1];
      idx = after ? real.indexOf(after.dataset.id) : real.length;
      if (idx < 0) idx = real.length;
    }
    endDrag();
    move(id, col, idx);
  });
  boardEl.addEventListener("dragend", endDrag);
  function endDrag() {
    ph.remove();
    $$(".dragging").forEach((x) => x.classList.remove("dragging"));
    $$(".gx-list.over").forEach((l) => l.classList.remove("over"));
    dragId = null;
    if (pendingRender) { pendingRender = false; render(); }
  }

  // ---------- cliques no quadro ----------
  boardEl.addEventListener("click", (e) => {
    const f = e.target.closest("[data-filter]");
    if (f) { filters[board] = f.dataset.filter; render(); return; }
    const a = e.target.closest("[data-act]");
    if (a) return action(a.dataset.act, a.dataset);
    const c = e.target.closest(".card");
    if (c) openDrawer(c.dataset.id);
  });
  $("#actions").addEventListener("click", (e) => { const a = e.target.closest("[data-act]"); if (a) action(a.dataset.act, a.dataset); });

  function action(act, data) {
    if (act === "novoPedido") {
      const p = makePedido({ semRota: Math.random() < 0.3, prio: Math.random() < 0.2 });
      db.sep.inbox.unshift(p.id); flashId = p.id; save(); render();
      toast(`${p.id} recebido${p.rota ? "" : " · SEM ROTA"}`);
    }
    if (act === "autoDist") autoDistribute(board);
    if (act === "autoCargas") autoCargas();
    if (act === "novaCarga") novaCarga();
    if (act === "liberar") {
      const c = db.emb.cargas.find((x) => x.id === data.carga);
      confirmBox(`Liberar ${c.id}?`, `A carga <b>${esc(c.rota)}</b> com ${c.pedidos.length} pedido(s) e ${cargaVol(c)} volume(s) será liberada para carregamento na <b>doca ${c.doca}</b> (${c.veiculo} ${c.placa}). Depois disso, não é possível incluir ou retirar pedidos.`, "Liberar carga", () => {
        c.status = "liberada"; c.liberada = now();
        c.pedidos.forEach((id) => log(P(id), `Carga ${c.id} liberada para carregamento (doca ${c.doca})`));
        save(); render(); toast(`${c.id} liberada · disponível no app de Embarque`);
      });
    }
    if (act === "arquivar") {
      const c = db.emb.cargas.find((x) => x.id === data.carga);
      c.pedidos.forEach((id) => { P(id).etapa = "fim"; db.done.push(id); });
      db.emb.cargas.splice(db.emb.cargas.indexOf(c), 1);
      db.stats.embarcadas++;
      save(); render(); toast(`${c.id} arquivada`);
    }
  }

  // distribui pelo menor volume de trabalho pendente (balanceamento)
  function autoDistribute(k) {
    const B = db[k];
    const cand = sortInbox(B.inbox, k).filter((id) => k !== "sep" || P(id).rota);
    const skipped = B.inbox.length - cand.length;
    if (!cand.length) return toast(skipped ? "Defina a rota dos pedidos antes de distribuir" : "Caixa de entrada vazia");
    const loadOf = (pid) => B.cols[pid].reduce((t, id) => t + units(P(id)) - doneU(P(id), k), 0);
    const ids = Object.keys(B.cols);
    cand.forEach((id) => {
      const pid = ids.slice().sort((a, b) => loadOf(a) - loadOf(b))[0];
      moveCore(id, pid, null);
    });
    save(); render();
    toast(`${cand.length} pedido(s) distribuído(s) por carga de trabalho${skipped ? ` · ${skipped} sem rota ficaram na caixa` : ""}`);
  }

  // agrupa por rota: completa cargas em montagem da mesma rota e cria novas com o menor veículo que comporta
  function autoCargas() {
    const groups = {};
    db.emb.inbox.forEach((id) => { const r = P(id).rota; if (r) (groups[r] = groups[r] || []).push(id); });
    let moved = 0, created = 0;
    Object.entries(groups).forEach(([rota, ids]) => {
      ids.forEach((id) => {
        const p = P(id);
        let c = db.emb.cargas.find((x) => x.status === "montando" && x.rota === rota && cargaVol(x) + p.volumes <= x.cap);
        if (!c) {
          const total = ids.reduce((t, x) => t + (db.emb.inbox.includes(x) ? P(x).volumes : 0), 0);
          const veic = Object.entries(VEICULOS).find(([, cap]) => cap >= total)?.[0] || "Truck";
          c = newCarga({ rota, veiculo: veic }); created++;
        }
        if (!moveCore(id, c.id, null)) moved++;
      });
    });
    save(); render();
    toast(moved ? `${moved} pedido(s) alocados${created ? ` · ${created} carga(s) criada(s)` : ""}` : "Nenhum pedido para alocar");
  }

  // ---------- modais ----------
  function openModal(html) { $("#modal").innerHTML = html; $("#modal").hidden = false; $("#mScrim").hidden = false; }
  function closeModal() { $("#modal").hidden = true; $("#mScrim").hidden = true; }
  $("#mScrim").addEventListener("click", closeModal);
  $("#modal").addEventListener("click", (e) => { if (e.target.closest("[data-close]")) closeModal(); });

  function confirmBox(title, html, okLabel, onOk) {
    openModal(`<h2>${title}</h2><p>${html}</p><div class="m-act"><button class="btn ghost" data-close>Cancelar</button><button class="btn primary" id="mOk">${okLabel}</button></div>`);
    $("#mOk").onclick = () => { closeModal(); onOk(); };
  }

  const rotaOptions = (sel) => Object.keys(ROTAS).map((r) => `<option ${r === sel ? "selected" : ""}>${esc(r)}</option>`).join("");

  function askRota(id, then) {
    const p = P(id);
    openModal(`<h2>Defina a rota de ${p.id}</h2>
      <p><b>${p.cli.cod} · ${esc(p.cli.nome)}</b> (${esc(p.cli.cidade)}) chegou sem rota. Escolha a rota para liberar a separação — ela fica salva no pedido.</p>
      <label class="field"><span>Rota</span><select id="mRota"><option value="">Selecione…</option>${rotaOptions()}</select></label>
      <div class="m-act"><button class="btn ghost" data-close>Cancelar</button><button class="btn primary" id="mOk">Salvar e continuar</button></div>`);
    $("#mOk").onclick = () => {
      const r = $("#mRota").value; if (!r) return toast("Escolha uma rota");
      p.rota = r; log(p, `Rota definida pelo coordenador: ${r}`); save(); closeModal(); then && then();
    };
  }

  function novaCarga() {
    const rotas = [...new Set(db.emb.inbox.map((id) => P(id).rota).filter(Boolean))];
    openModal(`<h2>Nova carga</h2>
      <label class="field"><span>Rota</span><select id="ncRota">${rotaOptions(rotas[0])}</select></label>
      <div class="row2">
        <label class="field"><span>Veículo</span><select id="ncVeic">${Object.entries(VEICULOS).map(([v, c]) => `<option value="${v}">${v} · até ${c} vol.</option>`).join("")}</select></label>
        <label class="field"><span>Doca</span><select id="ncDoca">${["01", "02", "03", "04"].map((d) => `<option>${d}</option>`).join("")}</select></label>
      </div>
      <label class="field"><span>Motorista</span><select id="ncMot">${MOTORISTAS.map((m) => `<option>${esc(m)}</option>`).join("")}</select></label>
      <div class="m-act"><button class="btn ghost" data-close>Cancelar</button><button class="btn primary" id="mOk">Criar carga</button></div>`);
    $("#mOk").onclick = () => {
      const c = newCarga({ rota: $("#ncRota").value, veiculo: $("#ncVeic").value, motorista: $("#ncMot").value, doca: $("#ncDoca").value });
      save(); closeModal(); render(); toast(`${c.id} criada · arraste os pedidos para ela`);
      requestAnimationFrame(() => (boardEl.scrollLeft = boardEl.scrollWidth));
    };
  }

  $("#userBtn").addEventListener("click", () => {
    openModal(`<h2>${esc(sess.nome)}</h2><p>Perfil: Gestão de Expedição</p>
      <div class="m-act"><button class="btn ghost" id="mReset">Reiniciar dados de demonstração</button><button class="btn primary" id="mOut">Sair</button></div>`);
    $("#mReset").onclick = () => { seed(); closeModal(); closeDrawer(); render(); toast("Cenário de demonstração reiniciado"); };
    $("#mOut").onclick = () => { W.logout(); location.replace("./"); };
  });

  // ---------- gaveta: detalhe do pedido ----------
  function openDrawer(id) { openId = id; $("#drawer").hidden = false; $("#drScrim").hidden = false; renderDrawer(); }
  function closeDrawer() { openId = null; $("#drawer").hidden = true; $("#drScrim").hidden = true; }
  $("#drScrim").addEventListener("click", closeDrawer);

  function stageInfo(p) {
    const loc = locate(p.id);
    if (p.etapa === "sep" || p.etapa === "conf") {
      const k = p.etapa, L = k === "sep" ? "separação" : "conferência";
      if (live(p, k)) return { txt: `Em ${L} · ${nameOf(p[k].resp)}`, cls: "live" };
      if (loc.col === "inbox") return { txt: k === "sep" ? (p.rota ? "Aguardando separador" : "Sem rota · aguardando definição") : "Separado · aguardando conferente", cls: "wait" };
      return { txt: `Na fila de ${nameOf(loc.col)} · ${loc.list.indexOf(p.id) + 1}º`, cls: "wait" };
    }
    if (p.etapa === "emb") {
      if (!loc || loc.col === "inbox") return { txt: "Conferido · aguardando carga", cls: "wait" };
      return { txt: `Carga ${loc.carga.id} · ${{ montando: "em montagem", liberada: "liberada", carregando: "carregando", embarcada: "embarcada" }[loc.carga.status]}`, cls: loc.carga.status === "carregando" ? "live" : "" };
    }
    return { txt: "Embarcado", cls: "" };
  }

  function renderDrawer() {
    const p = openId && P(openId);
    if (!p) return closeDrawer();
    if ($("#drawer").contains(document.activeElement) && document.activeElement.tagName === "SELECT") return; // não atrapalha quem está escolhendo
    const k = p.etapa === "sep" || p.etapa === "conf" ? p.etapa : null;
    const st = stageInfo(p);
    const loc = locate(p.id);
    const isLive = k && live(p, k);
    const c = isLive && curItem(p, k);

    const liveHtml = isLive ? `<div class="dr-live">
        <div class="cl-row"><span class="cl-tag"><i></i>${k === "sep" ? "Separando agora" : "Conferindo agora"} · ${esc(nameOf(p[k].resp))}</span><span class="timer" data-since="${p[k].inicio}">00:00</span></div>
        <div class="cl-row"><span class="big">${pct(p, k)}%</span><span><b>${itensOk(p, k)}</b>/${p.itens.length} itens · <b>${doneU(p, k)}</b>/${units(p)} unidades</span></div>
        <div class="cl-bar"><i style="width:${pct(p, k)}%"></i></div>
        ${c ? `<div class="now"><span class="gaddr">${c.end}</span><p>${esc(c.desc)}<small>${c.sku} · ${c[k]}/${c.qtd} un. ${k === "sep" ? "separadas" : "conferidas"}</small></p></div>` : ""}
      </div>` : "";

    const showConf = p.etapa !== "sep";
    const rows = p.itens.map((i) => {
      const v = k ? i[k] : i.qtd, ok = v >= i.qtd, isNow = c && c === i;
      const dot = ok ? `<span class="sdot ok">${CHECK}</span>` : v > 0 ? `<span class="sdot part" style="--p:${Math.round((v / i.qtd) * 100)}%"></span>` : `<span class="sdot"></span>`;
      return `<tr class="${ok ? "ok" : ""} ${isNow ? "now" : ""}">
        <td>${dot}</td><td><span class="gaddr">${i.end}</span></td>
        <td>${esc(i.desc)}${isNow ? `<span class="now-tag">agora</span>` : ""}<small>${i.sku}</small></td>
        <td class="r">${i.qtd}</td><td class="r">${i.sep}</td>${showConf ? `<td class="r">${i.conf}</td>` : ""}</tr>`;
    }).join("");

    let actions = "";
    if (k && !isLive) {
      const people = k === "sep" ? SEPS : CONFS;
      actions = `<section><h4 class="dr-h">Ações</h4><div class="dr-act">
        <select id="drMove"><option value="">Mover para…</option>${loc.col !== "inbox" ? `<option value="inbox">Caixa de entrada</option>` : ""}
          ${people.filter((x) => x.id !== loc.col).map((x) => `<option value="${x.id}">${esc(x.nome)} (fim da fila)</option>`).join("")}</select>
        <button class="btn primary" id="drMoveGo">Mover</button>
        ${loc.col !== "inbox" && loc.list.indexOf(p.id) > (live(P(loc.list[0]), k) ? 1 : 0) ? `<button class="btn ghost" id="drTop">Passar para o próximo da fila</button>` : ""}
      </div></section>`;
    }

    $("#drawer").innerHTML = `
      <header class="dr-head">
        <div><p class="dr-k">Pedido</p><h2>${p.id}</h2></div>
        <span class="stage ${st.cls}">${esc(st.txt)}</span>
        <button class="dr-x" id="drClose" aria-label="Fechar">×</button>
      </header>
      <div class="dr-body">
        <div class="dr-grid">
          <div class="dr-f"><small>Cliente</small><b>${p.cli.cod} · ${esc(p.cli.nome)}</b><span>${esc(p.cli.cidade)}</span></div>
          <div class="dr-f"><small>Vendedor</small><b>${esc(p.vendedor)}</b><span>Recebido ${fmtAge(p.criado)} · ${fmtTime(p.criado)}</span></div>
          <div class="dr-f"><small>Rota</small><select id="drRota" class="${p.rota ? "" : "warn"}"><option value="">— Sem rota —</option>${rotaOptions(p.rota)}</select></div>
          <div class="dr-f"><small>Prioridade</small><button class="tgl ${p.prio === "alta" ? "on" : ""}" id="drPrio">${p.prio === "alta" ? "▲ Alta" : "Normal"}</button></div>
        </div>
        <div class="dr-nums">
          <div><b>${p.itens.length}</b><small>SKUs</small></div>
          <div><b>${units(p)}</b><small>unidades</small></div>
          <div><b>${p.volumes || "—"}</b><small>volumes</small></div>
          <div><b>${p.carga || "—"}</b><small>carga</small></div>
        </div>
        ${liveHtml}
        <section>
          <h4 class="dr-h">Itens · ordem de coleta</h4>
          <table class="dr-items"><thead><tr><th></th><th>Endereço</th><th>Produto</th><th class="r">Pedido</th><th class="r">Separado</th>${showConf ? `<th class="r">Conferido</th>` : ""}</tr></thead><tbody>${rows}</tbody></table>
        </section>
        ${actions}
        <section><h4 class="dr-h">Histórico</h4>
          <ol class="timeline">${p.hist.map((h) => `<li><time>${fmtTime(h.t)}</time>${esc(h.txt)}</li>`).join("")}</ol>
        </section>
      </div>`;
    tickTimers();

    $("#drClose").onclick = closeDrawer;
    $("#drRota").onchange = (e) => {
      const r = e.target.value || null;
      p.rota = r; log(p, r ? `Rota alterada pelo coordenador: ${r}` : "Rota removida pelo coordenador");
      save(); e.target.blur(); render(); renderDrawer(); toast(r ? `Rota de ${p.id}: ${r}` : `${p.id} sem rota`);
    };
    $("#drPrio").onclick = () => {
      p.prio = p.prio === "alta" ? "normal" : "alta"; log(p, p.prio === "alta" ? "Marcado como prioridade" : "Prioridade removida");
      save(); render(); renderDrawer();
    };
    if ($("#drMoveGo")) $("#drMoveGo").onclick = () => { const v = $("#drMove").value; if (v) move(p.id, v, null); };
    if ($("#drTop")) $("#drTop").onclick = () => move(p.id, loc.col, 0);
  }

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!$("#modal").hidden) closeModal(); else if (openId) closeDrawer();
  });

  // ---------- simulação da operação (enquanto não há integração com os apps) ----------
  function tick() {
    if (!sim) return;
    let changed = false;
    db.tick = (db.tick || 0) + 1;
    ["sep", "conf"].forEach((k) => {
      Object.entries(db[k].cols).forEach(([pid, l]) => {
        if (!l.length) return;
        const p = P(l[0]);
        if (!live(p, k)) {
          // operador "pega" o próximo pedido alguns segundos após a atribuição
          if (now() - (p[k].atrib || 0) < 12000) return;
          p[k].inicio = now(); p[k].resp = pid; log(p, `${k === "sep" ? "Separação" : "Conferência"} iniciada por ${nameOf(pid)}`);
          changed = true; return;
        }
        // ritmo da demonstração: ~1 unidade a cada 3 s na separação, um pouco mais rápido na conferência
        if (Math.random() > (k === "sep" ? 0.5 : 0.7)) return;
        const c0 = curItem(p, k); if (c0) c0[k]++;
        changed = true;
        if (!curItem(p, k)) {
          p[k].fim = now(); l.shift(); db.stats[pid]++;
          if (k === "sep") {
            p.volumes = Math.max(1, Math.ceil(units(p) / 10)); p.etapa = "conf"; db.conf.inbox.push(p.id);
            log(p, `Separação finalizada por ${nameOf(pid)} · ${p.volumes} volume(s)`);
            toast(`${p.id} separado por ${nameOf(pid)} → caixa da conferência`);
          } else {
            p.etapa = "emb"; db.emb.inbox.push(p.id);
            log(p, `Conferência finalizada por ${nameOf(pid)} · pronto para carga`);
            toast(`${p.id} conferido → aguardando carga`);
          }
          if (l[0]) P(l[0])[k].atrib = now(); // próximo da fila começa em seguida
        }
      });
    });
    db.emb.cargas.forEach((c) => {
      if (c.status === "liberada" && now() - (c.liberada || 0) > 6000) {
        c.status = "carregando"; c.inicio = now(); changed = true;
        c.pedidos.forEach((id) => log(P(id), `Carregamento iniciado na doca ${c.doca}`));
      } else if (c.status === "carregando") {
        if (Math.random() > 0.3) return;
        c.lidos++; changed = true;
        if (c.lidos >= cargaVol(c)) {
          c.status = "embarcada"; c.fim = now(); c.lacre = String(4500 + Math.floor(Math.random() * 400)).padStart(6, "0");
          c.pedidos.forEach((id) => log(P(id), `Embarcado · ${c.veiculo} ${c.placa} · lacre ${c.lacre}`));
          toast(`${c.id} embarcada · lacre ${c.lacre}`);
        }
      }
    });
    // integração simulada: chega um pedido novo de tempos em tempos
    if (db.tick % 30 === 0) {
      const p = makePedido({ semRota: Math.random() < 0.25, prio: Math.random() < 0.15 });
      db.sep.inbox.unshift(p.id); flashId = p.id; changed = true;
      if (board === "sep") toast(`Novo pedido via integração: ${p.id}${p.rota ? "" : " · SEM ROTA"}`);
    }
    if (changed) { save(); render(); if (openId) renderDrawer(); }
  }
  setInterval(tick, 1500);

  $("#simBtn").addEventListener("click", () => {
    sim = !sim; localStorage.setItem("wms-bb-gx-sim", sim ? "on" : "off"); renderTop();
    toast(sim ? "Simulação retomada" : "Simulação pausada — o quadro fica parado para você organizar");
  });

  $("#tabs").addEventListener("click", (e) => {
    const b = e.target.closest(".gx-tab"); if (!b) return;
    board = b.dataset.board; localStorage.setItem("wms-bb-gx-board", board);
    $("#board").scrollLeft = 0; render();
  });

  // ---------- início ----------
  load();
  $("#userName").textContent = sess.nome;
  render();
})();
