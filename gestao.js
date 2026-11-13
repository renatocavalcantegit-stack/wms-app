// WMS Beach Bike — Gestão de Expedição (web)
// Quadros estilo kanban (Separação, Conferência, Faturamento, Embarque) + Acompanhamento por rota.
(() => {
  "use strict";

  const W = window.WMS, R = window.Regras;
  const sess = W.session();
  if (!sess || sess.perfil !== "coord") { location.replace("./"); return; }

  const STORE = "wms-bb-gestao-v2";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const now = () => Date.now();
  const MIN = 60000;
  const pad = (n) => String(n).padStart(2, "0");

  // ---------- cadastros de demonstração ----------
  const SEPS = [
    { id: "s1", nome: "Marcos Silva" }, { id: "s2", nome: "Joana Lima" }, { id: "s3", nome: "Rafael Souza" },
    { id: "s4", nome: "Bruno Alves" }, { id: "s5", nome: "Larissa Melo" }, { id: "s6", nome: "Thiago Nunes" },
  ];
  const CONFS = [{ id: "c1", nome: "Ana Paula" }, { id: "c2", nome: "Carla Dias" }, { id: "c3", nome: "Diego Rocha" }, { id: "c4", nome: "Vanessa Reis" }];
  const FATS = [{ id: "f1", nome: "Rita Moreira" }, { id: "f2", nome: "Sônia Prado" }];
  const MOTS = [
    { id: "m1", nome: "José Carlos" }, { id: "m2", nome: "Severino Lima" }, { id: "m3", nome: "Antônio Neto" },
    { id: "m4", nome: "Cícero Gomes" }, { id: "m5", nome: "Edilson Ramos" },
  ];
  const PEOPLE = [...SEPS, ...CONFS, ...FATS, ...MOTS];
  const AV = ["#E10600", "#0E0E10", "#2563EB", "#EA580C", "#16A34A", "#7C3AED", "#0891B2", "#A16207", "#DB2777", "#475569"];
  const OPERADOR = "Operador de doca";
  const VEICULOS = { VUC: 40, Toco: 80, Truck: 140 };
  const VENDEDORES = ["Paulo Henrique", "Fernanda Costa", "Lucas Martins", "Patrícia Rocha", "Diego Farias"];
  const NOMES = ["Bike Center", "Pedal Forte", "Casa da Bike", "Rei das Bikes", "Ponto do Ciclista", "Mega Bikes", "Pedal Livre", "Duas Rodas", "Oficina do Pedal", "Ciclovia Bikes", "Bike Mais", "Roda Livre"];
  // cidade e bairros fictícios por rota
  const LOCAIS = {
    centro: [["Fortaleza", ["Centro", "Benfica", "Fátima", "Joaquim Távora"]]],
    eusebio: [["Eusébio", ["Centro", "Mangabeira", "Tamatanduba"]]],
    caucaia: [["Caucaia", ["Centro", "Jurema", "Icaraí"]]],
    maracanau: [["Maracanaú", ["Jereissati", "Pajuçara", "Centro"]]],
    maranguape: [["Maranguape", ["Centro", "Novo Maranguape"]]],
    cearatransp: [["Sobral", ["Centro", "Junco"]], ["Crateús", ["Centro", "São Vicente"]], ["Tianguá", ["Centro"]]],
    megafrete: [["Juazeiro do Norte", ["Centro", "Pirajá"]], ["Crato", ["Centro"]], ["Iguatu", ["Centro", "Prado"]]],
    nortlog: [["Itapipoca", ["Centro", "Violete"]], ["Acaraú", ["Centro"]], ["Itarema", ["Centro", "Riacho"]]],
    fp: [["Quixadá", ["Centro", "Campo Novo"]], ["Russas", ["Centro"]], ["Limoeiro do Norte", ["Centro"]]],
    messejana: [["Fortaleza", ["Messejana", "Cambeba", "Lagoa Redonda"]]],
    itaitinga: [["Itaitinga", ["Centro", "Gereberaba"]]],
    horizonte: [["Horizonte", ["Centro", "Planalto"]]],
    cascavel: [["Cascavel", ["Centro", "Caponga"]]],
  };
  const DIARIAS = R.ROTAS.filter((r) => r.semanal == null).map((r) => r.id);

  const BOARDS = {
    sep: { people: SEPS, nome: "Separação", verbo: "Separando" },
    conf: { people: CONFS, nome: "Conferência", verbo: "Conferindo" },
    lib: { people: FATS, nome: "Faturamento", verbo: "Faturando" },
    emb: { people: MOTS, nome: "Embarque", verbo: "Carregando" },
  };

  // ---------- aleatório (semente fixa nos dados iniciais) ----------
  let rnd = Math.random;
  const mulberry32 = (a) => () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const rint = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const shuffle = (a) => { const c = [...a]; for (let i = c.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [c[i], c[j]] = [c[j], c[i]]; } return c; };
  // rotas diárias aparecem mais que as semanais
  const pickRota = () => (rnd() < 0.85 ? pick(DIARIAS) : pick(["itaitinga", "horizonte", "cascavel"]));

  // ---------- helpers ----------
  let db;
  const P = (id) => db.pedidos[id];
  const C = (id) => db.cargas[id];
  const hoje = () => R.iso(new Date());
  const rotaOf = (id) => R.rota(id);
  const units = (p) => p.itens.reduce((t, i) => t + i.qtd, 0);
  const doneU = (p, k) => p.itens.reduce((t, i) => t + Math.min(i[k], i.qtd), 0);
  const itensOk = (p, k) => p.itens.filter((i) => i[k] >= i.qtd).length;
  const pct = (p, k) => Math.round((doneU(p, k) / units(p)) * 100);
  const live = (p, k) => !!(p[k] && p[k].inicio && !p[k].fim);
  const isLive = (k, id) => (k === "emb" ? C(id).status === "carregando" : live(P(id), k));
  const curItem = (p, k) => p.itens.find((i) => i[k] < i.qtd);
  const nameOf = (id) => (PEOPLE.find((x) => x.id === id) || {}).nome || "—";
  const initials = (n) => n.split(" ").map((x) => x[0]).slice(0, 2).join("");
  const avColor = (id) => AV[PEOPLE.findIndex((x) => x.id === id) % AV.length];
  const log = (o, txt, t = now()) => o.hist.push({ t, txt });
  const fillUnits = (p, k, frac) => { let n = Math.round(units(p) * frac); p.itens.forEach((i) => { const a = Math.min(i.qtd, n); i[k] = a; n -= a; }); };
  const vols = (p) => Math.max(1, Math.ceil(units(p) / 10));
  const cargaVol = (c) => c.pedidos.reduce((t, id) => t + (P(id).volumes || 0), 0);
  const cargaLidos = (c) => c.pedidos.reduce((t, id) => t + (c.lidos[id] || 0), 0);
  const cargaPedOk = (c) => c.pedidos.filter((id) => (c.lidos[id] || 0) >= P(id).volumes).length;
  const cargaCur = (c) => c.pedidos.find((id) => (c.lidos[id] || 0) < P(id).volumes);
  const placa = () => { const L = "ABCDEFGHJKLMNPQRSTUVWXYZ"; return `${pick(L)}${pick(L)}${pick(L)}-${rint(1, 9)}${pick(L)}${rint(10, 99)}`; };
  const blank = () => ({ resp: null, atrib: null, inicio: null, fim: null });
  const sameDay = (ts) => R.iso(new Date(ts)) === hoje();

  // pedido chegou fora do horário e o coordenador ainda não decidiu (só no dia da chegada; virou o dia, vale a data interna)
  const foraPend = (p) => !!(p.embFora && !p.embDef && p.etapa !== "fim" && sameDay(p.chegada));

  function setEmbarque(p, t = now()) {
    if (!p.rota) { p.embarque = null; p.embFora = false; return; }
    const r = rotaOf(p.rota), e = R.calcEmbarque(r, p.chegada);
    Object.assign(p, { embarque: e.data, embFora: e.fora, embDef: false });
    const hm = fmtTime(p.chegada);
    log(p, e.fora ? `Chegou às ${hm}, fora do horário (corte ${r.corte}) — aguardando definição da data de embarque`
      : `Embarque previsto: ${R.tag(e.data, R.iso(new Date(t))).label.toLowerCase()} (${R.fmtDia(e.data)})`, t);
  }

  function makePedido({ semRota = false, prio = false, chegada = now(), rota = null } = {}) {
    const rid = semRota ? null : rota || pickRota();
    const [cidade, bairros] = pick(LOCAIS[rid || pickRota()]);
    const bairro = pick(bairros);
    const prods = shuffle(W.PRODUTOS).slice(0, rint(2, 6));
    const itens = prods.map((x) => ({ sku: x.sku, ean: x.ean, desc: x.desc, end: W.ENDERECOS[x.sku], qtd: x.tipo === "bike" ? rint(1, 4) : rint(2, 12), sep: 0, conf: 0 }))
      .sort((a, b) => a.end.localeCompare(b.end, "pt-BR", { numeric: true }));
    const p = {
      id: "PV-" + db.seq++, cli: { cod: "C" + String(rint(100, 899)).padStart(4, "0"), nome: `${pick(NOMES)} ${cidade === "Fortaleza" ? bairro : cidade}`, cidade, bairro },
      vendedor: pick(VENDEDORES), rota: rid, prio: prio ? "alta" : "normal", chegada, embarque: null, embFora: false, embDef: false,
      itens, etapa: "sep", sep: blank(), conf: blank(), lib: { ...blank(), ordem: null }, volumes: 0, nota: null, carga: null, hist: [],
    };
    db.pedidos[p.id] = p;
    log(p, "Pedido recebido via integração (Sankhya)", chegada);
    if (rid) setEmbarque(p, chegada); else log(p, "Cliente sem rota cadastrada — aguardando definição", chegada);
    return p;
  }

  // carga montada no ERP (Sankhya) chega pronta e faturada
  function erpCarga(rid, ids, mot, ts = now()) {
    const vol = ids.reduce((t, id) => t + P(id).volumes, 0);
    const veic = Object.entries(VEICULOS).find(([, cap]) => cap >= vol)?.[0] || "Truck";
    const c = {
      id: "CG-" + String(db.cargaSeq++).padStart(4, "0"), rota: rid, motorista: mot || null, veiculo: veic, placa: placa(),
      doca: pad(rint(1, 4)), data: ids.map((id) => P(id).embarque).sort()[0] || hoje(), pedidos: [...ids], lidos: {},
      status: "aguardando", atrib: ts, inicio: null, fim: null, lacre: "", alertas: [], hist: [], criado: ts,
    };
    db.cargas[c.id] = c;
    ids.forEach((id) => {
      const p = P(id); p.etapa = "emb"; p.carga = c.id;
      const i = db.mont.indexOf(id); if (i >= 0) db.mont.splice(i, 1);
      log(p, `Incluído na carga ${c.id} pelo Sankhya`, ts);
      if (mot) log(p, `Carga ${c.id} com motorista ${nameOf(mot)}`, ts);
    });
    log(c, `Carga montada no Sankhya · ${ids.length} pedidos · ${vol} volumes · ${veic} ${c.placa}`, ts);
    if (mot) log(c, `Motorista definido no ERP: ${nameOf(mot)}`, ts);
    (mot ? db.emb.cols[mot] : db.emb.inbox).push(c.id);
    return c;
  }

  // ---------- dados iniciais: cenário com operação em andamento ----------
  function seed() {
    rnd = mulberry32(2026);
    db = {
      v: 2, seq: 10431, cargaSeq: 240, nfSeq: 236001, pedidos: {}, cargas: {}, mont: [],
      sep: { inbox: [], cols: {} }, conf: { inbox: [], cols: {} }, lib: { inbox: [], cols: {} }, emb: { inbox: [], cols: {} }, stats: {}, tick: 0,
    };
    SEPS.forEach((x) => { db.sep.cols[x.id] = []; db.stats[x.id] = rint(4, 11); });
    CONFS.forEach((x) => { db.conf.cols[x.id] = []; db.stats[x.id] = rint(6, 14); });
    FATS.forEach((x) => { db.lib.cols[x.id] = []; db.stats[x.id] = rint(9, 18); });
    MOTS.forEach((x) => { db.emb.cols[x.id] = []; db.stats[x.id] = 0; });
    const t = now();

    // horário de hoje (se ainda não chegou, usa o mesmo horário de ontem)
    const at = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); const d = new Date(t); d.setHours(h, m, rint(0, 50), 0); let x = d.getTime(); if (x > t - 2 * MIN) x -= 864e5; return x; };
    const early = () => Math.min(at(`0${rint(7, 8)}:${pad(rint(0, 55))}`), t - rint(50, 90) * MIN);
    const stamp = (p, f) => Math.round(p.chegada + (t - 2 * MIN - p.chegada) * f);
    const L = { sep: "Separação", conf: "Conferência" };

    // marca como concluídas as etapas anteriores a "upto"
    const advance = (p, upto) => {
      const n = ["sep", "conf", "lib", "mont", "emb", "fim"].indexOf(upto);
      if (n > 0) {
        const r = pick(SEPS).id;
        Object.assign(p.sep, { resp: r, atrib: stamp(p, 0.04), inicio: stamp(p, 0.07), fim: stamp(p, 0.22) });
        fillUnits(p, "sep", 1); p.volumes = vols(p);
        log(p, `Separação atribuída a ${nameOf(r)}`, p.sep.atrib); log(p, `Separação iniciada por ${nameOf(r)}`, p.sep.inicio);
        log(p, `Separação finalizada por ${nameOf(r)} · ${p.volumes} volume(s)`, p.sep.fim);
      }
      if (n > 1) {
        const r = pick(CONFS).id;
        Object.assign(p.conf, { resp: r, atrib: stamp(p, 0.26), inicio: stamp(p, 0.29), fim: stamp(p, 0.4) });
        fillUnits(p, "conf", 1);
        log(p, `Conferência atribuída a ${nameOf(r)}`, p.conf.atrib); log(p, `Conferência iniciada por ${nameOf(r)}`, p.conf.inicio);
        log(p, `Conferência finalizada por ${nameOf(r)} · aguardando liberação p/ faturamento`, p.conf.fim);
      }
      if (n > 2) {
        const f = pick(FATS).id;
        Object.assign(p.lib, { resp: f, atrib: stamp(p, 0.45), inicio: stamp(p, 0.5), fim: stamp(p, 0.53) });
        p.nota = db.nfSeq++;
        log(p, `Liberado para faturamento → ${nameOf(f)} · Sankhya atualizado`, p.lib.atrib);
        log(p, `Faturado por ${nameOf(f)} · NF ${p.nota} · aguardando montagem de carga no ERP`, p.lib.fim);
        p.mont = p.lib.fim;
      }
      p.etapa = upto;
    };
    const assign = (p, k, resp, minsAgo) => { p[k].resp = resp; p[k].atrib = t - minsAgo * MIN; log(p, `${L[k]} atribuída a ${nameOf(resp)}`, p[k].atrib); };
    const startAt = (p, k, frac, minsAgo) => { p[k].inicio = t - minsAgo * MIN; fillUnits(p, k, frac); log(p, `${L[k]} iniciada por ${nameOf(p[k].resp)}`, p[k].inicio); };

    // --- separação: caixa de entrada (fora do horário, sem rota, Messejana 12h–14h, rota semanal)
    [{ rota: "centro", chegada: at("09:24") }, { semRota: true, chegada: t - 6 * MIN }, { rota: "messejana", chegada: at("12:18") },
     { prio: true, chegada: t - 3 * MIN }, { rota: "cascavel", chegada: t - 14 * MIN }, { semRota: true, chegada: t - 25 * MIN },
     { rota: "nortlog", chegada: at("12:41") }, { rota: "messejana", chegada: at("13:35") }, { chegada: t - 31 * MIN }]
      .forEach((o) => db.sep.inbox.push(makePedido(o).id));

    // --- separadores: andamento em vários estágios + filas
    const sepPlan = { s1: [[0.92, 14], 0, 0], s2: [[0.65, 8], 1, 0], s3: [[0.35, 4], "eusebio", 0, 0], s4: [[0.1, 1]], s5: ["wait", 0], s6: [] };
    Object.entries(sepPlan).forEach(([sid, plan]) => plan.forEach((step) => {
      const p = step === "eusebio" ? makePedido({ rota: "eusebio", chegada: at("09:41") }) : makePedido({ chegada: early(), prio: step === 1 });
      assign(p, "sep", sid, Array.isArray(step) ? step[1] + 2 : rint(2, 10));
      if (Array.isArray(step)) startAt(p, "sep", step[0], step[1]);
      if (step === "wait") p.sep.atrib = t;
      db.sep.cols[sid].push(p.id);
    }));

    // --- conferência
    [early(), early(), at("11:22"), early()].forEach((ch, i) => { const p = makePedido({ chegada: ch, rota: i === 2 ? "caucaia" : null }); advance(p, "conf"); db.conf.inbox.push(p.id); });
    const confPlan = { c1: [[0.8, 6], 0], c2: [[0.4, 3]], c3: [[0.05, 1], 0, 0], c4: [] };
    Object.entries(confPlan).forEach(([cid, plan]) => plan.forEach((step) => {
      const p = makePedido({ chegada: early() }); advance(p, "conf");
      assign(p, "conf", cid, Array.isArray(step) ? step[1] + 1 : rint(2, 6));
      if (Array.isArray(step)) startAt(p, "conf", step[0], step[1]);
      db.conf.cols[cid].push(p.id);
    }));

    // --- liberação para faturamento
    // caixa com vários conferidos por rota, para o filtro e a liberação em lote
    [["centro"], ["caucaia"], ["maracanau", at("11:35")], ["centro"], ["messejana"], ["caucaia", null, true], ["centro"],
     ["cascavel"], ["messejana"], ["centro"], ["caucaia"], ["nortlog"]]
      .forEach(([rota, ch, prio]) => { const p = makePedido({ chegada: ch || early(), rota, prio: !!prio }); advance(p, "lib"); db.lib.inbox.push(p.id); });
    const libPlan = { f1: ["live", 0, 0], f2: [0] };
    Object.entries(libPlan).forEach(([fid, plan]) => plan.forEach((step) => {
      const p = makePedido({ chegada: early(), rota: pick(DIARIAS) }); advance(p, "lib");
      p.lib.resp = fid; p.lib.atrib = t - rint(2, 8) * MIN; log(p, `Liberado para faturamento → ${nameOf(fid)} · Sankhya atualizado`, p.lib.atrib);
      if (step === "live") { p.lib.inicio = t - 4000; p.lib.dur = 16000; log(p, `Faturamento iniciado por ${nameOf(fid)} (Sankhya)`, p.lib.inicio); }
      db.lib.cols[fid].push(p.id);
    }));
    FATS.forEach((f) => renumLib(f.id));

    // --- faturados aguardando montagem de carga no ERP (Itaitinga espera a quarta-feira)
    ["centro", "centro", "maracanau", "messejana", "itaitinga"].forEach((r) => { const p = makePedido({ rota: r, chegada: early() }); advance(p, "mont"); db.mont.push(p.id); });

    // --- cargas vindas do ERP
    const mkCarga = ({ rota, mot, n, status = "aguardando", frac = 0, minsAgo = 10 }) => {
      const ids = [];
      for (let i = 0; i < n; i++) { const p = makePedido({ rota, chegada: early() }); advance(p, "mont"); db.mont.push(p.id); ids.push(p.id); }
      const c = erpCarga(rota, ids, mot, t - (minsAgo + 15) * MIN);
      if (mot) c.atrib = t - minsAgo * MIN;
      if (status === "carregando") {
        c.status = "carregando"; c.inicio = t - minsAgo * MIN; log(c, `Carregamento iniciado na doca ${c.doca} · ${OPERADOR}`, c.inicio);
        let left = Math.round(cargaVol(c) * frac);
        c.pedidos.forEach((id) => { const a = Math.min(P(id).volumes, left); c.lidos[id] = a; left -= a; });
        c.alertas.push({ t: t - 2 * MIN, txt: `Bip duplicado: ${c.pedidos[0]} vol. 1 — ignorado` });
      }
      if (status === "embarcada") {
        Object.assign(c, { status: "embarcada", inicio: t - (minsAgo + 18) * MIN, fim: t - minsAgo * MIN, lacre: String(rint(4400, 4890)).padStart(6, "0") });
        c.pedidos.forEach((id) => { c.lidos[id] = P(id).volumes; const p = P(id); p.etapa = "fim"; p.embarcado = c.fim; log(p, `Embarcado · ${c.veiculo} ${c.placa} · lacre ${c.lacre}`, c.fim); });
        log(c, `Carregamento iniciado na doca ${c.doca} · ${OPERADOR}`, c.inicio); log(c, `Embarcada · lacre ${c.lacre}`, c.fim);
        const l = db.emb.cols[mot]; l.splice(l.indexOf(c.id), 1); db.stats[mot]++;
      }
      return c;
    };
    mkCarga({ rota: "maranguape", mot: "m3", n: 2, status: "embarcada", minsAgo: 35 });
    mkCarga({ rota: "fp", mot: "m5", n: 2, status: "embarcada", minsAgo: 50 });
    mkCarga({ rota: "centro", mot: "m1", n: 4, status: "carregando", frac: 0.55, minsAgo: 9 });
    mkCarga({ rota: "eusebio", mot: "m1", n: 3 });
    mkCarga({ rota: "nortlog", mot: "m2", n: 2, minsAgo: 1 });
    mkCarga({ rota: "messejana", mot: "m4", n: 3, status: "carregando", frac: 0.85, minsAgo: 14 });
    mkCarga({ rota: "caucaia", mot: null, n: 3, minsAgo: 6 });
    mkCarga({ rota: "cearatransp", mot: null, n: 2, minsAgo: 12 });

    rnd = Math.random;
    save();
  }

  function load() {
    try { const d = JSON.parse(localStorage.getItem(STORE)); if (d && d.v === 2 && d.pedidos) { db = d; return; } } catch {}
    seed();
  }
  const save = () => localStorage.setItem(STORE, JSON.stringify(db));

  // ---------- estado de tela ----------
  let board = localStorage.getItem("wms-bb-gx-board") || "sep";
  if (!["sep", "conf", "lib", "emb", "rota"].includes(board)) board = "sep";
  const filters = { sep: "todos", conf: "todos", lib: "todos", emb: "todas" };
  let acRota = localStorage.getItem("wms-bb-gx-acrota") || "todas", acF = "todos";
  let query = "";
  let openRef = null; // { t: "p" | "c", id }
  let sim = localStorage.getItem("wms-bb-gx-sim") !== "off";
  let flashId = null; // id ou lista de ids destacados no próximo render
  const isFlash = (id) => flashId === id || (Array.isArray(flashId) && flashId.includes(id));
  let dragId = null, dragGroup = null, pendingRender = false;
  // seleção em lote na caixa de entrada do faturamento
  const sel = new Set();
  let libVisible = [];

  // ---------- formatação ----------
  const fmtDur = (ms) => {
    const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return (h ? h + ":" + pad(m) : pad(m)) + ":" + pad(x);
  };
  const fmtAge = (ts) => { const m = Math.floor((now() - ts) / MIN); return m < 1 ? "agora" : m < 60 ? `há ${m} min` : `há ${Math.floor(m / 60)}h${pad(m % 60)}`; };
  function fmtTime(ts) { return new Date(ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }); }
  const rotaTag = (id) => { const r = rotaOf(id); return r ? `<span class="rt" style="--rc:${r.cor}"><i></i>${esc(r.nome)}</span>` : `<span class="rt none">SEM ROTA</span>`; };
  const ICON_USER = '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/></svg>';
  const ICON_WARN = '<svg viewBox="0 0 24 24"><path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/></svg>';
  const CARET = '<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>';
  const CHECK = '<svg viewBox="0 0 24 24"><path d="M5 12l5 5 9-10"/></svg>';
  const ICON_DOC = '<svg viewBox="0 0 24 24"><path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6M9 13h7M9 17h5"/></svg>';

  // etiqueta da data de embarque (Hoje, Amanhã, Quinta, Fora do horário…)
  function embInfo(p) {
    if (!p.embarque) return null;
    if (foraPend(p)) return { label: "Fora do horário", sub: R.fmtDia(p.embarque), cls: "fora" };
    const t = R.tag(p.embarque, hoje());
    if (p.etapa === "fim") return { ...t, cls: "done", label: t.cls === "atrasado" ? R.fmtDia(p.embarque) : t.label };
    return t;
  }
  function embTag(p, btn = false) {
    const e = embInfo(p);
    if (!e) return btn ? `<span class="muted">—</span>` : "";
    if (btn && p.etapa !== "fim") return `<button class="etag ${e.cls}" data-etag="${p.id}" title="Embarque: ${e.sub} · clique para alterar">${e.label}${CARET}</button>`;
    return `<span class="etag ${e.cls}" title="Embarque: ${e.sub}">${e.label}</span>`;
  }

  let toastT;
  function toast(m) { const t = $("#toast"); t.textContent = m; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 2800); }

  // ---------- localização / movimento ----------
  function locate(k, id) {
    const B = db[k];
    if (B.inbox.includes(id)) return { list: B.inbox, col: "inbox" };
    for (const [c, l] of Object.entries(B.cols)) if (l.includes(id)) return { list: l, col: c };
    return null;
  }
  const locateP = (id) => { const p = P(id); return ["sep", "conf", "lib"].includes(p.etapa) ? locate(p.etapa, id) : null; };

  // ordem de faturamento enviada ao Sankhya: 1, 2, 3… só entre os que aguardam (o que está faturando fica de fora)
  function renumLib(col) {
    if (!col || col === "inbox") return;
    let n = 0;
    db.lib.cols[col].forEach((id) => { const q = P(id); if (!live(q, "lib")) q.lib.ordem = ++n; });
  }

  // núcleo do movimento (sem render); retorna mensagem de erro ou null
  function moveCore(k, id, toCol, idx) {
    const from = locate(k, id);
    if (!from) return "Item não encontrado";
    if (isLive(k, id)) return k === "emb" ? "Carga em carregamento não pode ser movida" : "Pedido em andamento não pode ser movido";
    const B = db[k], to = toCol === "inbox" ? B.inbox : B.cols[toCol];
    from.list.splice(from.list.indexOf(id), 1);
    if (idx == null) idx = to.length;
    if (toCol !== "inbox" && to[0] && isLive(k, to[0])) idx = Math.max(1, idx);
    idx = Math.min(Math.max(0, idx), to.length);
    to.splice(idx, 0, id);
    const changed = from.col !== toCol;

    if (k === "emb") {
      const c = C(id);
      if (changed) {
        c.motorista = toCol === "inbox" ? null : toCol; c.atrib = now();
        const txt = c.motorista ? `Carga designada ao motorista ${nameOf(toCol)}` : "Motorista removido — carga voltou para a caixa de entrada";
        log(c, txt); c.pedidos.forEach((pid) => log(P(pid), `${c.id}: ${txt.toLowerCase()}`));
      } else if (toCol !== "inbox") log(c, `Ordem alterada na fila de ${nameOf(toCol)} · ${idx + 1}ª`);
      return null;
    }

    const p = P(id);
    if (changed) { p[k].resp = toCol === "inbox" ? null : toCol; p[k].atrib = toCol === "inbox" ? null : now(); }
    if (k === "lib") {
      renumLib(from.col); renumLib(toCol);
      if (toCol === "inbox") { p.lib.ordem = null; if (changed) log(p, "Liberação para faturamento cancelada · Sankhya atualizado"); }
      else log(p, changed ? `Liberado para faturamento → ${nameOf(toCol)} · ordem ${p.lib.ordem} · Sankhya atualizado` : `Ordem de faturamento alterada para ${p.lib.ordem} · Sankhya atualizado`);
      return null;
    }
    const L = BOARDS[k].nome;
    if (changed) log(p, toCol === "inbox" ? "Devolvido à caixa de entrada" : `${L} atribuída a ${nameOf(toCol)} · ${idx + 1}º da fila`);
    else if (toCol !== "inbox") log(p, `Prioridade alterada na fila de ${nameOf(toCol)} · ${idx + 1}º`);
    return null;
  }

  function move(k, id, toCol, idx, checked = false) {
    // regra: pedido sem rota não vai para separador sem antes definir a rota
    if (!checked && k === "sep" && toCol !== "inbox" && !P(id).rota) return askRota(id, () => move(k, id, toCol, idx, true));
    const before = locate(k, id);
    const err = moveCore(k, id, toCol, idx);
    if (err) { toast(err); render(); return; }
    flashId = id;
    save(); render(); if (openRef) renderDrawer();
    const same = before && before.col === toCol;
    if (k === "lib" && toCol !== "inbox") {
      const n = db.lib.cols[toCol].filter((x) => !live(P(x), "lib")).length;
      toast(same ? `Ordem de faturamento atualizada no Sankhya (${n} pedido(s) de ${nameOf(toCol)})` : `${id} liberado p/ faturamento · ${nameOf(toCol)} · ordem ${P(id).lib.ordem} enviada ao Sankhya`);
    } else if (k === "lib") toast(`${id} voltou para a caixa · liberação cancelada no Sankhya`);
    else if (k === "emb") toast(toCol === "inbox" ? `${id} sem motorista` : `${id} → ${nameOf(toCol)}`);
    else toast(`${id} → ${toCol === "inbox" ? "caixa de entrada" : nameOf(toCol)}`);
  }

  // movimento em lote (faturamento): mantém a sequência e insere a partir de idx
  function moveMany(k, ids, toCol, idx) {
    let ok = 0, err = null;
    ids.forEach((id) => {
      const e = moveCore(k, id, toCol, idx == null ? null : idx + ok);
      if (e) err = e; else { ok++; sel.delete(id); }
    });
    if (!ok) { toast(err || "Nada para mover"); render(); return; }
    flashId = ids;
    save(); render(); if (openRef) renderDrawer();
    if (toCol === "inbox") return toast(`${ok} pedido(s) voltaram para a caixa · liberação cancelada no Sankhya`);
    const ords = ids.map((id) => P(id).lib.ordem).filter((n) => n != null);
    toast(`${ok} pedido(s) liberado(s) p/ ${nameOf(toCol)} · ordem ${Math.min(...ords)}–${Math.max(...ords)} enviada ao Sankhya`);
  }
  function liberarSel(fid) {
    const ids = sortInbox(db.lib.inbox, "lib").filter((id) => sel.has(id));
    if (ids.length) moveMany("lib", ids, fid, null);
  }

  // ---------- status (acompanhamento e detalhe) ----------
  function statusOf(p) {
    const S = (txt, cls, grp, sub = "") => ({ txt, cls, grp, sub });
    const loc = locateP(p.id);
    if (p.etapa === "sep") {
      if (!loc || loc.col === "inbox") return S("Aguardando designar separador", "wait", "sep", p.rota ? "" : "sem rota");
      return live(p, "sep") ? S("Em separação", "work", "sep", `${pct(p, "sep")}%`) : S("Aguardando início da separação", "next", "sep", `${loc.list.indexOf(p.id) + 1}º na fila`);
    }
    if (p.etapa === "conf") {
      if (!loc || loc.col === "inbox") return S("Aguardando designar conferente", "wait", "conf");
      return live(p, "conf") ? S("Em conferência", "work", "conf", `${pct(p, "conf")}%`) : S("Aguardando início da conferência", "next", "conf", `${loc.list.indexOf(p.id) + 1}º na fila`);
    }
    if (p.etapa === "lib") {
      if (!loc || loc.col === "inbox") return S("Aguardando liberar p/ faturamento", "wait", "fat");
      return S("Aguardando faturamento", "erp", "fat", live(p, "lib") ? `${nameOf(p.lib.resp)} · faturando` : `${nameOf(p.lib.resp)} · ordem ${p.lib.ordem}`);
    }
    if (p.etapa === "mont") return S("Aguardando montagem de carga", "erp", "emb", `NF ${p.nota}`);
    if (p.etapa === "emb") { const c = C(p.carga); return S("Aguardando embarque", "ship", "emb", `${c.id}${c.status === "carregando" ? " · carregando" : c.motorista ? "" : " · sem motorista"}`); }
    const c = C(p.carga);
    return S("Embarcado", "done", "fim", c ? `${c.id} · lacre ${c.lacre}` : "");
  }

  // ---------- render ----------
  function render(reset = false) {
    if (dragId) { pendingRender = true; return; }
    [...sel].forEach((id) => { if (!db.lib.inbox.includes(id)) sel.delete(id); });
    const b = $("#board");
    const scrolls = {}; if (!reset) $$(".gx-list").forEach((l) => (scrolls[l.dataset.col] = l.scrollTop));
    const bx = reset ? 0 : b.scrollLeft, by = reset ? 0 : b.scrollTop;
    b.classList.toggle("list", board === "rota");
    b.innerHTML = board === "rota" ? renderRota() : renderPeople(board);
    $$(".gx-list").forEach((l) => { if (scrolls[l.dataset.col]) l.scrollTop = scrolls[l.dataset.col]; });
    b.scrollLeft = bx; b.scrollTop = by;
    renderTop(); applySearch(); tickTimers();
    flashId = null;
  }

  const kp = (n, l, cls = "") => `<span class="gx-kpi ${cls}"><b>${n}</b>${l}</span>`;
  const firstLive = (k) => Object.values(db[k].cols).filter((l) => l[0] && isLive(k, l[0])).length;
  const queued = (k) => Object.values(db[k].cols).reduce((t, l) => t + l.filter((id) => !isLive(k, id)).length, 0);

  function renderTop() {
    $$(".gx-tab").forEach((x) => x.classList.toggle("active", x.dataset.board === board));
    $("#tbSep").textContent = db.sep.inbox.length;
    $("#tbConf").textContent = db.conf.inbox.length;
    $("#tbLib").textContent = db.lib.inbox.length;
    $("#tbEmb").textContent = db.emb.inbox.length;
    const fora = Object.values(db.pedidos).filter(foraPend).length;
    $("#tbRota").textContent = fora; $("#tbRota").hidden = !fora;
    $("#simBtn").classList.toggle("on", sim);
    $("#simBtn span").textContent = sim ? "Simulação ao vivo" : "Simulação pausada";

    const td = hoje();
    const T = { sep: "Distribuição da separação", conf: "Distribuição da conferência", lib: "Liberação para faturamento", emb: "Embarque · cargas do ERP", rota: "Acompanhamento por rota" };
    $("#boardTitle").textContent = T[board];
    let k = "", a = "";
    if (board === "sep" || board === "conf") {
      const B = db[board], hojeN = BOARDS[board].people.reduce((t, x) => t + db.stats[x.id], 0);
      k = kp(B.inbox.length, "na caixa de entrada") + (board === "sep" ? kp(B.inbox.filter((id) => !P(id).rota).length, "sem rota", "red") : "")
        + kp(firstLive(board), board === "sep" ? "em separação" : "em conferência") + kp(queued(board), "na fila") + kp(hojeN, board === "sep" ? "separados hoje" : "conferidos hoje", "green");
      a = (board === "sep" ? `<button class="btn ghost" data-act="novoPedido">+ Pedido de teste</button>` : "") + `<button class="btn primary" data-act="autoDist">Distribuir automaticamente</button>`;
    } else if (board === "lib") {
      const fat = Object.values(db.pedidos).filter((p) => p.lib.fim && sameDay(p.lib.fim)).length;
      k = kp(db.lib.inbox.length, "aguardando liberação") + kp(queued("lib"), "liberados na fila") + kp(firstLive("lib"), "faturando") + kp(db.mont.length, "aguardando carga no ERP") + kp(fat, "faturados hoje", "green");
      a = `<span class="hint">Arrastar para a faturista libera o pedido no Sankhya · a ordem da fila é a prioridade</span><button class="btn primary" data-act="autoDist">Liberar automaticamente</button>`;
    } else if (board === "emb") {
      const cs = Object.values(db.cargas), emb = cs.filter((c) => c.status === "embarcada" && sameDay(c.fim)).length;
      k = kp(db.emb.inbox.length, "sem motorista", db.emb.inbox.length ? "red" : "") + kp(firstLive("emb"), "carregando") + kp(queued("emb"), "na fila") + kp(db.mont.length, "pedidos aguardando carga no ERP") + kp(emb, "embarcadas hoje", "green");
      a = `<span class="hint">Cargas montadas no Sankhya · com motorista já caem na coluna dele</span><button class="btn primary" data-act="autoDist">Designar motoristas</button>`;
    } else {
      const ps = Object.values(db.pedidos).filter((p) => acRota === "todas" || (acRota === "semrota" ? !p.rota : p.rota === acRota));
      k = kp(ps.length, "pedidos") + kp(ps.filter((p) => p.embarque === td && p.etapa !== "fim").length, "a embarcar hoje")
        + kp(ps.filter(foraPend).length, "fora do horário", "red") + kp(ps.filter((p) => p.etapa === "fim").length, "embarcados", "green");
      a = `<span class="hint show">Clique na etiqueta de embarque para definir a data</span>`;
    }
    $("#kpis").innerHTML = k; $("#actions").innerHTML = a;
  }

  // card de pedido
  function pedidoCard(p, k, o = {}) {
    const isL = live(p, k);
    const waiting = o.first && !isL && o.col !== "inbox";
    const cls = ["card", !p.rota && "no-route", isL && "live", waiting && "waiting", isFlash(p.id) && "flash"].filter(Boolean).join(" ");
    const nums =`<span><b>${p.itens.length}</b> SKUs</span><span><b>${units(p)}</b> un.</span>${p.volumes ? `<span><b>${p.volumes}</b> vol.</span>` : ""}`;
    const age = o.col === "inbox" ? fmtAge(k === "sep" ? p.chegada : k === "conf" ? p.sep.fim : p.conf.fim) : "";
    let liveHtml = "";
    if (isL && k !== "lib") {
      const c = curItem(p, k), pc = pct(p, k);
      liveHtml = `<div class="c-live">
        <div class="cl-row"><span class="cl-tag"><i></i>${k === "sep" ? "Separando agora" : "Conferindo agora"}</span><span class="timer" data-since="${p[k].inicio}">00:00</span></div>
        <div class="cl-bar"><i style="width:${pc}%"></i></div>
        <div class="cl-row small"><b>${pc}%</b><span>${itensOk(p, k)}/${p.itens.length} itens · ${doneU(p, k)}/${units(p)} un.</span></div>
        ${c ? `<p class="cl-cur"><span class="gaddr">${c.end}</span>${esc(c.desc)}</p>` : ""}
      </div>`;
    } else if (isL) {
      liveHtml = `<div class="c-live"><div class="cl-row"><span class="cl-tag"><i></i>Faturando agora</span><span class="timer" data-since="${p.lib.inicio}">00:00</span></div>
        <p class="cl-cur">Sankhya · gerando nota fiscal</p></div>`;
    } else if (waiting) {
      liveHtml = `<div class="c-live"><div class="cl-row"><span class="cl-tag"><i></i>${k === "lib" ? "Próximo a faturar" : "Aguardando início"}</span><span class="timer" data-since="${p[k].atrib || now()}">00:00</span></div></div>`;
    }
    let from = "";
    if (k === "conf" && !isL && p.sep.resp) from = `Separado por ${esc(nameOf(p.sep.resp))}`;
    if (k === "lib") from = o.col === "inbox" ? `Conferido por ${esc(nameOf(p.conf.resp))}` : isL ? "" : `<span class="erp-ok">Sankhya ✓</span> liberado · ordem ${p.lib.ordem}`;
    const draggable = !isL;
    return `<article class="${cls}" draggable="${draggable}" data-id="${p.id}" style="--rc:${p.rota ? rotaOf(p.rota).cor : "var(--red-brand)"}">
      <div class="c-top">${rotaTag(p.rota)}${p.prio === "alta" ? `<span class="c-prio">PRIORIDADE</span>` : ""}${o.pos ? `<span class="c-pos">${o.pos}</span>` : ""}</div>
      <div class="c-main"><p class="c-id">${p.id}</p>${embTag(p)}</div>
      <p class="c-cli"><b>${p.cli.cod}</b>${esc(p.cli.nome)}</p>
      <p class="c-vend">${ICON_USER}Vend.: ${esc(p.vendedor)}</p>
      <div class="c-nums">${nums}${age ? `<span class="c-age">${age}</span>` : ""}</div>
      ${from ? `<p class="c-from">${from}</p>` : ""}
      ${liveHtml}
    </article>`;
  }

  // card compacto do faturamento (2 linhas): posição/seleção · pedido + etiquetas · volumes / rota · cliente
  function libCard(p, o = {}) {
    const isL = live(p, "lib"), inbox = o.col === "inbox", s = inbox && sel.has(p.id), r = rotaOf(p.rota);
    const cls = ["card", "cc", isL && "live", s && "sel", isFlash(p.id) && "flash"].filter(Boolean).join(" ");
    const left = isL ? ICON_DOC : inbox ? `<span class="cb" data-sel="${p.id}" title="Selecionar">${s ? CHECK : ""}</span>` : o.pos || "";
    const right = isL ? `<span class="timer" data-since="${p.lib.inicio}">00:00</span>` : `<span class="cc-vol">${p.volumes} vol.</span>`;
    return `<article class="${cls}" draggable="${!isL}" data-id="${p.id}" style="--rc:${r ? r.cor : "var(--red-brand)"}">
      <span class="cc-pos">${left}</span>
      <span class="cc-id">${p.id}${p.prio === "alta" ? `<span class="c-prio">PRIOR.</span>` : ""}${embTag(p)}</span>${right}
      <span class="cc-sub"><i></i>${esc(r ? r.nome : "Sem rota")} · ${esc(p.cli.nome)}</span>${isL ? `<span class="cc-st">faturando</span>` : ""}
    </article>`;
  }

  // card de carga (embarque)
  function cargaCard(c, o = {}) {
    const vol = cargaVol(c), lid = cargaLidos(c), isL = c.status === "carregando";
    const waiting = o.first && !isL && o.col !== "inbox";
    const cls = ["card", "cg", isL && "live", waiting && "waiting", isFlash(c.id) && "flash"].filter(Boolean).join(" ");
    const cidades = new Set(c.pedidos.map((id) => P(id).cli.cidade)).size;
    let liveHtml = "";
    if (isL) {
      const cur = cargaCur(c), pc = vol ? Math.round((lid / vol) * 100) : 0, al = c.alertas[c.alertas.length - 1];
      liveHtml = `<div class="c-live">
        <div class="cl-row"><span class="cl-tag"><i></i>Carregando · doca ${c.doca}</span><span class="timer" data-since="${c.inicio}">00:00</span></div>
        <div class="cl-bar"><i style="width:${pc}%"></i></div>
        <div class="cl-row small"><b>${pc}%</b><span>${cargaPedOk(c)}/${c.pedidos.length} pedidos · ${lid}/${vol} vol.</span></div>
        ${cur ? `<p class="cl-cur"><span class="gaddr">${cur}</span>${esc(P(cur).cli.nome)} · vol. ${Math.min((c.lidos[cur] || 0) + 1, P(cur).volumes)}/${P(cur).volumes}</p>` : ""}
        ${al && now() - al.t < 30000 ? `<p class="cl-alert">${ICON_WARN}${esc(al.txt)}</p>` : ""}
      </div>`;
    } else if (waiting) {
      liveHtml = `<div class="c-live"><div class="cl-row"><span class="cl-tag"><i></i>Aguardando início · doca ${c.doca}</span><span class="timer" data-since="${c.atrib || now()}">00:00</span></div></div>`;
    }
    const t = R.tag(c.data, hoje());
    return `<article class="${cls}" draggable="${!isL}" data-id="${c.id}" style="--rc:${rotaOf(c.rota).cor}">
      <div class="c-top">${rotaTag(c.rota)}<span class="c-erp">SANKHYA</span>${o.pos ? `<span class="c-pos">${o.pos}</span>` : ""}</div>
      <div class="c-main"><p class="c-id">${c.id}</p><span class="etag ${t.cls}" title="Embarque: ${t.sub}">${t.label}</span></div>
      <div class="truck-line"><span class="plate">${c.placa}</span><span>${c.veiculo} · Doca ${c.doca}</span></div>
      <div class="c-nums"><span><b>${c.pedidos.length}</b> pedidos</span><span><b>${vol}</b> vol.</span><span><b>${cidades}</b> ${cidades > 1 ? "cidades" : "cidade"}</span>${o.col === "inbox" ? `<span class="c-age">${fmtAge(c.criado)}</span>` : ""}</div>
      ${liveHtml}
    </article>`;
  }

  // ordenação da caixa de entrada: sem rota (precisa de ação) > prioridade > data de embarque; empate mantém a ordem manual
  const sortInbox = (ids, k) => k === "emb" ? [...ids] : [...ids].sort((a, b) => {
    const A = P(a), B = P(b);
    if (k === "sep" && !A.rota !== !B.rota) return !A.rota ? -1 : 1;
    if (A.prio !== B.prio) return A.prio === "alta" ? -1 : 1;
    return String(A.embarque || "9").localeCompare(String(B.embarque || "9"));
  });

  const FILTROS = { semrota: (p) => !p.rota, fora: foraPend, hoje: (p) => p.embarque === hoje(), prio: (p) => p.prio === "alta" };

  function inboxCol(k) {
    const B = db[k];
    let f = filters[k], ids = sortInbox(B.inbox, k), chips;
    // filtro de rota que esvaziou (tudo liberado) volta para "Todas"
    if (k === "lib" && f !== "todos" && !B.inbox.some((id) => (rotaOf(f) ? P(id).rota === f : FILTROS[f] && FILTROS[f](P(id))))) f = filters.lib = "todos";
    const chip = (id, label, n, extra = "", style = "") => `<button class="gchip ${extra} ${f === id ? "active" : ""}" data-filter="${esc(id)}" ${style}>${label} <b>${n}</b></button>`;
    if (k === "emb") {
      if (f !== "todas") ids = ids.filter((id) => C(id).rota === f);
      const rotas = [...new Set(B.inbox.map((id) => C(id).rota))];
      chips = chip("todas", "Todas", B.inbox.length) + rotas.map((r) => chip(r, `<i></i>${esc(rotaOf(r).nome)}`, B.inbox.filter((id) => C(id).rota === r).length, "", `style="--rc:${rotaOf(r).cor}"`)).join("");
    } else if (k === "lib") {
      // faturamento: filtro por rota para liberar vários pedidos de uma vez
      if (rotaOf(f)) ids = ids.filter((id) => P(id).rota === f); else if (FILTROS[f]) ids = ids.filter((id) => FILTROS[f](P(id)));
      const cnt = (fn) => B.inbox.filter((id) => fn(P(id))).length;
      const rotas = R.ROTAS.filter((r) => B.inbox.some((id) => P(id).rota === r.id));
      const fo = cnt(foraPend), pr = cnt(FILTROS.prio);
      chips = chip("todos", "Todas", B.inbox.length)
        + rotas.map((r) => chip(r.id, `<i></i>${esc(r.nome)}`, cnt((p) => p.rota === r.id), "", `style="--rc:${r.cor}"`)).join("")
        + (fo ? chip("fora", "Fora do horário", fo, "red") : "") + (pr ? chip("prio", "Prioridade", pr) : "");
    } else {
      if (FILTROS[f]) ids = ids.filter((id) => FILTROS[f](P(id)));
      const cnt = (fn) => B.inbox.filter((id) => fn(P(id))).length;
      const fo = cnt(foraPend);
      chips = chip("todos", "Todos", B.inbox.length) + (k === "sep" ? chip("semrota", "Sem rota", cnt(FILTROS.semrota), "red") : "")
        + (fo ? chip("fora", "Fora do horário", fo, "red") : "") + chip("hoje", "Hoje", cnt(FILTROS.hoje)) + chip("prio", "Prioridade", cnt(FILTROS.prio));
    }
    const title = { sep: "Caixa de entrada", conf: "Separados", lib: "Conferidos", emb: "Cargas do ERP" }[k];
    const sub = { sep: "Pedidos recebidos aguardando separador", conf: "Aguardando conferente", lib: "Aguardando liberação para faturamento", emb: "Montadas no Sankhya · aguardando motorista" }[k];
    const cards = ids.map((id) => (k === "emb" ? cargaCard(C(id), { col: "inbox" }) : k === "lib" ? libCard(P(id), { col: "inbox" }) : pedidoCard(P(id), k, { col: "inbox" }))).join("");
    let extra = "";
    if (k === "lib") {
      libVisible = ids;
      if (ids.length) {
        const all = ids.every((id) => sel.has(id)), rf = rotaOf(f);
        extra += `<button class="lib-all" data-selall="1"><span class="cb ${all ? "on" : ""}">${all ? CHECK : ""}</span>${all ? "Limpar seleção" : rf ? `Selecionar os ${ids.length} de ${esc(rf.nome)}` : `Selecionar todos (${ids.length})`}</button>`;
      }
      if (sel.size) {
        const v = [...sel].reduce((t, id) => t + P(id).volumes, 0);
        extra += `<div class="lib-bar"><p><span>${sel.size} selecionado(s) · ${v} vol.</span><button class="x" data-selclear="1">Limpar</button></p><div>${FATS.map((x) => `<button data-libto="${x.id}">Liberar para ${esc(x.nome.split(" ")[0])}</button>`).join("")}</div></div>`;
      }
    }
    return `<section class="col inbox">
      <header class="col-head">
        <div class="ch-row"><h3>${title}</h3><span class="count">${B.inbox.length}</span></div>
        <p class="ch-sub">${sub}</p>
        <div class="gchips">${chips}</div>
        ${extra}
      </header>
      <div class="gx-list ${k === "lib" ? "compact" : ""}" data-col="inbox">${cards || `<div class="col-empty">Nada por aqui 🎉</div>`}</div>
    </section>`;
  }

  function personCol(k, person) {
    const l = db[k].cols[person.id];
    const busy = l[0] && isLive(k, l[0]);
    const L = BOARDS[k];
    const st = busy ? `<span class="st work"><i></i>${L.verbo}</span>` : l.length ? `<span class="st wait"><i></i>Aguardando início</span>` : `<span class="st"><i></i>Livre</span>`;
    let m;
    if (k === "emb") m = [[l.length, "cargas"], [l.reduce((t, id) => t + cargaVol(C(id)) - cargaLidos(C(id)), 0), "vol. a carregar"], [db.stats[person.id], "embarcadas"]];
    else if (k === "lib") m = [[l.length, "na fila"], [l.reduce((t, id) => t + P(id).volumes, 0), "volumes"], [db.stats[person.id], "faturados"]];
    else m = [[l.length, "pedidos"], [l.reduce((t, id) => t + units(P(id)) - doneU(P(id), k), 0), "un. pendentes"], [db.stats[person.id], "hoje"]];
    const cards = l.map((id, i) => {
      const o = { col: person.id, first: i === 0, pos: busy && i === 0 ? "" : `${busy ? i : i + 1}${k === "emb" ? "ª" : "º"}` };
      return k === "emb" ? cargaCard(C(id), o) : k === "lib" ? libCard(P(id), o) : pedidoCard(P(id), k, o);
    }).join("");
    const empty = { sep: "Arraste pedidos para cá", conf: "Arraste pedidos para cá", lib: "Arraste para liberar no Sankhya", emb: "Arraste cargas para este motorista" }[k];
    return `<section class="col">
      <header class="col-head">
        <div class="person">
          <span class="avatar" style="--av:${avColor(person.id)}">${initials(person.nome)}</span>
          <div class="person-n"><div class="ch-row"><h3>${esc(person.nome)}</h3>${k === "emb" ? `<span class="role">Motorista</span>` : k === "lib" ? `<span class="role">Faturista</span>` : ""}</div>${st}</div>
        </div>
        <div class="metrics">${m.map(([v, s]) => `<div><b>${v}</b><small>${s}</small></div>`).join("")}</div>
      </header>
      <div class="gx-list ${k === "lib" ? "compact" : ""}" data-col="${person.id}">${cards || `<div class="col-empty">${empty}</div>`}</div>
    </section>`;
  }

  const renderPeople = (k) => inboxCol(k) + BOARDS[k].people.map((x) => personCol(k, x)).join("");

  // ---------- acompanhamento por rota ----------
  function renderRota() {
    const td = hoje(), all = Object.values(db.pedidos);
    const inRota = (p, r) => r === "todas" || (r === "semrota" ? !p.rota : p.rota === r);
    const semN = all.filter((p) => !p.rota).length;
    const tabs = [{ id: "todas", nome: "Todas" }, ...R.ROTAS, ...(semN ? [{ id: "semrota", nome: "Sem rota", cor: "var(--red-brand)" }] : [])];
    if (!tabs.some((x) => x.id === acRota)) acRota = "todas";
    const tabsHtml = tabs.map((r) => {
      const ps = all.filter((p) => inRota(p, r.id)), fo = ps.filter(foraPend).length;
      return `<button class="ac-rt ${acRota === r.id ? "active" : ""}" data-rota="${r.id}" ${r.cor ? `style="--rc:${r.cor}"` : ""}>${r.cor ? "<i></i>" : ""}${esc(r.nome)}<b>${ps.length}</b>${fo ? `<em title="Fora do horário">${fo}</em>` : ""}</button>`;
    }).join("");

    const base = all.filter((p) => inRota(p, acRota));
    const sts = new Map(base.map((p) => [p.id, statusOf(p)]));
    const G = (g) => (p) => sts.get(p.id).grp === g;
    const F = { todos: () => true, fora: foraPend, hoje: (p) => p.embarque === td && p.etapa !== "fim", sep: G("sep"), conf: G("conf"), fat: G("fat"), emb: G("emb"), fim: G("fim") };
    if (!F[acF]) acF = "todos";
    const fchips = [["todos", "Todos"], ["fora", "Fora do horário", "red"], ["hoje", "Embarque hoje"], ["sep", "Separação"], ["conf", "Conferência"], ["fat", "Faturamento"], ["emb", "Carga / embarque"], ["fim", "Embarcados"]]
      .map(([id, l, c]) => { const n = base.filter(F[id]).length; if (id === "fora" && !n) return ""; return `<button class="ac-fc ${c || ""} ${acF === id ? "active" : ""}" data-acf="${id}">${l} <b>${n}</b></button>`; }).join("");

    const rows = base.filter(F[acF]).sort((a, b) => (foraPend(b) - foraPend(a)) || ((a.etapa === "fim") - (b.etapa === "fim"))
      || String(a.embarque || "0").localeCompare(String(b.embarque || "0")) || a.chegada - b.chegada);
    const r = R.rota(acRota), showRota = !r;
    const cargaMot = (p) => { const c = p.carga && C(p.carga); return c ? (c.motorista ? esc(nameOf(c.motorista)) : `<span class="muted">a designar</span>`) : "—"; };
    const tr = rows.map((p) => {
      const s = sts.get(p.id), e = embInfo(p);
      return `<tr class="ac-row ${foraPend(p) ? "fora" : ""} ${p.etapa === "fim" ? "fim" : ""}" data-id="${p.id}">
        <td><span class="ac-id">${p.id}</span>${showRota ? `<small>${rotaTag(p.rota)}</small>` : ""}</td>
        <td class="ac-cli"><b>${p.cli.cod}</b>${esc(p.cli.nome)}</td>
        <td>${esc(p.vendedor)}</td>
        <td class="ac-loc">${esc(p.cli.cidade)}<small>${esc(p.cli.bairro)}</small></td>
        <td>${embTag(p, true)}<small>${e ? `${e.sub} · ` : ""}chegou ${fmtTime(p.chegada)}</small></td>
        <td><span class="spill ${s.cls}"><i></i>${s.txt}</span>${s.sub ? `<small>${esc(s.sub)}</small>` : ""}</td>
        <td class="ac-ppl"><span><em>Sep.</em>${p.sep.resp ? esc(nameOf(p.sep.resp)) : "—"}</span><span><em>Conf.</em>${p.conf.resp ? esc(nameOf(p.conf.resp)) : "—"}</span></td>
        <td class="mono">${p.nota || "—"}</td>
        <td>${cargaMot(p)}</td>
      </tr>`;
    }).join("");
    const rule = r ? `<div class="ac-rule">${rotaTag(r.id)}<span>${esc(R.regraTexto(r))}</span></div>`
      : `<div class="ac-rule"><b>${acRota === "semrota" ? "Pedidos sem rota cadastrada" : "Todas as rotas"}</b></div>`;
    return `<div class="ac-rotas">${tabsHtml}</div>
      <section class="ac-panel">
        <div class="ac-bar">${rule}<div class="ac-f">${fchips}</div></div>
        <table class="ac-table">
          <thead><tr><th>Pedido</th><th>Cliente</th><th>Vendedor</th><th>Cidade / bairro</th><th>Embarque</th><th>Status</th><th>Separador / conferente</th><th>Nota</th><th>Motorista</th></tr></thead>
          <tbody>${tr || `<tr><td colspan="9" class="ac-empty">Nenhum pedido neste filtro</td></tr>`}</tbody>
        </table>
      </section>`;
  }

  // ---------- busca ----------
  function applySearch() {
    const q = query.trim().toLowerCase();
    const hayP = (p) => `${p.id} ${p.cli.cod} ${p.cli.nome} ${p.vendedor} ${rotaOf(p.rota)?.nome || "sem rota"} ${p.cli.cidade} ${p.cli.bairro} ${p.nota || ""} ${p.carga || ""}`;
    $$(".card").forEach((el) => {
      const id = el.dataset.id, c = board === "emb" && C(id);
      const hay = c ? `${c.id} ${rotaOf(c.rota).nome} ${nameOf(c.motorista)} ${c.placa} ${c.pedidos.map((x) => hayP(P(x))).join(" ")}` : hayP(P(id));
      el.classList.toggle("q-miss", !!q && !hay.toLowerCase().includes(q));
    });
    $$(".ac-row").forEach((el) => el.classList.toggle("q-miss", !!q && !hayP(P(el.dataset.id)).toLowerCase().includes(q)));
  }
  $("#search").addEventListener("input", (e) => { query = e.target.value; applySearch(); });

  // ---------- cronômetros ----------
  function tickTimers() { $$(".timer[data-since]").forEach((el) => (el.textContent = fmtDur(now() - +el.dataset.since))); }
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
    // faturamento: arrastar um card marcado leva todos os marcados juntos
    if (board === "lib" && sel.has(dragId) && sel.size > 1) {
      dragGroup = sortInbox(db.lib.inbox, "lib").filter((id) => sel.has(id));
      ph.dataset.n = `${dragGroup.length} pedidos`; ph.style.height = "44px";
      setTimeout(() => dragGroup && dragGroup.forEach((id) => { const el = $(`.card[data-id="${id}"]`, boardEl); if (el) el.classList.add("dragging"); }), 0);
      return;
    }
    ph.style.height = c.offsetHeight + "px";
    setTimeout(() => c.classList.add("dragging"), 0);
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
    const id = dragId, col = list.dataset.col, group = dragGroup;
    // na caixa de entrada a lista exibida pode estar filtrada/ordenada: índice relativo à lista real
    if (col === "inbox") {
      const real = db[board].inbox.filter((x) => (group ? !group.includes(x) : x !== id));
      const after = seq[idx + 1];
      idx = after ? real.indexOf(after.dataset.id) : real.length;
      if (idx < 0) idx = real.length;
    }
    endDrag();
    if (group) moveMany(board, group, col, idx); else move(board, id, col, idx);
  });
  boardEl.addEventListener("dragend", endDrag);
  function endDrag() {
    ph.remove();
    $$(".dragging").forEach((x) => x.classList.remove("dragging"));
    $$(".gx-list.over").forEach((l) => l.classList.remove("over"));
    dragId = null; dragGroup = null; delete ph.dataset.n;
    if (pendingRender) { pendingRender = false; render(); }
  }

  // ---------- cliques no quadro ----------
  boardEl.addEventListener("click", (e) => {
    // seleção em lote (faturamento)
    const cb = e.target.closest("[data-sel]");
    if (cb) { e.stopPropagation(); const id = cb.dataset.sel; sel.has(id) ? sel.delete(id) : sel.add(id); render(); return; }
    if (e.target.closest("[data-selall]")) {
      const all = libVisible.length && libVisible.every((id) => sel.has(id));
      libVisible.forEach((id) => (all ? sel.delete(id) : sel.add(id))); render(); return;
    }
    if (e.target.closest("[data-selclear]")) { sel.clear(); render(); return; }
    const lt = e.target.closest("[data-libto]");
    if (lt) return liberarSel(lt.dataset.libto);
    const et = e.target.closest("button[data-etag]");
    if (et) { e.stopPropagation(); return openPop(et.dataset.etag, et); }
    const f = e.target.closest("[data-filter]");
    if (f) { filters[board] = f.dataset.filter; render(); return; }
    const rt = e.target.closest("[data-rota]");
    if (rt) { acRota = rt.dataset.rota; acF = "todos"; localStorage.setItem("wms-bb-gx-acrota", acRota); render(true); return; }
    const af = e.target.closest("[data-acf]");
    if (af) { acF = af.dataset.acf; render(); return; }
    const row = e.target.closest(".ac-row");
    if (row) return openDrawer({ t: "p", id: row.dataset.id });
    const c = e.target.closest(".card");
    if (c) openDrawer({ t: board === "emb" ? "c" : "p", id: c.dataset.id });
  });
  $("#actions").addEventListener("click", (e) => { const a = e.target.closest("[data-act]"); if (a) action(a.dataset.act); });

  function action(act) {
    if (act === "novoPedido") {
      const p = makePedido({ semRota: Math.random() < 0.3, prio: Math.random() < 0.2 });
      db.sep.inbox.unshift(p.id); flashId = p.id; save(); render();
      toast(`${p.id} recebido${p.rota ? ` · embarque ${embInfo(p).label.toLowerCase()}` : " · SEM ROTA"}`);
    }
    if (act === "autoDist") autoDistribute(board);
  }

  // distribui pelo menor volume de trabalho pendente (balanceamento)
  function autoDistribute(k) {
    const B = db[k];
    const cand = sortInbox(B.inbox, k).filter((id) => k !== "sep" || P(id).rota);
    const skipped = B.inbox.length - cand.length;
    if (!cand.length) return toast(skipped ? "Defina a rota dos pedidos antes de distribuir" : "Caixa de entrada vazia");
    const loadOf = (pid) => B.cols[pid].reduce((t, id) => t + (k === "emb" ? cargaVol(C(id)) - cargaLidos(C(id)) : k === "lib" ? 1 : units(P(id)) - doneU(P(id), k)), 0);
    const ids = Object.keys(B.cols);
    cand.forEach((id) => moveCore(k, id, ids.slice().sort((a, b) => loadOf(a) - loadOf(b))[0], null));
    save(); render();
    const what = { sep: "distribuído(s) por carga de trabalho", conf: "distribuído(s) por carga de trabalho", lib: "liberado(s) no Sankhya", emb: "designada(s) aos motoristas" }[k];
    toast(`${cand.length} ${k === "emb" ? "carga(s)" : "pedido(s)"} ${what}${skipped ? ` · ${skipped} sem rota ficaram na caixa` : ""}`);
  }

  // ---------- data de embarque (popover do acompanhamento) ----------
  const pop = document.createElement("div"); pop.className = "gx-pop"; pop.hidden = true; document.body.appendChild(pop);
  let popId = null;
  function openPop(id, el) {
    const p = P(id), r = rotaOf(p.rota), td = hoje(), prox = R.proximoEmbarque(r, td, false), fp = foraPend(p);
    const opt = (d, label) => `<button data-d="${d}" class="${d === p.embarque && !fp ? "sel" : ""}"><b>${label}</b><span>${R.fmtDia(d)}</span></button>`;
    pop.innerHTML = `<p class="pop-h">${p.id} · ${esc(r.nome)}</p>
      ${fp ? `<p class="pop-w">Chegou às ${fmtTime(p.chegada)}, depois do corte (${r.corte}). Defina se embarca hoje ou no próximo embarque.</p>`
        : `<p class="pop-s">Chegou às ${fmtTime(p.chegada)} · ${p.embDef ? "data definida pelo coordenador" : "data calculada pela regra da rota"}</p>`}
      ${opt(td, "Hoje")}${opt(prox, fp ? "Confirmar próximo embarque" : "Próximo embarque")}
      <label class="pop-d"><span>Outra data</span><input type="date" id="popDate" min="${td}" value="${p.embarque}"></label>`;
    pop.hidden = false; popId = id;
    const rc = el.getBoundingClientRect(), h = pop.offsetHeight;
    pop.style.left = Math.max(8, Math.min(rc.left, innerWidth - pop.offsetWidth - 12)) + "px";
    pop.style.top = (rc.bottom + h + 12 > innerHeight ? rc.top - h - 6 : rc.bottom + 6) + "px";
  }
  function closePop() { pop.hidden = true; popId = null; }
  function setData(id, d) {
    const p = P(id), t = R.tag(d, hoje());
    p.embarque = d; p.embDef = true;
    log(p, `Data de embarque definida pelo coordenador: ${t.label.toLowerCase()} (${R.fmtDia(d)})`);
    flashId = id; closePop(); save(); render(); if (openRef) renderDrawer();
    toast(`${p.id}: embarque ${t.label.toLowerCase()} · ${R.fmtDia(d)}`);
  }
  pop.addEventListener("click", (e) => { const b = e.target.closest("[data-d]"); if (b) setData(popId, b.dataset.d); });
  pop.addEventListener("change", (e) => { if (e.target.id === "popDate" && e.target.value) setData(popId, e.target.value); });
  document.addEventListener("click", (e) => { if (!pop.hidden && !pop.contains(e.target) && !e.target.closest("[data-etag]")) closePop(); });
  boardEl.addEventListener("scroll", closePop, true);

  // ---------- modais ----------
  function openModal(html) { $("#modal").innerHTML = html; $("#modal").hidden = false; $("#mScrim").hidden = false; }
  function closeModal() { $("#modal").hidden = true; $("#mScrim").hidden = true; }
  $("#mScrim").addEventListener("click", closeModal);
  $("#modal").addEventListener("click", (e) => { if (e.target.closest("[data-close]")) closeModal(); });

  const rotaOptions = (sel) => R.ROTAS.map((r) => `<option value="${r.id}" ${r.id === sel ? "selected" : ""}>${esc(r.nome)}</option>`).join("");

  function setRota(p, r) {
    p.rota = r;
    log(p, r ? `Rota definida pelo coordenador: ${rotaOf(r).nome}` : "Rota removida pelo coordenador");
    if (!p.embDef || !r) setEmbarque(p);
  }

  function askRota(id, then) {
    const p = P(id);
    openModal(`<h2>Defina a rota de ${p.id}</h2>
      <p><b>${p.cli.cod} · ${esc(p.cli.nome)}</b> (${esc(p.cli.cidade)} · ${esc(p.cli.bairro)}) chegou sem rota. Escolha a rota para liberar a separação — ela fica salva no pedido e define a data de embarque.</p>
      <label class="field"><span>Rota</span><select id="mRota"><option value="">Selecione…</option>${rotaOptions()}</select></label>
      <div class="m-act"><button class="btn ghost" data-close>Cancelar</button><button class="btn primary" id="mOk">Salvar e continuar</button></div>`);
    $("#mOk").onclick = () => {
      const r = $("#mRota").value; if (!r) return toast("Escolha uma rota");
      setRota(p, r); save(); closeModal(); then && then();
    };
  }

  $("#userBtn").addEventListener("click", () => {
    openModal(`<h2>${esc(sess.nome)}</h2><p>Perfil: Gestão de Expedição</p>
      <div class="m-act"><button class="btn ghost" id="mReset">Reiniciar dados de demonstração</button><button class="btn primary" id="mOut">Sair</button></div>`);
    $("#mReset").onclick = () => { seed(); closeModal(); closeDrawer(); render(true); toast("Cenário de demonstração reiniciado"); };
    $("#mOut").onclick = () => { W.logout(); location.replace("./"); };
  });

  // ---------- gaveta: detalhe do pedido / da carga ----------
  function openDrawer(ref) { openRef = ref; $("#drawer").hidden = false; $("#drScrim").hidden = false; renderDrawer(); }
  function closeDrawer() { openRef = null; $("#drawer").hidden = true; $("#drScrim").hidden = true; }
  $("#drScrim").addEventListener("click", closeDrawer);

  function stageInfo(p) {
    const s = statusOf(p);
    return { txt: s.txt + (s.sub && s.grp !== "fim" ? ` · ${s.sub}` : ""), cls: s.cls === "work" ? "live" : s.cls === "done" ? "" : "wait" };
  }

  const timeline = (h) => `<ol class="timeline">${[...h].sort((a, b) => a.t - b.t).map((x) => `<li><time>${fmtTime(x.t)}</time>${esc(x.txt)}</li>`).join("")}</ol>`;

  function renderDrawer() {
    if (!openRef) return;
    if ($("#drawer").contains(document.activeElement) && document.activeElement.tagName === "SELECT") return; // não atrapalha quem está escolhendo
    if (openRef.t === "c") return renderCargaDrawer();
    const p = P(openRef.id);
    if (!p) return closeDrawer();
    const k = ["sep", "conf", "lib"].includes(p.etapa) ? p.etapa : null;
    const st = stageInfo(p), loc = locateP(p.id);
    const isL = k && live(p, k), itemK = isL && k !== "lib" ? k : null;
    const c = itemK && curItem(p, itemK);
    const r = rotaOf(p.rota), e = embInfo(p);

    let liveHtml = "";
    if (itemK) liveHtml = `<div class="dr-live">
        <div class="cl-row"><span class="cl-tag"><i></i>${k === "sep" ? "Separando agora" : "Conferindo agora"} · ${esc(nameOf(p[k].resp))}</span><span class="timer" data-since="${p[k].inicio}">00:00</span></div>
        <div class="cl-row"><span class="big">${pct(p, k)}%</span><span><b>${itensOk(p, k)}</b>/${p.itens.length} itens · <b>${doneU(p, k)}</b>/${units(p)} unidades</span></div>
        <div class="cl-bar"><i style="width:${pct(p, k)}%"></i></div>
        ${c ? `<div class="now"><span class="gaddr">${c.end}</span><p>${esc(c.desc)}<small>${c.sku} · ${c[k]}/${c.qtd} un. ${k === "sep" ? "separadas" : "conferidas"}</small></p></div>` : ""}
      </div>`;
    else if (isL) liveHtml = `<div class="dr-live"><div class="cl-row"><span class="cl-tag"><i></i>Faturando agora · ${esc(nameOf(p.lib.resp))}</span><span class="timer" data-since="${p.lib.inicio}">00:00</span></div>
        <div class="cl-row"><span>Sankhya · gerando nota fiscal</span></div></div>`;

    const showConf = p.etapa !== "sep";
    const rows = p.itens.map((i) => {
      const v = itemK ? i[itemK] : showConf ? i.conf : i.sep, ok = v >= i.qtd, isNow = c && c === i;
      const dot = ok ? `<span class="sdot ok">${CHECK}</span>` : v > 0 ? `<span class="sdot part" style="--p:${Math.round((v / i.qtd) * 100)}%"></span>` : `<span class="sdot"></span>`;
      return `<tr class="${ok ? "ok" : ""} ${isNow ? "now" : ""}">
        <td>${dot}</td><td><span class="gaddr">${i.end}</span></td>
        <td>${esc(i.desc)}${isNow ? `<span class="now-tag">agora</span>` : ""}<small>${i.sku}</small></td>
        <td class="r">${i.qtd}</td><td class="r">${i.sep}</td>${showConf ? `<td class="r">${i.conf}</td>` : ""}</tr>`;
    }).join("");

    let actions = "";
    if (k && !isL) {
      const others = BOARDS[k].people.filter((x) => x.id !== loc.col);
      const label = k === "lib" ? "(liberar · fim da fila)" : "(fim da fila)";
      const canTop = loc.col !== "inbox" && loc.list.indexOf(p.id) > (isLive(k, loc.list[0]) ? 1 : 0);
      actions = `<section><h4 class="dr-h">Ações</h4><div class="dr-act">
        <select id="drMove"><option value="">${k === "lib" ? "Liberar para…" : "Mover para…"}</option>${loc.col !== "inbox" ? `<option value="inbox">Caixa de entrada${k === "lib" ? " (cancelar liberação)" : ""}</option>` : ""}
          ${others.map((x) => `<option value="${x.id}">${esc(x.nome)} ${label}</option>`).join("")}</select>
        <button class="btn primary" id="drMoveGo">${k === "lib" ? "Confirmar" : "Mover"}</button>
        ${canTop ? `<button class="btn ghost" id="drTop">Passar para o próximo da fila</button>` : ""}
      </div></section>`;
    }
    const rotaLocked = ["mont", "emb", "fim"].includes(p.etapa);
    const carga = p.carga && C(p.carga);

    $("#drawer").innerHTML = `
      <header class="dr-head">
        <div><p class="dr-k">Pedido</p><h2>${p.id}</h2></div>
        <span class="stage ${st.cls}">${esc(st.txt)}</span>
        <button class="dr-x" id="drClose" aria-label="Fechar">×</button>
      </header>
      <div class="dr-body">
        <div class="dr-grid">
          <div class="dr-f"><small>Cliente</small><b>${p.cli.cod} · ${esc(p.cli.nome)}</b><span>${esc(p.cli.cidade)} · ${esc(p.cli.bairro)}</span></div>
          <div class="dr-f"><small>Vendedor</small><b>${esc(p.vendedor)}</b><span>Chegou ${fmtAge(p.chegada)} · ${fmtTime(p.chegada)}</span></div>
          <div class="dr-f"><small>Rota</small>${rotaLocked ? `<b>${esc(r ? r.nome : "—")}</b>` : `<select id="drRota" class="${p.rota ? "" : "warn"}"><option value="">— Sem rota —</option>${rotaOptions(p.rota)}</select>`}</div>
          <div class="dr-f"><small>Embarque</small>${e ? `<div class="dr-emb">${embTag(p)}<span>${e.sub}${p.embDef ? " · definido pelo coordenador" : ""}</span></div><span>${r ? `Corte ${r.corte}${r.semanal != null ? ` de ${R.DIAS[r.semanal].toLowerCase()}` : ""} · altere no Acompanhamento` : ""}</span>` : `<b>—</b><span>Defina a rota</span>`}</div>
          <div class="dr-f"><small>Prioridade</small><button class="tgl ${p.prio === "alta" ? "on" : ""}" id="drPrio">${p.prio === "alta" ? "▲ Alta" : "Normal"}</button></div>
          <div class="dr-f"><small>Carga</small>${carga ? `<b><a href="#" id="drCarga">${carga.id}</a></b><span>${carga.motorista ? esc(nameOf(carga.motorista)) : "sem motorista"} · ${carga.veiculo} ${carga.placa}</span>` : `<b>—</b><span>${p.etapa === "mont" ? "aguardando montagem no ERP" : "ainda não faturado"}</span>`}</div>
        </div>
        <div class="dr-nums">
          <div><b>${p.itens.length}</b><small>SKUs</small></div>
          <div><b>${units(p)}</b><small>unidades</small></div>
          <div><b>${p.volumes || "—"}</b><small>volumes</small></div>
          <div><b>${p.nota || "—"}</b><small>nota fiscal</small></div>
        </div>
        ${liveHtml}
        <section>
          <h4 class="dr-h">Itens · ordem de coleta</h4>
          <table class="dr-items"><thead><tr><th></th><th>Endereço</th><th>Produto</th><th class="r">Pedido</th><th class="r">Separado</th>${showConf ? `<th class="r">Conferido</th>` : ""}</tr></thead><tbody>${rows}</tbody></table>
        </section>
        ${actions}
        <section><h4 class="dr-h">Histórico</h4>${timeline(p.hist)}</section>
      </div>`;
    tickTimers();

    $("#drClose").onclick = closeDrawer;
    if ($("#drRota")) $("#drRota").onchange = (ev) => {
      setRota(p, ev.target.value || null);
      save(); ev.target.blur(); render(); renderDrawer(); toast(p.rota ? `Rota de ${p.id}: ${rotaOf(p.rota).nome}` : `${p.id} sem rota`);
    };
    $("#drPrio").onclick = () => {
      p.prio = p.prio === "alta" ? "normal" : "alta"; log(p, p.prio === "alta" ? "Marcado como prioridade" : "Prioridade removida");
      save(); render(); renderDrawer();
    };
    if ($("#drCarga")) $("#drCarga").onclick = (ev) => { ev.preventDefault(); openDrawer({ t: "c", id: carga.id }); };
    if ($("#drMoveGo")) $("#drMoveGo").onclick = () => { const v = $("#drMove").value; if (v) move(k, p.id, v, null); };
    if ($("#drTop")) $("#drTop").onclick = () => move(k, p.id, loc.col, 0);
  }

  function renderCargaDrawer() {
    const c = C(openRef.id);
    if (!c) return closeDrawer();
    const vol = cargaVol(c), lid = cargaLidos(c), pc = vol ? Math.round((lid / vol) * 100) : 0, cur = cargaCur(c);
    const loc = locate("emb", c.id);
    const st = c.status === "embarcada" ? { txt: `Embarcada · lacre ${c.lacre}`, cls: "" } : c.status === "carregando" ? { txt: `Carregando · doca ${c.doca}`, cls: "live" }
      : !c.motorista ? { txt: "Aguardando motorista", cls: "wait" } : { txt: `Na fila de ${nameOf(c.motorista)} · ${loc ? loc.list.indexOf(c.id) + 1 : 1}ª`, cls: "wait" };
    const liveHtml = c.status === "carregando" ? `<div class="dr-live">
        <div class="cl-row"><span class="cl-tag"><i></i>Bipando agora · ${OPERADOR}</span><span class="timer" data-since="${c.inicio}">00:00</span></div>
        <div class="cl-row"><span class="big">${pc}%</span><span><b>${cargaPedOk(c)}</b>/${c.pedidos.length} pedidos · <b>${lid}</b>/${vol} volumes</span></div>
        <div class="cl-bar"><i style="width:${pc}%"></i></div>
        ${cur ? `<div class="now"><span class="gaddr">${cur}</span><p>${esc(P(cur).cli.nome)}<small>${esc(P(cur).cli.cidade)} · ${esc(P(cur).cli.bairro)} · ${c.lidos[cur] || 0}/${P(cur).volumes} vol. carregados</small></p></div>` : ""}
      </div>` : "";
    const rows = c.pedidos.map((id, i) => {
      const p = P(id), v = c.lidos[id] || 0, ok = v >= p.volumes, isNow = c.status === "carregando" && cur === id;
      const dot = ok ? `<span class="sdot ok">${CHECK}</span>` : v > 0 ? `<span class="sdot part" style="--p:${Math.round((v / p.volumes) * 100)}%"></span>` : `<span class="sdot"></span>`;
      return `<tr class="click ${ok ? "ok" : ""} ${isNow ? "now" : ""}" data-pid="${id}">
        <td>${dot}</td><td class="r">${i + 1}º</td><td><b>${id}</b>${isNow ? `<span class="now-tag">agora</span>` : ""}<small>NF ${p.nota}</small></td>
        <td>${esc(p.cli.nome)}<small>${esc(p.cli.cidade)} · ${esc(p.cli.bairro)}</small></td><td class="r">${v}/${p.volumes}</td></tr>`;
    }).join("");
    const t = R.tag(c.data, hoje());
    $("#drawer").innerHTML = `
      <header class="dr-head">
        <div><p class="dr-k">Carga · Sankhya</p><h2>${c.id}</h2></div>
        <span class="stage ${st.cls}">${esc(st.txt)}</span>
        <button class="dr-x" id="drClose" aria-label="Fechar">×</button>
      </header>
      <div class="dr-body">
        <div class="dr-grid">
          <div class="dr-f"><small>Rota</small><b>${rotaTag(c.rota)}</b><span>Embarque ${t.label.toLowerCase()} · ${t.sub}</span></div>
          <div class="dr-f"><small>Motorista</small><b>${c.motorista ? esc(nameOf(c.motorista)) : "— a designar —"}</b><span>${c.motorista ? "" : "arraste a carga para a coluna do motorista"}</span></div>
          <div class="dr-f"><small>Veículo</small><b><span class="plate">${c.placa}</span> ${c.veiculo}</b><span>Doca ${c.doca}</span></div>
          <div class="dr-f"><small>Carregamento</small><b>${c.status === "embarcada" ? `${fmtTime(c.inicio)}–${fmtTime(c.fim)} · ${fmtDur(c.fim - c.inicio)}` : c.status === "carregando" ? `desde ${fmtTime(c.inicio)}` : "não iniciado"}</b><span>Bip: ${OPERADOR}</span></div>
        </div>
        <div class="dr-nums">
          <div><b>${c.pedidos.length}</b><small>pedidos</small></div>
          <div><b>${vol}</b><small>volumes</small></div>
          <div><b>${lid}</b><small>bipados</small></div>
          <div><b>${c.lacre || "—"}</b><small>lacre</small></div>
        </div>
        ${liveHtml}
        <section>
          <h4 class="dr-h">Pedidos · ordem de carregamento</h4>
          <table class="dr-items"><thead><tr><th></th><th class="r">#</th><th>Pedido</th><th>Cliente</th><th class="r">Volumes</th></tr></thead><tbody>${rows}</tbody></table>
        </section>
        ${c.alertas.length ? `<section><h4 class="dr-h">Alertas do bip</h4><ul class="dr-alerts">${c.alertas.map((a) => `<li>${ICON_WARN}<span><time>${fmtTime(a.t)}</time>${esc(a.txt)}</span></li>`).join("")}</ul></section>` : ""}
        <section><h4 class="dr-h">Histórico</h4>${timeline(c.hist)}</section>
      </div>`;
    tickTimers();
    $("#drClose").onclick = closeDrawer;
    $$("#drawer tr[data-pid]").forEach((tr) => (tr.onclick = () => openDrawer({ t: "p", id: tr.dataset.pid })));
  }

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!pop.hidden) closePop(); else if (!$("#modal").hidden) closeModal(); else if (openRef) closeDrawer();
  });

  // ---------- simulação da operação (enquanto não há integração com os apps e o ERP) ----------
  function tick() {
    if (!sim) return;
    let changed = false;
    db.tick = (db.tick || 0) + 1;

    // separadores e conferentes
    ["sep", "conf"].forEach((k) => {
      Object.entries(db[k].cols).forEach(([pid, l]) => {
        if (!l.length) return;
        const p = P(l[0]);
        if (!live(p, k)) {
          if (now() - (p[k].atrib || 0) < 12000) return; // operador "pega" o próximo pedido alguns segundos após a atribuição
          p[k].inicio = now(); p[k].resp = pid; log(p, `${BOARDS[k].nome} iniciada por ${nameOf(pid)}`);
          changed = true; return;
        }
        if (Math.random() > (k === "sep" ? 0.5 : 0.7)) return; // ritmo da demonstração
        const c0 = curItem(p, k); if (c0) c0[k]++;
        changed = true;
        if (curItem(p, k)) return;
        p[k].fim = now(); l.shift(); db.stats[pid]++;
        if (k === "sep") {
          p.volumes = vols(p); p.etapa = "conf"; db.conf.inbox.push(p.id);
          log(p, `Separação finalizada por ${nameOf(pid)} · ${p.volumes} volume(s)`);
          if (board === "sep") toast(`${p.id} separado por ${nameOf(pid)} → caixa da conferência`);
        } else {
          p.etapa = "lib"; db.lib.inbox.push(p.id);
          log(p, `Conferência finalizada por ${nameOf(pid)} · aguardando liberação p/ faturamento`);
          if (board === "conf" || board === "lib") toast(`${p.id} conferido → aguardando liberação p/ faturamento`);
        }
        if (l[0]) P(l[0])[k].atrib = now();
      });
    });

    // faturistas (Sankhya)
    Object.entries(db.lib.cols).forEach(([fid, l]) => {
      if (!l.length) return;
      const p = P(l[0]);
      if (!live(p, "lib")) {
        if (now() - (p.lib.atrib || 0) < 8000) return;
        p.lib.inicio = now(); p.lib.dur = (9 + Math.floor(Math.random() * 8)) * 1000;
        log(p, `Faturamento iniciado por ${nameOf(fid)} (Sankhya)`); renumLib(fid); changed = true; return;
      }
      if (now() - p.lib.inicio < (p.lib.dur || 12000)) return;
      p.lib.fim = now(); p.nota = db.nfSeq++; l.shift(); db.stats[fid]++;
      p.etapa = "mont"; p.mont = now(); db.mont.push(p.id);
      log(p, `Faturado por ${nameOf(fid)} · NF ${p.nota} · aguardando montagem de carga no ERP`);
      renumLib(fid); if (l[0]) P(l[0]).lib.atrib = now();
      changed = true;
      if (board === "lib") toast(`${p.id} faturado · NF ${p.nota}`);
    });

    // ERP monta a carga com os faturados que embarcam hoje (mesma rota)
    if (db.tick % 16 === 0) {
      const td = hoje(), ready = db.mont.filter((id) => now() - (P(id).mont || 0) > 20000 && P(id).embarque && P(id).embarque <= td);
      if (ready.length) {
        const g = {}; ready.forEach((id) => (g[P(id).rota] = g[P(id).rota] || []).push(id));
        const [rid, ids] = Object.entries(g).sort((a, b) => b[1].length - a[1].length)[0];
        const mot = Math.random() < 0.5 ? MOTS[Math.floor(Math.random() * MOTS.length)].id : null;
        const c = erpCarga(rid, ids, mot);
        flashId = c.id; changed = true;
        if (board === "emb") toast(`Sankhya: carga ${c.id} (${rotaOf(rid).nome}) recebida${mot ? ` → ${nameOf(mot)}` : " · sem motorista"}`);
      }
    }

    // carregamento: o operador de doca bipa os volumes da carga atual de cada motorista
    Object.entries(db.emb.cols).forEach(([mid, l]) => {
      if (!l.length) return;
      const c = C(l[0]);
      if (c.status !== "carregando") {
        if (now() - (c.atrib || 0) < 10000) return;
        c.status = "carregando"; c.inicio = now(); changed = true;
        log(c, `Carregamento iniciado na doca ${c.doca} · ${OPERADOR}`);
        c.pedidos.forEach((id) => log(P(id), `Carregamento iniciado (${c.id}, doca ${c.doca})`));
        return;
      }
      if (Math.random() > 0.4) return;
      const cur = cargaCur(c);
      if (cur) {
        if (Math.random() < 0.05) {
          const txt = Math.random() < 0.5 ? `Bip duplicado: ${cur} vol. ${Math.max(1, c.lidos[cur] || 0)} — ignorado` : `Volume de outra carga recusado: PV-${10300 + Math.floor(Math.random() * 100)} vol. 1`;
          c.alertas.push({ t: now(), txt }); log(c, txt); changed = true; return;
        }
        c.lidos[cur] = (c.lidos[cur] || 0) + 1; changed = true;
        if (c.lidos[cur] >= P(cur).volumes) log(P(cur), `Todos os volumes carregados (${c.id})`);
      }
      if (!cargaCur(c)) {
        c.status = "embarcada"; c.fim = now(); c.lacre = String(4500 + Math.floor(Math.random() * 400)).padStart(6, "0");
        l.shift(); db.stats[mid]++;
        c.pedidos.forEach((id) => { const p = P(id); p.etapa = "fim"; p.embarcado = now(); log(p, `Embarcado · ${c.veiculo} ${c.placa} · lacre ${c.lacre}`); });
        log(c, `Embarcada · lacre ${c.lacre}`);
        if (l[0]) C(l[0]).atrib = now();
        toast(`${c.id} embarcada · ${nameOf(mid)} · lacre ${c.lacre}`);
      }
    });

    // integração simulada: chega um pedido novo de tempos em tempos
    if (db.tick % 30 === 0) {
      const p = makePedido({ semRota: Math.random() < 0.25, prio: Math.random() < 0.15 });
      db.sep.inbox.unshift(p.id); flashId = p.id; changed = true;
      if (board === "sep") toast(`Novo pedido via integração: ${p.id}${p.rota ? ` · embarque ${embInfo(p).label.toLowerCase()}` : " · SEM ROTA"}`);
    }
    if (changed) { save(); render(); if (openRef) renderDrawer(); }
  }
  setInterval(tick, 1500);

  $("#simBtn").addEventListener("click", () => {
    sim = !sim; localStorage.setItem("wms-bb-gx-sim", sim ? "on" : "off"); renderTop();
    toast(sim ? "Simulação retomada" : "Simulação pausada — o quadro fica parado para você organizar");
  });

  $("#tabs").addEventListener("click", (e) => {
    const b = e.target.closest(".gx-tab"); if (!b) return;
    board = b.dataset.board; localStorage.setItem("wms-bb-gx-board", board);
    closePop(); render(true);
  });

  // ---------- início ----------
  load();
  $("#userName").textContent = sess.nome;
  render(true);
})();
