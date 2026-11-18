// Fase 1e: login único dos coletores, Sair que encerra a sessão no servidor e a tela de Dispositivos do coordenador.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prepararBancoDeTeste } from "./banco-de-teste.js";
import { criarServidor } from "../src/servidor.js";
import { USERS } from "../../js/sessao.js";

let pool, app;
before(async () => {
  pool = await prepararBancoDeTeste();
  app = criarServidor({ pool });
});
after(async () => {
  await app.close();
  await pool.end();
});

const usuario = (login) => USERS.find((u) => u.login === login);
const entrar = (login, aparelho) =>
  app.inject({ method: "POST", url: "/api/login", payload: { login, pin: usuario(login).pin, ...(aparelho ? { aparelho } : {}) } });
const comToken = (token) => ({ authorization: `Bearer ${token}` });
const batimento = (token, pendentes) =>
  app.inject({ method: "POST", url: "/api/sincronizar", headers: comToken(token), payload: { acoes: [], ...(pendentes != null ? { pendentes } : {}) } });
const dispositivos = (token) => app.inject({ url: "/api/dispositivos", headers: comToken(token) });
const desconectar = (token, id) => app.inject({ method: "POST", url: `/api/dispositivos/${id}/desconectar`, headers: comToken(token) });

test("separador conectado num coletor: o login em outro aparelho é recusado e o primeiro continua", async () => {
  const a = await entrar("separador", "coletor-A");
  assert.equal(a.statusCode, 200);
  const b = await entrar("separador", "coletor-B");
  assert.equal(b.statusCode, 409);
  assert.equal(b.json().motivo, "outro-aparelho");
  assert.match(b.json().erro, /^Você já está conectado em outro aparelho \(desde \d\d:\d\d, último contato agora\)\. Saia por lá ou peça ao coordenador para desconectar\.$/);
  // o coletor A não caiu
  assert.equal((await batimento(a.json().token)).statusCode, 200);
});

test("no mesmo aparelho pode entrar de novo; a sessão antiga dele termina", async () => {
  const antiga = (await entrar("separador", "coletor-A")).json().token;
  const nova = await entrar("separador", "coletor-A");
  assert.equal(nova.statusCode, 200);
  const r = await batimento(antiga);
  assert.equal(r.statusCode, 401);
  assert.equal(r.json().motivo, "novo-login");
});

test("PIN errado não revela onde a pessoa está conectada", async () => {
  const r = await app.inject({ method: "POST", url: "/api/login", payload: { login: "separador", pin: "errado", aparelho: "coletor-B" } });
  assert.equal(r.statusCode, 401);
  assert.equal(r.json().erro, "Usuário ou PIN incorretos.");
});

test("coordenador pode estar em vários aparelhos (computador e celular)", async () => {
  assert.equal((await entrar("coordenador", "pc-escritorio")).statusCode, 200);
  assert.equal((await entrar("coordenador", "celular")).statusCode, 200);
});

test("Sair encerra a sessão no servidor: o token para de valer e o login em outro aparelho é liberado", async () => {
  const token = (await entrar("conferente", "coletor-C")).json().token;
  assert.equal((await entrar("conferente", "coletor-D")).statusCode, 409);
  assert.equal((await app.inject({ method: "POST", url: "/api/logout", headers: comToken(token) })).statusCode, 200);
  const r = await batimento(token);
  assert.equal(r.statusCode, 401);
  assert.equal(r.json().motivo, "saiu");
  assert.equal((await entrar("conferente", "coletor-D")).statusCode, 200);
});

test("Dispositivos: só o coordenador vê; lista quem está conectado, sem o token, com as ações não enviadas", async () => {
  const sep = (await entrar("separador2", "coletor-E")).json().token;
  await batimento(sep, 7);
  assert.equal((await dispositivos(sep)).statusCode, 403);

  const coord = (await entrar("coordenador", "pc-escritorio")).json().token;
  const r = (await dispositivos(coord)).json();
  assert.ok(Date.parse(r.agora));
  const d = r.dispositivos.find((x) => x.login === "separador2");
  assert.equal(d.nome, "Segundo Separador");
  assert.equal(d.perfil, "sep");
  assert.equal(d.aparelho, "coletor-E");
  assert.equal(d.acoes_pendentes, 7);
  assert.ok(d.criada_em && d.ultimo_contato);
  assert.ok(r.dispositivos.every((x) => !("token" in x)), "o token nunca sai do servidor");
  assert.ok(r.dispositivos.find((x) => x.id === r.esta && x.login === "coordenador"), "diz qual é a sessão de quem está olhando");
});

test("coletor perdido: o coordenador desconecta, o aparelho fica sabendo e a pessoa entra em outro", async () => {
  const perdido = (await entrar("embarque", "coletor-perdido")).json().token;
  assert.equal((await entrar("embarque", "coletor-novo")).statusCode, 409);

  const coord = (await entrar("coordenador", "pc-escritorio")).json().token;
  const lista = (await dispositivos(coord)).json();
  const d = lista.dispositivos.find((x) => x.login === "embarque");
  assert.equal((await desconectar(coord, d.id)).statusCode, 200);
  assert.equal((await desconectar(coord, d.id)).statusCode, 404, "já desconectado");
  assert.equal((await desconectar(coord, lista.esta)).statusCode, 409, "não desconecta a si mesmo");

  const r = await batimento(perdido);
  assert.equal(r.statusCode, 401);
  assert.deepEqual(r.json(), { erro: "O coordenador desconectou este aparelho.", motivo: "coordenador" });
  assert.equal((await entrar("embarque", "coletor-novo")).statusCode, 200);
  const gravado = (await pool.query("SELECT encerrada_por, motivo FROM sessoes WHERE id = $1", [d.id])).rows[0];
  assert.deepEqual(gravado, { encerrada_por: "coordenador", motivo: "coordenador" });
});
