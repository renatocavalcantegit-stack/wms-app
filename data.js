// Catálogo e pedidos de demonstração, compartilhados entre Separação e Conferência.
window.WMS = (() => {
  "use strict";

  const PRODUTOS = [
    { sku: "BK-29-ALU-18", ean: "7891000100011", desc: "Bicicleta Aro 29 Alumínio 21v Preta", tipo: "bike", preco: 1899.9 },
    { sku: "BK-26-ACO-RD", ean: "7891000100028", desc: "Bicicleta Aro 26 Aço Vermelha", tipo: "bike", preco: 899.9 },
    { sku: "BK-20-INF-AZ", ean: "7891000100035", desc: "Bicicleta Infantil Aro 20 Azul", tipo: "bike", preco: 649.9 },
    { sku: "CM-29-PRESTA", ean: "7891000200018", desc: "Câmara de Ar Aro 29 Presta", tipo: "peca", preco: 29.9 },
    { sku: "CM-26-SCHRAD", ean: "7891000200025", desc: "Câmara de Ar Aro 26 Schrader", tipo: "peca", preco: 22.9 },
    { sku: "PN-29-225", ean: "7891000200032", desc: "Pneu 29 x 2.25 Cravo", tipo: "peca", preco: 119.9 },
    { sku: "CP-MTB-M-PT", ean: "7891000300015", desc: "Capacete MTB Tam. M Preto", tipo: "acess", preco: 159.9 },
    { sku: "LV-GEL-G", ean: "7891000300022", desc: "Luva Gel Dedo Curto G", tipo: "acess", preco: 49.9 },
    { sku: "SN-LED-USB", ean: "7891000300039", desc: "Sinalizador LED USB Traseiro", tipo: "acess", preco: 39.9 },
    { sku: "CR-KMC-9V", ean: "7891000200049", desc: "Corrente KMC 9 Velocidades", tipo: "peca", preco: 89.9 },
    { sku: "PD-PLAT-AL", ean: "7891000200056", desc: "Pedal Plataforma Alumínio", tipo: "peca", preco: 79.9 },
    { sku: "GF-SQ-750", ean: "7891000300046", desc: "Garrafa Squeeze 750 ml", tipo: "acess", preco: 24.9 },
    { sku: "BM-PISO-AL", ean: "7891000300053", desc: "Bomba de Piso com Manômetro", tipo: "acess", preco: 139.9 },
    { sku: "SL-GEL-CONF", ean: "7891000200063", desc: "Selim Gel Conforto", tipo: "peca", preco: 69.9 },
  ];
  const ENDERECOS = {
    "BK-29-ALU-18": "A-01-1-02", "BK-26-ACO-RD": "A-01-1-05", "BK-20-INF-AZ": "A-02-1-01",
    "CM-29-PRESTA": "B-03-2-04", "CM-26-SCHRAD": "B-03-2-06", "PN-29-225": "B-04-1-02",
    "CP-MTB-M-PT": "C-01-3-01", "LV-GEL-G": "C-02-2-03", "SN-LED-USB": "C-02-3-05",
    "CR-KMC-9V": "B-05-2-01", "PD-PLAT-AL": "B-05-3-02", "GF-SQ-750": "C-03-1-04",
    "BM-PISO-AL": "C-04-1-01", "SL-GEL-CONF": "B-06-2-03",
  };

  const find = (code) => {
    const c = String(code).trim().toUpperCase();
    return PRODUTOS.find((p) => p.ean === c || p.sku.toUpperCase() === c) || null;
  };

  const item = (sku, qtd) => ({
    ...PRODUTOS.find((x) => x.sku === sku), end: ENDERECOS[sku], qtd, sep: 0, status: "pendente", motivo: "",
  });

  const order = (id, cliente, cidade, prio, hora, itens) => ({
    id, cliente, cidade, prio, hora, status: "pendente", itens, inicio: null, fim: null, operador: null, atual: 0,
  });

  // rota: ordena itens pelo endereço (rua > prédio > nível > posição)
  const routeSort = (o) => {
    o.itens.sort((a, b) => a.end.localeCompare(b.end, "pt-BR", { numeric: true }));
    return o;
  };

  // pedidos para separar
  const seedSeparacao = () => [
    order("PV-10421", "Pedal & Cia Bikes", "Recife · PE", "alta", "07:42", [item("BK-29-ALU-18", 2), item("CM-29-PRESTA", 6), item("CP-MTB-M-PT", 2), item("SN-LED-USB", 4)]),
    order("PV-10422", "Bike Point Olinda", "Olinda · PE", "normal", "08:05", [item("BK-26-ACO-RD", 3), item("CM-26-SCHRAD", 5), item("PD-PLAT-AL", 2)]),
    order("PV-10423", "Ciclo Norte Distribuidora", "Paulista · PE", "alta", "08:31", [item("PN-29-225", 8), item("CM-29-PRESTA", 10), item("CR-KMC-9V", 6), item("SL-GEL-CONF", 4), item("BM-PISO-AL", 2)]),
    order("PV-10424", "Rota Bike Caruaru", "Caruaru · PE", "normal", "09:10", [item("BK-20-INF-AZ", 4), item("GF-SQ-750", 12), item("LV-GEL-G", 6)]),
    order("PV-10425", "Mundo Pedal", "Jaboatão · PE", "normal", "09:48", [item("CP-MTB-M-PT", 3), item("LV-GEL-G", 3), item("SN-LED-USB", 3), item("GF-SQ-750", 6)]),
  ].map(routeSort);

  // pedidos já separados, aguardando conferência
  const seedConferencia = () => {
    const sep = (o, faltas = {}) => {
      o.itens.forEach((i) => {
        const f = faltas[i.sku];
        Object.assign(i, f != null ? { sep: f, status: "falta", motivo: "Quantidade insuficiente" } : { sep: i.qtd, status: "ok" });
      });
      return Object.assign(o, { status: "concluido", operador: "Marcos", fim: Date.now() - 3600e3 });
    };
    return [
      sep(order("PV-10401", "Casa do Ciclista", "Recife · PE", "alta", "06:55", [item("BK-29-ALU-18", 1), item("CM-29-PRESTA", 4), item("LV-GEL-G", 2), item("GF-SQ-750", 3)])),
      sep(order("PV-10402", "Speed Bikes Boa Viagem", "Recife · PE", "normal", "07:10", [item("PN-29-225", 4), item("CR-KMC-9V", 2), item("PD-PLAT-AL", 2), item("BM-PISO-AL", 1)]), { "BM-PISO-AL": 0 }),
      sep(order("PV-10403", "Pedala Garanhuns", "Garanhuns · PE", "normal", "07:28", [item("BK-20-INF-AZ", 2), item("CP-MTB-M-PT", 2), item("SN-LED-USB", 5)])),
      sep(order("PV-10404", "Trilha Livre Bike Shop", "Petrolina · PE", "alta", "07:35", [item("BK-26-ACO-RD", 2), item("CM-26-SCHRAD", 6), item("SL-GEL-CONF", 3), item("GF-SQ-750", 6), item("LV-GEL-G", 4)]), { "CM-26-SCHRAD": 5 }),
    ].map(routeSort);
  };

  // cargas montadas com pedidos já conferidos (volumes etiquetados)
  // pedidos listados na ordem de ENTREGA; o carregamento é feito na ordem inversa
  const seedEmbarque = () => {
    // obs: composição dos volumes informada na conferência (demonstração)
    const p = (id, cliente, cidade, volumes, tipos, atencao = "", outro = "") =>
      ({ id, cliente, cidade, volumes, lidos: [], obs: tipos ? { tipos, outro, atencao, por: "Usuário Conferente", em: null } : null });
    const c = (id, rota, veiculo, placa, motorista, doca, saida, pedidos) => ({
      id, rota, veiculo, placa, motorista, doca, saida, pedidos, status: "aberta", inicio: null, fim: null, operador: null, log: [], obs: "",
    });
    return [
      c("CG-0231", "Recife / RMR", "VUC", "QYK-4B21", "José Carlos", "02", "10:30", [
        p("PV-10401", "Casa do Ciclista", "Recife · PE", 2, { caixa: 1, sacola: 1 }),
        p("PV-10402", "Speed Bikes Boa Viagem", "Recife · PE", 2, { pneuaro: 1, caixa: 1 }),
        p("PV-10421", "Pedal & Cia Bikes", "Recife · PE", 3, { caixa: 2, pneuaro: 1 }, "Vai ter acréscimo de 1 bicicleta"),
        p("PV-10425", "Mundo Pedal", "Jaboatão · PE", 2, { aro: 1, sacola: 1 }),
      ]),
      c("CG-0232", "Agreste", "Toco", "PCZ-7H90", "Severino Lima", "03", "11:15", [
        p("PV-10424", "Rota Bike Caruaru", "Caruaru · PE", 4, { amarrado: 1, pneu: 2, caixa: 1 }, "Amarrado com 6 pneus aro 29"),
        p("PV-10403", "Pedala Garanhuns", "Garanhuns · PE", 2, { caixa: 2 }),
      ]),
      c("CG-0233", "Sertão", "Truck", "RFA-2C33", "Antônio Neto", "01", "13:00", [
        p("PV-10404", "Trilha Livre Bike Shop", "Petrolina · PE", 3, { bike: 1, caixa: 1, outro: 1 }, "", "Tubo de garfo"),
        p("PV-10423", "Ciclo Norte Distribuidora", "Paulista · PE", 5, { caixa: 3, quadro: 2 }, "Quadros envoltos em plástico bolha"),
      ]),
    ];
  };

  // lê o código de uma etiqueta de volume: QR "PV-10404|1/3|..." ou digitado "10404 1", "PV-10404/1"
  const parseVolume = (raw) => {
    const s = String(raw).trim().toUpperCase();
    const m = s.match(/^(?:PV-?)?(\d{3,})\s*[|/\-\s.]\s*(\d{1,3})(?:\s*\/\s*(\d{1,3}))?/);
    return m ? { id: "PV-" + m[1], vol: +m[2], total: m[3] ? +m[3] : null } : null;
  };

  // ---------- usuários de demonstração (cada perfil acessa só a sua tela) ----------
  // PINs fictícios, apenas para o MVP; num sistema real a autenticação fica no servidor
  const USERS = [
    { login: "separador", nome: "Usuário Separador", perfil: "sep", pin: "1111" },
    { login: "conferente", nome: "Usuário Conferente", perfil: "conf", pin: "2222" },
    { login: "embarque", nome: "Usuário de Embarque", perfil: "emb", pin: "3333" },
    { login: "coordenador", nome: "Usuário Coordenador", perfil: "coord", pin: "4444" },
  ];
  const PERFIS = { sep: "Separação", conf: "Conferência", emb: "Embarque", coord: "Gestão de Expedição" };
  const SESSION = "wms-bb-session";

  const session = () => {
    try {
      const s = JSON.parse(localStorage.getItem(SESSION));
      return s && USERS.find((u) => u.login === s.login) ? s : null;
    } catch { return null; }
  };
  const login = (user, pin) => {
    const u = USERS.find((x) => x.login === String(user).trim().toLowerCase() && x.pin === String(pin).trim());
    if (!u) return null;
    const s = { login: u.login, nome: u.nome, perfil: u.perfil, desde: Date.now() };
    localStorage.setItem(SESSION, JSON.stringify(s));
    return s;
  };
  const logout = () => localStorage.removeItem(SESSION);
  // página de cada perfil
  const homeUrl = (perfil) => ({ conf: "conferencia.html", coord: "gestao.html" }[perfil] || "./");

  // ---------- observação dos volumes (conferência → Sankhya / embarque) ----------
  // tipos de volume: [id, nome na tela, abreviação enviada ao ERP]
  const VOL_TIPOS = [
    ["caixa", "Caixa", "CX"], ["sacola", "Sacola", "SAC"], ["pneu", "Pneu", "PNEU"], ["aro", "Aro", "ARO"],
    ["pneuaro", "Pneu + aro", "PNEU+ARO"], ["quadro", "Quadro", "QUADRO"], ["bike", "Bicicleta", "BIC"],
    ["amarrado", "Amarrado", "AMARRADO"], ["outro", "Outro", ""],
  ];
  const semAcento = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
  // linhas [qtd, nome, abreviação] na ordem do cadastro
  const obsLinhas = (obs) => VOL_TIPOS.filter(([id]) => obs && obs.tipos && obs.tipos[id] > 0)
    .map(([id, nome, ab]) => [obs.tipos[id], id === "outro" ? obs.outro || "Outro" : nome, id === "outro" ? semAcento(obs.outro) || "OUTRO" : ab]);
  const obsTotal = (obs) => (obs && obs.tipos ? Object.values(obs.tipos).reduce((t, n) => t + (n || 0), 0) : 0);
  // texto gravado na observação do pedido no Sankhya (vai para os dados adicionais da NF-e)
  const obsErp = (obs) => {
    if (!obs) return "";
    const t = obsTotal(obs);
    let s = `[WMS] VOLUMES: ${obsLinhas(obs).map(([n, , ab]) => `${n} ${ab}`).join(" + ")} = ${t} VOL.`;
    if (obs.atencao) s += ` | ATENCAO: ${semAcento(obs.atencao)}`;
    return s;
  };
  const obsResumo = (obs) => obsLinhas(obs).map(([n, nome]) => `${n} ${nome}`).join(" · ");

  return { USERS, PERFIS, session, login, logout, homeUrl, VOL_TIPOS, obsLinhas, obsTotal, obsErp, obsResumo, PRODUTOS, ENDERECOS, find, item, order, routeSort, seedSeparacao, seedConferencia, seedEmbarque, parseVolume, SEP_STORE: "wms-bb-sep-v1", CONF_STORE: "wms-bb-conf-v1" };
})();
