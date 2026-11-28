// IMPRESSORAS de etiqueta da rede (v81): o cadastro, a etiqueta na linguagem da impressora e o envio.
//
// O navegador do coletor não enxerga as impressoras da rede; o servidor, que está na mesma rede, enxerga.
// Então o coletor pede "imprima estas etiquetas na impressora X" e o servidor monta a etiqueta e manda direto para
// a impressora pela porta 9100 (o "RAW", padrão das impressoras de etiqueta). Só nas impressoras cadastradas.
import net from "node:net";
import { validarImpressora, textoParaEtiqueta, MSG_IMPRESSORA_NAO_ENCONTRADA, msgImpressoraNaoRespondeu } from "../../../compartilhado/regras/impressoras.js";

export class ErroDaImpressora extends Error {
  constructor(mensagem, status = 400) { super(mensagem); this.status = status; }
}

const COLUNAS = `id, nome, setor, ip, porta, modelo, largura_mm AS "larguraMm", altura_mm AS "alturaMm", ativa`;

// gestor: todas, com IP e porta · coletor (apenasAtivas): só as ativas, sem o IP (ele não precisa saber)
export async function listarImpressoras(pool, { apenasAtivas = false } = {}) {
  if (apenasAtivas) return (await pool.query("SELECT id, nome, setor FROM impressoras WHERE ativa ORDER BY setor, nome")).rows;
  return (await pool.query(`SELECT ${COLUNAS} FROM impressoras ORDER BY setor, nome`)).rows;
}

const limpar = (d) => ({
  nome: String(d.nome ?? "").trim(), setor: String(d.setor ?? "").trim().slice(0, 40), ip: String(d.ip ?? "").trim(),
  porta: Number(d.porta ?? 9100), modelo: d.modelo || "argox-ppla", larguraMm: Number(d.larguraMm ?? 80), alturaMm: Number(d.alturaMm ?? 60),
  ativa: d.ativa !== false,
});

// grava (nova, ou a existente quando vem o id). Devolve a impressora gravada.
export async function salvarImpressora(pool, dados, id = null) {
  const d = limpar(dados);
  const erro = validarImpressora(d);
  if (erro) throw new ErroDaImpressora(erro);
  try {
    const valores = [d.nome, d.setor, d.ip, d.porta, d.modelo, d.larguraMm, d.alturaMm, d.ativa];
    const r = id
      ? await pool.query(`UPDATE impressoras SET nome = $1, setor = $2, ip = $3, porta = $4, modelo = $5, largura_mm = $6, altura_mm = $7, ativa = $8
                           WHERE id = $9 RETURNING ${COLUNAS}`, [...valores, id])
      : await pool.query(`INSERT INTO impressoras (nome, setor, ip, porta, modelo, largura_mm, altura_mm, ativa)
                           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING ${COLUNAS}`, valores);
    if (!r.rows[0]) throw new ErroDaImpressora(MSG_IMPRESSORA_NAO_ENCONTRADA, 404);
    return r.rows[0];
  } catch (e) {
    if (e.code === "23505") throw new ErroDaImpressora("JÁ EXISTE UMA IMPRESSORA COM ESTE NOME.", 409);
    throw e;
  }
}

async function impressoraAtiva(pool, id) {
  const p = (await pool.query(`SELECT ${COLUNAS} FROM impressoras WHERE id = $1`, [id])).rows[0];
  if (!p || !p.ativa) throw new ErroDaImpressora(MSG_IMPRESSORA_NAO_ENCONTRADA, 404);
  return p;
}

// ---------- a etiqueta em PPLA (Argox) ----------
// PPLA é a linguagem das Argox (a mesma família do DPL da Datamax). Medidas em décimos de mm (comando "m").
// Cada campo: rotação, fonte (1-8; "E" = código de barras Code 128), multiplicadores, altura do código, linha (a
// partir de baixo) e coluna. A posição pode precisar de ajuste fino depois do primeiro "Imprimir teste" na Argox.
const STX = "\x02";
const n4 = (v) => String(Math.max(0, Math.round(v))).padStart(4, "0");
const texto = (fonte, mult, linha, coluna, t) => `1${fonte}${mult}${mult}000${n4(linha)}${n4(coluna)}${t}`;
const codigoDeBarras = (altura, linha, coluna, t) => `1E32${String(altura).padStart(3, "0")}${n4(linha)}${n4(coluna)}${t}`;

