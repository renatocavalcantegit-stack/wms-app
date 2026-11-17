// WMS Beach Bike — regras do cadastro de endereços.
// Formato usado nas prateleiras da Beach Bike: só números, como R3001-P7-A100-AP101
// (Rua 3001, Prédio 7, Andar 100, Apartamento 101).
// Quem cadastra digita os números exatamente como estão na prateleira; o sistema só junta as partes.

// doca = doca de RECEBIMENTO (entrada de notas); expedicao = doca de EXPEDIÇÃO (o separador deixa o pedido para o conferente);
// devolucao = doca de DEVOLUÇÃO (o que saiu de um pedido cortado ou cancelado espera o estoquista armazenar)
export const TIPOS_ENDERECO = { picking: "Picking", aereo: "Aéreo", doca: "Doca recebimento", expedicao: "Doca expedição", devolucao: "Doca devolução" };

export const MSG_ENDERECO_COM_ESTOQUE = "ENDEREÇO POSSUI ESTOQUE. REALIZE A RETIRADA TOTAL ANTES DE DESATIVAR.";
export const MSG_ENDERECO_COM_TAREFA = "ENDEREÇO POSSUI TAREFAS PENDENTES. CONCLUA OU CANCELE ANTES DE DESATIVAR.";
export const MSG_ENDERECO_EM_USO = "JÁ EXISTE UM ENDEREÇO ATIVO COM ESTE CÓDIGO.";

// confere rua, prédio, andar e apartamento digitados (cadastro de um endereço e reativação): números inteiros a partir de 1
export function validarPartes({ rua, predio, andar, apto }) {
  for (const [nome, v] of [["Rua", rua], ["Prédio", predio], ["Andar", andar], ["Apartamento", apto]]) {
    const n = Number(v);
    if (v === "" || v == null || !Number.isInteger(n) || n < 1) return `${nome}: informe um número inteiro a partir de 1.`;
  }
  return null;
}

// as partes como números (o formulário entrega texto: "3001" → 3001)
export const partesDoEndereco = ({ rua, predio, andar, apto }) => ({ rua: +rua, predio: +predio, andar: +andar, apto: +apto });

// ---------- criação em lote ----------
// Também com os números da placa. Ex.: rua 3001 a 3001, prédio 1 a 6, andar 100 a 300 de 100 em 100,
// apto 101 a 106 (os do 1º andar). Nos outros andares o apartamento repete a posição: 201–206, 301–306.

// limite de endereços criados de uma vez (evita travar a tela com um intervalo digitado errado)
export const MAXIMO_POR_LOTE = 5000;

// valida um intervalo "inicial / final" (números inteiros a partir de 1, inicial ≤ final)
function intervalo(nome, ini, fim) {
  const a = Number(ini), b = Number(fim);
  if (ini === "" || fim === "" || !Number.isInteger(a) || !Number.isInteger(b) || a < 1 || b < 1)
    return `${nome}: informe números inteiros a partir de 1.`;
  if (a > b) return `${nome}: o inicial não pode ser maior que o final.`;
  return null;
}

// confere o formulário do lote; devolve o motivo do erro ou null
export function validarLote(f) {
  const erro = intervalo("Rua", f.ruaIni, f.ruaFim) || intervalo("Prédio", f.predioIni, f.predioFim)
    || intervalo("Andar", f.andarIni, f.andarFim) || intervalo("Apartamento", f.aptoIni, f.aptoFim);
  if (erro) return erro;
  const passo = Number(f.andarPasso);
  if (!Number.isInteger(passo) || passo < 1) return "Andar: informe de quanto em quanto sobe (ex.: 100).";
  if ((f.andarFim - f.andarIni) % passo !== 0)
    return `Andar: de ${f.andarIni} subindo de ${passo} em ${passo} não chega em ${f.andarFim}.`;
  // com mais de um andar, o apto do 1º andar começa pelo número do andar (andar 100 → apto 101), senão não dá para repetir
  if (+f.andarFim > +f.andarIni && +f.aptoIni < +f.andarIni)
    return `Apartamento: informe os do andar ${f.andarIni} como estão na placa (ex.: ${+f.andarIni + 1} a ${+f.andarIni + 6}).`;
  if (!TIPOS_ENDERECO[f.tipo]) return "Escolha o tipo do endereço.";
  const total = contarLote(f);
  if (total > MAXIMO_POR_LOTE) return `O lote geraria ${total} endereços. O máximo de uma vez é ${MAXIMO_POR_LOTE}.`;
  return null;
}

// os andares do lote: 100, 200, 300 (do inicial ao final, de "passo" em "passo")
export function andaresDoLote(f) {
  const lista = [];
  for (let andar = +f.andarIni; andar <= +f.andarFim; andar += +f.andarPasso) lista.push(andar);
  return lista;
}

// os apartamentos de um andar: a mesma posição dos do 1º andar (101–106 no andar 100 → 201–206 no andar 200)
export function aptosDoAndar(f, andar) {
  const lista = [];
  for (let apto = +f.aptoIni; apto <= +f.aptoFim; apto++) lista.push(apto - +f.andarIni + andar);
  return lista;
}

