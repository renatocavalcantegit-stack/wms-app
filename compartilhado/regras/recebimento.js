// WMS Beach Bike — regras do Recebimento (conferência das notas, volumes e armazenamento).
// As notas vêm do ERP. Cada confirmação do coletor é uma "conferência": soma ao que já foi conferido,
// põe o saldo na doca e gera os volumes. O armazenamento leva o saldo da doca para um endereço.
// Os três status da nota (conferência, divergência e armazenamento) são independentes.
import { MSG_ENDERECO_INATIVO, MSG_ENDERECO_NAO_ENCONTRADO } from "./enderecos.js";
import { lerQuantidade, quantidadePositiva, arredondarQtd, somarQtd, formatarQtd, MSG_QUANTIDADE } from "./quantidade.js";

export const MSG_NOTA_FINALIZADA = "NOTA FINALIZADA. NÃO RECEBE NOVAS CONFERÊNCIAS.";
export const MSG_PRODUTO_FORA_DA_NOTA = "PRODUTO NÃO PERTENCE A ESTA NOTA.";
export const MSG_NAO_E_DOCA = "ENDEREÇO NÃO É UMA DOCA. LEIA O QR DA DOCA.";
export const MSG_SALDO_ORIGEM = "QUANTIDADE INFORMADA MAIOR QUE O SALDO DISPONÍVEL NO ENDEREÇO DE ORIGEM.";
export const MSG_ACIMA_DO_PENDENTE = "QUANTIDADE MAIOR QUE O PENDENTE DE ARMAZENAR.";
export const MSG_DESTINO_IGUAL = "O DESTINO NÃO PODE SER A PRÓPRIA DOCA DE ORIGEM.";
export const MSG_NOTA_JA_IMPORTADA = "NOTA JÁ IMPORTADA.";
// a conferência não deixa passar do que está na nota (o excedente é bloqueado)
export const msgAcimaDaNota = (pendente) => `QUANTIDADE ACIMA DO PENDENTE DA NOTA. PENDENTE: ${formatarQtd(pendente)}.`;

// limite de volumes numa confirmação (evita imprimir centenas de etiquetas por engano)
export const MAXIMO_VOLUMES = 99;

export const STATUS_CONFERENCIA = { aguardando: "Aguardando", aberta: "Em aberto", conferida: "Conferida" };
export const STATUS_DIVERGENCIA = { sem: "Sem divergência", com: "Com divergência" };
export const STATUS_ARMAZENAMENTO = { pendente: "Pendente", parcial: "Parcial", armazenado: "Armazenado" };

const soma = (lista, campo) => somarQtd(lista, (x) => x[campo]);

// as conferências de um produto de uma nota
const conferenciasDoItem = (conferencias, notaId, produto) =>
  conferencias.filter((c) => c.notaId === notaId && c.produto === produto);

// o que ainda está na doca esperando ser armazenado, de uma conferência
export const pendenteDaConferencia = (c) => arredondarQtd(c.qtd - c.armazenado - c.cancelado);

// ---------- detalhe da nota ----------
// os números de cada produto da nota: o que a nota pede, o que foi conferido, a diferença,
// o que já foi armazenado, o que falta armazenar e quantos volumes foram gerados
export function resumoDoItem(nota, item, conferencias) {
  const lista = conferenciasDoItem(conferencias, nota.id, item.produto);
  const conferido = soma(lista, "qtd");
  const armazenado = soma(lista, "armazenado");
  return {
    produto: item.produto, qtdNota: item.qtd, conferido,
    divergencia: arredondarQtd(conferido - item.qtd),
    armazenado,
    pendenteArmazenar: arredondarQtd(conferido - armazenado - soma(lista, "cancelado")),
    volumes: lista.reduce((t, c) => t + c.volumes.length, 0),
  };
}
export const resumoDaNota = (nota, conferencias) => nota.itens.map((item) => resumoDoItem(nota, item, conferencias));

// os três status do cabeçalho da nota
export function statusDaNota(nota, conferencias) {
  const itens = resumoDaNota(nota, conferencias);
  const conferido = soma(itens, "conferido");
  const pendente = soma(itens, "pendenteArmazenar");
  const armazenado = soma(itens, "armazenado");
  return {
    conferencia: nota.finalizada ? "conferida" : conferido > 0 ? "aberta" : "aguardando",
    // só depois de finalizar se sabe se faltou algo (antes disso, toda nota em aberto pareceria divergente)
    divergencia: !nota.finalizada ? null : itens.some((i) => i.conferido < i.qtdNota) ? "com" : "sem",
    armazenamento: conferido === 0 || (armazenado === 0 && pendente > 0) ? "pendente" : pendente > 0 ? "parcial" : "armazenado",
  };
}

