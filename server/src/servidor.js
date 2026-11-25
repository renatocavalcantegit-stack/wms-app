// Monta o servidor do WMS: junta as rotas da API, o controle de login e as telas do app.
// Não liga o servidor (quem liga é iniciar.js); assim os testes conseguem montar um servidor com o banco de teste.
import Fastify from "fastify";
import { usuarioDaSessao, motivoDoFim } from "./consultas/sessoes.js";
import { MOTIVOS_DE_FIM } from "../../compartilhado/regras/login-unico.js";
import { criarCanalTempoReal } from "./tempo-real.js";
import { rotasDeLogin } from "./rotas-api/login.js";
import { rotasDeCatalogo } from "./rotas-api/catalogo.js";
import { rotasDePedidos } from "./rotas-api/pedidos.js";
import { rotasDeSincronizacao } from "./rotas-api/sincronizacao.js";
import { rotasDoPainel } from "./rotas-api/painel.js";
import { rotasDosDispositivos } from "./rotas-api/dispositivos.js";
import { rotasDoQuadro } from "./rotas-api/quadro.js";
import { rotasDasOcorrencias } from "./rotas-api/ocorrencias.js";
import { rotasDoEstoque } from "./rotas-api/estoque.js";
import { rotasDasTelas } from "./telas.js";

export function criarServidor({ pool, registrarLog = false }) {
  const app = Fastify({ logger: registrarLog });
  const tempoReal = criarCanalTempoReal();

  // Rotas protegidas usam esta verificação antes de rodar. O token vem no cabeçalho
  // "Authorization: Bearer <token>" ou, no canal de tempo real, em ?token=<token>.
  async function exigirLogin(request, reply) {
    const cabecalho = request.headers.authorization || "";
    const token = cabecalho.startsWith("Bearer ") ? cabecalho.slice(7) : request.query?.token;
    const usuario = token ? await usuarioDaSessao(pool, token) : null;
    if (!usuario) {
      // sessão encerrada (o coordenador desconectou, ou a pessoa saiu): o aparelho mostra o motivo
      const motivo = token ? await motivoDoFim(pool, token) : null;
      return reply.code(401).send({ erro: MOTIVOS_DE_FIM[motivo] || "Faça login novamente.", motivo });
    }
    request.usuario = usuario; // as rotas sabem quem está chamando
    request.token = token;     // e de qual sessão (aparelho): usado para gravar o último contato
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
  rotasDoPainel(app, contexto);
  rotasDosDispositivos(app, contexto);
  rotasDoQuadro(app, contexto);
  rotasDasOcorrencias(app, contexto);
  rotasDoEstoque(app, contexto);
  rotasDasTelas(app); // por último: o que não for /api/... é tela

  // ao desligar o servidor, fecha ANTES as conexões de tempo real: elas não terminam sozinhas
  // (a Gestão deixa o canal aberto) e o servidor ficaria esperando por elas para desligar
  app.addHook("preClose", async () => tempoReal.fechar());
  app.decorate("tempoReal", tempoReal);
  return app;
}
