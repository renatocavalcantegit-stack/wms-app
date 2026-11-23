// Ações da Conferência (Fase 2): o que o servidor faz com cada ação que chega do posto.
import { test } from "node:test";
import assert from "node:assert/strict";
import { avaliarAcaoDaConferencia, temDivergencia, sobrasDaConferencia } from "../compartilhado/regras/acoes-conferencia.js";
import { avaliarAcaoDaSeparacao } from "../compartilhado/regras/acoes-separacao.js";

const T = "2026-11-19T08:00:00.000Z";
const acao = (tipo, dados, login = "conferente") => ({ tipo, dados: { pedido: "PV-1", ...dados }, login, feitaEm: T });
const conf = (x = {}) => ({ pedido: "PV-1", setor: "exp", status: "aguardando", conferente: null, designadoPara: "conferente", ...x });
const esperado = [{ produto: "176", qtd: "10.000" }, { produto: "536", qtd: 4 }];
const OBS = { tipos: { caixa: 2 }, outro: "", atencao: "" };

test("iniciar: só na fila de quem iniciou; o mesmo conferente pode voltar; outro é conflito", () => {
  assert.deepEqual(avaliarAcaoDaConferencia(acao("conferencia.iniciar"), conf()),
    { resultado: "aplicada", conferencia: { status: "andamento", conferente: "conferente", inicio: T }, contagens: [] });
  assert.equal(avaliarAcaoDaConferencia(acao("conferencia.iniciar"), conf({ status: "andamento", conferente: "conferente" })).resultado, "aplicada");
  assert.equal(avaliarAcaoDaConferencia(acao("conferencia.iniciar"), conf({ status: "andamento", conferente: "outro" })).resultado, "conflito");
  assert.equal(avaliarAcaoDaConferencia(acao("conferencia.iniciar"), conf({ designadoPara: "outro" })).motivo, "O COORDENADOR PASSOU O PV-1 PARA OUTRA PESSOA.");
  assert.equal(avaliarAcaoDaConferencia(acao("conferencia.iniciar"), conf({ designadoPara: null })).motivo, "O COORDENADOR TIROU O PV-1 DA SUA FILA.");
  assert.match(avaliarAcaoDaConferencia(acao("conferencia.iniciar"), null).motivo, /NÃO ESTÁ NA CONFERÊNCIA/);
  assert.match(avaliarAcaoDaConferencia(acao("conferencia.iniciar"), conf({ status: "conferido" })).motivo, /CONFERIR NOVAMENTE/);
});

test("contagem: grava o valor atual; produto que não é do pedido vem marcado como fora", () => {
  const c = conf({ status: "andamento", conferente: "conferente" });
  assert.deepEqual(avaliarAcaoDaConferencia(acao("conferencia.contagem", { produto: "176", qtd: "2,5" }), c, esperado).contagens,
    [{ produto: "176", qtd: 2.5, fora: false }]);
  assert.deepEqual(avaliarAcaoDaConferencia(acao("conferencia.contagem", { produto: "999", qtd: 1 }), c, esperado).contagens,
    [{ produto: "999", qtd: 1, fora: true }]);
  assert.equal(avaliarAcaoDaConferencia(acao("conferencia.contagem", { produto: "176", qtd: -1 }), c, esperado).resultado, "recusada");
  assert.equal(avaliarAcaoDaConferencia(acao("conferencia.contagem", { produto: "176", qtd: 1 }), conf(), esperado).resultado, "conflito");
  assert.equal(avaliarAcaoDaConferencia(acao("conferencia.contagem", { produto: "176", qtd: 1 }, "outro"), c, esperado).resultado, "conflito");
});