// ---------- conferência (coletor) ----------
// a conferência é vinculada a uma doca: o endereço lido tem que existir, estar ativo e ser do tipo doca
// (devolução de pedido, v75: também pode ir para a doca de devolução)
export function validarDoca(endereco, nota = null) {
  if (!endereco) return MSG_ENDERECO_NAO_ENCONTRADO;
  if (!endereco.ativo) return MSG_ENDERECO_INATIVO;
  if (endereco.tipo === "devolucao" && ehDevolucao(nota)) return null;
  if (endereco.tipo !== "doca") return MSG_NAO_E_DOCA;
  return null;
}

// ---------- devolução de pedido (v75) ----------
// Corte ou cancelamento com mercadoria já separada: quem estava com a caixa entrega ao estoque e nasce uma
// ENTRADA PENDENTE, que o estoquista confere e armazena como uma nota. O "número" é o do pedido.
export const TIPO_DEVOLUCAO = "Devolução";
export const ehDevolucao = (nota) => nota?.tipo === TIPO_DEVOLUCAO;
// como a nota aparece nas telas: "NF 48230" ou "DEV PV-10421"
export const rotuloDaNota = (nota) => `${ehDevolucao(nota) ? "DEV" : "NF"} ${nota.numero}`;
// número da entrada: o do pedido; a segunda devolução do mesmo pedido ganha "-2", e assim por diante
export function numeroDaDevolucao(notas, pedido) {
  const ja = notas.filter((n) => ehDevolucao(n) && (n.numero === pedido || n.numero.startsWith(`${pedido}-`))).length;
  return ja ? `${pedido}-${ja + 1}` : pedido;
}

// armazenamento: sai de uma doca de recebimento OU da doca de devolução (o fluxo do estoquista é o mesmo)
export const MSG_NAO_E_DOCA_ARMAZENAR = "ENDEREÇO NÃO É DOCA DE RECEBIMENTO NEM DE DEVOLUÇÃO. LEIA O QR DA DOCA.";
export function validarDocaDeArmazenamento(endereco) {
  if (!endereco) return MSG_ENDERECO_NAO_ENCONTRADO;
  if (!endereco.ativo) return MSG_ENDERECO_INATIVO;
  if (endereco.tipo !== "doca" && endereco.tipo !== "devolucao") return MSG_NAO_E_DOCA_ARMAZENAR;
  return null;
}

// bipar a caixa conta a quantidade dela: 2 caixas de 12 = 24 unidades
export const quantidadeEmUnidades = (embalagem, quantasEmbalagens) => arredondarQtd((embalagem ? embalagem.qtd : 1) * lerQuantidade(quantasEmbalagens));

// quanto ainda falta conferir de um produto da nota
export function pendenteDeConferir(nota, produto, conferencias) {
  const item = nota.itens.find((i) => i.produto === produto);
  return item ? arredondarQtd(item.qtd - soma(conferenciasDoItem(conferencias, nota.id, produto), "qtd")) : 0;
}

// confere uma confirmação antes de gravar. Não trava o produto para outro coletor:
// cada confirmação soma, e o que passar do pendente é bloqueado (funciona mesmo sem rede).
export function validarConferencia(nota, { produto, qtd, volumes }, conferencias) {
  if (nota.finalizada) return MSG_NOTA_FINALIZADA;
  if (!nota.itens.some((i) => i.produto === produto)) return MSG_PRODUTO_FORA_DA_NOTA;
  const quantidade = lerQuantidade(qtd); // "101,5" → 101.5
  if (!quantidadePositiva(quantidade)) return MSG_QUANTIDADE;
  const pendente = pendenteDeConferir(nota, produto, conferencias);
  if (quantidade > pendente) return msgAcimaDaNota(pendente);
  const n = Number(volumes);
  if (!Number.isInteger(n) || n < 1) return "Informe em quantos volumes (1 ou mais).";
  if (n > MAXIMO_VOLUMES) return `No máximo ${MAXIMO_VOLUMES} volumes por confirmação.`;
  return null;
}

// código do volume impresso na etiqueta (único no WMS inteiro): 1 → V000001
export const codigoDoVolume = (n) => "V" + String(n).padStart(6, "0");

// ---------- código do volume com servidor (v78, decisão de 25/11/2026: "código do aparelho + sequência") ----------
// Com vários coletores conferindo sem rede, a sequência do servidor não serve (dois aparelhos gerariam o mesmo número).
// Cada aparelho gera o seu: os 6 primeiros caracteres do código do aparelho + a sequência dele. Ex.: V3FA2C-0001.
// Único sem precisar de rede; o servidor ainda recusa um código repetido (MSG_VOLUME_REPETIDO), por garantia.
export const codigoDoVolumeDoAparelho = (aparelho, n) =>
  `V${String(aparelho).replace(/[^0-9a-z]/gi, "").slice(0, 6).toUpperCase()}-${String(n).padStart(4, "0")}`;
