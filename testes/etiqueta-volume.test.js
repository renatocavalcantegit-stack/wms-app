// Etiqueta de volume: o texto do QR impresso na conferência e a leitura dele no embarque.
import { test } from "node:test";
import assert from "node:assert/strict";
import { WMS, Etiqueta } from "./codigo-atual.js";

const { parseVolume } = WMS;
const { qrText } = Etiqueta;

test("qrText: pedido | volume/total | cliente | cidade-UF, sem acentos e em maiúsculas", () => {
  const pedido = { id: "PV-10404", cliente: "Trilha Livre Bike Shop", cidade: "Petrolina · PE" };
  assert.equal(qrText(pedido, 1, 3), "PV-10404|1/3|TRILHA LIVRE BIKE SHOP|PETROLINA-PE");
  assert.equal(qrText({ id: "PV-10425", cliente: "Pedala São João", cidade: "Jaboatão · PE" }, 2, 2),
    "PV-10425|2/2|PEDALA SAO JOAO|JABOATAO-PE");
});

test("parseVolume: lê o QR da etiqueta", () => {
  assert.deepEqual(parseVolume("PV-10404|1/3|TRILHA LIVRE BIKE SHOP|PETROLINA-PE"), { id: "PV-10404", vol: 1, total: 3 });
});

test("parseVolume: aceita o código digitado de vários jeitos", () => {
  assert.deepEqual(parseVolume("10404 1"), { id: "PV-10404", vol: 1, total: null });
  assert.deepEqual(parseVolume("PV-10404/2"), { id: "PV-10404", vol: 2, total: null });
  assert.deepEqual(parseVolume("pv10404-2"), { id: "PV-10404", vol: 2, total: null });
  assert.deepEqual(parseVolume("  10404.3/5 "), { id: "PV-10404", vol: 3, total: 5 });
});

test("parseVolume: código que não é de volume devolve null", () => {
  assert.equal(parseVolume("ABC"), null);
  assert.equal(parseVolume("PV-10404"), null); // falta o número do volume
  assert.equal(parseVolume("12 1"), null); // número do pedido curto demais
});

test("o QR impresso é lido de volta com o mesmo pedido e volume", () => {
  const pedido = { id: "PV-10421", cliente: "Pedal & Cia Bikes", cidade: "Recife · PE" };
  assert.deepEqual(parseVolume(qrText(pedido, 2, 3)), { id: "PV-10421", vol: 2, total: 3 });
});
