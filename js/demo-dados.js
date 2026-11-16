// WMS Beach Bike — dados de demonstração: catálogo, endereços e pedidos de exemplo.
// No sistema real tudo isto vem do servidor (que recebe do Sankhya).
import { acharProduto, routeSort } from "../compartilhado/regras/produtos.js";

export const PRODUTOS = [
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
// componentes usados nos pedidos de montagem (ordem de produção)
export const COMPONENTES = [
  { sku: "QD-29-ALU-M", ean: "7891000400012", desc: "Quadro Aro 29 Alumínio Tam. 17", tipo: "peca", preco: 389.9 },
  { sku: "AR-29-PD-36", ean: "7891000400029", desc: "Aro 29 Parede Dupla 36 Furos", tipo: "peca", preco: 84.9 },
  { sku: "GD-MTB-680", ean: "7891000400036", desc: "Guidão MTB 680 mm", tipo: "peca", preco: 59.9 },
  { sku: "MS-31-60", ean: "7891000400043", desc: "Mesa 31,8 x 60 mm", tipo: "peca", preco: 54.9 },
  { sku: "FR-VB-KIT", ean: "7891000400050", desc: "Kit Freio V-Brake Dianteiro + Traseiro", tipo: "peca", preco: 69.9 },
  { sku: "CB-TR-7V", ean: "7891000400067", desc: "Câmbio Traseiro 7 Velocidades", tipo: "peca", preco: 74.9 },
  { sku: "PE-3X-170", ean: "7891000400074", desc: "Pedivela Triplo 170 mm", tipo: "peca", preco: 119.9 },
  { sku: "CU-36-QR", ean: "7891000400081", desc: "Par de Cubos 36 Furos Blocagem", tipo: "peca", preco: 99.9 },
];
// endereço de picking de cada produto, no formato das prateleiras (rua-prédio-andar-apartamento, só números)
export const ENDERECOS = {
  "BK-29-ALU-18": "R3001-P1-A100-AP102", "BK-26-ACO-RD": "R3001-P1-A100-AP105", "BK-20-INF-AZ": "R3001-P2-A100-AP101",
  "CM-29-PRESTA": "R3002-P3-A200-AP204", "CM-26-SCHRAD": "R3002-P3-A200-AP206", "PN-29-225": "R3002-P4-A100-AP102",
  "CP-MTB-M-PT": "R3003-P1-A300-AP301", "LV-GEL-G": "R3003-P2-A200-AP203", "SN-LED-USB": "R3003-P2-A300-AP305",
  "CR-KMC-9V": "R3002-P5-A200-AP201", "PD-PLAT-AL": "R3002-P5-A300-AP302", "GF-SQ-750": "R3003-P3-A100-AP104",
  "BM-PISO-AL": "R3003-P4-A100-AP101", "SL-GEL-CONF": "R3002-P6-A200-AP203",
  "QD-29-ALU-M": "R3004-P1-A100-AP101", "AR-29-PD-36": "R3004-P1-A200-AP203", "GD-MTB-680": "R3004-P2-A100-AP102", "MS-31-60": "R3004-P2-A200-AP201",
  "FR-VB-KIT": "R3004-P3-A100-AP104", "CB-TR-7V": "R3004-P3-A200-AP202", "PE-3X-170": "R3004-P4-A100-AP101", "CU-36-QR": "R3004-P4-A200-AP203",
};
const CATALOGO = [...PRODUTOS, ...COMPONENTES];

// produto pelo código lido (EAN ou SKU) no catálogo de demonstração
export const find = (code) => acharProduto(CATALOGO, code);

const item = (sku, qtd) => ({
  ...CATALOGO.find((x) => x.sku === sku), end: ENDERECOS[sku], qtd, sep: 0, status: "pendente", motivo: "",
});

const order = (id, cliente, cidade, prio, hora, itens) => ({
  id, cliente, cidade, prio, hora, status: "pendente", itens, inicio: null, fim: null, operador: null, atual: 0,
});

// pedidos para separar
export const seedSeparacao = () => [
  order("PV-10421", "Pedal & Cia Bikes", "Recife · PE", "alta", "07:42", [item("BK-29-ALU-18", 2), item("CM-29-PRESTA", 6), item("CP-MTB-M-PT", 2), item("SN-LED-USB", 4)]),
  order("PV-10422", "Bike Point Olinda", "Olinda · PE", "normal", "08:05", [item("BK-26-ACO-RD", 3), item("CM-26-SCHRAD", 5), item("PD-PLAT-AL", 2)]),
  order("PV-10423", "Ciclo Norte Distribuidora", "Paulista · PE", "alta", "08:31", [item("PN-29-225", 8), item("CM-29-PRESTA", 10), item("CR-KMC-9V", 6), item("SL-GEL-CONF", 4), item("BM-PISO-AL", 2)]),
  order("PV-10424", "Rota Bike Caruaru", "Caruaru · PE", "normal", "09:10", [item("BK-20-INF-AZ", 4), item("GF-SQ-750", 12), item("LV-GEL-G", 6)]),
  order("PV-10425", "Mundo Pedal", "Jaboatão · PE", "normal", "09:48", [item("CP-MTB-M-PT", 3), item("LV-GEL-G", 3), item("SN-LED-USB", 3), item("GF-SQ-750", 6)]),
].map(routeSort);

// pedidos já separados, aguardando conferência
export const seedConferencia = () => {
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

// ---------- pedidos de montagem (ordem de produção) ----------
// chegam do Sankhya como um pedido normal; só o tipo de operação muda (por isso o prefixo OP)
const OP_CLI = "Ordem de produção", OP_LOC = "Montagem";
const op = (id, prio, hora, itens) => order(id, OP_CLI, OP_LOC, prio, hora, itens);
export const seedSeparacaoMont = () => [
  op("OP-3212", "alta", "07:20", [item("QD-29-ALU-M", 10), item("AR-29-PD-36", 20), item("CU-36-QR", 10), item("PN-29-225", 20), item("CM-29-PRESTA", 20)]),
  op("OP-3213", "normal", "08:02", [item("GD-MTB-680", 12), item("MS-31-60", 12), item("FR-VB-KIT", 12), item("SL-GEL-CONF", 12)]),
  op("OP-3214", "normal", "08:45", [item("CB-TR-7V", 8), item("PE-3X-170", 8), item("CR-KMC-9V", 8), item("PD-PLAT-AL", 8)]),
  op("OP-3215", "normal", "09:30", [item("QD-29-ALU-M", 6), item("AR-29-PD-36", 12), item("CM-29-PRESTA", 12), item("GD-MTB-680", 6), item("SL-GEL-CONF", 6)]),
].map(routeSort);
export const seedConferenciaMont = () => {
  const sep = (o, faltas = {}) => {
    o.itens.forEach((i) => {
      const f = faltas[i.sku];
      Object.assign(i, f != null ? { sep: f, status: "falta", motivo: "Quantidade insuficiente" } : { sep: i.qtd, status: "ok" });
    });
    return Object.assign(o, { status: "concluido", operador: "Thiago", fim: Date.now() - 3600e3 });
  };
  return [
    sep(op("OP-3208", "alta", "06:40", [item("QD-29-ALU-M", 8), item("AR-29-PD-36", 16), item("CU-36-QR", 8), item("PN-29-225", 16)])),
    sep(op("OP-3209", "normal", "06:58", [item("FR-VB-KIT", 10), item("CB-TR-7V", 10), item("PE-3X-170", 10), item("CR-KMC-9V", 10)]), { "PE-3X-170": 9 }),
    sep(op("OP-3210", "normal", "07:05", [item("GD-MTB-680", 15), item("MS-31-60", 15), item("SL-GEL-CONF", 15), item("PD-PLAT-AL", 15)])),
  ].map(routeSort);
};

// cargas montadas com pedidos já conferidos (volumes etiquetados)
// pedidos listados na ordem de ENTREGA; o carregamento é feito na ordem inversa
export const seedEmbarque = () => {
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

// setor atual de cada pessoa nos painéis (demonstração; no sistema real vem do app de cada um)
export const EQUIPE_SETOR = { s5: "mont", s6: "mont", c4: "mont" };

// =====================================================================
// ESTOQUE (antes da venda): endereços, produtos do ERP, embalagens, endereço padrão e saldos
// =====================================================================

// dados que o ERP manda de cada produto (exemplo do documento do estoquista; integração ainda simulada)
const doErp = (p, i) => ({
  codigo: p.sku, descricao: p.desc, un: "UN",
  fornecedor: [8558, 8561, 8603, 8710][i % 4], grupo: { bike: 21, peca: 22, acess: 23 }[p.tipo], subgrupo: null,
  estoqueMin: null, estoqueMax: p.tipo === "bike" ? 40 : 100,
  controlaValidade: false, controlaLote: false, controlaSerie: false,
  pesoBruto: { bike: 14.8, peca: 0.394, acess: 0.21 }[p.tipo], pesoLiquido: null, shelflife: null,
});

// endereços de demonstração: ruas 3001 a 3004, prédios 1 a 6;
// andares 100, 200 e 300 são picking (apartamentos x01 a x06) e o andar 500 é aéreo (501 a 503).
// Docas na rua 9001. O ID é o que vai no QR da prateleira.
function enderecosDeDemonstracao() {
  const lista = [];
  let id = 607500;
  const add = (rua, predio, andar, apto, tipo) =>
    lista.push({ id: id++, rua, predio, andar, apto, codigo: `R${rua}-P${predio}-A${andar}-AP${apto}`, tipo, deposito: "Principal", ativo: true, substituidoPor: null });
  for (let rua = 3001; rua <= 3004; rua++)
    for (let predio = 1; predio <= 6; predio++) {
      for (const andar of [100, 200, 300]) for (let a = 1; a <= 6; a++) add(rua, predio, andar, andar + a, "picking");
      for (let a = 1; a <= 3; a++) add(rua, predio, 500, 500 + a, "aereo");
    }
  for (let a = 1; a <= 4; a++) add(9001, 1, 100, 100 + a, "doca");
  // dois endereços já desativados, para mostrar o filtro de INATIVOS
  lista.find((e) => e.codigo === "R3004-P6-A500-AP503").ativo = false;
  lista.find((e) => e.codigo === "R3004-P6-A300-AP306").ativo = false;
  return lista;
}

// embalagens: todo produto tem a "Unidade" com o EAN; alguns têm caixa/pacote (com ou sem código)
function embalagensDeDemonstracao() {
  let id = 1;
  const lista = CATALOGO.map((p) => ({ id: id++, produto: p.sku, codigo: p.ean, descricao: "Unidade", qtd: 1 }));
  const extra = (produto, codigo, descricao, qtd) => lista.push({ id: id++, produto, codigo, descricao, qtd });
  extra("CM-29-PRESTA", "17891000200015", "Caixa com 50", 50);
  extra("CM-26-SCHRAD", "17891000200022", "Caixa com 50", 50);
  extra("GF-SQ-750", "17891000300043", "Caixa com 24", 24);
  extra("LV-GEL-G", "", "Pacote com 12", 12); // sem código: localizado pelo código interno ou descrição
  extra("PN-29-225", "17891000200039", "Fardo com 10", 10);
  return lista;
}

// saldos iniciais: cada produto no seu picking e, os mais volumosos, também no aéreo
function estoqueInicial(enderecos) {
  const porCodigo = (c) => enderecos.find((e) => e.codigo === c);
  const associacoes = [], saldos = [];
  const aereo = { "BK-29-ALU-18": "R3001-P1-A500-AP501", "BK-26-ACO-RD": "R3001-P1-A500-AP502", "BK-20-INF-AZ": "R3001-P2-A500-AP501",
    "PN-29-225": "R3002-P4-A500-AP501", "CM-29-PRESTA": "R3002-P3-A500-AP501", "QD-29-ALU-M": "R3004-P1-A500-AP501" };
  CATALOGO.forEach((p, i) => {
    const pick = porCodigo(ENDERECOS[p.sku]);
    associacoes.push({ produto: p.sku, enderecoId: pick.id });
    saldos.push({ enderecoId: pick.id, produto: p.sku, qtd: p.tipo === "bike" ? 6 + (i % 5) : 20 + ((i * 7) % 40) });
    if (aereo[p.sku]) {
      const a = porCodigo(aereo[p.sku]);
      associacoes.push({ produto: p.sku, enderecoId: a.id });
      saldos.push({ enderecoId: a.id, produto: p.sku, qtd: p.tipo === "bike" ? 24 : 120 });
    }
  });
  // um produto guardado fora do endereço padrão (aparece na consulta, mesmo sem associação)
  saldos.push({ enderecoId: porCodigo("R3003-P5-A500-AP501").id, produto: "GF-SQ-750", qtd: 48 });
  return { associacoes, saldos };
}

export function estoqueDeDemonstracao() {
  const enderecos = enderecosDeDemonstracao();
  return {
    enderecos,
    produtos: CATALOGO.map(doErp),
    embalagens: embalagensDeDemonstracao(),
    ...estoqueInicial(enderecos),
    proximoId: { endereco: 607500 + enderecos.length, embalagem: 100 },
  };
}

// o que o "ERP" manda na próxima importação simulada: produtos novos e um que já existe (para mostrar o bloqueio)
export const importacaoDoErp = () => [
  { sku: "CM-20-SCHRAD", desc: "Câmara de Ar Aro 20 Schrader", tipo: "peca" },
  { sku: "FL-DIANT-USB", desc: "Farol Dianteiro LED USB 300 lm", tipo: "acess" },
  { sku: "BK-29-ALU-18", desc: "Bicicleta Aro 29 Alumínio 21v Preta", tipo: "bike" },
].map(doErp);