export const msgVolumeRepetido = (codigo) => `CÓDIGO DE VOLUME ${codigo} JÁ EXISTE. A CONFIRMAÇÃO NÃO ENTROU: DESCARTE AS ETIQUETAS.`;
export const MSG_VOLUMES_INVALIDOS = "CÓDIGOS DOS VOLUMES INVÁLIDOS.";
// os códigos que o coletor mandou: texto curto, sem repetir dentro da mesma confirmação
export function validarCodigosDosVolumes(codigos) {
  if (!Array.isArray(codigos) || !codigos.length) return MSG_VOLUMES_INVALIDOS;
  if (codigos.some((c) => typeof c !== "string" || !/^[A-Z0-9-]{1,40}$/.test(c))) return MSG_VOLUMES_INVALIDOS;
  const repetido = codigos.find((c, i) => codigos.indexOf(c) !== i);
  return repetido ? msgVolumeRepetido(repetido) : null;
}

// ---------- armazenamento (coletor) ----------
// produtos pendentes de armazenar, por data da conferência e agrupados por produto
// (mesmo vindos de notas diferentes): [{ dia, produtos: [{ produto, pendente }] }], datas mais antigas primeiro
export function pendentesPorData(conferencias) {
  const porDia = new Map();
  for (const c of conferencias) {
    const p = pendenteDaConferencia(c);
    if (p <= 0) continue;
    const dia = porDia.get(c.dia) || new Map();
    dia.set(c.produto, arredondarQtd((dia.get(c.produto) || 0) + p));
    porDia.set(c.dia, dia);
  }
  return [...porDia.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([dia, produtos]) => ({ dia, produtos: [...produtos.entries()].map(([produto, pendente]) => ({ produto, pendente })) }));
}

// quanto do produto espera armazenamento numa doca (somando todas as datas e notas)
export const pendenteNaDoca = (conferencias, produto, docaId) =>
  conferencias.filter((c) => c.produto === produto && c.docaId === docaId).reduce((t, c) => arredondarQtd(t + pendenteDaConferencia(c)), 0);

// confere o armazenamento antes de gravar; devolve o motivo do bloqueio ou null
export function validarArmazenamento({ qtd, saldoOrigem, pendente, origemId, destino }) {
  const quantidade = lerQuantidade(qtd); // "101,5" → 101.5
  if (!quantidadePositiva(quantidade)) return MSG_QUANTIDADE;
  if (quantidade > saldoOrigem) return MSG_SALDO_ORIGEM;
  if (quantidade > pendente) return MSG_ACIMA_DO_PENDENTE;
  if (!destino) return MSG_ENDERECO_NAO_ENCONTRADO;
  if (!destino.ativo) return MSG_ENDERECO_INATIVO;
  if (destino.id === origemId) return MSG_DESTINO_IGUAL;
  return null;
}

// reparte a quantidade armazenada entre as conferências pendentes, das mais antigas para as mais novas.
// Devolve [{ id, qtd }] — quanto abater de cada conferência.
export function distribuirArmazenamento(conferencias, qtd) {
  const partes = [];
  let resta = lerQuantidade(qtd);
  const ordem = [...conferencias].sort((a, b) => a.dia.localeCompare(b.dia) || a.id - b.id);
  for (const c of ordem) {
    if (resta <= 0) break;
    const parte = Math.min(resta, pendenteDaConferencia(c));
    if (parte > 0) { partes.push({ id: c.id, qtd: parte }); resta = arredondarQtd(resta - parte); }
  }
  return partes;
}

// ---------- notas vindas do ERP ----------
// nota que já existe (mesmo número e fornecedor) é bloqueada, sem duplicar
export function separarNotasImportadas(existentes, recebidas) {
  const chave = (n) => `${n.numero}|${n.fornecedor.codigo}`;
  const ja = new Set(existentes.map(chave));
  const importadas = [], bloqueadas = [];
  for (const n of recebidas) {
    if (ja.has(chave(n))) bloqueadas.push({ nota: n, msg: MSG_NOTA_JA_IMPORTADA });
    else { importadas.push(n); ja.add(chave(n)); }
  }
  return { importadas, bloqueadas };
}

