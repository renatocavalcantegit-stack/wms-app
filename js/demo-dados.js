// WMS Beach Bike — dados de demonstração: equipe, catálogo, endereços e pedidos de exemplo.
// No sistema real tudo isto vem do servidor (que recebe do Sankhya).
// Os produtos são os mais vendidos de verdade (js/demo-catalogo.js); os clientes ficam em js/demo-clientes.js.
import { acharProduto, routeSort } from "../compartilhado/regras/produtos.js";
import { PRODUTOS_BIKE, PRODUTOS_MOTO, PRODUTOS_NOVOS_DO_ERP } from "./demo-catalogo.js";

// ---------- equipe ----------
// separadores da expedição e da montagem, conferentes e faturista (nomes reais da operação; motoristas ainda fictícios)
export const SEPARADORES = [
  { id: "s1", nome: "Davi" }, { id: "s2", nome: "Helder" }, { id: "s3", nome: "Cilon" }, { id: "s4", nome: "Roberto" },
  { id: "s5", nome: "Vinicius" }, { id: "s6", nome: "Kaynan" }, { id: "s7", nome: "Railson" }, { id: "s8", nome: "Anderson" },
  { id: "s9", nome: "Dutra" }, { id: "s10", nome: "Elailson" }, { id: "s11", nome: "Oliveira" }, { id: "s12", nome: "Handerson" },
];
export const CONFERENTES = [
  { id: "c1", nome: "Diego" }, { id: "c2", nome: "Armando" }, { id: "c3", nome: "Wesly" },
  { id: "c4", nome: "Mike" }, { id: "c5", nome: "Darlisson" }, { id: "c6", nome: "Célio" },
];
export const FATURISTAS = [{ id: "f1", nome: "Erika Cristina" }];
export const MOTORISTAS = [
  { id: "m1", nome: "José Carlos" }, { id: "m2", nome: "Severino Lima" }, { id: "m3", nome: "Antônio Neto" },
  { id: "m4", nome: "Cícero Gomes" }, { id: "m5", nome: "Edilson Ramos" },
];
// setor atual de cada pessoa nos painéis (demonstração; no sistema real vem do app de cada um).
// Quem não está aqui trabalha na expedição; todos os conferentes ficam na expedição.
export const EQUIPE_SETOR = { s9: "mont", s10: "mont", s11: "mont", s12: "mont" };

// ---------- catálogo ----------
// tipo do produto (só muda o ícone no coletor e o peso de exemplo no cadastro), deduzido da descrição
const ACESSORIO = /^(BOMBA|CADEADO|CARAMANHOLA|SUPORTE CARAMANHOLA|FAROL|PISCA|CAPACETE|LUVA|ADESIVO|CAPA |RETROVISOR|BUZINA|CAMPAINHA|REFLETOR)/;
const tipoDoProduto = (desc) => (/^BICICLETA /.test(desc) ? "bike" : ACESSORIO.test(desc) ? "acess" : "peca");
const doCatalogo = (segmento) => ([sku, desc, un, ean, vendidos]) => ({ sku, ean, desc, un, segmento, vendidos, tipo: tipoDoProduto(desc) });

export const PRODUTOS = [...PRODUTOS_BIKE.map(doCatalogo("Bike")), ...PRODUTOS_MOTO.map(doCatalogo("Moto"))];
// peças que entram nos pedidos de montagem (ordem de produção): as de bicicleta usadas para montar uma bike
const PECA_DE_MONTAGEM = /^(ARO|PNEU|CAMARA \d|CUBO|GUIDAO|SELIM|PEDAL|CORRENTE|CAMBIO|FREIO|MANETE|MOV |GARFO|CANOTE|RODA LIVRE|EIXO|PUNHO|SUPORTE GUIDAO|COROA)/;
export const COMPONENTES = PRODUTOS.filter((p) => p.segmento === "Bike" && PECA_DE_MONTAGEM.test(p.desc));

