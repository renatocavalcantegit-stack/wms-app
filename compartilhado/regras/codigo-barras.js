// WMS Beach Bike — código de barras da etiqueta de produto (90 × 20 mm).
// O formato é escolhido sozinho, sem opção na tela:
//   - EAN-13, quando o código tem 13 dígitos com o dígito verificador certo (o código do fornecedor);
//   - Code 128, para qualquer outro texto (ex.: o código interno "BK-29-ALU-18").
// As funções devolvem as barras como texto de "1" (barra preta) e "0" (espaço), um caractere por módulo;
// quem desenha (js/etiqueta-produto.js) só transforma isso em SVG.

// dígito verificador do EAN-13: pesos 1 e 3 alternados nos 12 primeiros dígitos
export function digitoEan13(doze) {
  const soma = [...doze].reduce((t, d, i) => t + Number(d) * (i % 2 ? 3 : 1), 0);
  return (10 - (soma % 10)) % 10;
}

export const eanValido = (codigo) => /^\d{13}$/.test(codigo) && digitoEan13(codigo.slice(0, 12)) === Number(codigo[12]);

export const formatoDoCodigo = (codigo) => (eanValido(String(codigo)) ? "EAN13" : "CODE128");

// ---------- EAN-13 ----------
const L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
const R = L.map((p) => [...p].map((b) => (b === "1" ? "0" : "1")).join(""));
const G = R.map((p) => [...p].reverse().join(""));
// o 1º dígito não vira barra: ele define se cada dígito da esquerda usa a tabela L ou G
const PARIDADE = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];

export function barrasEan13(codigo) {
  const d = [...codigo].map(Number);
  const par = PARIDADE[d[0]];
  let s = "101";
  for (let i = 1; i <= 6; i++) s += (par[i - 1] === "L" ? L : G)[d[i]];
  s += "01010";
  for (let i = 7; i <= 12; i++) s += R[d[i]];
  return s + "101";
}

// ---------- Code 128 (conjunto B: letras, números e símbolos comuns) ----------
// larguras de barra/espaço de cada símbolo (0 a 106), na ordem oficial da tabela
const C128 = ["212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213", "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132", "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211", "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313", "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331", "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111", "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214", "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111", "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141", "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141", "114131", "311141", "411131", "211412", "211214", "211232", "2331112"];
const INICIO_B = 104, PARADA = 106;

// valores dos símbolos (início, dados, verificador, parada); o verificador é a soma ponderada módulo 103
export function simbolosCode128(texto) {
  const dados = [...String(texto)].map((c) => {
    const v = c.charCodeAt(0) - 32;
    if (v < 0 || v > 94) throw new Error(`Caractere não suportado no código de barras: "${c}"`);
    return v;
  });
  const verificador = dados.reduce((t, v, i) => t + v * (i + 1), INICIO_B) % 103;
  return [INICIO_B, ...dados, verificador, PARADA];
}

export function barrasCode128(texto) {
  return simbolosCode128(texto).map((v) =>
    [...C128[v]].map((w, i) => (i % 2 ? "0" : "1").repeat(Number(w))).join("")).join("");
}

// barras do código no formato certo
export const barrasDoCodigo = (codigo) => (formatoDoCodigo(codigo) === "EAN13" ? barrasEan13(codigo) : barrasCode128(codigo));