// ---------- produto novo que chega pela nota (v77, decisão de 25/11/2026) ----------
// O produto novo nasce da nota do ERP: quando a nota traz um produto que o WMS não tem, a importação cadastra o
// produto junto, com os dados que vêm do ERP em cada item (item.cadastro: descrição, unidade, embalagens com o
// código de barras...). O produto que já existe NÃO muda (atualizar cadastro é da sincronização de produtos).
//   - nasce com checkout ligado (conferência bipando unidade por unidade); o gestor desliga depois, se quiser;
//   - código de barras que já pertence a outro produto: a nota entra, o produto é cadastrado SEM aquele código e
//     fica um aviso na nota, para corrigir no Sankhya (o recebimento não para);
//   - produto novo sem os dados (descrição ou unidade): a nota é bloqueada (não dá para cadastrar).
export const msgProdutoSemDados = (codigo) => `PRODUTO ${codigo} NÃO ESTÁ CADASTRADO E A NOTA NÃO TROUXE OS DADOS DELE.`;
export const avisoCodigoRepetido = (codigo, produto, dono) =>
  `Código de barras ${codigo} do produto novo ${produto} já pertence ao produto ${dono}: o produto foi cadastrado sem esse código. Corrija no Sankhya.`;
export const avisoEmbalagemInvalida = (produto, descricao) =>
  `Embalagem "${descricao || "sem descrição"}" do produto novo ${produto} veio sem descrição ou quantidade inteira: ficou de fora. Corrija no Sankhya.`;

const textoLimpo = (v) => String(v ?? "").trim();

// notas = as que vão entrar (já sem as repetidas), na ordem · existe(codigo) → o WMS já tem o produto?
// donoDoCodigo(codigoDeBarras) → código do produto que já usa esse código de barras, ou null.
// Devolve uma entrada por nota: { nota, produtos, avisos, bloqueio }
//   produtos = os cadastros a criar: { codigo, descricao, un, checkout: true, ..., embalagens: [{ codigo, descricao, qtd }] }
//   bloqueio = motivo para a nota não entrar (null = entra). Nota bloqueada não cadastra nada.
export function cadastrosDasNotas(notas, { existe, donoDoCodigo }) {
  const criados = new Map(); // produto → já cadastrado por uma nota anterior desta mesma busca
  const codigosNovos = new Map(); // código de barras → produto novo desta busca que ficou com ele
  return notas.map((nota) => {
    const produtos = [], avisos = [], meus = new Map();
    for (const item of nota.itens) {
      if (existe(item.produto) || criados.has(item.produto) || produtos.some((p) => p.codigo === item.produto)) continue;
      const c = item.cadastro || {};
      if (!textoLimpo(c.descricao) || !textoLimpo(c.un)) return { nota, produtos: [], avisos: [], bloqueio: msgProdutoSemDados(item.produto) };
      const embalagens = [];
      for (const e of c.embalagens || []) {
        const descricao = textoLimpo(e.descricao), qtd = Number(e.qtd), codigo = textoLimpo(e.codigo) || null;
        if (!descricao || !Number.isInteger(qtd) || qtd < 1) { avisos.push(avisoEmbalagemInvalida(item.produto, descricao)); continue; }
        const dono = codigo && (donoDoCodigo(codigo) || codigosNovos.get(codigo) || meus.get(codigo));
        if (dono) { avisos.push(avisoCodigoRepetido(codigo, item.produto, dono)); embalagens.push({ codigo: null, descricao, qtd }); continue; }
        if (codigo) meus.set(codigo, item.produto);
        embalagens.push({ codigo, descricao, qtd });
      }
      produtos.push({
        codigo: item.produto, descricao: textoLimpo(c.descricao), un: textoLimpo(c.un).toUpperCase(), checkout: true,
        fornecedor: c.fornecedor ?? nota.fornecedor?.codigo ?? null, grupo: c.grupo ?? null, subgrupo: c.subgrupo ?? null,
        estoqueMin: c.estoqueMin ?? null, estoqueMax: c.estoqueMax ?? null,
        controlaValidade: !!c.controlaValidade, controlaLote: !!c.controlaLote, controlaSerie: !!c.controlaSerie,
        pesoBruto: c.pesoBruto ?? null, pesoLiquido: c.pesoLiquido ?? null, shelflife: c.shelflife ?? null,
        embalagens,
      });
    }
    // a nota entra: o que ela cadastrou passa a valer para as próximas notas desta busca
    for (const p of produtos) criados.set(p.codigo, nota.numero);
    for (const [codigo, produto] of meus) codigosNovos.set(codigo, produto);
    return { nota, produtos, avisos, bloqueio: null };
  });
}

// a nota como fica guardada: os itens só com produto e quantidade (o cadastro do ERP já foi usado)
export const notaSemCadastro = (nota) => ({ ...nota, itens: nota.itens.map(({ produto, qtd }) => ({ produto, qtd })) });
