// WMS Beach Bike — regras do cadastro de endereços.
// Formato usado nas prateleiras da Beach Bike: só números, como R3001-P7-A100-AP101
// (Rua 3001, Prédio 7, 1º andar, apartamento 1 desse andar).
// Andar e apartamento seguem a numeração de prédio: o andar 1 vira A100 e o apartamento 1 dele vira AP101;
// no andar 2, A200 e AP201… Na tela, quem cadastra digita só "andar 1, apto 1" e o sistema monta o código.

export const TIPOS_ENDERECO = { picking: "Picking", aereo: "Aéreo", doca: "Doca" };

// limite de endereços criados de uma vez (evita travar a tela com um intervalo digitado errado)
export const MAXIMO_POR_LOTE = 5000;

export const MSG_ENDERECO_COM_ESTOQUE = "ENDEREÇO POSSUI ESTOQUE. REALIZE A RETIRADA TOTAL ANTES DE DESATIVAR.";
export const MSG_ENDERECO_COM_TAREFA = "ENDEREÇO POSSUI TAREFAS PENDENTES. CONCLUA OU CANCELE ANTES DE DESATIVAR.";
export const MSG_ENDERECO_EM_USO = "JÁ EXISTE UM ENDEREÇO ATIVO COM ESTE CÓDIGO.";

// o apartamento usa os 2 últimos dígitos (AP101 a AP199 no andar 1), então cada andar tem no máximo 99
export const MAXIMO_APTOS_POR_ANDAR = 99;

// do que foi digitado (andar 1, apto 3) para o que vai na prateleira (andar 100, apto 103)
export const naPrateleira = ({ rua, predio, andar, apto }) =>
  ({ rua: +rua, predio: +predio, andar: andar * 100, apto: andar * 100 + +apto });

// o caminho inverso, para mostrar um endereço já cadastrado num formulário (andar 100, apto 103 → andar 1, apto 3)
export const comoDigitado = (e) => ({ rua: e.rua, predio: e.predio, andar: Math.floor(e.andar / 100), apto: e.apto - e.andar });

// confere rua, prédio, andar e apartamento digitados (um endereço só, como na reativação)
export function validarDigitado({ rua, predio, andar, apto }) {
  for (const [nome, v] of [["Rua", rua], ["Prédio", predio], ["Andar", andar], ["Apartamento", apto]]) {
    const n = Number(v);
    if (v === "" || !Number.isInteger(n) || n < 1) return `${nome}: informe um número inteiro a partir de 1.`;
  }
  if (+apto > MAXIMO_APTOS_POR_ANDAR) return `Apartamento: de 1 a ${MAXIMO_APTOS_POR_ANDAR} em cada andar.`;
  return null;
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

// valida um intervalo "inicial / final" de um campo (números inteiros positivos, inicial ≤ final)
function intervalo(nome, ini, fim) {
  const a = Number(ini), b = Number(fim);
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 1 || b < 1) return `${nome}: informe números inteiros a partir de 1.`;
  if (a > b) return `${nome}: o inicial não pode ser maior que o final.`;
  return null;
}

// quantos endereços um lote vai gerar (para mostrar antes de criar)
export function contarLote(f) {
  const n = (ini, fim) => Math.max(0, Number(fim) - Number(ini) + 1);
  return n(f.ruaIni, f.ruaFim) * n(f.predioIni, f.predioFim) * n(f.andarIni, f.andarFim) * n(f.aptoIni, f.aptoFim);
}

// gera todos os endereços dentro dos intervalos (rua × prédio × andar × apartamento).
// Andar e apartamento chegam como digitados (1, 2, 3…) e saem no formato da prateleira (A100, AP101…).
// Ex.: rua 1–3, prédio 1–2, andar 1–2, apto 1–3 → 3 × 2 × 2 × 3 = 36 endereços (o documento citava 72; a conta é 36).
// Devolve { erro } ou { enderecos: [{ rua, predio, andar, apto, codigo, tipo }] } — sem ID; quem grava dá o ID.
export function gerarLote(f) {
  const erro = intervalo("Rua", f.ruaIni, f.ruaFim) || intervalo("Prédio", f.predioIni, f.predioFim)
    || intervalo("Andar", f.andarIni, f.andarFim) || intervalo("Apartamento", f.aptoIni, f.aptoFim);
  if (erro) return { erro };
  if (+f.aptoFim > MAXIMO_APTOS_POR_ANDAR) return { erro: `Apartamento: de 1 a ${MAXIMO_APTOS_POR_ANDAR} em cada andar.` };
  if (!TIPOS_ENDERECO[f.tipo]) return { erro: "Escolha o tipo do endereço." };
  const total = contarLote(f);
  if (total > MAXIMO_POR_LOTE) return { erro: `O lote geraria ${total} endereços. O máximo de uma vez é ${MAXIMO_POR_LOTE}.` };

  const enderecos = [];
  for (let rua = +f.ruaIni; rua <= +f.ruaFim; rua++)
    for (let predio = +f.predioIni; predio <= +f.predioFim; predio++)
      for (let andar = +f.andarIni; andar <= +f.andarFim; andar++)
        for (let apto = +f.aptoIni; apto <= +f.aptoFim; apto++) {
          const partes = naPrateleira({ rua, predio, andar, apto });
          enderecos.push({ ...partes, codigo: codigoDoEndereco(partes), tipo: f.tipo });
        }
  return { enderecos };
}

// só desativa endereço vazio e sem tarefa pendente (abastecimento, armazenamento…); nunca se exclui um endereço
export function podeDesativar({ saldo, tarefasPendentes = 0 }) {
  if (saldo > 0) return { ok: false, msg: MSG_ENDERECO_COM_ESTOQUE };
  if (tarefasPendentes > 0) return { ok: false, msg: MSG_ENDERECO_COM_TAREFA };
  return { ok: true };
}

// reativar com novos dados não pode bater com outro endereço que já está ativo
export function conflitoAoReativar(enderecos, partes, idAtual) {
  const codigo = codigoDoEndereco(partes);
  return enderecos.some((e) => e.ativo && e.codigo === codigo && e.id !== idAtual);
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
  if (associacoes.some((a) => a.produto === produto && a.enderecoId === endereco.id)) return { ok: false, msg: MSG_JA_ASSOCIADO };
  return { ok: true };
}
