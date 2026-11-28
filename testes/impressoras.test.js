// v81: as impressoras de etiqueta da rede — o cadastro (regras), o texto que vai para a Argox e o js/dados que
// conversa com o servidor (sem rede, a mensagem certa; a última impressora escolhida fica no aparelho).
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { limparArmazenamento } from "./armazenamento-falso.js";
import { validarImpressora, ipValido, textoParaEtiqueta, MSG_SEM_REDE_PARA_IMPRIMIR } from "../compartilhado/regras/impressoras.js";
import { imprimirNaImpressora, listarImpressoras, ultimaImpressora, lembrarImpressora } from "../js/dados/impressoras.js";
import { dadosDaEtiquetaDoVolume } from "../js/etiqueta-recebimento.js";

beforeEach(() => limparArmazenamento());
const boa = { nome: "Argox Doca 1", ip: "192.168.1.60", porta: 9100, modelo: "argox-ppla", larguraMm: 80, alturaMm: 60 };

test("o cadastro confere nome, IP, porta, modelo e tamanho", () => {
  assert.equal(validarImpressora(boa), null);
  assert.match(validarImpressora({ ...boa, nome: "  " }), /nome/);
  assert.match(validarImpressora({ ...boa, nome: "x".repeat(41) }), /40/);
  for (const ip of ["192.168.1", "192.168.1.256", "abc", "", "192.168.01.1x"]) assert.equal(ipValido(ip), false, ip);
  assert.equal(ipValido(" 10.0.0.1 "), true);
  assert.match(validarImpressora({ ...boa, porta: 0 }), /Porta/);
  assert.match(validarImpressora({ ...boa, porta: 70000 }), /Porta/);
  assert.match(validarImpressora({ ...boa, modelo: "zebra" }), /Modelo/);
  assert.match(validarImpressora({ ...boa, larguraMm: 10 }), /Largura/);
  assert.match(validarImpressora({ ...boa, alturaMm: 300 }), /Altura/);
});

test("o texto da etiqueta vai sem acento, sem caractere de controle e curto", () => {
  assert.equal(textoParaEtiqueta("Ação São João\r\nLtda"), "Acao Sao JoaoLtda");
  assert.equal(textoParaEtiqueta("x".repeat(50), 10), "xxxxxxxxxx");
  assert.equal(textoParaEtiqueta(null), "");
});

test("os dados da etiqueta do volume para a impressora da rede", () => {
  const d = dadosDaEtiquetaDoVolume({ codigo: "VAAAA11-0001", criadoEm: "2026-11-28T12:00:00Z" }, { numero: 48201, fornecedor: { nome: "Fornecedor X" } }, "Palete");
  assert.deepEqual(d, { codigo: "VAAAA11-0001", tipo: "Palete", nota: "48201", fornecedor: "Fornecedor X", dia: "28/11/2026" });
});

test("imprimir pede ao servidor; sem rede devolve a mensagem para tentar de novo ou imprimir no aparelho", async () => {
  let pedido;
  const ok = async (url, op) => { pedido = { url, ...op }; return { ok: true, status: 200, json: async () => ({ enviadas: 1, impressora: "Argox Doca 1" }) }; };
  const r = await imprimirNaImpressora({ token: "t" }, "3", [{ codigo: "V1" }], ok);
  assert.deepEqual(r, { ok: true, enviadas: 1, impressora: "Argox Doca 1" });
  assert.equal(pedido.url, "api/imprimir");
  assert.deepEqual(JSON.parse(pedido.body), { impressora: 3, etiquetas: [{ codigo: "V1" }] });

  const semRede = await imprimirNaImpressora({ token: "t" }, 3, [{ codigo: "V1" }], async () => { throw new TypeError("Failed to fetch"); });
  assert.deepEqual(semRede, { ok: false, erro: MSG_SEM_REDE_PARA_IMPRIMIR, semRede: true });

  const naoRespondeu = await imprimirNaImpressora({ token: "t" }, 3, [{ codigo: "V1" }],
    async () => ({ ok: false, status: 502, json: async () => ({ erro: "A IMPRESSORA X NÃO RESPONDEU." }) }));
  assert.deepEqual(naoRespondeu, { ok: false, erro: "A IMPRESSORA X NÃO RESPONDEU." });
});

test("a lista vem do servidor e a última impressora escolhida fica neste aparelho", async () => {
  const r = await listarImpressoras({ token: "t" }, async () => ({ ok: true, status: 200, json: async () => [{ id: 2, nome: "A", setor: "" }] }));
  assert.deepEqual(r, { ok: true, impressoras: [{ id: 2, nome: "A", setor: "" }] });
  assert.equal(ultimaImpressora(), null);
  lembrarImpressora(2);
  assert.equal(ultimaImpressora(), 2);
});
