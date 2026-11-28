// WMS Beach Bike — Gestão de Estoque (WEB), aba IMPRESSORAS (v81): as impressoras de etiqueta da rede.
// O gestor cadastra cada Argox (nome, setor, IP, porta), desativa a que saiu de uso e manda um "Imprimir teste".
// O servidor é quem fala com a impressora; por isso a aba só funciona com o servidor.
// Também fica aqui a escolha da impressora ao reimprimir etiquetas na Gestão (a mesma lista do coletor).
import { esc } from "./js/util.js";
import { listarImpressoras, salvarImpressora, imprimirTeste, imprimirNaImpressora, ultimaImpressora, lembrarImpressora } from "./js/dados/impressoras.js";
import { validarImpressora, PORTA_PADRAO, MODELOS_DE_IMPRESSORA } from "./compartilhado/regras/impressoras.js";

// funções da tela principal (modal, toast, render), entregues por gestao-estoque.js
let tela;
export function iniciarImpressoras(funcoes) { tela = funcoes; }

let sess = null;          // com servidor: a sessão do gestor
let lista = null;         // a última lista lida do servidor (null = ainda lendo)
let erro = "";
export function ligarImpressorasNoServidor(sessao) { sess = sessao; }

async function carregar() {
  const r = await listarImpressoras(sess);
  lista = r.ok ? r.impressoras : []; erro = r.ok ? "" : r.erro;
  tela.render();
}

export function telaImpressoras() {
  const cabeca = `<div class="ge-head">
    <div><h1>Impressoras</h1><p class="ge-sub">Impressoras de etiqueta da rede (Argox, 80 × 60 mm). O coletor escolhe uma delas ao imprimir.</p></div>
    ${sess ? `<div class="ge-actions"><button class="btn primary" id="btNovaImpressora">Nova impressora</button></div>` : ""}
  </div>`;
  if (!sess) return cabeca + `<div class="ge-card"><p class="ge-vazio">As impressoras da rede funcionam só com o servidor. Na demonstração, as etiquetas saem pela impressão do navegador.</p></div>`;
  if (lista === null) { carregar(); return cabeca + `<div class="ge-card"><p class="ge-vazio">Carregando…</p></div>`; }
  return cabeca + (erro ? `<p class="ge-msg">${esc(erro)}</p>` : "") + `<div class="ge-card">
    <table class="ge-tab">
      <thead><tr><th>Nome</th><th>Setor</th><th>IP</th><th class="r">Porta</th><th>Modelo</th><th>Etiqueta</th><th>Situação</th><th class="r"></th></tr></thead>
      <tbody>${lista.map((p) => `<tr>
        <td><b>${esc(p.nome)}</b></td><td>${esc(p.setor || "—")}</td><td class="mono">${esc(p.ip)}</td><td class="r mono">${p.porta}</td>
        <td>${esc(MODELOS_DE_IMPRESSORA[p.modelo] || p.modelo)}</td><td>${p.larguraMm} × ${p.alturaMm} mm</td>
        <td>${p.ativa ? `<span class="ge-sit ok">Ativa</span>` : `<span class="ge-sit off">Desativada</span>`}</td>
        <td class="r"><button class="ge-link" data-testeimp="${p.id}"${p.ativa ? "" : " disabled"}>Imprimir teste</button> <button class="ge-link" data-editimp="${p.id}">Editar</button></td>
      </tr>`).join("") || `<tr><td colspan="8" class="ge-vazio">Nenhuma impressora cadastrada. Use "Nova impressora".</td></tr>`}</tbody>
    </table>
  </div>`;
}

function formulario(p) {
  const v = p || { nome: "", setor: "", ip: "", porta: PORTA_PADRAO, larguraMm: 80, alturaMm: 60, ativa: true };
  tela.abrirModal(`<h2>${p ? "Editar impressora" : "Nova impressora"}</h2>
    <form id="fImpressora" data-id="${p?.id || ""}" class="ge-form">
      <label class="field"><span>Nome</span><input name="nome" value="${esc(v.nome)}" maxlength="40" placeholder="Ex.: Argox Doca 1" required></label>
      <label class="field"><span>Setor (opcional)</span><input name="setor" value="${esc(v.setor)}" maxlength="40" placeholder="Ex.: Recebimento"></label>
      <label class="field"><span>IP</span><input name="ip" value="${esc(v.ip)}" inputmode="decimal" placeholder="Ex.: 192.168.1.60" required></label>
      <label class="field"><span>Porta</span><input name="porta" value="${v.porta}" inputmode="numeric" required></label>
      <label class="field"><span>Etiqueta (largura × altura, mm)</span>
        <span class="ge-prn-medida"><input name="larguraMm" value="${v.larguraMm}" inputmode="numeric" required> × <input name="alturaMm" value="${v.alturaMm}" inputmode="numeric" required></span></label>
      <label class="ge-prn-ativa"><input type="checkbox" name="ativa"${v.ativa ? " checked" : ""}> Ativa (aparece para o coletor)</label>
      <p id="impErr" class="ge-msg" hidden></p>
      <div class="m-act"><button type="button" class="btn ghost" data-fechar>Cancelar</button><button class="btn primary">Salvar</button></div>
    </form>`);
}

