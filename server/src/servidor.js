// Monta o servidor do WMS: junta as rotas da API e o controle de login.
// Não liga o servidor (quem liga é iniciar.js); assim os testes conseguem montar um servidor com o banco de teste.
import Fastify from "fastify";
import { usuarioDaSessao } from "./consultas/sessoes.js";
import { criarCanalTempoReal } from "./tempo-real.js";
import { rotasDeLogin } from "./rotas-api/login.js";
import { rotasDeCatalogo } from "./rotas-api/catalogo.js";
import { rotasDePedidos } from "./rotas-api/pedidos.js";
import { rotasDeSincronizacao } from "./rotas-api/sincronizacao.js";

export function criarServidor({ pool, registrarLog = false }) {
  const app = Fastify({ logger: registrarLog });
  const tempoReal = criarCanalTempoReal();

  // Rotas protegidas usam esta verificação antes de rodar. O token vem no cabeçalho
  // "Authorization: Bearer <token>" ou, no canal de tempo real, em ?token=<token>.
  async function exigirLogin(request, reply) {
    const cabecalho = request.headers.authorization || "";
    const token = cabecalho.startsWith("Bearer ") ? cabecalho.slice(7) : request.query?.token;
    const usuario = token ? await usuarioDaSessao(pool, token) : null;
    if (!usuario) return reply.code(401).send({ erro: "Faça login novamente." });
    request.usuario = usuario; // as rotas sabem quem está chamando
  }

  // GET /api/saude — o servidor e o banco estão no ar?
  app.get("/api/saude", async () => {
    await pool.query("SELECT 1");
    return { ok: true, hora: new Date().toISOString() };
  });

  const contexto = { pool, exigirLogin, tempoReal };
  rotasDeLogin(app, contexto);
  rotasDeCatalogo(app, contexto);
  rotasDePedidos(app, contexto);
  rotasDeSincronizacao(app, contexto);

  // ao desligar o servidor, fecha as conexões de tempo real
  app.addHook("onClose", async () => tempoReal.fechar());
  app.decorate("tempoReal", tempoReal);
  return app;
}
