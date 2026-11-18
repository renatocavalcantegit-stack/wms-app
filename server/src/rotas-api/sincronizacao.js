// POST /api/sincronizar — recebe um lote de ações feitas no aparelho (a fila que acumulou enquanto estava sem rede).
// GET  /api/tempo-real   — canal SSE: avisa as telas conectadas quando chegam ações.
//
// Batimento (Fase 1c): com a fila vazia, o coletor manda a lista vazia a cada 30 s. Toda chamada,
// com ou sem ações, grava o último contato do aparelho e avisa a Gestão (evento "contato").
//
// Desde a Fase 1a, cada ação é registrada em acoes_recebidas E aplicada no pedido
// (as da Separação: iniciar, item, concluir, reabrir). Ver consultas/acoes.js.
import { registrarAcoes } from "../consultas/acoes.js";
import { registrarContato } from "../consultas/sessoes.js";
import { registrarPasso } from "../consultas/pedidos.js";

// o que o aparelho manda: { acoes: [{ id, tipo, dados, feitaEm }, ...] }
const corpo = {
  type: "object",
  required: ["acoes"],
  properties: {
    acoes: {
      type: "array",
      maxItems: 500, // lote grande demais é dividido pelo aparelho
      items: {
        type: "object",
        required: ["id", "tipo", "dados", "feitaEm"],
        properties: {
          id: { type: "string", format: "uuid" },      // criado no aparelho (crypto.randomUUID())
          tipo: { type: "string", minLength: 1, maxLength: 100 },
          dados: { type: "object" },
          feitaEm: { type: "string", format: "date-time" },
        },
      },
    },
    // quantas ações o aparelho tinha na fila ao mandar este lote (Fase 1e: a tela de Dispositivos mostra)
    pendentes: { type: "integer", minimum: 0 },
    // o passo do item da vez (v63): 1 = endereço lido, 2 = produto bipado. No lote, um item por caixa da parada.
    // Só para a Gestão acompanhar (a bolinha do item enche aos poucos); não é ação e não muda o pedido.
    passo: {
      type: "object",
      required: ["passo", "itens"],
      properties: {
        passo: { type: "integer", minimum: 1, maximum: 2 },
        itens: {
          type: "array", minItems: 1, maxItems: 6,
          items: {
            type: "object",
            required: ["pedido", "sequencia"],
            properties: { pedido: { type: "string", minLength: 1, maxLength: 40 }, sequencia: { type: "integer", minimum: 1 } },
          },
        },
      },
    },
  },
};

export function rotasDeSincronizacao(app, { pool, exigirLogin, tempoReal }) {
  app.post("/api/sincronizar", { preHandler: exigirLogin, schema: { body: corpo } }, async (request) => {
    const acoes = request.body.acoes;
    const { novas, repetidas, recusadas } = acoes.length
      ? await registrarAcoes(pool, request.usuario, acoes)
      : { novas: [], repetidas: [], recusadas: [] }; // só o batimento
    // o que sobrou na fila do aparelho depois deste lote
    const pendentes = request.body.pendentes == null ? null : Math.max(0, request.body.pendentes - novas.length - repetidas.length);
    await registrarContato(pool, request.token, pendentes);
    // o passo é só acompanhamento: se falhar, as ações (que já foram gravadas) seguem confirmadas para o aparelho
    if (request.body.passo) await registrarPasso(pool, request.usuario.login, request.body.passo).catch((e) => request.log.warn(e, "passo do item não gravado"));
    if (novas.length) tempoReal.avisar("acoes", { login: request.usuario.login, quantidade: novas.length });
    else tempoReal.avisar("contato", { login: request.usuario.login });
    // o aparelho tira da fila tudo o que está em "novas" e em "repetidas": as duas já estão no servidor.
    // "recusadas" diz quais NÃO mudaram o pedido (conflito, recusada, desconhecida) e por quê.
    return { novas, repetidas, recusadas };
  });

  // o EventSource do navegador não envia cabeçalhos, por isso o token vem no endereço (?token=...)
  app.get("/api/tempo-real", { preHandler: exigirLogin }, (request, reply) => {
    tempoReal.conectar(request, reply);
  });
}
