// WMS Beach Bike — dados de demonstração: equipe, catálogo, endereços e pedidos de exemplo.
// No sistema real tudo isto vem do servidor (que recebe do Sankhya).
// Os produtos são os mais vendidos de verdade (js/demo-catalogo.js); os clientes ficam em js/demo-clientes.js.
// Endereços, saldos e endereço padrão são os REAIS do WMS do Sankhya (js/demo-estoque-real.js): dá para testar
// o bipe nas prateleiras que já têm etiqueta.
import { acharProduto, routeSort } from "../compartilhado/regras/produtos.js";
import { escolherOrigens, necessidade } from "../compartilhado/regras/movimentacao.js";
import { enderecoInventariavel, previstosDoEndereco } from "../compartilhado/regras/inventario.js";
import { posicoesDoLote, sugerirDivisao, ruasDaParte } from "../compartilhado/regras/separacao.js";
import { PRODUTOS_BIKE, PRODUTOS_MOTO, PRODUTOS_NOVOS_DO_ERP } from "./demo-catalogo.js";
import { ENDERECOS_REAIS, PRODUTOS_REAIS, SALDOS_REAIS } from "./demo-estoque-real.js";

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
export const tipoDoProduto = (desc) => (/^BICICLETA /.test(desc) ? "bike" : ACESSORIO.test(desc) ? "acess" : "peca");
// códigos de barras de cada produto vêm da planilha real (o 1º é o principal); o do catálogo fica só se o produto não estiver nela
const CODIGOS_REAIS = new Map(PRODUTOS_REAIS.map(([codigo, , , cods]) => [codigo, cods || []]));
const doCatalogo = (segmento) => ([sku, desc, un, ean, vendidos]) => {
  const eans = CODIGOS_REAIS.get(sku) || (ean ? [ean] : []);
  return { sku, ean: eans[0] || "", eans, desc, un, segmento, vendidos, tipo: tipoDoProduto(desc) };
};

// ---------- estoque real ----------
const codigoReal = ([, rua, predio, andar, apto]) => `R${rua}-P${predio}-A${andar}-AP${apto}`;
const ENDERECO_REAL = new Map(ENDERECOS_REAIS.map((e) => [e[0], e]));
// produtos que a "importação do ERP" simulada traz como novos: ficam fora do estoque inicial
const NOVOS = new Set(PRODUTOS_NOVOS_DO_ERP.map(([sku]) => sku));
const SALDOS_INICIAIS = SALDOS_REAIS.filter(([, produto]) => !NOVOS.has(produto));

// endereço onde o separador pega cada produto: o endereço padrão (picking) com mais saldo;
// produto sem endereço padrão sai do endereço onde tem mais saldo
const SEPARAR_EM = new Map();
[...SALDOS_INICIAIS].sort((a, b) => a[3] - b[3] || a[2] - b[2]).forEach(([id, produto]) => SEPARAR_EM.set(produto, codigoReal(ENDERECO_REAL.get(id))));

// só entram no catálogo dos pedidos os mais vendidos que existem no estoque real
export const PRODUTOS = [...PRODUTOS_BIKE.map(doCatalogo("Bike")), ...PRODUTOS_MOTO.map(doCatalogo("Moto"))].filter((p) => SEPARAR_EM.has(p.sku));
// peças que entram nos pedidos de montagem (ordem de produção): as de bicicleta usadas para montar uma bike
const PECA_DE_MONTAGEM = /^(ARO|PNEU|CAMARA \d|CUBO|GUIDAO|SELIM|PEDAL|CORRENTE|CAMBIO|FREIO|MANETE|MOV |GARFO|CANOTE|RODA LIVRE|EIXO|PUNHO|SUPORTE GUIDAO|COROA)/;
export const COMPONENTES = PRODUTOS.filter((p) => p.segmento === "Bike" && PECA_DE_MONTAGEM.test(p.desc));