// endereço de picking de cada produto (rua-prédio-andar-apartamento, só números).
// Os mais vendidos ficam mais perto: o 1º do ranking vai em R3001-P1-A100-AP101, o 2º no AP102…
// Cada prédio tem 18 posições de picking (andares 100, 200 e 300, aptos x01 a x06) e cada rua 6 prédios (108 posições).
// Bike nas ruas 3001 e 3002, Moto na 3003; a rua 3004 fica livre para os testes de cadastro.
function enderecoDePicking(ruaInicial, posicao) {
  const rua = ruaInicial + Math.floor(posicao / 108), naRua = posicao % 108;
  const predio = Math.floor(naRua / 18) + 1, andar = 100 * (Math.floor((naRua % 18) / 6) + 1), apto = andar + (naRua % 6) + 1;
  return `R${rua}-P${predio}-A${andar}-AP${apto}`;
}
export const ENDERECOS = Object.fromEntries([
  ...PRODUTOS_BIKE.map(([sku], i) => [sku, enderecoDePicking(3001, i)]),
  ...PRODUTOS_MOTO.map(([sku], i) => [sku, enderecoDePicking(3003, i)]),
]);
const CATALOGO = PRODUTOS;

// produto pelo código lido (EAN ou código interno) no catálogo de demonstração
export const find = (code) => acharProduto(CATALOGO, code);

const item = (sku, qtd) => ({
  ...CATALOGO.find((x) => x.sku === sku), end: ENDERECOS[sku], qtd, sep: 0, status: "pendente", motivo: "",
});

const order = (id, cliente, cidade, prio, hora, itens) => ({
  id, cliente, cidade, prio, hora, status: "pendente", itens, inicio: null, fim: null, operador: null, atual: 0,
});

// pedidos para separar
export const seedSeparacao = () => [
  order("PV-10421", "Horizonte Cedro Comercial", "Fortaleza · CE", "alta", "07:42", [item("176", 20), item("122", 30), item("536", 6), item("17057", 10)]),
  order("PV-10422", "Arco Cedro Comercial", "Maracanaú · CE", "normal", "08:05", [item("16016", 10), item("1797", 50), item("3243", 4)]),
  order("PV-10423", "Estação Cedro Comercial", "Limoeiro do Norte · CE", "alta", "08:31", [item("883", 8), item("167", 10), item("283", 6), item("4084", 4), item("2843", 2)]),
  order("PV-10424", "Diego Valente Pires", "Sobral · CE", "normal", "09:10", [item("13633", 4), item("19212", 12), item("17480", 6)]),
  order("PV-10425", "Trilha Solar Comercial", "Eusébio · CE", "normal", "09:48", [item("8745", 10), item("17726", 12), item("8545", 20), item("2825", 6)]),
].map(routeSort);

// pedidos já separados, aguardando conferência
export const seedConferencia = () => {
  const sep = (o, faltas = {}) => {
    o.itens.forEach((i) => {
      const f = faltas[i.sku];
      Object.assign(i, f != null ? { sep: f, status: "falta", motivo: "Quantidade insuficiente" } : { sep: i.qtd, status: "ok" });
    });
    return Object.assign(o, { status: "concluido", operador: "Davi", fim: Date.now() - 3600e3 });
  };
  return [
    sep(order("PV-10401", "Farol Cedro Comercial", "Fortaleza · CE", "alta", "06:55", [item("176", 10), item("16016", 4), item("17057", 2), item("19212", 3)])),
    sep(order("PV-10402", "Paineira Cedro Comercial", "Fortaleza · CE", "normal", "07:10", [item("536", 4), item("283", 2), item("3243", 2), item("2843", 1)]), { "2843": 0 }),
    sep(order("PV-10403", "Brisa Cedro Comercial", "Sobral · CE", "normal", "07:28", [item("13633", 2), item("8745", 6), item("14857", 5)])),
    sep(order("PV-10404", "Alameda Arco Comercial", "Quixadá · CE", "alta", "07:35", [item("883", 2), item("167", 6), item("4084", 3), item("19212", 6), item("17480", 4)]), { "167": 5 }),
  ].map(routeSort);
};

