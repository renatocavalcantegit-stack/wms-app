// GET  /api/dispositivos                 — os aparelhos conectados agora (Fase 1e)
// POST /api/dispositivos/:id/desconectar — o coordenador encerra a sessão de um aparelho
//
// Para quando o coletor foi perdido, quebrou ou ficou sem bateria e a pessoa precisa entrar em outro:
// o login único recusa o aparelho novo até a sessão do antigo terminar.
// Só os coordenadores (expedição e montagem) abrem esta tela.
// O aparelho desconectado fica sabendo no próximo contato (o servidor responde 401 "desconectado")
// e mantém a fila dele: o que não foi enviado vai quando alguém entrar de novo nele.
import { listarDispositivos, encerrarSessao } from "../consultas/sessoes.js";

const PERFIS_DOS_DISPOSITIVOS = ["coord", "coordmont"];

export function rotasDosDispositivos(app, { pool, exigirLogin, tempoReal }) {
  async function exigirCoordenador(request, reply) {
    if (!PERFIS_DOS_DISPOSITIVOS.includes(request.usuario.perfil)) {
      return reply.code(403).send({ erro: "Só o coordenador vê os dispositivos." });
    }
  }
  const protegida = { preHandler: [exigirLogin, exigirCoordenador] };

  app.get("/api/dispositivos", protegida, async (request) => {
    const agora = (await pool.query("SELECT now() AS agora")).rows[0].agora;
    // "esta" = a sessão de quem está olhando (a tela não oferece desconectar a si mesmo)
    return { agora, esta: request.usuario.sessao, dispositivos: await listarDispositivos(pool) };
  });

  app.post("/api/dispositivos/:id/desconectar", {
    ...protegida,
    schema: { params: { type: "object", properties: { id: { type: "integer" } } } },
  }, async (request, reply) => {
    if (request.params.id === request.usuario.sessao) {
      return reply.code(409).send({ erro: "Esta é a sua própria sessão. Para sair, use Sair." });
    }
    const login = await encerrarSessao(pool, { id: request.params.id }, request.usuario.login, "coordenador");
    if (!login) return reply.code(404).send({ erro: "Aparelho não encontrado ou já desconectado." });
    tempoReal.avisar("dispositivos", { login });
    return { ok: true, login };
  });
}