// quantos endereços o lote vai gerar (para mostrar antes de criar)
export function contarLote(f) {
  const n = (ini, fim) => Math.max(0, Number(fim) - Number(ini) + 1);
  const andares = Math.max(0, Math.floor((f.andarFim - f.andarIni) / f.andarPasso) + 1);
  return n(f.ruaIni, f.ruaFim) * n(f.predioIni, f.predioFim) * andares * n(f.aptoIni, f.aptoFim);
}

// gera todos os endereços do lote (rua × prédio × andar × apartamento), na ordem de caminhada.
// Devolve { erro } ou { enderecos: [{ rua, predio, andar, apto, codigo, tipo }] } — sem ID; quem grava dá o ID.
export function gerarLote(f) {
  const erro = validarLote(f);
  if (erro) return { erro };
  const enderecos = [];
  for (let rua = +f.ruaIni; rua <= +f.ruaFim; rua++)
    for (let predio = +f.predioIni; predio <= +f.predioFim; predio++)
      for (const andar of andaresDoLote(f))
        for (const apto of aptosDoAndar(f, andar)) {
          const partes = { rua, predio, andar, apto };
          enderecos.push({ ...partes, codigo: codigoDoEndereco(partes), tipo: f.tipo });
        }
  return { enderecos };
}

// monta o código impresso na prateleira a partir das partes
export const codigoDoEndereco = ({ rua, predio, andar, apto }) => `R${rua}-P${predio}-A${andar}-AP${apto}`;

// lê um código como "R3001-P7-A100-AP101" (aceita minúsculas e espaços nas pontas); devolve as partes ou null
export function lerCodigoDoEndereco(texto) {
  const m = String(texto).trim().toUpperCase().match(/^R(\d+)-P(\d+)-A(\d+)-AP(\d+)$/);
  if (!m) return null;
  const [rua, predio, andar, apto] = m.slice(1).map(Number);
  return { rua, predio, andar, apto };
}

// acha o endereço pelo que foi lido: o QR traz o ID (só números); digitando, vale o código da prateleira.
// Um ID antigo (endereço desativado e reconfigurado) é encontrado, mas continua inativo — quem chama bloqueia.
export function acharEndereco(enderecos, lido) {
  const t = String(lido).trim().toUpperCase();
  if (/^\d+$/.test(t)) return enderecos.find((e) => String(e.id) === t) || null;
  // pelo código, o endereço ativo tem preferência (o inativo com o mesmo código fica só no histórico)
  const comCodigo = enderecos.filter((e) => e.codigo === t);
  return comCodigo.find((e) => e.ativo) || comCodigo[0] || null;
}

// só desativa endereço vazio e sem tarefa pendente (abastecimento, armazenamento…); nunca se exclui um endereço
export function podeDesativar({ saldo, tarefasPendentes = 0 }) {
  if (saldo > 0) return { ok: false, msg: MSG_ENDERECO_COM_ESTOQUE };
  if (tarefasPendentes > 0) return { ok: false, msg: MSG_ENDERECO_COM_TAREFA };
  return { ok: true };
}

// endereço novo (ou reativado) não pode ter o mesmo código de outro endereço que já está ativo.
// `idIgnorar`: na reativação, o próprio endereço antigo não conta.
export function codigoEmUso(enderecos, partes, idIgnorar = null) {
  const codigo = codigoDoEndereco(partes);
  return enderecos.some((e) => e.ativo && e.codigo === codigo && e.id !== idIgnorar);
}

// ordem de caminhada no galpão: rua, prédio, andar, apartamento (como números: P9 vem antes de P10)
export function compararEnderecos(a, b) {
  const x = lerCodigoDoEndereco(a), y = lerCodigoDoEndereco(b);
  if (!x || !y) return String(a).localeCompare(String(b), "pt-BR", { numeric: true });
  return x.rua - y.rua || x.predio - y.predio || x.andar - y.andar || x.apto - y.apto;
}

// ---------- endereço padrão do produto (ENDEREÇAR PRODUTO) ----------
// A associação só diz "este produto mora aqui"; não movimenta estoque.
// Um produto pode ter vários endereços padrão (Picking, Aéreo ou os dois) e um endereço pode ter vários produtos.
export const MSG_JA_ASSOCIADO = "PRODUTO JÁ ASSOCIADO A ESTE ENDEREÇO.";
export const MSG_REMOVER_ASSOCIACAO = "DESEJA REALMENTE REMOVER ESTA ASSOCIAÇÃO?";
export const MSG_ENDERECO_INATIVO = "ENDEREÇO INATIVO. NÃO RECEBE MOVIMENTAÇÕES.";
export const MSG_ENDERECO_NAO_ENCONTRADO = "ENDEREÇO NÃO ENCONTRADO.";

export function podeAssociar(associacoes, produto, endereco) {
  if (!endereco) return { ok: false, msg: MSG_ENDERECO_NAO_ENCONTRADO };
  if (!endereco.ativo) return { ok: false, msg: MSG_ENDERECO_INATIVO };
  if (endereco.tipo === "expedicao") return { ok: false, msg: "DOCA DE EXPEDIÇÃO NÃO É ENDEREÇO PADRÃO DE PRODUTO." };
  if (endereco.tipo === "devolucao") return { ok: false, msg: "DOCA DE DEVOLUÇÃO NÃO É ENDEREÇO PADRÃO DE PRODUTO." };
  if (associacoes.some((a) => a.produto === produto && a.enderecoId === endereco.id)) return { ok: false, msg: MSG_JA_ASSOCIADO };
  return { ok: true };
}
