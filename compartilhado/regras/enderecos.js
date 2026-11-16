// WMS Beach Bike — regras do cadastro de endereços.
// Formato usado nas prateleiras da Beach Bike: só números, como R3001-P7-A100-AP101
// (Rua 3001, Prédio 7, Andar 100, Apartamento 101).
// Quem cadastra digita os números exatamente como estão na prateleira; o sistema só junta as partes.

export const TIPOS_ENDERECO = { picking: "Picking", aereo: "Aéreo", doca: "Doca" };

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
  if (associacoes.some((a) => a.produto === produto && a.enderecoId === endereco.id)) return { ok: false, msg: MSG_JA_ASSOCIADO };
  return { ok: true };
}
