// Código de barras da etiqueta de produto: EAN-13 quando o código é um EAN válido; senão, Code 128.
import { test } from "node:test";
import assert from "node:assert/strict";
import { digitoEan13, eanValido, formatoDoCodigo, barrasEan13, simbolosCode128, barrasCode128 } from "../compartilhado/regras/codigo-barras.js";

test("EAN-13: dígito verificador e validação", () => {
  assert.equal(digitoEan13("789100010001"), 1);
  assert.equal(eanValido("7891000100011"), true);
  assert.equal(eanValido("7891000100012"), false); // verificador errado
  assert.equal(eanValido("BK-29-ALU-18"), false);
});

test("formato escolhido sozinho: EAN-13 para EAN válido, Code 128 para o resto", () => {
  assert.equal(formatoDoCodigo("7891000100011"), "EAN13");
  assert.equal(formatoDoCodigo("BK-29-ALU-18"), "CODE128");
  assert.equal(formatoDoCodigo("7891000100012"), "CODE128");
});

test("EAN-13: 95 módulos, com as guardas de início, meio e fim", () => {
  const b = barrasEan13("4006381333931"); // exemplo clássico da especificação
  assert.equal(b.length, 95);
  assert.equal(b.slice(0, 3), "101");
  assert.equal(b.slice(45, 50), "01010");
  assert.equal(b.slice(-3), "101");
  // 2º dígito "0" com a tabela L (o 1º dígito 4 manda usar L G L L G G): 0001101
  assert.equal(b.slice(3, 10), "0001101");
});

test("Code 128: início B, verificador módulo 103 e parada", () => {
  // "PJJ123C": 104 + P(48)×1 + J(42)×2 + J(42)×3 + 1(17)×4 + 2(18)×5 + 3(19)×6 + C(35)×7 = 879; 879 mod 103 = 55
  const s = simbolosCode128("PJJ123C");
  assert.equal(s[0], 104);
  assert.equal(s.at(-2), 55);
  assert.equal(s.at(-1), 106);
  // cada símbolo tem 11 módulos; a parada tem 13
  assert.equal(barrasCode128("PJJ123C").length, 11 * (7 + 2) + 13);
  assert.throws(() => simbolosCode128("Câmara"), /não suportado/);
});