// clique na área da aba; devolve true quando tratou
export function cliqueImpressoras(t) {
  if (t.id === "btNovaImpressora") { formulario(null); return true; }
  if (t.dataset.editimp) { formulario(lista.find((p) => p.id === +t.dataset.editimp)); return true; }
  if (t.dataset.testeimp) {
    const p = lista.find((x) => x.id === +t.dataset.testeimp);
    t.disabled = true; tela.toast(`Mandando o teste para ${p.nome}…`);
    imprimirTeste(sess, p.id).then((r) => { t.disabled = false; tela.toast(r.ok ? `Teste enviado para ${r.impressora}. Confira a etiqueta.` : r.erro); });
    return true;
  }
  return false;
}

// envio do formulário; devolve true quando tratou
export function enviarModalImpressoras(f) {
  if (f.id !== "fImpressora") return false;
  const d = Object.fromEntries(new FormData(f));
  const dados = { nome: d.nome.trim(), setor: d.setor.trim(), ip: d.ip.trim(), porta: Number(d.porta), modelo: "argox-ppla",
    larguraMm: Number(d.larguraMm), alturaMm: Number(d.alturaMm), ativa: !!d.ativa };
  const mostrar = (m) => { const e = document.querySelector("#impErr"); e.hidden = false; e.textContent = m; };
  const problema = validarImpressora(dados);
  if (problema) { mostrar(problema); return true; }
  salvarImpressora(sess, dados, +f.dataset.id || null).then((r) => {
    if (!r.ok) return mostrar(r.erro);
    tela.fecharModal(); tela.toast("Impressora salva"); lista = null; tela.render();
  });
  return true;
}

// ---------- reimprimir na Gestão: escolher a impressora ----------
// etiquetas = os dados para a impressora da rede · html = as mesmas etiquetas para a impressão do navegador
let pedido = null;
export function escolherImpressora(etiquetas, html) {
  const noNavegador = () => { document.querySelector("#printArea").innerHTML = html; window.print(); };
  if (!sess) return noNavegador(); // demonstração: só a impressão do navegador
  pedido = { etiquetas, html };
  tela.abrirModal(`<h2>Imprimir em</h2><p class="ge-sub">${etiquetas.length} etiqueta(s)</p><div id="impLista"><p class="ge-vazio">Carregando…</p></div>
    <div class="m-act"><button class="btn ghost" data-fechar>Cancelar</button><button class="btn ghost" data-impnavegador>Imprimir neste computador</button></div>`);
  listarImpressoras(sess).then((r) => {
    const el = document.querySelector("#impLista"); if (!el) return;
    const ativas = r.ok ? r.impressoras.filter((p) => p.ativa !== false) : [];
    const ultima = ultimaImpressora();
    ativas.sort((a, b) => (b.id === ultima) - (a.id === ultima));
    el.innerHTML = !r.ok ? `<p class="ge-msg">${esc(r.erro)}</p>`
      : ativas.map((p) => `<button class="ge-prn-op" data-impem="${p.id}"><b>${esc(p.nome)}</b><small>${esc(p.setor || "")}${p.id === ultima ? " · última usada" : ""}</small></button>`).join("")
        || `<p class="ge-vazio">Nenhuma impressora ativa. Cadastre na aba Impressoras.</p>`;
  });
}

// clique dentro do modal; devolve true quando tratou
export function cliqueModalImpressoras(t) {
  if (!pedido) return false;
  if (t.dataset.impnavegador !== undefined) {
    const { html } = pedido; pedido = null; tela.fecharModal();
    document.querySelector("#printArea").innerHTML = html; window.print(); return true;
  }
  if (t.dataset.impem) {
    const id = +t.dataset.impem, { etiquetas } = pedido;
    t.disabled = true;
    imprimirNaImpressora(sess, id, etiquetas).then((r) => {
      if (!r.ok) { t.disabled = false; return tela.toast(r.erro); }
      lembrarImpressora(id); pedido = null; tela.fecharModal();
      tela.toast(`${r.enviadas} etiqueta(s) enviada(s) para ${r.impressora}`);
    });
    return true;
  }
  return false;
}
