// A aba OCORRÊNCIAS da Gestão, de verdade (v75): corte de item e cancelamento do pedido.
// GET  /api/ocorrencias?setor=exp                    — o histórico do setor
// GET  /api/ocorrencias/pedido?setor=exp&pedido=…    — o pedido como o gestor vê (etapa, itens, quem está com ele)
// POST /api/ocorrencias                              — { setor, pedido, tipo, cortes, motivo, referencia }
//
// Só o coordenador do setor (o gestor de expedição; na montagem, o de montagem).
// Cada registro avisa as telas pelo canal de tempo real (evento "quadro"): os quadros da Gestão redesenham.
// O coletor e o posto ficam sabendo quando conferem o pedido aberto (a cada 15 s) ou baixam a lista.
import { abrirPedidoDoGestor, listarOcorrencias, registrarOcorrencia, ErroDaOcorrencia } from "../consultas/ocorrencias.js";

const SETOR_DO_PERFIL = { coord: "exp", coordmont: "mont" };
const setor = { type: "string", enum: ["exp", "mont"] };
const codigo = { type: "string", minLength: 1, maxLength: 40 };

export function rotasDasOcorrencias(app, { pool, exigirLogin, tempoReal }) {
  async function exigirCoordenadorDoSetor(request, reply) {
    const s = request.query?.setor ?? request.body?.setor;
    if (SETOR_DO_PERFIL[request.usuario.perfil] !== s) {
      return reply.code(403).send({ erro: "Só o gestor do setor registra ocorrências." });
    }
  }
  const protegida = { preHandler: [exigirLogin, exigirCoordenadorDoSetor] };
  // a regra recusou (pedido cancelado, sem motivo...): a mensagem vai para a tela
  async function executar(reply, fn) {
    try { return await fn(); } catch (erro) {
      if (erro instanceof ErroDaOcorrencia) return reply.code(erro.status).send({ erro: erro.message });
      throw erro;
    }
  }

  app.get("/api/ocorrencias", {
    ...protegida,
    schema: { querystring: { type: "object", required: ["setor"], properties: { setor } } },
  }, async (request) => ({ ocorrencias: await listarOcorrencias(pool, request.query.setor) }));

  app.get("/api/ocorrencias/pedido", {
    ...protegida,
    schema: { querystring: { type: "object", required: ["setor", "pedido"], properties: { setor, pedido: codigo } } },
  }, (request, reply) => executar(reply, async () => ({ pedido: await abrirPedidoDoGestor(pool, request.query.setor, request.query.pedido) })));

  app.post("/api/ocorrencias", {
    ...protegida,
    schema: {
      body: {
        type: "object",
        required: ["setor", "pedido", "tipo", "motivo", "referencia"],
        properties: {
          setor, pedido: codigo,
          tipo: { type: "string", enum: ["corte", "cancelamento"] },
          cortes: { type: "object", maxProperties: 300, additionalProperties: { anyOf: [{ type: "string", maxLength: 20 }, { type: "number" }] } },
          motivo: { type: "string", maxLength: 40 },
          referencia: { type: "string", maxLength: 80 },
        },
      },
    },
  }, (request, reply) => executar(reply, async () => {
    const r = await registrarOcorrencia(pool, request.body, request.usuario);
    tempoReal.avisar("quadro", { pedido: r.ocorrencia.pedido, ocorrencia: true });
    return r;
  }));
}
