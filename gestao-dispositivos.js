// WMS Beach Bike — Gestão (WEB): DISPOSITIVOS conectados (Fase 1e, login único). Só com o servidor.
// Abre pelo menu do usuário (o círculo com as iniciais), na Gestão de Expedição e na de Montagem.
//
// O separador, o conferente e o embarque ficam em um aparelho de cada vez. Se o coletor foi perdido, quebrou
// ou ficou sem bateria, a pessoa não consegue sair por ele: o coordenador desconecta aqui e ela entra em outro.
// O aparelho desconectado volta para o login no próximo contato. O que ele ainda não tinha enviado fica guardado
// nele e vai quando alguém entrar de novo nele (a coluna "não enviadas" avisa quantas eram no último contato).
import { esc as escapar } from "./js/util.js";
import { PERFIS } from "./js/sessao.js";
import { buscarDispositivos, desconectarDispositivo } from "./js/dados/quadro.js";
import { PERFIS_DE_UM_APARELHO } from "./compartilhado/regras/login-unico.js";

const esc = (s) => escapar(s ?? "");
const SEM_CONTATO_MS = 90_000;
const hora = (iso) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
const haQuanto = (ms) => { const m = Math.floor(Math.max(0, ms) / 60_000); return m < 1 ? "agora" : m < 60 ? `há ${m} min` : `há ${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`; };

// abrirJanela(html) / fecharJanela() / toast(msg): os da Gestão
export async function abrirDispositivos({ sess, abrirJanela, toast }) {
  abrirJanela(`<h2>Dispositivos</h2><p>Carregando…</p>`);
  const r = await buscarDispositivos(sess);
  if (!r.ok) {
    abrirJanela(`<h2>Dispositivos</h2><p>${esc(r.erro)}</p><div class="m-act"><button class="btn primary" data-close>Fechar</button></div>`);
    return;
  }
  const agora = Date.parse(r.agora);
  const linhas = r.dispositivos.map((d) => {
    const contato = d.ultimo_contato ? agora - Date.parse(d.ultimo_contato) : null;
    const semContato = contato == null || contato > SEM_CONTATO_MS;
    const eu = d.id === r.esta;
    const umAparelho = PERFIS_DE_UM_APARELHO.includes(d.perfil);
    return `<tr>
      <td><b>${esc(d.nome)}</b><small>${esc(PERFIS[d.perfil] || d.perfil)}${eu ? " · este computador" : ""}</small></td>
      <td><code title="${esc(d.aparelho || "")}">${esc(d.aparelho ? d.aparelho.slice(0, 8) : "—")}</code></td>
      <td>${hora(d.criada_em)}</td>
      <td class="${semContato ? "gq-dsp-off" : ""}">${contato == null ? "—" : semContato ? `Sem contato · ${haQuanto(contato)}` : haQuanto(contato)}</td>
      <td>${d.acoes_pendentes ? `<b class="gq-dsp-pend">${d.acoes_pendentes} não enviada(s)</b>` : "—"}</td>
      <td>${eu ? "" : `<button class="btn ghost" data-gqdesc="${d.id}" data-nome="${esc(d.nome)}" data-pend="${d.acoes_pendentes}"${umAparelho ? "" : ' title="Pode estar em vários aparelhos ao mesmo tempo"'}>Desconectar</button>`}</td>
    </tr>`;
  }).join("");
  abrirJanela(`<h2>Dispositivos conectados</h2>
    <p>Separador, conferente e embarque ficam em <b>um aparelho de cada vez</b>. Coletor perdido ou quebrado: desconecte aqui para a pessoa entrar em outro.</p>
    <div class="gq-dsp"><table>
      <thead><tr><th>Quem</th><th>Aparelho</th><th>Desde</th><th>Último contato</th><th>Ações</th><th></th></tr></thead>
      <tbody>${linhas || `<tr><td colspan="6">Nenhum aparelho conectado.</td></tr>`}</tbody>
    </table></div>
    <div class="m-act"><button class="btn ghost" id="gqDspAtualizar">Atualizar</button><button class="btn primary" data-close>Fechar</button></div>`);
  const m = document.querySelector("#modal");
  m.classList.add("wide");
  m.querySelector("#gqDspAtualizar").onclick = () => abrirDispositivos({ sess, abrirJanela, toast });
  m.querySelectorAll("[data-gqdesc]").forEach((b) => (b.onclick = async () => {
    const pend = Number(b.dataset.pend);
    const aviso = `Desconectar ${b.dataset.nome} deste aparelho?`
      + (pend ? `\n\nNo último contato, o aparelho tinha ${pend} ação(ões) que ainda não chegaram ao servidor. Elas ficam guardadas nele e vão quando alguém entrar de novo nele.` : "");
    if (!window.confirm(aviso)) return;
    const x = await desconectarDispositivo(sess, b.dataset.gqdesc);
    if (!x.ok) return toast(x.erro);
    toast(`${b.dataset.nome} desconectado · já pode entrar em outro aparelho`);
    abrirDispositivos({ sess, abrirJanela, toast });
  }));
}