// ---------- pedidos de montagem (ordem de produção) ----------
// chegam do Sankhya como um pedido normal; só o tipo de operação muda (por isso o prefixo OP)
const OP_CLI = "Ordem de produção", OP_LOC = "Montagem";
const op = (id, prio, hora, itens) => order(id, OP_CLI, OP_LOC, prio, hora, itens);
export const seedSeparacaoMont = () => [
  op("OP-3212", "alta", "07:20", [item("13075", 10), item("13633", 20), item("19958", 10), item("536", 20), item("16016", 20)]),
  op("OP-3213", "normal", "08:02", [item("21844", 12), item("4084", 12), item("18726", 12), item("17057", 12)]),
  op("OP-3214", "normal", "08:45", [item("18913", 8), item("17988", 8), item("283", 8), item("3243", 8)]),
  op("OP-3215", "normal", "09:30", [item("13075", 6), item("13633", 12), item("16016", 12), item("21844", 6), item("16440", 6)]),
].map(routeSort);
export const seedConferenciaMont = () => {
  const sep = (o, faltas = {}) => {
    o.itens.forEach((i) => {
      const f = faltas[i.sku];
      Object.assign(i, f != null ? { sep: f, status: "falta", motivo: "Quantidade insuficiente" } : { sep: i.qtd, status: "ok" });
    });
    return Object.assign(o, { status: "concluido", operador: "Dutra", fim: Date.now() - 3600e3 });
  };
  return [
    sep(op("OP-3208", "alta", "06:40", [item("13075", 8), item("13633", 16), item("19958", 8), item("536", 16)])),
    sep(op("OP-3209", "normal", "06:58", [item("18726", 10), item("18913", 10), item("17988", 10), item("283", 10)]), { "17988": 9 }),
    sep(op("OP-3210", "normal", "07:05", [item("21844", 15), item("4084", 15), item("16440", 15), item("3243", 15)])),
  ].map(routeSort);
};

// cargas montadas com pedidos já conferidos (volumes etiquetados)
// pedidos listados na ordem de ENTREGA; o carregamento é feito na ordem inversa
export const seedEmbarque = () => {
  // obs: composição dos volumes informada na conferência (demonstração)
  const p = (id, cliente, cidade, volumes, tipos, atencao = "", outro = "") =>
    ({ id, cliente, cidade, volumes, lidos: [], obs: tipos ? { tipos, outro, atencao, por: "Diego", em: null } : null });
  const c = (id, rota, veiculo, placa, motorista, doca, saida, pedidos) => ({
    id, rota, veiculo, placa, motorista, doca, saida, pedidos, status: "aberta", inicio: null, fim: null, operador: null, log: [], obs: "",
  });
  return [
    c("CG-0231", "Centro / Eusébio", "VUC", "QYK-4B21", "José Carlos", "02", "10:30", [
      p("PV-10401", "Farol Cedro Comercial", "Fortaleza · CE", 2, { caixa: 1, sacola: 1 }),
      p("PV-10402", "Paineira Cedro Comercial", "Fortaleza · CE", 2, { pneuaro: 1, caixa: 1 }),
      p("PV-10421", "Horizonte Cedro Comercial", "Fortaleza · CE", 3, { caixa: 2, pneuaro: 1 }, "Vai ter acréscimo de 1 caixa de câmaras"),
      p("PV-10425", "Trilha Solar Comercial", "Eusébio · CE", 2, { caixa: 1, sacola: 1 }),
    ]),
    c("CG-0232", "Ceará Transporte", "Toco", "PCZ-7H90", "Severino Lima", "03", "11:15", [
      p("PV-10424", "Diego Valente Pires", "Sobral · CE", 4, { amarrado: 1, aro: 2, caixa: 1 }, "Amarrado com 4 aros 29"),
      p("PV-10403", "Brisa Cedro Comercial", "Sobral · CE", 2, { caixa: 2 }),
    ]),
    c("CG-0233", "F&P", "Truck", "RFA-2C33", "Antônio Neto", "01", "13:00", [
      p("PV-10404", "Alameda Arco Comercial", "Quixadá · CE", 3, { pneu: 1, caixa: 1, outro: 1 }, "", "Bomba de oficina"),
      p("PV-10423", "Estação Cedro Comercial", "Limoeiro do Norte · CE", 5, { caixa: 3, pneu: 2 }, "Pneus amarrados em par"),
    ]),
  ];
};