// endereço de separação de cada produto do catálogo (código da prateleira, ex.: R602-P2-A6-AP601)
export const ENDERECOS = Object.fromEntries(PRODUTOS.map((p) => [p.sku, SEPARAR_EM.get(p.sku)]));
const CATALOGO = PRODUTOS;
const CATALOGO_SKUS = new Set(CATALOGO.map((p) => p.sku));

// produto pelo código lido (EAN, outro código de barras ou código interno): primeiro os do catálogo, depois
// qualquer produto do estoque real (assim a Conferência reconhece um produto bipado que não é do pedido)
const OUTROS_REAIS = PRODUTOS_REAIS.filter(([codigo]) => !CATALOGO.some((p) => p.sku === codigo))
  .map(([sku, desc, grupo, eans]) => ({ sku, ean: eans[0] || "", eans, desc, un: "UN", segmento: grupo, tipo: tipoDoProduto(desc) }));
export const find = (code) => acharProduto(CATALOGO, code) || acharProduto(OUTROS_REAIS, code);

const item = (sku, qtd) => ({
  ...CATALOGO.find((x) => x.sku === sku), end: ENDERECOS[sku], qtd, sep: 0, status: "pendente", motivo: "",
});

const order = (id, cliente, cidade, prio, hora, itens) => ({
  id, cliente, cidade, prio, hora, status: "pendente", itens, inicio: null, fim: null, operador: null, atual: 0,
  doca: null, lote: null, pos: null, parte: null,
});

// docas de expedição (rua 9002) — mesmos IDs do cadastro de endereços do Estoque
export const docaDeExpedicao = (n) => ({ id: 608007 + n, codigo: `R9002-P1-A100-AP${100 + n}` });

// pedido grande da demonstração, já dividido pelo coordenador em 2 partes (blocos de ruas seguidas)
function pedidoDividido() {
  const grande = routeSort(order("PV-10426", "Rota Norte Distribuidora", "Caucaia · CE", "normal", "09:55",
    [item("176", 40), item("122", 24), item("536", 12), item("17057", 20), item("16016", 30), item("1797", 60), item("13633", 10), item("19212", 18),
      item("8745", 24), item("17726", 24), item("8545", 30), item("2825", 12)]));
  const grupos = sugerirDivisao(grande.itens, 2);
  return grupos.map((idxs, k) => ({
    ...grande, id: `${grande.id}/${k + 1}`, itens: idxs.map((i) => ({ ...grande.itens[i] })),
    parte: { pai: grande.id, n: k + 1, de: grupos.length, ruas: ruasDaParte(grande.itens, idxs), por: "coordenador" },
  }));
}

// pedidos para separar: avulsos, dois num lote montado pelo coordenador (PV-10424 e PV-10425) e um pedido dividido
export const seedSeparacao = () => {
  const lista = [
    order("PV-10421", "Horizonte Cedro Comercial", "Fortaleza · CE", "alta", "07:42", [item("176", 20), item("122", 30), item("536", 6), item("17057", 10)]),
    order("PV-10422", "Arco Cedro Comercial", "Maracanaú · CE", "normal", "08:05", [item("16016", 10), item("1797", 50), item("3243", 4)]),
    order("PV-10423", "Estação Cedro Comercial", "Limoeiro do Norte · CE", "alta", "08:31", [item("883", 8), item("167", 10), item("283", 6), item("4084", 4), item("2843", 2)]),
    order("PV-10424", "Diego Valente Pires", "Sobral · CE", "normal", "09:10", [item("13633", 4), item("19212", 12), item("17480", 6)]),
    order("PV-10425", "Trilha Solar Comercial", "Eusébio · CE", "normal", "09:48", [item("8745", 10), item("17726", 12), item("8545", 20), item("2825", 6), item("19212", 6)]),
    order("PV-10427", "Praia Mansa Bikes", "Fortaleza · CE", "normal", "10:05", [item("176", 6), item("536", 2), item("3243", 2)]),
    order("PV-10428", "Vento Leste Comercial", "Fortaleza · CE", "normal", "10:12", [item("122", 10), item("176", 4), item("17057", 4)]),
  ].map(routeSort);
  const [l] = seedLotes();
  lista.filter((o) => l.pedidos.includes(o.id)).forEach((o) => Object.assign(o, { lote: l.id, pos: l.posicoes[o.id] }));
  return [...lista, ...pedidoDividido()];
};
// lote montado pelo coordenador (2 pedidos de Sobral/Eusébio com um produto em comum: o 19212 vira uma parada só)
export const seedLotes = () => {
  const ped = [{ id: "PV-10424", prio: "normal", hora: "09:10" }, { id: "PV-10425", prio: "normal", hora: "09:48" }];
  const posicoes = posicoesDoLote(ped);
  return [{ id: "L-1", pedidos: ped.map((p) => p.id).sort((a, b) => posicoes[a].localeCompare(posicoes[b])), posicoes,
    status: "pendente", criadoPor: { tipo: "coordenador", login: "coordenador", nome: "Coordenador" }, criado: Date.now() - 20 * 60e3,
    inicio: null, fim: null, operador: null, atual: 0 }];
};

