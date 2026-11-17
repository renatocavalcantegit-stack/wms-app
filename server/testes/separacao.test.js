// Fase 1a: as ações da Separação que chegam pelo /api/sincronizar passam a mudar o pedido no banco.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prepararBancoDeTeste } from "./banco-de-teste.js";
import { criarServidor } from "../src/servidor.js";
import { gerarHash } from "../src/senha.js";
import { USERS } from "../../js/sessao.js";

let pool, app;
const PIN_DE_TESTE = "9090"; // só do segundo separador criado aqui (não é PIN da demonstração)
before(async () => {
  pool = await prepararBancoDeTeste();
  app = criarServidor({ pool });
  // um segundo separador, para os conflitos
  await pool.query("INSERT INTO usuarios (login, nome, perfil, pin_hash) VALUES ('separador2', 'Segundo Separador', 'sep', $1)", [gerarHash(PIN_DE_TESTE)]);
});
after(async () => {
  await app.close();
  await pool.end();
});

const usuario = (perfil) => USERS.find((u) => u.perfil === perfil);
async function entrar(login, pin) {
  return (await app.inject({ method: "POST", url: "/api/login", payload: { login, pin } })).json().token;
}
const entrarSeparador = () => entrar(usuario("sep").login, usuario("sep").pin);
const entrarSeparador2 = () => entrar("separador2", PIN_DE_TESTE);

// cada ação com o seu ID (como o coletor cria) e a hora em que foi feita, um segundo depois da anterior
let relogio = Date.parse("2026-11-17T08:00:00Z");
const acao = (tipo, dados) => ({ id: randomUUID(), tipo, dados, feitaEm: new Date((relogio += 1000)).toISOString() });
const sincronizar = (token, acoes) =>
  app.inject({ method: "POST", url: "/api/sincronizar", headers: { authorization: `Bearer ${token}` }, payload: { acoes } });
const lerPedido = async (id) => (await pool.query("SELECT status, separador, inicio, fim, doca, lote, posicao_lote FROM pedidos WHERE id = $1", [id])).rows[0];
const lerItens = async (id) =>
  (await pool.query("SELECT sequencia, qtd, qtd_separada, status, motivo FROM itens_pedido WHERE pedido_id = $1 ORDER BY sequencia", [id])).rows;
const resultadoGravado = async (id) => (await pool.query("SELECT resultado, motivo, aplicada_em FROM acoes_recebidas WHERE id = $1", [id])).rows[0];

test("pedido inteiro: iniciar, separar cada item (um com falta quebrada) e deixar na doca", async () => {
  const token = await entrarSeparador();
  const itens = await lerItens("PV-10421");
  const lote = [
    acao("separacao.iniciar", { pedido: "PV-10421" }),
    ...itens.map((i, n) => n === 0
      ? acao("separacao.item", { pedido: "PV-10421", sequencia: i.sequencia, qtdSeparada: "1,5", status: "falta", motivo: "Endereço vazio" })
      : acao("separacao.item", { pedido: "PV-10421", sequencia: i.sequencia, qtdSeparada: i.qtd, status: "ok" })),
    acao("separacao.concluir", { pedido: "PV-10421", doca: "R9002-P1-A100-AP101" }),
  ];
  const r = await sincronizar(token, lote);
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.json(), { novas: lote.map((a) => a.id), repetidas: [], recusadas: [] });

  const p = await lerPedido("PV-10421");
  assert.equal(p.status, "concluido");
  assert.equal(p.separador, usuario("sep").login);
  assert.equal(p.doca, "R9002-P1-A100-AP101");
  assert.equal(p.inicio.toISOString(), lote[0].feitaEm); // a hora do coletor, não a da chegada
  assert.equal(p.fim.toISOString(), lote.at(-1).feitaEm);
  const depois = await lerItens("PV-10421");
  assert.deepEqual(depois.map((i) => [i.qtd_separada, i.status]), itens.map((i, n) => (n === 0 ? [1.5, "falta"] : [i.qtd, "ok"])));
  assert.equal(depois[0].motivo, "Endereço vazio");

  const gravada = await resultadoGravado(lote[0].id);
  assert.equal(gravada.resultado, "aplicada");
  assert.ok(gravada.aplicada_em);
});

test("ações chegam fora de ordem no lote: o servidor aplica na ordem em que foram feitas", async () => {
  const token = await entrarSeparador();
  const iniciar = acao("separacao.iniciar", { pedido: "PV-10422" });
  const item = acao("separacao.item", { pedido: "PV-10422", sequencia: 1, qtdSeparada: 50, status: "ok" });
  const r = await sincronizar(token, [item, iniciar]); // o item veio antes no lote, mas foi feito depois
  assert.deepEqual(r.json().recusadas, []);
  assert.deepEqual((await lerItens("PV-10422"))[0].status, "ok");
});