// =====================================================================
// ESTOQUE (antes da venda): endereços, produtos do ERP, embalagens, endereço padrão e saldos
// =====================================================================

// dados que o ERP manda de cada produto (exemplo do documento do estoquista; integração ainda simulada)
const doErp = (p, i) => ({
  codigo: p.sku, descricao: p.desc, un: p.un,
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
  extra("176", "18019227210719", "Caixa com 50", 50); // câmara 26 Pirelli
  extra("16016", "16938112670167", "Caixa com 50", 50); // câmara 29 Bison
  extra("17726", "17898926432360", "Caixa com 24", 24); // óleo Dulub
  extra("2825", "", "Caixa com 12", 12); // cola Vulcaflex — sem código: localizado pelo código interno ou descrição
  extra("536", "14717294987988", "Fardo com 10", 10); // pneu 26 Kenda
  return lista;
}

// saldos iniciais: cada produto no seu picking e, os mais volumosos, também no aéreo
function estoqueInicial(enderecos) {
  const porCodigo = (c) => enderecos.find((e) => e.codigo === c);
  const associacoes = [], saldos = [];
  // pulmão (aéreo) dos que mais saem: cabos e câmaras, pneu 26, câmara de moto e óleo
  const aereo = { "122": "R3001-P1-A500-AP501", "176": "R3001-P1-A500-AP502", "16016": "R3001-P1-A500-AP503",
    "536": "R3001-P2-A500-AP501", "8745": "R3003-P1-A500-AP501", "17726": "R3003-P1-A500-AP502" };
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
  saldos.push({ enderecoId: porCodigo("R3003-P5-A500-AP501").id, produto: "17726", qtd: 48 });
  return { associacoes, saldos };
}

// ---------- recebimento ----------
// fornecedores de exemplo (nomes fictícios)
const FORNECEDORES = {
  8558: "Pedal Sul Distribuidora", 8561: "Aro Forte Indústria", 8603: "Ciclo Peças SP", 8710: "Mundo Bike Importadora",
};
const fornecedor = (codigo) => ({ codigo, nome: FORNECEDORES[codigo] });
// dia relativo a hoje, no formato AAAA-MM-DD (-1 = ontem)
function dia(deslocamento) {
  const d = new Date();
  d.setDate(d.getDate() + deslocamento);
  return d.toLocaleDateString("sv");
}
const notaDoErp = (numero, codFornecedor, diasAtras, itens) =>
  ({ numero, fornecedor: fornecedor(codFornecedor), data: dia(-diasAtras), tipo: "Compra", finalizada: false,
    itens: itens.map(([produto, qtd]) => ({ produto, qtd })) });

// notas em todos os estados: aguardando, em aberto, conferida com e sem divergência, armazenamento parcial e completo.
// O que está "na doca esperando armazenar" também entra no saldo da doca.
function recebimentoInicial(enderecos, saldos) {
  const doca = (n) => enderecos.find((e) => e.codigo === `R9001-P1-A100-AP${100 + n}`).id;
  const notas = [], conferencias = [], volumes = [];
  let idNota = 1, idConf = 1, idVol = 1;
  const nota = (dados, finalizada) => { const n = { ...dados, id: idNota++, finalizada }; notas.push(n); return n; };
  // uma confirmação já feita no coletor (qtd conferida, quanto já foi armazenado, em quantos volumes)
  const conferiu = (n, produto, qtd, armazenado, nVolumes, docaN, diasAtras) => {
    const c = { id: idConf++, notaId: n.id, produto, qtd, docaId: doca(docaN), dia: dia(-diasAtras), armazenado, cancelado: 0, volumes: [] };
    for (let seq = 1; seq <= nVolumes; seq++) {
      const codigo = "V" + String(idVol++).padStart(6, "0");
      volumes.push({ codigo, notaId: n.id, produto, conferenciaId: c.id, seq, total: nVolumes });
      c.volumes.push(codigo);
    }
    conferencias.push(c);
    // o que ainda não foi armazenado está na doca
    if (qtd > armazenado) {
      const s = saldos.find((x) => x.enderecoId === c.docaId && x.produto === produto);
      if (s) s.qtd += qtd - armazenado; else saldos.push({ enderecoId: c.docaId, produto, qtd: qtd - armazenado });
    }
  };

  // conferida, sem divergência, tudo armazenado
  const a = nota(notaDoErp("48120", 8710, 3, [["16016", 100], ["17057", 20]]), true);
  conferiu(a, "16016", 100, 100, 2, 1, 3); conferiu(a, "17057", 20, 20, 2, 1, 3);
  // conferida com divergência (faltaram 4 aros), tudo o que chegou já armazenado
  const b = nota(notaDoErp("48190", 8561, 1, [["13633", 50], ["13075", 10]]), true);
  conferiu(b, "13633", 46, 46, 4, 2, 1); conferiu(b, "13075", 10, 10, 2, 2, 1);
  // conferida, sem divergência, armazenamento parcial (metade das câmaras ainda na doca)
  const c = nota(notaDoErp("48155", 8603, 1, [["176", 100], ["19212", 48]]), true);
  conferiu(c, "176", 100, 50, 2, 2, 1); conferiu(c, "19212", 48, 48, 2, 2, 1);
  // em aberto: parte conferida hoje, nada armazenado ainda
  const d = nota(notaDoErp("48213", 8558, 0, [["536", 40], ["167", 50], ["4084", 30]]), false);
  conferiu(d, "536", 24, 0, 2, 1, 0); conferiu(d, "4084", 30, 0, 1, 1, 0);
  // aguardando conferência
  nota(notaDoErp("48177", 8603, 0, [["17480", 24], ["14857", 36], ["2843", 6]]), false);
  nota(notaDoErp("48201", 8558, 0, [["536", 20], ["176", 100], ["283", 15]]), false);

  return { notas, conferencias, volumes, proximos: { nota: idNota, conferencia: idConf, volume: idVol } };
}

export function estoqueDeDemonstracao() {
  const enderecos = enderecosDeDemonstracao();
  const inicial = estoqueInicial(enderecos);
  const rec = recebimentoInicial(enderecos, inicial.saldos);
  return {
    enderecos,
    produtos: CATALOGO.map(doErp),
    embalagens: embalagensDeDemonstracao(),
    ...inicial,
    notas: rec.notas, conferencias: rec.conferencias, volumes: rec.volumes,
    movimentos: [],
    proximoId: { endereco: 607500 + enderecos.length, embalagem: 100, ...rec.proximos },
  };
}

// o que o "ERP" manda na próxima busca de notas: duas novas e uma que já existe (para mostrar o bloqueio)
export const importacaoDeNotas = () => [
  notaDoErp("48230", 8561, 0, [["13633", 60], ["19958", 20]]),
  notaDoErp("48231", 8710, 0, [["8745", 48], ["17726", 48], ["8545", 30]]),
  notaDoErp("48177", 8603, 0, [["17480", 24], ["14857", 36], ["2843", 6]]),
];

// o que o "ERP" manda na próxima importação simulada: produtos novos e um que já existe (para mostrar o bloqueio)
export const importacaoDoErp = () => [
  ...PRODUTOS_NOVOS_DO_ERP.map(doCatalogo("Novo")),
  CATALOGO[0],
].map(doErp);
