// Fila de envio do coletor: cada ação fica guardada no aparelho até o servidor confirmar que recebeu.
import "./armazenamento-falso.js";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { limparArmazenamento } from "./armazenamento-falso.js";
import {
  novoId, enfileirar, acoesPendentes, totalPendente, tirarDaFila, lerEstadoDaSincronizacao, gravarEstadoDaSincronizacao,
} from "../js/dados/fila.js";

beforeEach(() => limparArmazenamento());

test("ID de cada ação: UUID v4, diferente a cada vez (o servidor usa para não aplicar duas vezes)", () => {
  const a = novoId(), b = novoId();
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(a, b);
});

test("enfileirar guarda a ação com ID, hora e o login de quem fez", () => {
  const quando = new Date("2026-11-17T10:00:00Z");
  const a = enfileirar("separador", "separacao.iniciar", { pedido: "PV-1" }, quando);
  assert.deepEqual(acoesPendentes("separador"), [{ id: a.id, login: "separador", tipo: "separacao.iniciar", dados: { pedido: "PV-1" }, feitaEm: quando.toISOString() }]);
  assert.equal(totalPendente("separador"), 1);
});

test("a fila sobrevive a recarregar a página (está no armazenamento do aparelho)", async () => {
  enfileirar("separador", "separacao.iniciar", { pedido: "PV-1" });
  const recarregado = await import(`../js/dados/fila.js?recarregar=${Date.now()}`);
  assert.equal(recarregado.totalPendente("separador"), 1);
});

test("cada usuário só envia o que ele fez (outro login no mesmo aparelho espera a vez)", () => {
  enfileirar("separador", "separacao.iniciar", { pedido: "PV-1" });
  enfileirar("separador2", "separacao.iniciar", { pedido: "PV-2" });
  assert.deepEqual(acoesPendentes("separador").map((a) => a.dados.pedido), ["PV-1"]);
  assert.deepEqual(acoesPendentes("separador2").map((a) => a.dados.pedido), ["PV-2"]);
});

test("tirar da fila só o que o servidor confirmou, mantendo a ordem do resto", () => {
  const [a, b, c] = ["PV-1", "PV-2", "PV-3"].map((p) => enfileirar("separador", "separacao.iniciar", { pedido: p }));
  tirarDaFila([b.id, "id-que-nao-existe"]);
  assert.deepEqual(acoesPendentes("separador").map((x) => x.id), [a.id, c.id]);
});

test("estado da sincronização: começa vazio e guarda o que for gravado", () => {
  assert.deepEqual(lerEstadoDaSincronizacao(), { ultimaSincronizacao: null, semRedeDesde: null, sessaoVencida: false, recusadas: [] });
  gravarEstadoDaSincronizacao({ ultimaSincronizacao: "2026-11-17T10:00:00.000Z", semRedeDesde: null, sessaoVencida: false, recusadas: [] });
  assert.equal(lerEstadoDaSincronizacao().ultimaSincronizacao, "2026-11-17T10:00:00.000Z");
});
