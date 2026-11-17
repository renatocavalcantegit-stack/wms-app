// Inventário físico: sequência C1…C5, situação do item/endereço, fechamento da contagem, sincronização atômica.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  itemEncerrado, proximaContagem, quantidadeConsiderada, statusDoItem, diferenca, statusDoEndereco, contagemDoEndereco,
  previstosDoEndereco, validarProdutoNaContagem, validarQuantidadeContada, fecharContagemDoEndereco, validarNovoInventario,
  podeDecidir, planejarSincronizacao, indicadores, enderecoInventariavel, MSG_PRODUTO_FORA_DO_ENDERECO, MSG_INVENTARIO_FECHADO,
} from "../compartilhado/regras/inventario.js";

const cs = (...q) => q.map((qtd) => ({ qtd }));

test("sequência: C1 = C2 encerra; diferente gera a próxima; C5 é o limite e vale como considerada", () => {
  assert.equal(itemEncerrado(cs()), false);
  assert.equal(itemEncerrado(cs(10)), false);
  assert.equal(proximaContagem(cs(10)), 2);
  assert.equal(itemEncerrado(cs(10, 10)), true);
  assert.equal(quantidadeConsiderada(cs(10, 10)), 10);
  assert.equal(proximaContagem(cs(10, 12)), 3);
  assert.equal(quantidadeConsiderada(cs(10, 12, 12)), 12); // C3 = C2
  assert.equal(proximaContagem(cs(10, 12, 11)), 4);
  assert.equal(itemEncerrado(cs(10, 12, 11, 11)), true); // C4 = C3
  assert.equal(quantidadeConsiderada(cs(1, 2, 3, 4, 5)), 5); // chegou na C5: encerra com a C5
  assert.equal(proximaContagem(cs(1, 2, 3, 4, 5)), null);
  assert.equal(quantidadeConsiderada(cs(10, 12)), null);
});

test("situação do item comparada ao saldo do sistema", () => {
  assert.equal(statusDoItem({ contagens: [] }, 5), "nao_contado");
  assert.equal(statusDoItem({ contagens: cs(4) }, 5), "contando");
  assert.equal(statusDoItem({ contagens: cs(5, 5) }, 5), "ok");
  assert.equal(statusDoItem({ contagens: cs(4, 4) }, 5), "divergente");
  assert.equal(statusDoItem({ contagens: cs(4, 4), decisao: "aprovado" }, 5), "aprovado");
  assert.equal(diferenca({ contagens: cs(4, 4) }, 5), -1);
  assert.equal(diferenca({ contagens: cs(4) }, 5), null);
});

test("endereço: pendente, recontagem, concluído e a contagem da vez", () => {
  assert.equal(statusDoEndereco([{ contagens: [] }]), "pendente");
  assert.equal(statusDoEndereco([{ contagens: cs(3, 3) }, { contagens: cs(2, 4) }]), "recontagem");
  assert.equal(contagemDoEndereco([{ contagens: cs(3, 3) }, { contagens: cs(2, 4) }]), 3);
  assert.equal(statusDoEndereco([{ contagens: cs(3, 3) }]), "concluido");
  assert.equal(contagemDoEndereco([{ contagens: cs(3, 3) }]), null);
  assert.equal(contagemDoEndereco([{ contagens: [] }]), 1);
  // endereço vazio: conclui quando alguém finaliza a contagem dele
  assert.equal(statusDoEndereco([]), "pendente");
  assert.equal(statusDoEndereco([], true), "concluido");
});

test("previstos: saldo maior que zero ou associação; só picking e aéreo ativos entram", () => {
  const saldos = [{ enderecoId: 1, produto: "A", qtd: 3 }, { enderecoId: 1, produto: "B", qtd: 0 }, { enderecoId: 2, produto: "C", qtd: 9 }];
  assert.deepEqual(previstosDoEndereco(1, saldos, [{ enderecoId: 1, produto: "D" }]).sort(), ["A", "D"]);
  assert.equal(enderecoInventariavel({ ativo: true, tipo: "doca" }), false);
  assert.equal(enderecoInventariavel({ ativo: false, tipo: "picking" }), false);
  assert.equal(enderecoInventariavel({ ativo: true, tipo: "aereo" }), true);
});

test("coletor: rotativo só aceita o previsto; completo aceita produto novo; quantidade ≥ 0, quebrada até 3 casas", () => {
  const itens = [{ produto: "A", contagens: [] }, { produto: "B", contagens: cs(2, 2) }];
  assert.equal(validarProdutoNaContagem({ tipo: "rotativo", status: "aberto" }, itens, "X"), MSG_PRODUTO_FORA_DO_ENDERECO);
  assert.equal(validarProdutoNaContagem({ tipo: "rotativo", status: "aberto" }, itens, "A"), null);
  assert.equal(validarProdutoNaContagem({ tipo: "completo", status: "aberto" }, itens, "X"), null);
  assert.match(validarProdutoNaContagem({ tipo: "completo", status: "aberto" }, itens, "B"), /ENCERRADA/);
  assert.equal(validarProdutoNaContagem({ tipo: "completo", status: "finalizado" }, itens, "A"), MSG_INVENTARIO_FECHADO);
  assert.equal(validarQuantidadeContada(0), null);
  assert.ok(validarQuantidadeContada(-1));
  assert.equal(validarQuantidadeContada(1.5), null); // quantidade quebrada vale
  assert.equal(validarQuantidadeContada("101,5"), null); // digitada com vírgula
  assert.ok(validarQuantidadeContada(1.2345)); // mais de 3 casas
  assert.ok(validarQuantidadeContada(""));
});