test("dois separadores no mesmo pedido (um estava sem rede): o segundo vira conflito e nada dele é aplicado", async () => {
  const ana = await entrarSeparador(), bruno = await entrarSeparador2();
  await sincronizar(ana, [acao("separacao.iniciar", { pedido: "PV-10423" })]);
  const lote = [acao("separacao.iniciar", { pedido: "PV-10423" }), acao("separacao.item", { pedido: "PV-10423", sequencia: 1, qtdSeparada: 10, status: "ok" })];
  const r = (await sincronizar(bruno, lote)).json();
  assert.deepEqual(r.novas, lote.map((a) => a.id)); // as duas foram recebidas (saem da fila do coletor)…
  assert.deepEqual(r.recusadas.map((x) => [x.id, x.resultado]), lote.map((a) => [a.id, "conflito"])); // …mas não aplicadas
  assert.match(r.recusadas[0].motivo, new RegExp(usuario("sep").login));
  assert.equal((await lerPedido("PV-10423")).separador, usuario("sep").login);
  assert.equal((await lerItens("PV-10423"))[0].status, "pendente");
  assert.equal((await resultadoGravado(lote[0].id)).resultado, "conflito"); // fica registrado para o coordenador
});

test("reenvio depois de a resposta se perder: não aplica de novo e repete o resultado de cada ação", async () => {
  const bruno = await entrarSeparador2();
  const lote = [acao("separacao.iniciar", { pedido: "PV-10423" })]; // PV-10423 já está com o outro separador
  const primeira = (await sincronizar(bruno, lote)).json();
  const segunda = (await sincronizar(bruno, lote)).json();
  assert.deepEqual(segunda.repetidas, [lote[0].id]);
  assert.deepEqual(segunda.recusadas, primeira.recusadas);
});

test("ação recusada não impede as outras do mesmo lote", async () => {
  const token = await entrarSeparador();
  const boa = acao("separacao.iniciar", { pedido: "PV-10427" });
  const ruim = acao("separacao.item", { pedido: "PV-10427", sequencia: 99, qtdSeparada: 1, status: "ok" }); // feita depois do iniciar
  const r = (await sincronizar(token, [boa, ruim])).json();
  assert.deepEqual(r.recusadas.map((x) => [x.id, x.resultado]), [[ruim.id, "recusada"]]);
  assert.equal((await lerPedido("PV-10427")).status, "andamento");
});

test("lote de pedidos: cada pedido guarda o lote e a sua caixa", async () => {
  const token = await entrarSeparador();
  await sincronizar(token, [
    acao("separacao.iniciar", { pedido: "PV-10424", lote: "L-1", posicao: "A" }),
    acao("separacao.iniciar", { pedido: "PV-10425", lote: "L-1", posicao: "B" }),
  ]);
  assert.deepEqual([(await lerPedido("PV-10424")).posicao_lote, (await lerPedido("PV-10425")).posicao_lote], ["A", "B"]);
  assert.equal((await lerPedido("PV-10425")).lote, "L-1");
});

test("separar novamente: o pedido concluído volta zerado para quem reabriu", async () => {
  const bruno = await entrarSeparador2();
  const r = (await sincronizar(bruno, [acao("separacao.reabrir", { pedido: "PV-10421" })])).json();
  assert.deepEqual(r.recusadas, []);
  const p = await lerPedido("PV-10421");
  assert.deepEqual([p.status, p.separador, p.doca, p.fim], ["andamento", "separador2", null, null]);
  assert.ok((await lerItens("PV-10421")).every((i) => i.status === "pendente" && i.qtd_separada === 0));
});

test("só o perfil separador manda ações da Separação", async () => {
  const conferente = await entrar(usuario("conf").login, usuario("conf").pin);
  const a = acao("separacao.iniciar", { pedido: "PV-10428" });
  const r = (await sincronizar(conferente, [a])).json();
  assert.deepEqual(r.recusadas.map((x) => x.resultado), ["recusada"]);
  assert.match(r.recusadas[0].motivo, /PERFIL/);
  assert.equal((await lerPedido("PV-10428")).status, "pendente");
});

test("tipo de ação desconhecido: fica guardado, mas não mexe em nada", async () => {
  const token = await entrarSeparador();
  const a = acao("separacao.leitura", { pedido: "PV-10428", codigo: "7908005911280" });
  const r = (await sincronizar(token, [a])).json();
  assert.deepEqual(r.novas, [a.id]);
  assert.deepEqual(r.recusadas, [{ id: a.id, resultado: "desconhecida", motivo: "TIPO DE AÇÃO DESCONHECIDO: separacao.leitura" }]);
});

test("a lista de pedidos mostra o andamento que veio dos coletores", async () => {
  const token = await entrarSeparador();
  const lista = (await app.inject({ url: "/api/pedidos?setor=exp", headers: { authorization: `Bearer ${token}` } })).json();
  assert.equal(lista.find((p) => p.id === "PV-10423").status, "andamento");
  assert.equal(lista.find((p) => p.id === "PV-10428").status, "pendente");
});
