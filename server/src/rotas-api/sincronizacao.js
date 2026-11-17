// POST /api/sincronizar — recebe um lote de ações feitas no aparelho (a fila que acumulou enquanto estava sem rede).
// GET  /api/tempo-real   — canal SSE: avisa as telas conectadas quando chegam ações.
//
// Na Fase 0 as ações só ficam REGISTRADAS em acoes_recebidas. Aplicá-las (baixar saldo,
// concluir o pedido...) é o trabalho da Fase 1.
import { registrarAcoes } from "../consultas/acoes.js";

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
    const { novas, repetidas } = await registrarAcoes(pool, request.usuario.login, request.body.acoes);
    if (novas.length) tempoReal.avisar("acoes", { login: request.usuario.login, quantidade: novas.length });
    // o aparelho tira da fila tudo o que está em "novas" e em "repetidas": as duas já estão no servidor
    return { novas, repetidas };
  });

  // o EventSource do navegador não envia cabeçalhos, por isso o token vem no endereço (?token=...)
  app.get("/api/tempo-real", { preHandler: exigirLogin }, (request, reply) => {
    tempoReal.conectar(request, reply);
  });
}
