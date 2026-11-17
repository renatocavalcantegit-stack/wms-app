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
export function validarDoca(endereco) {
  if (!endereco) return MSG_ENDERECO_NAO_ENCONTRADO;
  if (!endereco.ativo) return MSG_ENDERECO_INATIVO;
  if (endereco.tipo !== "doca") return MSG_NAO_E_DOCA;
  return null;
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
