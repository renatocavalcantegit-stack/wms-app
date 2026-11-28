// v81 · Impressoras de etiqueta da rede: o gestor cadastra, o coletor escolhe e o servidor manda a etiqueta (PPLA)
// direto para a impressora pela porta 9100. Aqui a "impressora" é um servidor TCP falso nesta máquina.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { prepararBancoDeTeste } from "./banco-de-teste.js";
import { criarServidor } from "../src/servidor.js";
import { USERS } from "../../js/sessao.js";
import { etiquetaDoVolumePpla } from "../src/consultas/impressoras.js";
import { MSG_IMPRESSORA_NAO_ENCONTRADA, msgImpressoraNaoRespondeu } from "../../compartilhado/regras/impressoras.js";

let pool, app, falsa, portaFalsa;
const recebido = []; // o que a impressora falsa recebeu (um texto por conexão)
before(async () => {
  pool = await prepararBancoDeTeste();
  await pool.query("DELETE FROM impressoras WHERE nome LIKE 'Teste %'");
  app = criarServidor({ pool });
  falsa = net.createServer((s) => { let t = ""; s.on("data", (d) => (t += d.toString("latin1"))); s.on("end", () => recebido.push(t)); });
  await new Promise((r) => falsa.listen(0, "127.0.0.1", r));
  portaFalsa = falsa.address().port;
});
after(async () => {
  await pool.query("DELETE FROM impressoras WHERE nome LIKE 'Teste %'"); // o cadastro sobrevive ao semear: cada teste limpa o seu
  await app.close();
  await pool.end();
  falsa.close();
});

const pin = (login) => USERS.find((u) => u.login === login).pin;
const tokens = {};
async function entrar(login) {
  tokens[login] ||= (await app.inject({ method: "POST", url: "/api/login", payload: { login, pin: pin(login) } })).json().token;
  return tokens[login];
}
const pedir = async (login, method, url, payload) =>
  app.inject({ method, url, payload, headers: { authorization: `Bearer ${await entrar(login)}` } });
const esperar = async (n) => { for (let i = 0; i < 50 && recebido.length < n; i++) await new Promise((r) => setTimeout(r, 20)); };

const etiqueta = { codigo: "VAAAA11-0001", tipo: "Palete", nota: "48201", fornecedor: "Fornecedor Ação Ltda", dia: "28/11/2026" };
let idAtiva, idDesligada;

test("só o gestor cadastra; o IP e o nome são conferidos", async () => {
  const base = { nome: "Teste Doca", setor: "Recebimento", ip: "127.0.0.1", porta: portaFalsa };
  assert.equal((await pedir("estoquista", "POST", "/api/impressoras", base)).statusCode, 403);
  assert.equal((await pedir("gestorestoque", "POST", "/api/impressoras", { ...base, ip: "192.168.1" })).statusCode, 400);
  const r = await pedir("gestorestoque", "POST", "/api/impressoras", base);
  assert.equal(r.statusCode, 200, r.body);
  assert.deepEqual({ ...r.json(), id: 0 }, { id: 0, nome: "Teste Doca", setor: "Recebimento", ip: "127.0.0.1", porta: portaFalsa, modelo: "argox-ppla", larguraMm: 80, alturaMm: 60, ativa: true });
  idAtiva = r.json().id;
  assert.equal((await pedir("gestorestoque", "POST", "/api/impressoras", base)).statusCode, 409, "nome repetido");
  const d = await pedir("gestorestoque", "POST", "/api/impressoras", { ...base, nome: "Teste Desligada", ativa: false });
  idDesligada = d.json().id;
});

test("o coletor vê só as ativas e sem o IP; o gestor vê todas", async () => {
  const doColetor = (await pedir("estoquista", "GET", "/api/impressoras")).json().filter((p) => p.nome.startsWith("Teste "));
  assert.deepEqual(doColetor, [{ id: idAtiva, nome: "Teste Doca", setor: "Recebimento" }]);
  const doGestor = (await pedir("gestorestoque", "GET", "/api/impressoras")).json().filter((p) => p.nome.startsWith("Teste "));
  assert.equal(doGestor.length, 2);
  assert.ok(doGestor.every((p) => p.ip === "127.0.0.1"));
  assert.equal((await pedir("separador", "GET", "/api/impressoras")).statusCode, 403);
});

test("imprimir manda as etiquetas em PPLA para a impressora", async () => {
  recebido.length = 0;
  const r = await pedir("estoquista", "POST", "/api/imprimir", { impressora: idAtiva, etiquetas: [etiqueta, { ...etiqueta, codigo: "VAAAA11-0002" }] });
  assert.equal(r.statusCode, 200, r.body);
  assert.deepEqual(r.json(), { enviadas: 2, impressora: "Teste Doca" });
  await esperar(1);
  assert.equal(recebido.length, 1, "uma conexão só para as duas etiquetas");
  assert.equal(recebido[0], etiquetaDoVolumePpla(etiqueta, { alturaMm: 60 }) + etiquetaDoVolumePpla({ ...etiqueta, codigo: "VAAAA11-0002" }, { alturaMm: 60 }));
  assert.equal((recebido[0].match(/\x02L/g) || []).length, 2);
  assert.ok(recebido[0].includes("VAAAA11-0002"));
  assert.ok(recebido[0].includes("Fornecedor Acao Ltda"), "sem acento");
  assert.ok(!/[^\x00-\x7E]/.test(recebido[0]), "só caracteres básicos");
});

test("o gestor imprime o teste; a desativada e a que não responde dão erro claro", async () => {
  recebido.length = 0;
  const t = await pedir("gestorestoque", "POST", `/api/impressoras/${idAtiva}/teste`);
  assert.equal(t.statusCode, 200, t.body);
  await esperar(1);
  assert.ok(recebido[0].includes("TESTE-0001"));
  assert.equal((await pedir("estoquista", "POST", `/api/impressoras/${idAtiva}/teste`)).statusCode, 403);

  const des = await pedir("estoquista", "POST", "/api/imprimir", { impressora: idDesligada, etiquetas: [etiqueta] });
  assert.equal(des.statusCode, 404);
  assert.equal(des.json().erro, MSG_IMPRESSORA_NAO_ENCONTRADA);

  // ninguém escutando nesta porta: a impressora "não responde"
  const livre = await new Promise((r) => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
  const alt = await pedir("gestorestoque", "PUT", `/api/impressoras/${idAtiva}`, { nome: "Teste Doca", setor: "Recebimento", ip: "127.0.0.1", porta: livre });
  assert.equal(alt.statusCode, 200, alt.body);
  const off = await pedir("estoquista", "POST", "/api/imprimir", { impressora: idAtiva, etiquetas: [etiqueta] });
  assert.equal(off.statusCode, 502);
  assert.equal(off.json().erro, msgImpressoraNaoRespondeu("Teste Doca"));
});

test("pedido de impressão fora do formato é recusado", async () => {
  assert.equal((await pedir("estoquista", "POST", "/api/imprimir", { impressora: idAtiva, etiquetas: [] })).statusCode, 400);
  const muitas = Array.from({ length: 21 }, () => etiqueta);
  assert.equal((await pedir("estoquista", "POST", "/api/imprimir", { impressora: idAtiva, etiquetas: muitas })).statusCode, 400);
  assert.equal((await pedir("estoquista", "POST", "/api/imprimir", { impressora: idAtiva, etiquetas: [{ ...etiqueta, codigo: "x".repeat(41) }] })).statusCode, 400);
});
