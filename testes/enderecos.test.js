// Cadastro de endereços: formato numérico da prateleira, cadastro um a um e em lote, desativação e endereço padrão.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  codigoDoEndereco, lerCodigoDoEndereco, acharEndereco, podeDesativar,
  partesDoEndereco, validarPartes, gerarLote, contarLote, andaresDoLote, aptosDoAndar, MAXIMO_POR_LOTE,
  codigoEmUso, compararEnderecos, podeAssociar,
  MSG_ENDERECO_COM_ESTOQUE, MSG_ENDERECO_COM_TAREFA, MSG_JA_ASSOCIADO, MSG_ENDERECO_INATIVO, MSG_ENDERECO_NAO_ENCONTRADO,
} from "../compartilhado/regras/enderecos.js";

// lote com os números da placa: rua 3001, prédio 1–2, andar 100–300 (de 100 em 100), apto 101–106 no 1º andar
const LOTE = { ruaIni: 3001, ruaFim: 3001, predioIni: 1, predioFim: 2, andarIni: 100, andarFim: 300, andarPasso: 100,
  aptoIni: 101, aptoFim: 106, tipo: "picking" };

test("lote: números da placa; os aptos do 1º andar se repetem na mesma posição nos outros andares", () => {
  assert.deepEqual(andaresDoLote(LOTE), [100, 200, 300]);
  assert.deepEqual(aptosDoAndar(LOTE, 300), [301, 302, 303, 304, 305, 306]);
  assert.equal(contarLote(LOTE), 1 * 2 * 3 * 6);
  const { enderecos } = gerarLote(LOTE);
  assert.equal(enderecos.length, 36);
  assert.equal(enderecos[0].codigo, "R3001-P1-A100-AP101");
  assert.equal(enderecos[6].codigo, "R3001-P1-A200-AP201");
  assert.deepEqual(enderecos[35], { rua: 3001, predio: 2, andar: 300, apto: 306, codigo: "R3001-P2-A300-AP306", tipo: "picking" });
  assert.equal(new Set(enderecos.map((e) => e.codigo)).size, 36); // nenhum repetido
  // um andar só: o apto vai exatamente como digitado
  const umAndar = gerarLote({ ...LOTE, predioFim: 1, andarIni: 500, andarFim: 500, aptoIni: 501, aptoFim: 503, tipo: "aereo" }).enderecos;
  assert.deepEqual(umAndar.map((e) => e.codigo), ["R3001-P1-A500-AP501", "R3001-P1-A500-AP502", "R3001-P1-A500-AP503"]);
});

test("lote: intervalos inválidos e lote grande demais são recusados com o motivo", () => {
  assert.match(gerarLote({ ...LOTE, ruaIni: 3005, ruaFim: 3001 }).erro, /^Rua: o inicial/);
  assert.match(gerarLote({ ...LOTE, predioIni: "" }).erro, /^Prédio/);
  assert.match(gerarLote({ ...LOTE, aptoIni: 1.5 }).erro, /^Apartamento/);
  assert.match(gerarLote({ ...LOTE, andarPasso: "" }).erro, /^Andar: informe de quanto/);
  assert.match(gerarLote({ ...LOTE, andarFim: 350 }).erro, /não chega em 350/);
  assert.match(gerarLote({ ...LOTE, aptoIni: 1, aptoFim: 6 }).erro, /^Apartamento: informe os do andar 100/);
  assert.match(gerarLote({ ...LOTE, tipo: "" }).erro, /tipo/);
  assert.match(gerarLote({ ...LOTE, ruaFim: 3001 + MAXIMO_POR_LOTE }).erro, /máximo/);
});

test("código do endereço: só números, no formato das prateleiras (R3001-P7-A100-AP101)", () => {
  assert.equal(codigoDoEndereco({ rua: 3001, predio: 7, andar: 100, apto: 101 }), "R3001-P7-A100-AP101");
  assert.deepEqual(lerCodigoDoEndereco(" r3001-p7-a100-ap101 "), { rua: 3001, predio: 7, andar: 100, apto: 101 });
  assert.equal(lerCodigoDoEndereco("A-01-1-02"), null); // formato antigo, com letras, não vale
  assert.equal(lerCodigoDoEndereco("R3001-P7-A100"), null);
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

test("código em uso: endereço novo ou reativado não pode repetir um endereço ativo", () => {
  const lista = [{ id: 1, codigo: "R1-P1-A100-AP101", ativo: true }, { id: 2, codigo: "R1-P1-A100-AP102", ativo: false }];
  assert.equal(codigoEmUso(lista, { rua: 1, predio: 1, andar: 100, apto: 101 }), true);
  assert.equal(codigoEmUso(lista, { rua: 1, predio: 1, andar: 100, apto: 102 }), false); // só existe inativo
  assert.equal(codigoEmUso(lista, { rua: 1, predio: 1, andar: 100, apto: 101 }, 1), false); // ignorando o próprio
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

test("rua, prédio, andar e apartamento: digitados exatamente como na prateleira, sem conversão", () => {
  const partes = partesDoEndereco({ rua: "3001", predio: "1", andar: "100", apto: "101" });
  assert.deepEqual(partes, { rua: 3001, predio: 1, andar: 100, apto: 101 });
  assert.equal(codigoDoEndereco(partes), "R3001-P1-A100-AP101");
  assert.equal(validarPartes({ rua: 3001, predio: 7, andar: 500, apto: 512 }), null);
  assert.match(validarPartes({ rua: "", predio: 7, andar: 100, apto: 101 }), /^Rua/);
  assert.match(validarPartes({ rua: 3001, predio: 7, andar: 0, apto: 101 }), /^Andar/);
  assert.match(validarPartes({ rua: 3001, predio: 7, andar: 100, apto: 1.5 }), /^Apartamento/);
});
