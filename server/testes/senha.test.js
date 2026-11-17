// PIN guardado com hash (não precisa de banco).
import { test } from "node:test";
import assert from "node:assert/strict";
import { gerarHash, conferirPin } from "../src/senha.js";

test("o hash não contém o PIN e confere com o PIN certo", () => {
  const guardado = gerarHash("4821");
  assert.ok(!guardado.includes("4821"));
  assert.equal(conferirPin("4821", guardado), true);
  assert.equal(conferirPin("4822", guardado), false);
});

test("o mesmo PIN gera hashes diferentes (sal aleatório)", () => {
  assert.notEqual(gerarHash("4821"), gerarHash("4821"));
});

test("hash guardado estragado não deixa entrar", () => {
  assert.equal(conferirPin("4821", "lixo"), false);
  assert.equal(conferirPin("4821", ""), false);
});
