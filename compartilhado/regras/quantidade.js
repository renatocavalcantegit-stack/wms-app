// WMS Beach Bike — QUANTIDADE QUEBRADA (ex.: 101,5 UN de raios, 20,935 PR).
// O WMS aceita até 3 casas depois da vírgula, igual ao banco (numeric(14,3)).
// Funções puras, usadas por todas as regras que mexem com quantidade (testadas em testes/quantidade.test.js).
//
// Por que arredondar? O computador guarda 0,1 de um jeito aproximado: 0.1 + 0.2 dá 0.30000000000000004.
// Arredondando para 3 casas depois de cada conta, a soma volta a ser 0,3 e as comparações (=, <) funcionam.

export const CASAS_DA_QUANTIDADE = 3;
const FATOR = 10 ** CASAS_DA_QUANTIDADE;

// 0.30000000000000004 → 0.3
export const arredondarQtd = (n) => Math.round(Number(n) * FATOR) / FATOR;

// soma uma lista de quantidades (ou um campo de cada item): somarQtd([1.1, 2.2]) · somarQtd(itens, (i) => i.qtd)
export const somarQtd = (lista, campo = (x) => x) => arredondarQtd(lista.reduce((t, x) => t + Number(campo(x) || 0), 0));

// lê o que o usuário digitou: "101,5" ou "101.5" → 101.5 · número passa direto.
// Vazio, texto ou mais de um separador ("1.234,5") → NaN, e a validação recusa.
export function lerQuantidade(valor) {
  if (typeof valor === "number") return valor;
  const texto = String(valor ?? "").trim().replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(texto) && !/^-?\.\d+$/.test(texto)) return NaN;
  return Number(texto);
}

// número de verdade, com no máximo 3 casas depois da vírgula
export const temCasasDemais = (n) => Math.abs(arredondarQtd(n) - n) > 1e-9;
export const quantidadeValida = (n, minimo = 0) => Number.isFinite(n) && n >= minimo && !temCasasDemais(n);

// para mostrar na tela: 101.5 → "101,5" · 12 → "12" · 20.935 → "20,935" (sem ponto de milhar, para não confundir)
export const formatarQtd = (n) =>
  Number(n).toLocaleString("pt-BR", { maximumFractionDigits: CASAS_DA_QUANTIDADE, useGrouping: false });

// quantidade que tem que ser maior que zero (separar, conferir, armazenar, transferir…)
export const MSG_QUANTIDADE = `Informe a quantidade (maior que zero, até ${CASAS_DA_QUANTIDADE} casas depois da vírgula).`;
export const quantidadePositiva = (n) => quantidadeValida(n) && n > 0;