test("finalizar contagem: soma os incluídos, previsto não bipado conta zero, produto novo entra", () => {
  const itens = [{ produto: "A", contagens: [] }, { produto: "B", contagens: [] }, { produto: "C", contagens: cs(4, 4) }];
  const r = fecharContagemDoEndereco(itens, [{ produto: "A", qtd: 5 }, { produto: "A", qtd: 2 }, { produto: "N", qtd: 3 }]);
  assert.deepEqual(r, [{ produto: "A", qtd: 7, novo: false }, { produto: "B", qtd: 0, novo: false }, { produto: "N", qtd: 3, novo: true }]);
});

test("criar inventário: tipo, descrição e abrangência", () => {
  assert.equal(validarNovoInventario({ tipo: "completo", descricao: "Rua 3001", ruas: [3001] }), null);
  assert.match(validarNovoInventario({ tipo: "completo", descricao: "x", ruas: [] }), /rua/);
  assert.match(validarNovoInventario({ tipo: "rotativo", descricao: "x", pares: [] }), /Selecione/);
  assert.match(validarNovoInventario({ tipo: "rotativo", descricao: " ", pares: [1] }), /descrição/);
});

test("decisão só em item encerrado com divergência e antes de sincronizar", () => {
  const inv = { status: "finalizado" };
  assert.equal(podeDecidir(inv, { contagens: cs(4, 4) }, 5), null);
  assert.match(podeDecidir(inv, { contagens: cs(4) }, 5), /AINDA/);
  assert.match(podeDecidir(inv, { contagens: cs(5, 5) }, 5), /SEM DIVERGÊNCIA/);
  assert.match(podeDecidir({ status: "sincronizado" }, { contagens: cs(4, 4) }, 5), /SINCRONIZADO/);
});

test("sincronização: só aprovados, só depois de finalizar, e atômica (um erro cancela tudo)", () => {
  const ativo = { ativo: true, codigo: "R1" };
  const itens = [
    { produto: "A", enderecoId: 1, endereco: ativo, contagens: cs(4, 4), decisao: "aprovado", saldo: 6 },
    { produto: "B", enderecoId: 1, endereco: ativo, contagens: cs(9, 9), decisao: "rejeitado", saldo: 1 },
    { produto: "C", enderecoId: 1, endereco: ativo, contagens: cs(0, 0), decisao: "aprovado", saldo: 3 },
    { produto: "D", enderecoId: 1, endereco: ativo, contagens: cs(2, 2), decisao: "aprovado", saldo: 2 }, // já bate
  ];
  assert.equal(planejarSincronizacao({ status: "aberto" }, itens).ok, false);
  const r = planejarSincronizacao({ status: "finalizado" }, itens);
  assert.deepEqual(r.ajustes, [
    { produto: "A", enderecoId: 1, antes: 6, delta: -2, depois: 4 },
    { produto: "C", enderecoId: 1, antes: 3, delta: -3, depois: 0 },
  ]);
  const comInativo = [...itens, { produto: "E", enderecoId: 2, endereco: { ativo: false, codigo: "R2" }, contagens: cs(1, 1), decisao: "aprovado", saldo: 0 }];
  const e = planejarSincronizacao({ status: "finalizado" }, comInativo);
  assert.equal(e.ok, false);
  assert.match(e.msg, /NENHUM AJUSTE/);
});

test("indicadores do painel", () => {
  const itens = [
    { enderecoId: 1, previsto: true, contagens: cs(4, 4) },
    { enderecoId: 1, previsto: true, contagens: cs(3, 3), decisao: "aprovado" },
    { enderecoId: 2, previsto: true, contagens: cs(1) },
    { enderecoId: 3, previsto: true, contagens: [] },
  ];
  const k = indicadores(itens, [1, 2, 3, 4], () => 4, { 4: true });
  assert.equal(k.concluidos, 2); assert.equal(k.pendentes, 2); assert.equal(k.pct, 50);
  assert.equal(k.contados, 2); assert.equal(k.naoContados, 2); assert.equal(k.contagens, 5);
  assert.equal(k.aprovados, 1); assert.equal(k.aguardando, 0); assert.equal(k.divergencias, 1);
});

test("finalizar contagem com quantidade quebrada: soma sem erro de vírgula", () => {
  const r = fecharContagemDoEndereco([{ produto: "A", contagens: [] }], [{ produto: "A", qtd: 0.1 }, { produto: "A", qtd: 0.2 }]);
  assert.deepEqual(r, [{ produto: "A", qtd: 0.3, novo: false }]);
});
