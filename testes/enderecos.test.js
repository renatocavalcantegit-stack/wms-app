// Cadastro de endereços: formato numérico da prateleira, criação em lote, desativação e endereço padrão.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  codigoDoEndereco, lerCodigoDoEndereco, acharEndereco, gerarLote, contarLote, podeDesativar,
  naPrateleira, comoDigitado, validarDigitado,
  conflitoAoReativar, compararEnderecos, podeAssociar, MAXIMO_POR_LOTE,
  MSG_ENDERECO_COM_ESTOQUE, MSG_ENDERECO_COM_TAREFA, MSG_JA_ASSOCIADO, MSG_ENDERECO_INATIVO, MSG_ENDERECO_NAO_ENCONTRADO,
} from "../compartilhado/regras/enderecos.js";

test("código do endereço: só números, no formato das prateleiras (R3001-P7-A100-AP101)", () => {
  assert.equal(codigoDoEndereco({ rua: 3001, predio: 7, andar: 100, apto: 101 }), "R3001-P7-A100-AP101");
  assert.deepEqual(lerCodigoDoEndereco(" r3001-p7-a100-ap101 "), { rua: 3001, predio: 7, andar: 100, apto: 101 });
  assert.equal(lerCodigoDoEndereco("A-01-1-02"), null); // formato antigo, com letras, não vale
  assert.equal(lerCodigoDoEndereco("R3001-P7-A100"), null);
});

// O documento do estoquista cita 72 para este exemplo, mas a conta é 3 × 2 × 2 × 3 = 36.
test("lote: rua 1–3, prédio 1–2, andar 1–2, apto 1–3 gera 3 × 2 × 2 × 3 = 36 endereços", () => {
  const f = { ruaIni: 1, ruaFim: 3, predioIni: 1, predioFim: 2, andarIni: 1, andarFim: 2, aptoIni: 1, aptoFim: 3, tipo: "picking" };
  assert.equal(contarLote(f), 36);
  const { enderecos } = gerarLote(f);
  assert.equal(enderecos.length, 36);
  // andar e apartamento digitados como 1, 2, 3 saem no formato da prateleira
  assert.equal(enderecos[0].codigo, "R1-P1-A100-AP101");
  assert.equal(enderecos[35].codigo, "R3-P2-A200-AP203");
  assert.deepEqual(enderecos[35], { rua: 3, predio: 2, andar: 200, apto: 203, codigo: "R3-P2-A200-AP203", tipo: "picking" });
  assert.equal(new Set(enderecos.map((e) => e.codigo)).size, 36); // nenhum repetido
});

test("lote: intervalos inválidos e lote grande demais são recusados com o motivo", () => {
  const base = { ruaIni: 1, ruaFim: 1, predioIni: 1, predioFim: 1, andarIni: 1, andarFim: 1, aptoIni: 1, aptoFim: 1, tipo: "aereo" };
  assert.match(gerarLote({ ...base, ruaIni: 5, ruaFim: 2 }).erro, /^Rua: o inicial/);
  assert.match(gerarLote({ ...base, predioIni: "" }).erro, /^Prédio/);
  assert.match(gerarLote({ ...base, aptoIni: 1.5 }).erro, /^Apartamento/);
  assert.match(gerarLote({ ...base, tipo: "" }).erro, /tipo/);
  assert.match(gerarLote({ ...base, aptoFim: 100 }).erro, /de 1 a 99/); // AP199 é o último do andar 1
  assert.match(gerarLote({ ...base, ruaFim: MAXIMO_POR_LOTE + 1 }).erro, /máximo/);
});

test("acharEndereco: o QR traz o ID; digitado, vale o código, preferindo o endereço ativo", () => {
  const lista = [
    { id: 607500, codigo: "R3001-P1-A100-AP101", ativo: false },
    { id: 607530, codigo: "R3001-P1-A100-AP101", ativo: true },
  ];
  assert.equal(acharEndereco(lista, "607500").id, 607500); // QR antigo: acha, mas está inativo
  assert.equal(acharEndereco(lista, "r3001-p1-a100-ap101").id, 607530);
  assert.equal(acharEndereco(lista, "999"), null);
});

test("desativar: só endereço sem estoque e sem tarefa pendente", () => {
  assert.deepEqual(podeDesativar({ saldo: 0 }), { ok: true });
  assert.deepEqual(podeDesativar({ saldo: 3 }), { ok: false, msg: MSG_ENDERECO_COM_ESTOQUE });
  assert.deepEqual(podeDesativar({ saldo: 0, tarefasPendentes: 1 }), { ok: false, msg: MSG_ENDERECO_COM_TAREFA });
});

test("reativar: não pode ficar igual a outro endereço ativo", () => {
  const lista = [{ id: 1, codigo: "R1-P1-A1-AP1", ativo: true }, { id: 2, codigo: "R1-P1-A1-AP2", ativo: false }];
  assert.equal(conflitoAoReativar(lista, { rua: 1, predio: 1, andar: 1, apto: 1 }, 2), true);
  assert.equal(conflitoAoReativar(lista, { rua: 1, predio: 1, andar: 1, apto: 2 }, 2), false);
});

test("ordem de caminhada: rua, prédio, andar e apartamento como números", () => {
  const lista = ["R3002-P1-A100-AP101", "R3001-P10-A100-AP101", "R3001-P9-A200-AP201", "R3001-P9-A100-AP102"];
  assert.deepEqual(lista.sort(compararEnderecos), ["R3001-P9-A100-AP102", "R3001-P9-A200-AP201", "R3001-P10-A100-AP101", "R3002-P1-A100-AP101"]);
});

test("endereçar produto: bloqueia repetido, endereço inativo e endereço que não existe", () => {
  const end = { id: 10, ativo: true };
  const assoc = [{ produto: "BK-29-ALU-18", enderecoId: 10 }];
  assert.deepEqual(podeAssociar(assoc, "BK-29-ALU-18", end), { ok: false, msg: MSG_JA_ASSOCIADO });
  assert.deepEqual(podeAssociar(assoc, "PN-29-225", end), { ok: true });
  assert.deepEqual(podeAssociar(assoc, "PN-29-225", { id: 11, ativo: false }), { ok: false, msg: MSG_ENDERECO_INATIVO });
  assert.deepEqual(podeAssociar(assoc, "PN-29-225", null), { ok: false, msg: MSG_ENDERECO_NAO_ENCONTRADO });
});

test("andar e apartamento: digitados como 1, 2… e gravados como na prateleira (A100, AP101…)", () => {
  assert.deepEqual(naPrateleira({ rua: 3001, predio: 7, andar: 1, apto: 1 }), { rua: 3001, predio: 7, andar: 100, apto: 101 });
  assert.equal(codigoDoEndereco(naPrateleira({ rua: 3001, predio: 7, andar: 5, apto: 12 })), "R3001-P7-A500-AP512");
  assert.deepEqual(comoDigitado({ rua: 3001, predio: 7, andar: 500, apto: 512 }), { rua: 3001, predio: 7, andar: 5, apto: 12 });
  assert.equal(validarDigitado({ rua: 3001, predio: 7, andar: 1, apto: 99 }), null);
  assert.match(validarDigitado({ rua: 3001, predio: 7, andar: 1, apto: 100 }), /de 1 a 99/);
  assert.match(validarDigitado({ rua: "", predio: 7, andar: 1, apto: 1 }), /^Rua/);
});
