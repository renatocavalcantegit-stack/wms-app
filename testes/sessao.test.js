// Login de demonstração: sessão guardada no aparelho, setor do separador/conferente e tela de cada perfil.
// Os PINs vêm do próprio cadastro de demonstração; não ficam escritos aqui.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { limparArmazenamento } from "./armazenamento-falso.js";
import { USERS, session, login, logout, setSetor, homeUrl, temSetor } from "../js/sessao.js";

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
