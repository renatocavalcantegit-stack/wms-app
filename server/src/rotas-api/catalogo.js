// GET /api/produtos/:codigo — produto pelo código lido (código de barras ou código interno).
import { buscarProdutoPorCodigo } from "../consultas/produtos.js";
import { normalizarCodigo } from "../../../compartilhado/regras/produtos.js";

export function rotasDeCatalogo(app, { pool, exigirLogin }) {
  app.get("/api/produtos/:codigo", { preHandler: exigirLogin }, async (request, reply) => {
    const produto = await buscarProdutoPorCodigo(pool, normalizarCodigo(request.params.codigo));
    if (!produto) return reply.code(404).send({ erro: "Produto não encontrado." });
    return produto;
  });
}