test("finalizar: as contagens da finalização valem; divergência é decidida no servidor", () => {
  const c = conf({ status: "andamento", conferente: "conferente" });
  const certo = [{ produto: "176", qtd: 10 }, { produto: "536", qtd: 4 }];
  const r = avaliarAcaoDaConferencia(acao("conferencia.finalizar", { volumes: 2, observacao: OBS, posto: "01", contagens: certo }), c, esperado);
  assert.equal(r.resultado, "aplicada");
  assert.deepEqual(r.conferencia, { status: "conferido", fim: T, posto: "01", volumes: 2, observacao: OBS });
  assert.equal(r.zerar, true);
  const falta = avaliarAcaoDaConferencia(acao("conferencia.finalizar", { volumes: 1, observacao: OBS, contagens: [{ produto: "176", qtd: 10 }] }), c, esperado);
  assert.equal(falta.conferencia.status, "divergente");
  // expedição precisa de volumes; montagem não
  assert.match(avaliarAcaoDaConferencia(acao("conferencia.finalizar", { volumes: 0, observacao: OBS, contagens: certo }), c, esperado).motivo, /VOLUMES/);
  const mont = avaliarAcaoDaConferencia(acao("conferencia.finalizar", { contagens: certo }), { ...c, setor: "mont" }, esperado);
  assert.deepEqual([mont.conferencia.status, mont.conferencia.volumes], ["conferido", null]);
  // reenvio da finalização: nada muda
  assert.deepEqual(avaliarAcaoDaConferencia(acao("conferencia.finalizar", { volumes: 2, observacao: OBS }), { ...c, status: "conferido" }, esperado).conferencia, {});
});

test("divergência: falta, excesso ou produto fora do pedido", () => {
  assert.equal(temDivergencia(esperado, [{ produto: "176", qtd: "10" }, { produto: "536", qtd: 4 }]), false);
  assert.equal(temDivergencia(esperado, [{ produto: "176", qtd: 11 }, { produto: "536", qtd: 4 }]), true);
  assert.equal(temDivergencia(esperado, [{ produto: "176", qtd: 10 }, { produto: "536", qtd: 4 }, { produto: "9", qtd: 1, fora: true }]), true);
});

test("excesso trava: com sobra na caixa o servidor recusa o finalizar (v68)", () => {
  assert.deepEqual(sobrasDaConferencia(esperado, [{ produto: "176", qtd: 10 }, { produto: "536", qtd: 3 }]), []); // falta não é sobra
  assert.deepEqual(sobrasDaConferencia(esperado, [{ produto: "176", qtd: "10.5" }, { produto: "536", qtd: 4 }, { produto: "9", qtd: 2, fora: true }]),
    [{ produto: "176", qtd: 0.5 }, { produto: "9", qtd: 2 }]);
  // pedido dividido: o separado das partes soma
  assert.deepEqual(sobrasDaConferencia([{ produto: "A", qtd: 1 }, { produto: "A", qtd: 2 }], [{ produto: "A", qtd: 3 }]), []);
  const c = conf({ status: "andamento", conferente: "conferente" });
  const excesso = avaliarAcaoDaConferencia(acao("conferencia.finalizar", { volumes: 1, observacao: OBS, contagens: [{ produto: "176", qtd: 11 }, { produto: "536", qtd: 4 }] }), c, esperado);
  assert.deepEqual(excesso, { resultado: "recusada", motivo: "PV-1 TEM EXCESSO: RETIRE DO VOLUME ANTES DE FINALIZAR." });
  const fora = avaliarAcaoDaConferencia(acao("conferencia.finalizar", { volumes: 1, observacao: OBS, contagens: [{ produto: "176", qtd: 10 }, { produto: "9", qtd: 1 }] }), c, esperado);
  assert.equal(fora.resultado, "recusada");
  // produto fora do pedido que já saiu da caixa (contagem 0) não trava
  const zerado = avaliarAcaoDaConferencia(acao("conferencia.finalizar", { volumes: 1, observacao: OBS, contagens: [{ produto: "176", qtd: 10 }, { produto: "536", qtd: 4 }, { produto: "9", qtd: 0 }] }), c, esperado);
  assert.equal(zerado.conferencia.status, "conferido");
});