// pedidos já separados, aguardando conferência
export const seedConferencia = () => {
  const sep = (o, faltas = {}) => {
    o.itens.forEach((i) => {
      const f = faltas[i.sku];
      Object.assign(i, f != null ? { sep: f, status: "falta", motivo: "Quantidade insuficiente" } : { sep: i.qtd, status: "ok" });
    });
    return Object.assign(o, { status: "concluido", operador: "Davi", fim: Date.now() - 3600e3, doca: docaDeExpedicao(1 + (n++ % 2)) });
  };
  let n = 0;
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
// todo produto que chega do ERP nasce com conferência por CHECKOUT (o gestor desliga depois, se for granel)
const doErp = (p, i) => ({
  codigo: p.sku, descricao: p.desc, un: p.un, checkout: true,
  fornecedor: [8558, 8561, 8603, 8710][i % 4], grupo: { bike: 21, peca: 22, acess: 23 }[p.tipo], subgrupo: null,
  estoqueMin: null, estoqueMax: p.tipo === "bike" ? 40 : 100,
  controlaValidade: false, controlaLote: false, controlaSerie: false,
  pesoBruto: { bike: 14.8, peca: 0.394, acess: 0.21 }[p.tipo], pesoLiquido: null, shelflife: null,
});

// endereços REAIS (mesmo ID do QR das etiquetas). Quem é endereço padrão de algum produto é picking; o resto, aéreo (pulmão).
// Além deles, só na demonstração: docas de recebimento (rua 9001), de expedição (9002) e o prédio 6 da rua 3004,
// vazio, para os testes de cadastro e desativação. O ID é o que vai no QR da prateleira.
function enderecosDeDemonstracao() {
  const picking = new Set(SALDOS_INICIAIS.filter((s) => s[3]).map((s) => s[0]));
  const lista = ENDERECOS_REAIS.map((e) => ({ id: e[0], rua: e[1], predio: e[2], andar: e[3], apto: e[4], codigo: codigoReal(e),
    tipo: picking.has(e[0]) ? "picking" : "aereo", deposito: "Principal", ativo: true, substituidoPor: null }));
  let id = 608004; // depois do maior ID real (as docas mantêm os IDs que já estavam impressos)
  const add = (rua, predio, andar, apto, tipo) =>
    lista.push({ id: id++, rua, predio, andar, apto, codigo: `R${rua}-P${predio}-A${andar}-AP${apto}`, tipo, deposito: "Principal", ativo: true, substituidoPor: null });
  for (let a = 1; a <= 4; a++) add(9001, 1, 100, 100 + a, "doca");
  // docas de expedição na rua 9002: o separador deixa o pedido aqui e o conferente busca
  for (let a = 1; a <= 6; a++) add(9002, 1, 100, 100 + a, "expedicao");
  for (const andar of [100, 200, 300]) for (let a = 1; a <= 6; a++) add(3004, 6, andar, andar + a, "picking");
  for (let a = 1; a <= 3; a++) add(3004, 6, 500, 500 + a, "aereo");
  // dois endereços já desativados, para mostrar o filtro de INATIVOS
  lista.find((e) => e.codigo === "R3004-P6-A500-AP503").ativo = false;
  lista.find((e) => e.codigo === "R3004-P6-A300-AP306").ativo = false;
  // doca de devolução (rua 9003), no fim da lista para não mudar o ID dos endereços acima
  add(9003, 1, 100, 101, "devolucao");
  return lista;
}

// embalagens: cada código de barras do produto é uma "Unidade" (produto com dois códigos tem duas);
// produto sem código de barras não tem embalagem (é achado pelo código interno). Alguns têm caixa/pacote.
function embalagensDeDemonstracao(produtos) {
  let id = 1;
  const lista = [];
  const unidades = (codigo, cods) => cods.forEach((c) => lista.push({ id: id++, produto: codigo, codigo: c, descricao: "Unidade", qtd: 1 }));
  CATALOGO.forEach((p) => unidades(p.sku, p.eans));
  produtos.filter((p) => !CATALOGO_SKUS.has(p.codigo)).forEach((p) => unidades(p.codigo, CODIGOS_REAIS.get(p.codigo) || []));
  const extra = (produto, codigo, descricao, qtd) => lista.push({ id: id++, produto, codigo, descricao, qtd });
  extra("176", "18019227210719", "Caixa com 50", 50); // câmara 26 Pirelli
  extra("16016", "16938112670167", "Caixa com 50", 50); // câmara 29 Bison
  extra("17726", "17898926432360", "Caixa com 24", 24); // óleo Dulub
  extra("2825", "", "Caixa com 12", 12); // cola Vulcaflex — sem código: localizado pelo código interno ou descrição
  extra("536", "14717294987988", "Fardo com 10", 10); // pneu 26 Kenda
  return lista;
}

// saldos iniciais: os reais da planilha; o endereço padrão (End.Padrão) vira a associação produto → picking
function estoqueInicial() {
  const associacoes = SALDOS_INICIAIS.filter((s) => s[3]).map(([enderecoId, produto]) => ({ produto, enderecoId }));
  const saldos = SALDOS_INICIAIS.map(([enderecoId, produto, qtd]) => ({ enderecoId, produto, qtd }));
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

// ---------- movimentação ----------
// mínimo e máximo de cada produto no seu picking (bicicleta ocupa mais espaço) e tarefas de abastecimento
// em todos os estados: urgente, normal, em andamento (com duas origens) e o histórico (concluída, parcial, cancelada).
function movimentacaoInicial(enderecos, associacoes, saldos) {
  const porCodigo = (c) => enderecos.find((e) => e.codigo === c);
  const tipoDe = (sku) => CATALOGO.find((p) => p.sku === sku).tipo;
  // mínimo/máximo só dos pickings dos produtos do catálogo (os que entram nos pedidos de demonstração)
  const doCatalogo = new Set(CATALOGO.map((p) => p.sku)), tipoPorId = new Map(enderecos.map((e) => [e.id, e.tipo]));
  const limites = associacoes
    .filter((a) => doCatalogo.has(a.produto) && tipoPorId.get(a.enderecoId) === "picking")
    .map((a) => ({ produto: a.produto, enderecoId: a.enderecoId, ...(tipoDe(a.produto) === "bike" ? { minimo: 3, maximo: 12 } : { minimo: 10, maximo: 60 }) }));
  const pickingDe = (sku) => porCodigo(ENDERECOS[sku]).id;
  const saldo = (enderecoId, produto) => saldos.find((x) => x.enderecoId === enderecoId && x.produto === produto);
  const definir = (enderecoId, produto, qtd) => { const x = saldo(enderecoId, produto); if (x) x.qtd = qtd; else saldos.push({ enderecoId, produto, qtd }); };

  // produtos das tarefas: os mais vendidos cujo picking tem mínimo/máximo e que têm saldo no aéreo (pulmão) de verdade
  const temAereo = (sku) => saldos.some((x) => x.produto === sku && x.qtd > 0 && tipoPorId.get(x.enderecoId) === "aereo");
  const [A, B, C, D, E, F] = CATALOGO.map((p) => p.sku)
    .filter((sku) => limites.some((l) => l.produto === sku && l.enderecoId === pickingDe(sku)) && temAereo(sku));

  // pickings que a separação já esvaziou (no mínimo ou abaixo)
  definir(pickingDe(A), A, 4);
  definir(pickingDe(B), B, 6);
  definir(pickingDe(C), C, 8);
  definir(pickingDe(D), D, 2);

  const tarefas = [];
  let id = 1;
  const criada = (minutosAtras) => new Date(Date.now() - minutosAtras * 60000).toISOString();
  const tarefa = (produto, prioridade, quem, minutosAtras, extra = {}) => {
    const pickingId = pickingDe(produto);
    const picking = enderecos.find((e) => e.id === pickingId);
    const lim = limites.find((l) => l.produto === produto && l.enderecoId === pickingId);
    const falta = necessidade(saldo(pickingId, produto)?.qtd || 0, lim.maximo);
    const aereos = saldos.filter((x) => x.produto === produto).map((x) => ({ endereco: enderecos.find((e) => e.id === x.enderecoId), saldo: x.qtd }))
      .filter((a) => a.endereco.tipo === "aereo");
    const t = { id: id++, produto, pickingId, prioridade, status: "aberta", quem, usuario: quem === "sistema" ? "" : "estoquista",
      criada: criada(minutosAtras), necessidade: falta, origens: escolherOrigens(aereos, falta, picking).map((o) => ({ ...o, feito: 0 })), ...extra };
    tarefas.push(t);
    return t;
  };
  // histórico (já encerradas)
  // (o histórico guarda a necessidade da época: o picking estava no mínimo)
  definir(pickingDe(E), E, 2); definir(pickingDe(F), F, 2);
  tarefa(E, "normal", "sistema", 300, { status: "concluida", fim: criada(280) }).origens.forEach((o) => (o.feito = o.qtd));
  const parcial = tarefa(F, "normal", "gestor", 240, { status: "parcial", fim: criada(220) });
  parcial.origens[0].feito = Math.floor(parcial.origens[0].qtd / 2);
  // depois das tarefas encerradas, o picking deles voltou ao normal
  definir(pickingDe(E), E, 40); definir(pickingDe(F), F, 40);
  tarefa(C, "normal", "coletor", 200, { status: "cancelada", fim: criada(190) });
  // abertas: o coletor mostra as urgentes primeiro
  tarefa(B, "normal", "sistema", 50);
  tarefa(A, "urgente", "sistema", 35);
  tarefa(D, "normal", "coletor", 20);
  // em andamento: já retirou 20 do aéreo e guardou no picking
  const andamento = tarefa(C, "normal", "sistema", 10, { status: "andamento" });
  andamento.origens[0].feito = 20;
  saldo(andamento.origens[0].enderecoId, C).qtd -= 20;
  saldo(andamento.pickingId, C).qtd += 20;
  return { limites, tarefas, proximaTarefa: id };
}

// ---------- inventário ----------
// 1) rotativo já sincronizado (histórico, só consulta);
// 2) completo da rua 3003 em andamento: endereços concluídos (com e sem divergência, um aprovado), um em recontagem,
//    um com quantidades incluídas e não finalizadas, um produto achado fora da previsão e o resto pendente;
// 3) rotativo de pickings da rua 3001, recém-criado (nada contado).
function inventarioInicial(enderecos, associacoes, saldos) {
  const qtd = (enderecoId, produto) => saldos.find((x) => x.enderecoId === enderecoId && x.produto === produto)?.qtd || 0;
  const quando = (minutosAtras) => new Date(Date.now() - minutosAtras * 60000).toISOString();
  const item = (enderecoId, produto, previsto = true) => ({ enderecoId, produto, previsto, contagens: [], decisao: null, decididoPor: null, decididoEm: null, ajuste: null });
  // registra as contagens C1, C2… (operadores fictícios, alternando)
  const contar = (it, qtds, minutosAtras) => qtds.forEach((q, k) =>
    it.contagens.push({ n: k + 1, qtd: q, operador: k % 2 ? "estoquista2" : "estoquista", quando: quando(minutosAtras - k * 25) }));
  const base = (id, tipo, descricao, minutosAtras) => ({ id, tipo, descricao, status: "aberto", ruas: [], enderecos: [], itens: [],
    rascunhos: {}, contados: {}, criado: quando(minutosAtras), criadoPor: "gestorestoque",
    finalizado: null, finalizadoPor: null, sincronizado: null, sincronizadoPor: null, sincErro: null, novosPadrao: [] });
  const ordenar = (lista) => lista.sort((a, b) => a.codigo.localeCompare(b.codigo));

  // 1) histórico: rotativo de 4 pickings da rua 3002, sincronizado ontem
  const h = base(1, "rotativo", "Rotativo semanal · rua 3002", 60 * 30);
  const pk3002 = ordenar(enderecos.filter((e) => enderecoInventariavel(e) && e.rua === 3002 && e.tipo === "picking"))
    .filter((e) => previstosDoEndereco(e.id, saldos, associacoes).length).slice(0, 4);
  pk3002.forEach((e, k) => {
    const p = previstosDoEndereco(e.id, saldos, associacoes)[0], s = qtd(e.id, p);
    const it = item(e.id, p); h.itens.push(it);
    it.saldoSinc = k === 1 ? s + 2 : s; // saldo do sistema quando sincronizou
    // contagens: a 1ª bate, a 2ª faltou 2 (aprovado), a 3ª sobrou 3 com C3 (rejeitado), a 4ª bate
    // o sistema tinha 2 a mais; o ajuste aprovado deixou o saldo igual ao contado
    if (k === 1) { contar(it, [s, s], 60 * 28); Object.assign(it, { decisao: "aprovado", decididoPor: "gestorestoque", decididoEm: quando(60 * 26),
      ajuste: { antes: s + 2, delta: -2, depois: s, quando: quando(60 * 25) } }); }
    else if (k === 2) { contar(it, [s + 1, s + 3, s + 3], 60 * 28); Object.assign(it, { decisao: "rejeitado", decididoPor: "gestorestoque", decididoEm: quando(60 * 26) }); }
    else contar(it, [s, s], 60 * 28);
  });
  h.enderecos = pk3002.map((e) => e.id); pk3002.forEach((e) => (h.contados[e.id] = true));
  Object.assign(h, { status: "sincronizado", finalizado: quando(60 * 25.5), finalizadoPor: "gestorestoque", sincronizado: quando(60 * 25), sincronizadoPor: "gestorestoque" });

  // 2) completo da rua 3003, em andamento
  const c = base(2, "completo", "Inventário geral · rua 3003", 180);
  c.ruas = [3003];
  const ends = ordenar(enderecos.filter((e) => enderecoInventariavel(e) && e.rua === 3003));
  c.enderecos = ends.map((e) => e.id);
  ends.forEach((e) => previstosDoEndereco(e.id, saldos, associacoes).forEach((p) => c.itens.push(item(e.id, p))));
  const comItens = ends.filter((e) => c.itens.some((i) => i.enderecoId === e.id));
  const itensDe = (e) => c.itens.filter((i) => i.enderecoId === e.id);
  comItens.forEach((e, k) => {
    if (k > 6) return;
    itensDe(e).forEach((it) => {
      const s = qtd(e.id, it.produto);
      if (k === 0) contar(it, [s, s], 150);                                   // bate
      if (k === 1) contar(it, [s - 1, s - 1], 140);                           // faltou 1: aguardando aprovação
      if (k === 2) { contar(it, [s + 4, s + 2, s + 2], 130); Object.assign(it, { decisao: "aprovado", decididoPor: "gestorestoque", decididoEm: quando(40) }); }
      if (k === 3) contar(it, [s, s - 3], 90);                                // C1 ≠ C2: aguarda a C3
      if (k === 4) contar(it, [0, 0], 80);                                    // previsto e não encontrado: zero
      if (k === 5) contar(it, [s, s], 70);
    });
    if (k <= 5) c.contados[e.id] = true;
  });
  // produto encontrado fora da previsão (no 1º endereço contado): entra na contagem e vai para aprovação
  const fora = item(comItens[0].id, "2825", false); contar(fora, [6, 6], 150); c.itens.push(fora);
  // endereços vazios do prédio 1 já contados (nada previsto, nada achado)
  ends.filter((e) => e.predio === 1 && !itensDe(e).length).slice(0, 8).forEach((e) => (c.contados[e.id] = true));
  // quantidades incluídas e ainda não finalizadas (o operador saiu no meio)
  const meio = comItens[6];
  c.rascunhos[meio.id] = itensDe(meio).slice(0, 1).map((it) => ({ produto: it.produto, qtd: qtd(meio.id, it.produto), operador: "estoquista", quando: quando(12) }));

  // 3) rotativo recém-criado: 6 pickings da rua 3001
  const r = base(3, "rotativo", "Rotativo · cabos e câmaras da rua 3001", 25);
  ordenar(enderecos.filter((e) => enderecoInventariavel(e) && e.rua === 3001 && e.tipo === "picking"))
    .filter((e) => previstosDoEndereco(e.id, saldos, associacoes).length).slice(0, 6)
    .forEach((e) => { r.itens.push(item(e.id, previstosDoEndereco(e.id, saldos, associacoes)[0])); r.enderecos.push(e.id); });

  return { inventarios: [h, c, r], proximoInventario: 4 };
}

// produtos: os do catálogo com os dados de exemplo do ERP; os demais do estoque real só com código, descrição e grupo.
// Todos nascem com conferência por checkout; na demonstração, quem não tem código de barras já vem como granel.
function produtosDeDemonstracao() {
  const grupo = new Map(PRODUTOS_REAIS.map(([codigo, , g]) => [codigo, g]));
  const doCat = CATALOGO.map((p, i) => ({ ...doErp(p, i), grupo: grupo.get(p.sku) || null, checkout: !!p.ean }));
  const jaTem = new Set(doCat.map((p) => p.codigo));
  const outros = PRODUTOS_REAIS.filter(([codigo]) => !jaTem.has(codigo) && !NOVOS.has(codigo))
    .map(([codigo, descricao, g, cods]) => ({ codigo, descricao, un: "UN", grupo: g, checkout: cods.length > 0 }));
  return [...doCat, ...outros];
}

export function estoqueDeDemonstracao() {
  const enderecos = enderecosDeDemonstracao(), produtos = produtosDeDemonstracao();
  const inicial = estoqueInicial();
  const rec = recebimentoInicial(enderecos, inicial.saldos);
  const mov = movimentacaoInicial(enderecos, inicial.associacoes, inicial.saldos);
  const inv = inventarioInicial(enderecos, inicial.associacoes, inicial.saldos);
  return {
    enderecos,
    // demonstração: os produtos sem código de barras já vêm como granel (checkout desligado) para testar
    produtos,
    embalagens: embalagensDeDemonstracao(produtos),
    ...inicial,
    notas: rec.notas, conferencias: rec.conferencias, volumes: rec.volumes,
    limites: mov.limites, tarefas: mov.tarefas,
    inventarios: inv.inventarios,
    movimentos: [],
    // separação que confirmou mais do que o sistema tinha no endereço (o gestor de estoque investiga)
    divergencias: [],
    proximoId: { endereco: Math.max(...enderecos.map((e) => e.id)) + 1, embalagem: 100, ...rec.proximos, tarefa: mov.proximaTarefa, inventario: inv.proximoInventario, divergencia: 1 },
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
