// Etiqueta de volume: o texto do QR impresso na conferência e a leitura dele no embarque.
import { test } from "node:test";
import assert from "node:assert/strict";
import { qrText, parseVolume, enderecoDaEtiqueta } from "../compartilhado/regras/etiqueta-volume.js";

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

// ---------- endereço e rota impressos na etiqueta ----------
const NOMES = { centro: "Centro", messejana: "Messejana" };
const nomeDaRota = (id) => NOMES[id] || null;

test("enderecoDaEtiqueta: cidade · UF, bairro, rua e número do cadastro do cliente, e o nome da rota", () => {
  const pedido = { id: "PV-10421", cliente: "Horizonte Cedro Comercial", cidade: "Fortaleza · CE" };
  const cadastro = { bairro: "Bairro Horizonte", rua: "Rua das Acácias", numero: "1250", rota: "centro" };
  assert.deepEqual(enderecoDaEtiqueta(pedido, cadastro, nomeDaRota),
    { cidade: "Fortaleza · CE", bairro: "Bairro Horizonte", rua: "Rua das Acácias", numero: "1250", rota: "Centro" });
});

test("enderecoDaEtiqueta: o endereço e a rota que vierem no próprio pedido (Sankhya) valem mais que o cadastro", () => {
  const pedido = { cidade: "Fortaleza · CE", rota: "messejana", entrega: { bairro: "Messejana", rua: "Av. Frei Cirilo", numero: "88" } };
  const cadastro = { bairro: "Bairro Horizonte", rua: "Rua das Acácias", numero: "1250", rota: "centro" };
  const e = enderecoDaEtiqueta(pedido, cadastro, nomeDaRota);
  assert.equal(e.bairro, "Messejana");
  assert.equal(e.rua, "Av. Frei Cirilo");
  assert.equal(e.numero, "88");
  assert.equal(e.rota, "Messejana");
});

test("enderecoDaEtiqueta: sem cadastro, só a cidade; sem rota, SEM ROTA; rua sem número vira S/N", () => {
  assert.deepEqual(enderecoDaEtiqueta({ cidade: "Montagem" }),
    { cidade: "Montagem", bairro: "", rua: "", numero: "", rota: "SEM ROTA" });
  assert.equal(enderecoDaEtiqueta({ cidade: "Sobral · CE" }, { rota: "nao-existe" }, nomeDaRota).rota, "SEM ROTA");
  assert.equal(enderecoDaEtiqueta({ cidade: "Sobral · CE" }, { rua: "Rua Projetada" }).numero, "S/N");
});
