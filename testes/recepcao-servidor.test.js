// v78: a Conferência da nota no coletor COM SERVIDOR (js/dados/recepcao.js) e o código do volume do aparelho.
// O coletor confere sem rede: a confirmação entra na fila, soma na cópia local e as etiquetas saem na hora.
// A cópia local some quando o servidor já tem a confirmação, quando a nota fecha ou quando foi recusada.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { limparArmazenamento } from "./armazenamento-falso.js";
import { lerRecepcao, baixarNotas, conferirNaFila, finalizarNaFila, descartarRecusadas } from "../js/dados/recepcao.js";
import { acoesPendentes, tirarDaFila } from "../js/dados/fila.js";
import {
  codigoDoVolumeDoAparelho, validarCodigosDosVolumes, msgVolumeRepetido, MSG_VOLUMES_INVALIDOS, msgAcimaDaNota,
} from "../compartilhado/regras/recebimento.js";
import { MSG_ENDERECO_NAO_ENCONTRADO } from "../compartilhado/regras/enderecos.js";

const sessao = { login: "estoquista", token: "t" };
const NOTA = { id: 7, numero: "48201", tipo: "Compra", fornecedor: { codigo: 8558, nome: "Pedal Sul" }, data: "2026-11-25", finalizada: false, pedido: null,
  itens: [{ produto: "536", qtd: 20 }] };
const DOCA = { id: 900, rua: 9, predio: 1, andar: 0, apto: 1, codigo: "DOCA-1", tipo: "doca", ativo: true };
const PICKING = { id: 100, rua: 1, predio: 1, andar: 0, apto: 1, codigo: "R1", tipo: "picking", ativo: true };
// o que o servidor devolve em /api/recepcao/notas
const resposta = (conferencias = [], notas = [NOTA]) => ({
  notas, conferencias, produtos: [{ codigo: "536", descricao: "CAMARA", un: "UN", checkout: true }],
  embalagens: [{ id: 1, produto: "536", codigo: "789", descricao: "Unidade", qtd: 1 }], docas: [DOCA],
});
const servidor = (corpo) => async () => ({ ok: true, status: 200, json: async () => corpo });
const semRede = async () => { throw new TypeError("sem rede"); };
const conferido = () => lerRecepcao().conferencias.reduce((t, c) => t + c.qtd, 0);

beforeEach(() => limparArmazenamento());

test("código do volume: código do aparelho + sequência; o servidor recusa repetido ou inválido", () => {
  assert.equal(codigoDoVolumeDoAparelho("3fa2c1d4-0000-4000-8000-000000000000", 1), "V3FA2C1-0001");
  assert.equal(codigoDoVolumeDoAparelho("3fa2c1d4", 12345), "V3FA2C1-12345");
  assert.equal(validarCodigosDosVolumes(["VAB-0001", "VAB-0002"]), null);
  assert.equal(validarCodigosDosVolumes(["VAB-0001", "VAB-0001"]), msgVolumeRepetido("VAB-0001"));
  assert.equal(validarCodigosDosVolumes([]), MSG_VOLUMES_INVALIDOS);
  assert.equal(validarCodigosDosVolumes(["<script>"]), MSG_VOLUMES_INVALIDOS);
});

test("sem nada baixado, a tela fica vazia; sem rede, a cópia que já estava fica", async () => {
  assert.equal(lerRecepcao().baixadoEm, null);
  assert.deepEqual((await baixarNotas(sessao, semRede)), { ok: false, semRede: true });
  assert.ok((await baixarNotas(sessao, servidor(resposta()))).ok);
  assert.equal(lerRecepcao().notas.length, 1);
  await baixarNotas(sessao, semRede);
  assert.equal(lerRecepcao().notas.length, 1, "sem rede, continua conferindo com a cópia");
});

