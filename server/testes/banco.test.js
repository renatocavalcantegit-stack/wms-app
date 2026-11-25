// Migrações e carga da demonstração no banco de teste.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prepararBancoDeTeste } from "./banco-de-teste.js";
import { migrar } from "../db/migrar.js";
import { semear } from "../db/semear.js";
import { estoqueDeDemonstracao, seedSeparacao, seedSeparacaoMont, seedConferencia, seedConferenciaMont } from "../../js/demo-dados.js";
import { USERS } from "../../js/sessao.js";

let pool;
before(async () => { pool = await prepararBancoDeTeste(); });
after(async () => { await pool.end(); });

const contar = async (tabela) => (await pool.query(`SELECT count(*)::int AS n FROM ${tabela}`)).rows[0].n;

test("migrar de novo não aplica nada (cada arquivo roda uma vez só)", async () => {
  assert.deepEqual(await migrar(pool), []);
  const { rows } = await pool.query("SELECT nome FROM migracoes ORDER BY nome");
  assert.deepEqual(rows.map((r) => r.nome), ["001_base.sql", "002_quantidade_quebrada.sql", "003_resultado_das_acoes.sql", "004_painel_ao_vivo.sql", "005_fila_do_separador_e_login_unico.sql", "006_passo_do_item.sql", "007_conferencia.sql", "008_ocorrencias.sql", "009_entrega_da_devolucao.sql", "010_observacao_do_pedido.sql", "011_notas_de_entrada.sql", "012_produto_novo_pela_nota.sql"]);
});

test("a demonstração do banco é a mesma do app", async () => {
  const estoque = estoqueDeDemonstracao();
  assert.equal(await contar("usuarios"), USERS.length);
  assert.equal(await contar("produtos"), estoque.produtos.length);
  assert.equal(await contar("embalagens"), estoque.embalagens.length);
  assert.equal(await contar("enderecos"), estoque.enderecos.length);
  assert.equal(await contar("saldos"), estoque.saldos.length);
  assert.equal(await contar("associacoes"), estoque.associacoes.length);
  assert.equal(await contar("pedidos"), seedSeparacao().length + seedSeparacaoMont().length + seedConferencia().length + seedConferenciaMont().length);
  assert.equal(await contar("conferencias"), seedConferencia().length + seedConferenciaMont().length);
});

test("o PIN não fica guardado no banco", async () => {
  const { rows } = await pool.query("SELECT login, pin_hash FROM usuarios");
  for (const r of rows) {
    const pin = USERS.find((u) => u.login === r.login).pin;
    assert.ok(!r.pin_hash.includes(pin), `PIN de ${r.login} aparece no hash`);
  }
});

test("endereço é identificado pelo ID: a base real tem códigos repetidos", async () => {
  const { rows } = await pool.query("SELECT codigo, count(*)::int AS n FROM enderecos GROUP BY codigo HAVING count(*) > 1");
  assert.ok(rows.length > 0);
});

test("saldo fracionado da base real é guardado sem arredondar e volta como número", async () => {
  const fracionados = estoqueDeDemonstracao().saldos.filter((s) => !Number.isInteger(s.qtd));
  assert.ok(fracionados.length > 0);
  const s = fracionados[0];
  const { rows } = await pool.query("SELECT qtd FROM saldos WHERE endereco_id = $1 AND produto = $2", [s.enderecoId, s.produto]);
  assert.equal(rows[0].qtd, s.qtd);
});

test("item de pedido aceita quantidade quebrada (até 3 casas) e volta como número", async () => {
  await pool.query("INSERT INTO itens_pedido (pedido_id, sequencia, produto, endereco_codigo, qtd, qtd_separada) VALUES ('PV-10421', 98, '122', 'R1', 101.5, 20.935)");
  try {
    const { rows } = await pool.query("SELECT qtd, qtd_separada FROM itens_pedido WHERE pedido_id = 'PV-10421' AND sequencia = 98");
    assert.deepEqual(rows[0], { qtd: 101.5, qtd_separada: 20.935 });
    // mais de 3 casas: o banco arredonda para 3 (a regra do front já recusa antes de chegar aqui)
    await pool.query("UPDATE itens_pedido SET qtd_separada = 1.23456 WHERE pedido_id = 'PV-10421' AND sequencia = 98");
    assert.equal((await pool.query("SELECT qtd_separada FROM itens_pedido WHERE pedido_id = 'PV-10421' AND sequencia = 98")).rows[0].qtd_separada, 1.235);
    // negativo continua recusado (zero pode, desde a v75: item cortado pelo gestor)
    await assert.rejects(pool.query("UPDATE itens_pedido SET qtd = -1 WHERE pedido_id = 'PV-10421' AND sequencia = 98"));
  } finally {
    await pool.query("DELETE FROM itens_pedido WHERE pedido_id = 'PV-10421' AND sequencia = 98");
  }
});

test("pedido dividido guarda de quem é a parte", async () => {
  const { rows } = await pool.query("SELECT pedido_pai, parte_numero, partes_total FROM pedidos WHERE id = 'PV-10426/1'");
  assert.deepEqual(rows[0], { pedido_pai: "PV-10426", parte_numero: 1, partes_total: 2 });
});

test("o banco recusa dado inválido", async () => {
  // saldo negativo
  await assert.rejects(pool.query("INSERT INTO saldos (endereco_id, produto, qtd) VALUES (4123, '122', -1)"));
  // código de barras repetido
  const { rows } = await pool.query("SELECT produto, codigo FROM embalagens WHERE codigo IS NOT NULL LIMIT 1");
  await assert.rejects(pool.query("INSERT INTO embalagens (id, produto, codigo, descricao, qtd) VALUES (999999, $1, $2, 'Cópia', 1)", [rows[0].produto, rows[0].codigo]));
  // item de produto que não existe
  await assert.rejects(pool.query("INSERT INTO itens_pedido (pedido_id, sequencia, produto, endereco_codigo, qtd) VALUES ('PV-10421', 99, 'NAO-EXISTE', 'R1', 1)"));
});

test("semear de novo recomeça a demonstração sem duplicar", async () => {
  await semear(pool);
  assert.equal(await contar("usuarios"), USERS.length);
});
