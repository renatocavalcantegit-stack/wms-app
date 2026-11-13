// WMS Beach Bike — regras de rota: horário de corte e data de embarque.
// Funções puras (sem tela e sem armazenamento): usadas pelo painel de Gestão e, depois, pelo servidor.

// semanal: dia da semana do embarque (0 = domingo … 6 = sábado); sabado: rota que também embarca no sábado
export const ROTAS = [
  { id: "centro", nome: "Centro", cor: "#2563EB", corte: "09:00" },
  { id: "eusebio", nome: "Eusébio", cor: "#7C3AED", corte: "09:00" },
  { id: "caucaia", nome: "Caucaia", cor: "#0891B2", corte: "11:00" },
  { id: "maracanau", nome: "Maracanaú", cor: "#16A34A", corte: "11:00" },
  { id: "maranguape", nome: "Maranguape", cor: "#65A30D", corte: "11:00" },
  { id: "cearatransp", nome: "Ceará Transporte", cor: "#EA580C", corte: "11:00" },
  { id: "megafrete", nome: "Mega Frete", cor: "#DB2777", corte: "11:00" },
  { id: "nortlog", nome: "Nortlog", cor: "#A16207", corte: "12:00" },
  { id: "fp", nome: "F&P", cor: "#475569", corte: "12:00" },
  { id: "messejana", nome: "Messejana", cor: "#BE123C", corte: "12:00", sabado: true },
  { id: "itaitinga", nome: "Itaitinga", cor: "#0D9488", corte: "13:00", semanal: 3 },
  { id: "horizonte", nome: "Horizonte", cor: "#9333EA", corte: "13:00", semanal: 3 },
  { id: "cascavel", nome: "Cascavel", cor: "#CA8A04", corte: "13:00", semanal: 4 },
];
// minutos depois do corte em que o pedido fica "fora do horário", aguardando o coordenador decidir
export const JANELA = 60;

export const DIAS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
export const DIAS3 = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const pad = (n) => String(n).padStart(2, "0");

// datas sempre como "AAAA-MM-DD" no fuso local
export const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parse = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
export const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
export const diffDays = (a, b) => Math.round((parse(a) - parse(b)) / 864e5);
const toMin = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
const fmtMin = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
export const fmtDia = (s) => { const d = parse(s); return `${DIAS3[d.getDay()]} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}`; };

export const rota = (id) => (typeof id === "object" ? id : ROTAS.find((r) => r.id === id) || null);

// a rota tem embarque neste dia?
export function embarca(r, dia) {
  r = rota(r);
  const w = parse(dia).getDay();
  if (r.semanal != null) return w === r.semanal;
  return (w >= 1 && w <= 5) || (w === 6 && !!r.sabado);
}

// próximo dia de embarque da rota a partir de "dia" (incluindo o próprio dia, ou só depois dele)
export function proximoEmbarque(r, dia, incluirDia = true) {
  let d = incluirDia ? dia : addDays(dia, 1);
  for (let i = 0; i < 14 && !embarca(r, d); i++) d = addDays(d, 1);
  return d;
}

// data de embarque de um pedido que chegou em "ts" (chegada na caixa de entrada da separação)
// fora = chegou até JANELA minutos depois do corte: a data já é o próximo embarque, mas o coordenador precisa analisar
export function calcEmbarque(r, ts) {
  r = rota(r);
  const c = new Date(ts), dia = iso(c);
  const m = c.getHours() * 60 + c.getMinutes() + c.getSeconds() / 60, corte = toMin(r.corte);
  if (!embarca(r, dia)) return { data: proximoEmbarque(r, dia), fora: false };
  if (m <= corte) return { data: dia, fora: false };
  return { data: proximoEmbarque(r, dia, false), fora: m <= corte + JANELA };
}

// tradução da data real para a etiqueta: Hoje, Amanhã, dia da semana, Próx. semana
export function tag(data, hoje) {
  const n = diffDays(data, hoje), d = parse(data), sub = fmtDia(data);
  if (n < 0) return { label: "Atrasado", sub, cls: "atrasado" };
  if (n === 0) return { label: "Hoje", sub, cls: "hoje" };
  if (n === 1) return { label: "Amanhã", sub, cls: "amanha" };
  if (n <= 6) return { label: DIAS[d.getDay()], sub, cls: "futuro" };
  if (n <= 13) return { label: "Próx. semana", sub, cls: "semana" };
  return { label: `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`, sub, cls: "semana" };
}

export function regraTexto(r) {
  r = rota(r);
  const c = toMin(r.corte), j = fmtMin(c + JANELA);
  if (r.semanal != null) {
    const dia = DIAS[r.semanal].toLowerCase();
    return `Rota semanal · embarca na ${dia} · pedidos até ${r.corte} de ${dia}; até ${j} fica fora do horário`;
  }
  let t = `Pedidos até ${r.corte} embarcam hoje; até ${j} ficam fora do horário para você decidir`;
  if (r.sabado) t += " · 12h–14h embarca no dia seguinte pela manhã, inclusive sábado";
  return t;
}
