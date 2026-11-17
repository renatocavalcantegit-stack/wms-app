// GET /api/pedidos?setor=exp&status=pendente — lista dos pedidos da separação
// GET /api/pedidos/:id                         — um pedido com os itens
import { listarPedidos, buscarPedido } from "../consultas/pedidos.js";

const filtros = {
  type: "object",
  required: ["setor"],
  properties: {
    setor: { type: "string", enum: ["exp", "mont"] },
    status: { type: "string", enum: ["pendente", "andamento", "concluido"] },
  },
};

export function rotasDePedidos(app, { pool, exigirLogin }) {
  app.get("/api/pedidos", { preHandler: exigirLogin, schema: { querystring: filtros } }, async (request) => {
    return listarPedidos(pool, { setor: request.query.setor, status: request.query.status });
  });

  app.get("/api/pedidos/:id", { preHandler: exigirLogin }, async (request, reply) => {
    const pedido = await buscarPedido(pool, request.params.id);
    if (!pedido) return reply.code(404).send({ erro: "Pedido não encontrado." });
    return pedido;
  });
}
