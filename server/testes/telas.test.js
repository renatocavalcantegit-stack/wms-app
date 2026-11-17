// O servidor entrega as telas do app (Fase 1b): tela e API no mesmo endereço.
// O mais importante aqui é o que ele NÃO pode entregar: o .env com a senha do banco, o código do servidor, o .git...
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { criarServidor } from "../src/servidor.js";

let app;
// as telas não usam o banco: um "pool" vazio basta
before(() => { app = criarServidor({ pool: { query: async () => ({ rows: [] }) } }); });
after(() => app.close());

const pegar = (url) => app.inject({ url });

test("a raiz entrega a tela do coletor", async () => {
  const r = await pegar("/");
  assert.equal(r.statusCode, 200);
  assert.match(r.headers["content-type"], /text\/html/);
  assert.match(r.body, /<html/i);
});

test("telas, scripts, estilos e imagens com o tipo certo", async () => {
  assert.match((await pegar("/conferencia.html")).headers["content-type"], /text\/html/);
  assert.match((await pegar("/js/sessao.js")).headers["content-type"], /javascript/);
  assert.match((await pegar("/compartilhado/regras/quantidade.js")).headers["content-type"], /javascript/);
  assert.match((await pegar("/styles.css")).headers["content-type"], /text\/css/);
  assert.match((await pegar("/assets/logo.png")).headers["content-type"], /image\/png/);
});

test("modo.json diz ao app que há servidor (o arquivo do GitHub Pages diz que não)", async () => {
  assert.deepEqual((await pegar("/modo.json")).json(), { servidor: true });
});

test("nunca entrega o .env, o código do servidor, o .git nem nada fora do app", async () => {
  for (const url of [
    "/server/.env", "/server/src/banco.js", "/server/package.json", "/.git/config", "/.claude/launch.json",
    "/node_modules/fastify/package.json", "/e2e/ajuda.js", "/testes/sessao.test.js", "/package.json",
    "/../server/.env", "/%2e%2e/server/.env", "/js/..%2f..%2fserver/.env", "/.env",
  ]) {
    const r = await pegar(url);
    assert.equal(r.statusCode, 404, url);
  }
});

test("arquivo que não existe: 404", async () => {
  assert.equal((await pegar("/nao-existe.html")).statusCode, 404);
});

test("a API continua respondendo antes das telas", async () => {
  const r = await pegar("/api/saude");
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().ok, true);
});
