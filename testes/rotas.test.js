// Regras de rota: horário de corte, dias de embarque e data de embarque de cada pedido.
// Semana usada nos testes (novembro/2026): seg 09 · ter 10 · qua 11 · qui 12 · sex 13 · sáb 14 · dom 15.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Regras } from "./codigo-atual.js";

const { rota, iso, addDays, diffDays, fmtDia, embarca, proximoEmbarque, calcEmbarque, tag, regraTexto } = Regras;

// momento de chegada do pedido, no fuso local (ex.: chegada("2026-11-09", "08:30"))
const chegada = (dia, hora) => new Date(`${dia}T${hora}`).getTime();

test("datas: formato AAAA-MM-DD, soma e diferença de dias", () => {
  assert.equal(iso(new Date(2026, 0, 5)), "2026-01-05");
  assert.equal(addDays("2026-11-30", 1), "2026-12-01");
  assert.equal(addDays("2026-01-01", -1), "2025-12-31");
  assert.equal(diffDays("2026-12-01", "2026-11-30"), 1);
  assert.equal(fmtDia("2026-11-14"), "sáb 14/11");
});

test("rota: busca pelo id, aceita o próprio objeto e devolve null se não existir", () => {
  assert.equal(rota("centro").nome, "Centro");
  const r = rota("messejana");
  assert.equal(rota(r), r);
  assert.equal(rota("nao-existe"), null);
});

test("embarca: rotas diárias de segunda a sexta; sábado só nas marcadas; semanais no dia delas", () => {
  assert.equal(embarca("centro", "2026-11-09"), true); // segunda
  assert.equal(embarca("centro", "2026-11-14"), false); // sábado
  assert.equal(embarca("centro", "2026-11-15"), false); // domingo
  assert.equal(embarca("messejana", "2026-11-14"), true); // sábado, rota com sábado
  assert.equal(embarca("messejana", "2026-11-15"), false); // domingo
  assert.equal(embarca("cascavel", "2026-11-12"), true); // quinta, rota semanal de quinta
  assert.equal(embarca("cascavel", "2026-11-11"), false); // quarta
});

test("proximoEmbarque: pula os dias sem embarque", () => {
  assert.equal(proximoEmbarque("centro", "2026-11-13"), "2026-11-13"); // sexta conta o próprio dia
  assert.equal(proximoEmbarque("centro", "2026-11-13", false), "2026-11-16"); // depois da sexta: segunda
  assert.equal(proximoEmbarque("itaitinga", "2026-11-12"), "2026-11-18"); // depois de quinta: próxima quarta
});

test("calcEmbarque (Centro, corte 09:00): antes do corte embarca hoje", () => {
  assert.deepEqual(calcEmbarque("centro", chegada("2026-11-09", "08:30")), { data: "2026-11-09", fora: false });
  assert.deepEqual(calcEmbarque("centro", chegada("2026-11-09", "09:00")), { data: "2026-11-09", fora: false });
});

test("calcEmbarque (Centro): até 1h depois do corte vai para o próximo dia e fica fora do horário", () => {
  assert.deepEqual(calcEmbarque("centro", chegada("2026-11-09", "09:00:30")), { data: "2026-11-10", fora: true });
  assert.deepEqual(calcEmbarque("centro", chegada("2026-11-09", "09:30")), { data: "2026-11-10", fora: true });
  assert.deepEqual(calcEmbarque("centro", chegada("2026-11-09", "10:00")), { data: "2026-11-10", fora: true });
});

test("calcEmbarque (Centro): mais de 1h depois do corte vai para o próximo dia sem alerta", () => {
  assert.deepEqual(calcEmbarque("centro", chegada("2026-11-09", "10:01")), { data: "2026-11-10", fora: false });
});

test("calcEmbarque (Centro): sexta depois do corte vai para segunda; sábado também", () => {
  assert.deepEqual(calcEmbarque("centro", chegada("2026-11-13", "09:30")), { data: "2026-11-16", fora: true });
  assert.deepEqual(calcEmbarque("centro", chegada("2026-11-14", "08:00")), { data: "2026-11-16", fora: false });
});

test("calcEmbarque (Messejana, corte 12:00, embarca no sábado)", () => {
  assert.deepEqual(calcEmbarque("messejana", chegada("2026-11-13", "12:30")), { data: "2026-11-14", fora: true });
  assert.deepEqual(calcEmbarque("messejana", chegada("2026-11-14", "13:30")), { data: "2026-11-16", fora: false });
});

test("calcEmbarque (Itaitinga, semanal de quarta, corte 13:00)", () => {
  assert.deepEqual(calcEmbarque("itaitinga", chegada("2026-11-09", "08:00")), { data: "2026-11-11", fora: false });
  assert.deepEqual(calcEmbarque("itaitinga", chegada("2026-11-11", "12:59")), { data: "2026-11-11", fora: false });
  assert.deepEqual(calcEmbarque("itaitinga", chegada("2026-11-11", "13:30")), { data: "2026-11-18", fora: true });
  assert.deepEqual(calcEmbarque("itaitinga", chegada("2026-11-12", "08:00")), { data: "2026-11-18", fora: false });
});

test("tag: traduz a data de embarque para a etiqueta da tela", () => {
  const hoje = "2026-11-13"; // sexta
  assert.deepEqual(tag("2026-11-12", hoje), { label: "Atrasado", sub: "qui 12/11", cls: "atrasado" });
  assert.deepEqual(tag("2026-11-13", hoje), { label: "Hoje", sub: "sex 13/11", cls: "hoje" });
  assert.deepEqual(tag("2026-11-14", hoje), { label: "Amanhã", sub: "sáb 14/11", cls: "amanha" });
  assert.deepEqual(tag("2026-11-17", hoje), { label: "Terça", sub: "ter 17/11", cls: "futuro" });
  assert.deepEqual(tag("2026-11-19", hoje), { label: "Quinta", sub: "qui 19/11", cls: "futuro" });
  assert.deepEqual(tag("2026-11-20", hoje), { label: "Próx. semana", sub: "sex 20/11", cls: "semana" });
  assert.deepEqual(tag("2026-11-26", hoje), { label: "Próx. semana", sub: "qui 26/11", cls: "semana" });
  assert.deepEqual(tag("2026-11-27", hoje), { label: "27/11", sub: "sex 27/11", cls: "semana" });
});

test("regraTexto: explicação da regra de cada rota", () => {
  assert.equal(regraTexto("centro"), "Pedidos até 09:00 embarcam hoje; até 10:00 ficam fora do horário para você decidir");
  assert.equal(regraTexto("messejana"),
    "Pedidos até 12:00 embarcam hoje; até 13:00 ficam fora do horário para você decidir · 12h–14h embarca no dia seguinte pela manhã, inclusive sábado");
  assert.equal(regraTexto("itaitinga"), "Rota semanal · embarca na quarta · pedidos até 13:00 de quarta; até 14:00 fica fora do horário");
});
