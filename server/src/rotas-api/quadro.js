// O quadro da Separação na Gestão, de verdade (Fase 1e).
// GET  /api/quadro/separacao?setor=exp           — caixa de entrada, filas e separadores
// POST /api/quadro/mover                         — { setor, unidade, para, ordem }: muda o pedido (ou o lote) de fila
// POST /api/quadro/rota                          — { setor, pedido, rota }: define a rota do pedido sem rota
// POST /api/quadro/lotes                         — { setor, pedidos }: agrupa pedidos da caixa num lote
// POST /api/quadro/lotes/:id/desfazer            — { setor }: desfaz o lote que ainda não começou
//
// Só o coordenador do setor mexe: o de expedição no quadro da expedição, o de montagem no da montagem.
// Cada mudança avisa as telas pelo canal de tempo real (evento "quadro"): as outras Gestões redesenham.
// O coletor fica sabendo na próxima vez que baixa a lista (a cada 30 s, ou quando volta para a lista).
import { quadroDaSeparacao, moverNoQuadro, definirRota, criarLote, desfazerLote, ErroDoQuadro } from "../consultas/quadro.js";

const SETOR_DO_PERFIL = { coord: "exp", coordmont: "mont" };
const setor = { type: "string", enum: ["exp", "mont"] };
const codigo = { type: "string", minLength: 1, maxLength: 40 };

export function rotasDoQuadro(app, { pool, exigirLogin, tempoReal }) {
  // roda depois do exigirLogin. O setor vem na consulta (GET) ou no corpo (POST).
  async function exigirCoordenadorDoSetor(request, reply) {
    const s = request.query?.setor ?? request.body?.setor;
    if (SETOR_DO_PERFIL[request.usuario.perfil] !== s) {
      return reply.code(403).send({ erro: "Só o coordenador do setor mexe no quadro." });
    }
  }
  const protegida = { preHandler: [exigirLogin, exigirCoordenadorDoSetor] };

  // a trava devolve a mensagem para a tela (ex.: "PV-10421 já está em separação")
  async function executar(reply, fn, aviso) {
    try {
      const r = await fn();
      tempoReal.avisar("quadro", aviso);
      return r;
    } catch (erro) {
      if (erro instanceof ErroDoQuadro) return reply.code(erro.status).send({ erro: erro.message });
      throw erro;
    }
  }

  app.get("/api/quadro/separacao", {
    ...protegida,
    schema: { querystring: { type: "object", required: ["setor"], properties: { setor } } },
  }, async (request) => quadroDaSeparacao(pool, request.query.setor));

  app.post("/api/quadro/mover", {
    ...protegida,
    schema: {
      body: {
        type: "object",
        required: ["setor", "unidade"],
        properties: {
          setor, unidade: codigo,
          para: { type: ["string", "null"], maxLength: 50 }, // null = caixa de entrada
          ordem: { type: "array", maxItems: 500, items: codigo },
        },
      },
    },
  }, (request, reply) => {
    const { setor: s, unidade, para = null, ordem = [] } = request.body;
    return executar(reply, () => moverNoQuadro(pool, { setor: s, unidade, para, ordem, por: request.usuario.login }), { unidade, para });
  });

  app.post("/api/quadro/rota", {
    ...protegida,
    schema: { body: { type: "object", required: ["setor", "pedido", "rota"], properties: { setor, pedido: codigo, rota: codigo } } },
  }, (request, reply) => executar(reply, () => definirRota(pool, request.body), { pedido: request.body.pedido }));

  app.post("/api/quadro/lotes", {
    ...protegida,
    schema: { body: { type: "object", required: ["setor", "pedidos"], properties: { setor, pedidos: { type: "array", maxItems: 20, items: codigo } } } },
  }, (request, reply) => executar(reply, () => criarLote(pool, request.body), { lote: true }));

  app.post("/api/quadro/lotes/:id/desfazer", {
    ...protegida,
    schema: { body: { type: "object", required: ["setor"], properties: { setor } } },
  }, (request, reply) => executar(reply, () => desfazerLote(pool, { setor: request.body.setor, lote: request.params.id }), { lote: request.params.id }));
}
