// WMS Beach Bike — a RECEPÇÃO do coletor COM SERVIDOR (Estoque no servidor, entrega B · v78).
//
// Requisito nº 1: a conferência nunca espera a rede. Por isso:
//   1) o coletor BAIXA as notas em aberto (só elas, com os produtos, as embalagens e as docas) e guarda numa chave
//      própria e pequena. A Recepção com servidor nunca lê o Estoque inteiro da demonstração;
//   2) cada confirmação entra na FILA (js/dados/fila.js) como "recepcao.conferir", e o "Finalizar nota" como
//      "recepcao.finalizar". O js/sincronizacao.js manda para o servidor quando houver rede;
//   3) enquanto o servidor não confirma, a confirmação fica numa lista LOCAL que soma ao conferido da tela.
//      Ela sai dessa lista quando o servidor já tem (aparece no que o coletor baixa) ou quando foi recusada.
// A tela usa o mesmo formato de dados da demonstração ({ notas, conferencias, produtos, embalagens, enderecos }),
// então as regras e o desenho da Conferência são os mesmos.
import { gravarNoAparelho, CHAVE_ESTOQUE } from "./armazenamento.js";
import { enfileirar, acoesPendentes } from "./fila.js";
import { codigoDoAparelho } from "../sessao.js";
import { lerQuantidade } from "../../compartilhado/regras/quantidade.js";
import { validarDoca, validarConferencia, codigoDoVolumeDoAparelho, rotuloDaNota } from "../../compartilhado/regras/recebimento.js";

const CHAVE = "wms-bb-recepcao-v1";
const CHAVE_SEQUENCIA = "wms-bb-volume-seq"; // a sequência dos volumes DESTE aparelho (fica mesmo se a cópia das notas for apagada)
export const BAIXAR_A_CADA_MS = 30_000;

// locais: as confirmações feitas aqui que o servidor ainda não mostrou · finalizadas: as notas finalizadas aqui
const VAZIO = { baixadoEm: null, notas: [], conferencias: [], produtos: [], embalagens: [], docas: [], locais: [], finalizadas: [] };
function ler() {
  try { return { ...VAZIO, ...JSON.parse(localStorage.getItem(CHAVE)) }; } catch { return { ...VAZIO }; }
}
// memória cheia: a cópia do Estoque da demonstração não vale nada com servidor, então pode ser apagada para abrir espaço
const gravar = (d) => gravarNoAparelho(CHAVE, JSON.stringify(d), { descartaveis: [CHAVE_ESTOQUE] });

// o que a tela usa (o mesmo formato da demonstração). A nota finalizada aqui aparece como finalizada.
export function lerRecepcao() {
  const d = ler();
  const fechadas = new Set(d.finalizadas.map((f) => f.notaId));
  return {
    notas: d.notas.map((n) => (fechadas.has(n.id) ? { ...n, finalizada: true } : n)),
    conferencias: [...d.conferencias, ...d.locais],
    produtos: d.produtos, embalagens: d.embalagens, enderecos: d.docas, baixadoEm: d.baixadoEm,
  };
}

// ---------- baixar do servidor ----------
// Devolve { ok: true } ou { ok: false, semRede?, sessaoVencida? }. Sem rede, a cópia que já estava fica.
export async function baixarNotas(sessao, buscar = fetch) {
  let r;
  try {
    r = await buscar("api/recepcao/notas", { cache: "no-store", headers: { authorization: `Bearer ${sessao.token}` } });
  } catch { return { ok: false, semRede: true }; }
  if (r.status === 401) return { ok: false, sessaoVencida: true };
  if (!r.ok) return { ok: false };
  const s = await r.json();
  const d = ler();
  const noServidor = new Set(s.conferencias.map((c) => c.acaoId).filter(Boolean));
  const abertas = new Set(s.notas.map((n) => n.id));
  const naFila = new Set(acoesPendentes(sessao.login).map((a) => a.id));
  // Uma confirmação local que já saiu da fila e ainda não aparece no servidor pode só ter chegado depois desta
  // leitura: espera mais uma baixada antes de descartar (na segunda, com certeza foi recusada).
  const manter = (x, jaTem) => {
    if (jaTem || !abertas.has(x.notaId)) return null;
    if (naFila.has(x.acaoId)) return { ...x, ausente: 0 };
    const ausente = (x.ausente || 0) + 1;
    return ausente < 2 ? { ...x, ausente } : null;
  };
  gravar({
    baixadoEm: new Date().toISOString(),
    notas: s.notas, conferencias: s.conferencias, produtos: s.produtos, embalagens: s.embalagens, docas: s.docas,
    locais: d.locais.map((l) => manter(l, noServidor.has(l.acaoId))).filter(Boolean),
    finalizadas: d.finalizadas.map((f) => manter(f, false)).filter(Boolean),
  });
  return { ok: true };
}

