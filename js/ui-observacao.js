// WMS Beach Bike — pedaços de tela da OBSERVAÇÃO DO PEDIDO (v76), usados pelo coletor, pelo posto,
// pela Gestão (as três gavetas) e pelo embarque. Só monta HTML; quem decide é compartilhado/regras/observacao.js.
// Estilos: classes "obp-" em styles.css.
import { esc } from "./util.js";
import { obrigatoriaPara, descreverCiencia, naoEraPara, TEXTO_DO_PAPEL, temObservacao } from "../compartilhado/regras/observacao.js";

const hora = (iso) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

// o texto do vendedor, em destaque amarelo (o "grifo" do papel). As quebras de linha do Sankhya ficam.
export const caixaDoTexto = (texto) => `<div class="obp-texto">${esc(String(texto ?? "").trim())}</div>`;

// faixa no card do pedido no coletor (lista)
export const faixaDaObservacao = (texto) => (temObservacao(texto) ? `<p class="obp-faixa">📝 Observação do pedido</p>` : "");
// marca no card dos quadros da Gestão
export const marcaDaObservacao = (tem) => (tem ? `<span class="obp-marca" title="Este pedido tem observação do vendedor">📝 Observação</span>` : "");

// para quem a leitura é obrigatória, em palavras ("separador e conferente")
export function paraQuem(texto, para) {
  const lista = obrigatoriaPara(texto, para).map((p) => TEXTO_DO_PAPEL[p]);
  return lista.length ? lista.join(lista.length > 2 ? ", " : " e ").replace(/, ([^,]*)$/, " e $1") : "ninguém";
}

// seção da gaveta da Gestão: o texto, para quem é obrigatória, quem respondeu e o aviso de "Não era para mim"
export function secaoDaObservacao({ texto, para = null, ciencias = [] }) {
  if (!temObservacao(texto)) return "";
  const linhas = ciencias.map((c) => `<li class="${c.resposta === "nao_era" ? "nao" : ""}"><span>${esc(descreverCiencia(c))}</span><time>${hora(c.feita_em)}</time></li>`).join("");
  const avisos = naoEraPara(ciencias).map((c) => `<p class="obp-alerta">⚠ ${esc(c.nome || c.login)} respondeu "Não era para mim" (${esc(TEXTO_DO_PAPEL[c.papel] || c.papel)}): confira se quem precisava ler recebeu a informação.</p>`).join("");
  return `<section class="obp-secao">
    <h4 class="dr-h">Observação do pedido <span class="obp-para">· obrigatória para ${esc(paraQuem(texto, para))}</span></h4>
    ${caixaDoTexto(texto)}
    ${linhas ? `<ul class="obp-respostas">${linhas}</ul>` : `<p class="obp-ninguem">Ninguém respondeu ainda.</p>`}
    ${avisos}
  </section>`;
}