// etiqueta do volume da conferência: { codigo, tipo, nota, fornecedor, dia } (o tamanho vem da impressora)
export function etiquetaDoVolumePpla(e, { alturaMm = 60 } = {}) {
  const topo = alturaMm * 10; // em décimos de mm
  const codigo = textoParaEtiqueta(e.codigo, 30).toUpperCase();
  return [
    `${STX}m`, `${STX}L`, "D11", "H12",
    texto(4, 2, topo - 110, 40, codigo),
    codigoDeBarras(130, topo - 290, 40, codigo),
    texto(4, 1, topo - 360, 40, `NF ${textoParaEtiqueta(e.nota, 20)}   ${textoParaEtiqueta(e.tipo, 12).toUpperCase()}`),
    texto(3, 1, topo - 420, 40, textoParaEtiqueta(e.fornecedor, 34)),
    texto(3, 1, topo - 480, 40, textoParaEtiqueta(e.dia ? `Criado em ${e.dia}` : "", 34)),
    "Q0001", "E", "",
  ].join("\r");
}

// manda os bytes para a impressora (porta 9100). Falha se ela não aceitar a conexão em poucos segundos.
// A Argox atende uma conexão por vez: se ela ainda está ocupada com a anterior, a conexão pode demorar. Por isso
// tenta de novo uma vez. O motivo da falha vai para o registro do servidor ("conectar" ou "enviar").
function enviarUmaVez({ ip, porta }, bytes, tempoMs) {
  return new Promise((resolver, rejeitar) => {
    const s = net.createConnection({ host: ip, port: porta });
    let acabou = false, etapa = "conectar";
    const fim = (erro) => {
      if (acabou) return; acabou = true; s.destroy();
      if (erro) { erro.etapa = etapa; rejeitar(erro); } else resolver();
    };
    s.setTimeout(tempoMs, () => fim(new Error("tempo esgotado")));
    s.on("error", fim);
    s.on("connect", () => { etapa = "enviar"; s.end(bytes, () => fim()); });
  });
}
export async function enviarParaImpressora(impressora, dados, { tempoMs = 4000, log = console } = {}) {
  const bytes = Buffer.from(dados, "latin1");
  try { return await enviarUmaVez(impressora, bytes, tempoMs); } catch (erro) {
    log.warn?.(`impressora ${impressora.nome || impressora.ip}: falhou ao ${erro.etapa} (${erro.code || erro.message})`);
    if (erro.etapa !== "conectar") throw erro; // já recebeu parte: não manda de novo (sairia etiqueta repetida)
  }
  try { return await enviarUmaVez(impressora, bytes, tempoMs); } catch (erro) {
    log.warn?.(`impressora ${impressora.nome || impressora.ip}: falhou de novo ao ${erro.etapa} (${erro.code || erro.message})`);
    throw erro;
  }
}

// imprime as etiquetas dos volumes numa impressora cadastrada e ativa. Devolve { enviadas, impressora }.
export async function imprimirEtiquetas(pool, impressoraId, etiquetas, { enviar = enviarParaImpressora } = {}) {
  const p = await impressoraAtiva(pool, impressoraId);
  const dados = etiquetas.map((e) => etiquetaDoVolumePpla(e, p)).join("");
  try { await enviar(p, dados); } catch { throw new ErroDaImpressora(msgImpressoraNaoRespondeu(p.nome), 502); }
  return { enviadas: etiquetas.length, impressora: p.nome };
}

// "Imprimir teste" do gestor: uma etiqueta de exemplo, para conferir que o servidor alcança a impressora
export async function imprimirTeste(pool, id, opcoes) {
  const p = (await pool.query(`SELECT ${COLUNAS} FROM impressoras WHERE id = $1`, [id])).rows[0];
  if (!p) throw new ErroDaImpressora(MSG_IMPRESSORA_NAO_ENCONTRADA, 404);
  const dia = new Date().toLocaleDateString("pt-BR");
  const exemplo = { codigo: "TESTE-0001", tipo: "Teste", nota: "00000", fornecedor: `Teste da ${p.nome}`, dia };
  const enviar = opcoes?.enviar || enviarParaImpressora;
  try { await enviar(p, etiquetaDoVolumePpla(exemplo, p)); } catch { throw new ErroDaImpressora(msgImpressoraNaoRespondeu(p.nome), 502); }
  return { enviadas: 1, impressora: p.nome };
}