// ---------- conferir e finalizar (sem esperar a rede) ----------
const hoje = () => new Date().toLocaleDateString("sv");

// os próximos n códigos de volume deste aparelho (V3FA2C-0001, V3FA2C-0002...)
function proximosCodigos(n) {
  const ultimo = Number(localStorage.getItem(CHAVE_SEQUENCIA)) || 0;
  localStorage.setItem(CHAVE_SEQUENCIA, String(ultimo + n));
  const aparelho = codigoDoAparelho();
  return Array.from({ length: n }, (_, i) => codigoDoVolumeDoAparelho(aparelho, ultimo + 1 + i));
}

// confirma uma quantidade de um produto da nota, na doca lida (as mesmas regras do servidor).
// Devolve { ok, conferencia, volumes } (volumes no formato da etiqueta) ou { ok: false, msg }.
export function conferirNaFila(sessao, { notaId, produto, qtd, volumes, docaId }) {
  const db = lerRecepcao();
  const nota = db.notas.find((n) => n.id === notaId);
  if (!nota) return { ok: false, msg: "Nota não encontrada." };
  const erroDoca = validarDoca(db.enderecos.find((e) => e.id === docaId) || null, nota);
  if (erroDoca) return { ok: false, msg: erroDoca };
  const erro = validarConferencia(nota, { produto, qtd, volumes }, db.conferencias);
  if (erro) return { ok: false, msg: erro };

  const total = Number(volumes), codigos = proximosCodigos(total), quantidade = lerQuantidade(qtd), dia = hoje();
  const acao = enfileirar(sessao.login, "recepcao.conferir",
    { nota: notaId, rotulo: rotuloDaNota(nota), produto, qtd: quantidade, doca: docaId, volumes: codigos, dia });
  const conferencia = { id: `local-${acao.id}`, acaoId: acao.id, notaId, produto, qtd: quantidade, docaId, dia, armazenado: 0, cancelado: 0, volumes: codigos };
  const d = ler();
  gravar({ ...d, locais: [...d.locais, conferencia] });
  return { ok: true, conferencia, volumes: codigos.map((codigo, i) => ({ codigo, notaId, produto, seq: i + 1, total })) };
}

// finaliza a nota: some da lista deste coletor na hora; o servidor registra quem e quando
export function finalizarNaFila(sessao, notaId) {
  const d = ler();
  const nota = d.notas.find((n) => n.id === notaId);
  if (!nota || d.finalizadas.some((f) => f.notaId === notaId)) return { ok: false };
  const acao = enfileirar(sessao.login, "recepcao.finalizar", { nota: notaId, rotulo: rotuloDaNota(nota) });
  gravar({ ...d, finalizadas: [...d.finalizadas, { acaoId: acao.id, notaId }] });
  return { ok: true };
}

// o servidor recusou estas ações: a confirmação (ou a finalização) sai da cópia local
export function descartarRecusadas(ids) {
  const fora = new Set(ids);
  const d = ler();
  if (!d.locais.some((l) => fora.has(l.acaoId)) && !d.finalizadas.some((f) => fora.has(f.acaoId))) return;
  gravar({ ...d, locais: d.locais.filter((l) => !fora.has(l.acaoId)), finalizadas: d.finalizadas.filter((f) => !fora.has(f.acaoId)) });
}

// outra aba mudou a cópia (ex.: a baixada de outra janela)
export function aoMudarRecepcao(fn) {
  window.addEventListener("storage", (e) => { if (e.key === CHAVE) fn(); });
}