test("corrigir volumes e conferir novamente: só pedido conferido", () => {
  const feito = conf({ status: "conferido", conferente: "conferente", designadoPara: "conferente" });
  assert.deepEqual(avaliarAcaoDaConferencia(acao("conferencia.volumes", { volumes: 3, observacao: OBS }), feito).conferencia, { volumes: 3, observacao: OBS });
  assert.equal(avaliarAcaoDaConferencia(acao("conferencia.volumes", { volumes: 3, observacao: OBS }), conf({ status: "andamento", conferente: "conferente" })).resultado, "recusada");
  const r = avaliarAcaoDaConferencia(acao("conferencia.reabrir"), feito);
  assert.deepEqual([r.conferencia.status, r.conferencia.fim, r.zerar], ["andamento", null, true]);
  assert.equal(avaliarAcaoDaConferencia(acao("conferencia.reabrir"), conf({ status: "andamento", conferente: "conferente" })).resultado, "recusada");
});

test("separar novamente: recusado depois que a conferência começou", () => {
  const p = { id: "PV-1", status: "concluido", separador: "separador" };
  const reabrir = { tipo: "separacao.reabrir", dados: { pedido: "PV-1" }, login: "separador", feitaEm: T };
  assert.equal(avaliarAcaoDaSeparacao(reabrir, { ...p, statusConferencia: "aguardando" }, []).resultado, "aplicada");
  assert.equal(avaliarAcaoDaSeparacao(reabrir, { ...p, statusConferencia: null }, []).resultado, "aplicada");
  assert.match(avaliarAcaoDaSeparacao(reabrir, { ...p, statusConferencia: "andamento" }, []).motivo, /SENDO CONFERIDO/);
});

// ---------- devolução pedida pelo gestor (v75) ----------
test("devolver: o conferente tira da caixa o que o gestor cortou (nunca mais do que falta); finalizar espera a devolução", () => {
  const c = conf({ status: "andamento", conferente: "conferente", devolver: [{ produto: "176", qtd: "2.000" }] });
  assert.deepEqual(avaliarAcaoDaConferencia(acao("conferencia.devolver", { itens: [{ produto: "176", qtd: 3 }] }), c),
    { resultado: "aplicada", conferencia: {}, contagens: [], devolver: [{ produto: "176", qtd: 2 }] });
  // reenvio depois de já devolvido: nada a fazer
  assert.deepEqual(avaliarAcaoDaConferencia(acao("conferencia.devolver", { itens: [{ produto: "176", qtd: 2 }] }), conf({ status: "andamento", conferente: "conferente" })).devolver, []);
  assert.equal(avaliarAcaoDaConferencia(acao("conferencia.devolver", { itens: [{ produto: "176", qtd: 0 }] }), c).resultado, "recusada");
  assert.equal(avaliarAcaoDaConferencia(acao("conferencia.devolver", { itens: [] }, "outro"), c).resultado, "conflito");
  const fin = avaliarAcaoDaConferencia(acao("conferencia.finalizar", { volumes: 1, observacao: OBS, contagens: [] }), c);
  assert.equal(fin.motivo, "FAÇA A DEVOLUÇÃO DO QUE O GESTOR CORTOU ANTES DE FINALIZAR (F9).");
});

test("pedido cancelado pelo gestor: o posto não mexe mais", () => {
  for (const t of ["conferencia.iniciar", "conferencia.contagem", "conferencia.finalizar"]) {
    assert.equal(avaliarAcaoDaConferencia(acao(t, { produto: "176", qtd: 1 }), conf({ status: "cancelado", conferente: "conferente" })).motivo, "O GESTOR CANCELOU O PV-1.");
  }
});

test("conferencia.entregar: pedido cancelado, o conferente marca a entrega ao estoque", () => {
  const r = avaliarAcaoDaConferencia({ tipo: "conferencia.entregar", dados: { pedido: "PV-1" }, login: "bia" }, { pedido: "PV-1", setor: "exp", status: "cancelado" });
  assert.deepEqual(r, { resultado: "aplicada", conferencia: {}, contagens: [], entregar: true });
  assert.equal(avaliarAcaoDaConferencia({ tipo: "conferencia.entregar", dados: { pedido: "PV-1" }, login: "bia" },
    { pedido: "PV-1", setor: "exp", status: "aguardando" }).resultado, "recusada");
});
