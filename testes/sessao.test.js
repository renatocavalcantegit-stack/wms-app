// Login de demonstração: sessão guardada no aparelho, setor do separador/conferente e tela de cada perfil.
// Os PINs vêm do próprio cadastro de demonstração; não ficam escritos aqui.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { limparArmazenamento } from "./armazenamento-falso.js";
import { USERS, session, login, logout, setSetor, homeUrl, temSetor, temServidor, loginNoServidor } from "../js/sessao.js";

const separador = USERS.find((u) => u.perfil === "sep");

beforeEach(limparArmazenamento);

test("login certo cria a sessão com nome e perfil", () => {
  const s = login(separador.login, separador.pin);
  assert.equal(s.login, separador.login);
  assert.equal(s.nome, separador.nome);
  assert.equal(s.perfil, "sep");
  assert.deepEqual(session(), s);
});

test("login ignora espaços e maiúsculas no usuário", () => {
  assert.ok(login(`  ${separador.login.toUpperCase()} `, ` ${separador.pin} `));
});

test("PIN errado não entra e não cria sessão", () => {
  assert.equal(login(separador.login, "PIN-ERRADO"), null);
  assert.equal(session(), null);
});

test("logout apaga a sessão", () => {
  login(separador.login, separador.pin);
  logout();
  assert.equal(session(), null);
});

test("sessão de usuário que não existe mais, ou corrompida, é ignorada", () => {
  localStorage.setItem("wms-bb-session", JSON.stringify({ login: "fantasma", perfil: "sep" }));
  assert.equal(session(), null);
  localStorage.setItem("wms-bb-session", "{isto não é JSON");
  assert.equal(session(), null);
});

test("setSetor grava o setor na sessão; sem sessão, não faz nada", () => {
  assert.equal(setSetor("mont"), null);
  login(separador.login, separador.pin);
  setSetor("mont");
  assert.equal(session().setor, "mont");
});

test("só separador e conferente escolhem setor", () => {
  assert.equal(temSetor("sep"), true);
  assert.equal(temSetor("conf"), true);
  assert.equal(temSetor("emb"), false);
  assert.equal(temSetor("coord"), false);
});

test("homeUrl: cada perfil vai para a sua tela", () => {
  assert.equal(homeUrl("conf"), "conferencia.html");
  assert.equal(homeUrl("coord"), "gestao.html");
  assert.equal(homeUrl("coordmont"), "montagem.html");
  assert.equal(homeUrl("sep"), "./");
  assert.equal(homeUrl("emb"), "./");
});

test("estoque: o estoquista vai para o coletor do estoque e o gestor para o painel WEB", () => {
  assert.equal(homeUrl("estq"), "estoque.html");
  assert.equal(homeUrl("gest"), "gestao-estoque.html");
  assert.equal(temSetor("estq"), false); // estoquista não escolhe Expedição/Montagem
});

// ---------- com servidor (Fase 1b) ----------
// "fetch" de mentira: cada teste diz o que o servidor responde

const responde = (status, corpo) => async () => ({ ok: status === 200, status, json: async () => corpo });
const semRede = async () => { throw new TypeError("Failed to fetch"); };

test("tem servidor? o arquivo modo.json diz (no GitHub Pages é false; o servidor do WMS responde true)", async () => {
  assert.equal(await temServidor(responde(200, { servidor: true })), true);
  assert.equal(await temServidor(responde(200, { servidor: false })), false);
  assert.equal(await temServidor(responde(404, {})), false);
  assert.equal(await temServidor(semRede), false);
});

test("login no servidor: guarda o token na sessão do turno", async () => {
  const chamadas = [];
  const buscar = async (url, opcoes) => {
    chamadas.push({ url, corpo: JSON.parse(opcoes.body) });
    return { ok: true, status: 200, json: async () => ({ token: "tok-1", expiraEm: "2026-11-18T00:00:00Z", login: "separador", nome: "Usuário Separador", perfil: "sep" }) };
  };
  const r = await loginNoServidor(" Separador ", "9999", buscar);
  assert.equal(r.ok, true);
  assert.deepEqual(chamadas, [{ url: "api/login", corpo: { login: "separador", pin: "9999" } }]);
  const s = session();
  assert.deepEqual([s.login, s.perfil, s.token, s.expiraEm], ["separador", "sep", "tok-1", "2026-11-18T00:00:00Z"]);
});

test("login no servidor: PIN errado e sem rede dão erros diferentes, e não criam sessão", async () => {
  assert.deepEqual(await loginNoServidor("separador", "0", responde(401, {})), { ok: false, erro: "pin" });
  assert.deepEqual(await loginNoServidor("separador", "0", semRede), { ok: false, erro: "sem-rede" });
  assert.equal(session(), null);
});

test("sessão do servidor vale para usuário que não está na lista de demonstração", async () => {
  await loginNoServidor("novo.usuario", "1", responde(200, { token: "t", expiraEm: "x", login: "novo.usuario", nome: "Novo", perfil: "sep" }));
  assert.equal(session().login, "novo.usuario");
});