test("conferir sem rede: entra na fila, soma na hora, gera os códigos dos volumes e valida como o servidor", async () => {
  await baixarNotas(sessao, servidor(resposta()));
  const r = conferirNaFila(sessao, { notaId: 7, produto: "536", qtd: "12", volumes: 2, docaId: 900 });
  assert.ok(r.ok);
  assert.equal(conferido(), 12);
  assert.equal(r.volumes.length, 2);
  assert.match(r.volumes[0].codigo, /^V[0-9A-F]{6}-0001$/);
  assert.match(r.volumes[1].codigo, /^V[0-9A-F]{6}-0002$/);
  assert.deepEqual([r.volumes[1].seq, r.volumes[1].total], [2, 2]);
  const [a] = acoesPendentes("estoquista");
  assert.equal(a.tipo, "recepcao.conferir");
  assert.deepEqual({ ...a.dados, dia: "" }, { nota: 7, rotulo: "NF 48201", produto: "536", qtd: 12, doca: 900, volumes: r.volumes.map((v) => v.codigo), dia: "" });
  // a sequência continua no próximo
  const r2 = conferirNaFila(sessao, { notaId: 7, produto: "536", qtd: 1, volumes: 1, docaId: 900 });
  assert.match(r2.volumes[0].codigo, /-0003$/);
  // as mesmas regras: acima do pendente e endereço que não é doca
  assert.deepEqual(conferirNaFila(sessao, { notaId: 7, produto: "536", qtd: 8, volumes: 1, docaId: 900 }), { ok: false, msg: msgAcimaDaNota(7) });
  // o coletor só baixa as docas: um endereço que não é doca nem é encontrado
  assert.equal(conferirNaFila(sessao, { notaId: 7, produto: "536", qtd: 1, volumes: 1, docaId: PICKING.id }).msg, MSG_ENDERECO_NAO_ENCONTRADO);
});

test("a confirmação local sai quando o servidor já tem; a recusada sai na hora", async () => {
  await baixarNotas(sessao, servidor(resposta()));
  const a = conferirNaFila(sessao, { notaId: 7, produto: "536", qtd: 5, volumes: 1, docaId: 900 }).conferencia;
  const b = conferirNaFila(sessao, { notaId: 7, produto: "536", qtd: 3, volumes: 1, docaId: 900 }).conferencia;
  // o servidor aplicou a primeira (ela aparece no que o coletor baixa, com a ação que criou)
  tirarDaFila([a.acaoId]);
  await baixarNotas(sessao, servidor(resposta([{ ...a, id: 50, ausente: undefined }])));
  assert.equal(conferido(), 8, "a do servidor + a local que ainda está na fila, sem contar duas vezes");
  // a segunda foi recusada (outro coletor conferiu antes)
  tirarDaFila([b.acaoId]);
  descartarRecusadas([b.acaoId]);
  assert.equal(conferido(), 5);
});

test("saiu da fila mas o servidor ainda não mostra: espera mais uma baixada antes de descartar", async () => {
  await baixarNotas(sessao, servidor(resposta()));
  const a = conferirNaFila(sessao, { notaId: 7, produto: "536", qtd: 5, volumes: 1, docaId: 900 }).conferencia;
  tirarDaFila([a.acaoId]);
  await baixarNotas(sessao, servidor(resposta())); // a leitura pode ter sido feita antes de a ação ser aplicada
  assert.equal(conferido(), 5);
  await baixarNotas(sessao, servidor(resposta())); // na segunda, com certeza não entrou
  assert.equal(conferido(), 0);
});

test("finalizar: a nota fica finalizada no coletor até o servidor tirar ela da lista", async () => {
  await baixarNotas(sessao, servidor(resposta()));
  assert.ok(finalizarNaFila(sessao, 7).ok);
  assert.equal(finalizarNaFila(sessao, 7).ok, false, "tocar duas vezes não manda duas");
  assert.equal(lerRecepcao().notas[0].finalizada, true);
  assert.equal(acoesPendentes("estoquista")[0].tipo, "recepcao.finalizar");
  await baixarNotas(sessao, servidor(resposta()));
  assert.equal(lerRecepcao().notas[0].finalizada, true, "ainda na fila");
  tirarDaFila(acoesPendentes("estoquista").map((x) => x.id));
  await baixarNotas(sessao, servidor(resposta([], [])));
  assert.deepEqual(lerRecepcao().notas, []);
});
