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
  },
};

export function rotasDeSincronizacao(app, { pool, exigirLogin, tempoReal }) {
  app.post("/api/sincronizar", { preHandler: exigirLogin, schema: { body: corpo } }, async (request) => {
    const acoes = request.body.acoes;
    const { novas, repetidas, recusadas } = acoes.length
      ? await registrarAcoes(pool, request.usuario, acoes)
      : { novas: [], repetidas: [], recusadas: [] }; // só o batimento
    await registrarContato(pool, request.token);
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
