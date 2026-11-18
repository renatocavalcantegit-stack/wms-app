// GET  /api/painel/separacao?setor=exp          — o painel "Ao vivo" da Gestão (Fase 1c)
// POST /api/painel/nao-aplicadas/:id/vista       — o coordenador marca uma ação não aplicada como vista
//
// Só os coordenadores (expedição e montagem) abrem o painel.
// A tela atualiza quando o canal de tempo real avisa ("acoes", "contato" ou "painel").
import { painelDaSeparacao, marcarComoVista } from "../consultas/painel.js";

const PERFIS_DO_PAINEL = ["coord", "coordmont"];

export function rotasDoPainel(app, { pool, exigirLogin, tempoReal }) {
  // roda depois do exigirLogin: ele já colocou o usuário em request.usuario
  async function exigirCoordenador(request, reply) {
    if (!PERFIS_DO_PAINEL.includes(request.usuario.perfil)) {
      return reply.code(403).send({ erro: "PERFIL SEM PERMISSÃO PARA O PAINEL." });
    }
  }
  const protegida = { preHandler: [exigirLogin, exigirCoordenador] };

  app.get("/api/painel/separacao", {
    ...protegida,
    schema: { querystring: { type: "object", required: ["setor"], properties: { setor: { type: "string", enum: ["exp", "mont"] } } } },
  }, async (request) => painelDaSeparacao(pool, request.query.setor));

  app.post("/api/painel/nao-aplicadas/:id/vista", {
    ...protegida,
    schema: { params: { type: "object", properties: { id: { type: "string", format: "uuid" } } } },
  }, async (request, reply) => {
    const ok = await marcarComoVista(pool, request.params.id, request.usuario.login);
    if (!ok) return reply.code(404).send({ erro: "Ação não encontrada ou já vista." });
    tempoReal.avisar("painel", { vista: request.params.id }); // as outras telas da Gestão tiram da lista também
    return { ok: true };
  });
}
