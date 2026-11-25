// A aba ENTRADA da Gestão de Estoque, de verdade (Estoque no servidor, entrega A · v77).
// GET  /api/estoque/notas?nf=&fornecedor=&de=&ate=&conferencia=&divergencia=&armazenamento=&pagina=1&porPagina=20
//                                                  — a lista, filtrada e paginada no banco, com os indicadores do topo
// GET  /api/estoque/notas/:id                      — o detalhe: itens, conferências, volumes (para reimprimir)
// POST /api/estoque/notas/:id/cancelar-pendente    — { produto }: tira da lista de armazenamento (o saldo fica na doca)
// POST /api/estoque/notas/importar                 — "Buscar notas do ERP" (simulado até o Sankhya ser ligado)
//
// Só o gestor de estoque. Cada mudança avisa as telas pelo canal de tempo real (evento "estoque").
import { listarNotas, detalheDaNota, cancelarPendente, importarNotasDoErp, ErroDaNota, POR_PAGINA } from "../consultas/notas-entrada.js";

const PERFIS_DO_ESTOQUE = ["gest"];
const texto = { type: "string", maxLength: 60 };
const data = { type: "string", pattern: "^([0-9]{4}-[0-9]{2}-[0-9]{2})?$" }; // AAAA-MM-DD ou vazio

export function rotasDoEstoque(app, { pool, exigirLogin, tempoReal }) {
  async function exigirGestorDeEstoque(request, reply) {
    if (!PERFIS_DO_ESTOQUE.includes(request.usuario.perfil)) {
      return reply.code(403).send({ erro: "Só o gestor de estoque mexe nas notas de entrada." });
    }
  }
  const protegida = { preHandler: [exigirLogin, exigirGestorDeEstoque] };
  // a regra recusou: a mensagem vai para a tela
  async function executar(reply, fn, avisar = false) {
    try {
      const r = await fn();
      if (avisar) tempoReal.avisar("estoque", { notas: true });
      return r;
    } catch (erro) {
      if (erro instanceof ErroDaNota) return reply.code(erro.status).send({ erro: erro.message });
      throw erro;
    }
  }

  app.get("/api/estoque/notas", {
    ...protegida,
    schema: {
      querystring: {
        type: "object",
        properties: {
          nf: texto, fornecedor: texto, de: data, ate: data,
          conferencia: { type: "string", enum: ["", "aguardando", "aberta", "conferida"] },
          divergencia: { type: "string", enum: ["", "sem", "com"] },
          armazenamento: { type: "string", enum: ["", "pendente", "parcial", "armazenado"] },
          pagina: { type: "integer", minimum: 1, default: 1 },
          porPagina: { type: "integer", enum: POR_PAGINA, default: 20 },
        },
      },
    },
  }, async (request) => {
    const { pagina, porPagina, ...filtros } = request.query;
    return listarNotas(pool, filtros, pagina, porPagina);
  });

  const comId = { type: "object", required: ["id"], properties: { id: { type: "integer", minimum: 1 } } };
  app.get("/api/estoque/notas/:id", { ...protegida, schema: { params: comId } },
    (request, reply) => executar(reply, () => detalheDaNota(pool, request.params.id)));

  app.post("/api/estoque/notas/:id/cancelar-pendente", {
    ...protegida,
    schema: { params: comId, body: { type: "object", required: ["produto"], properties: { produto: { type: "string", minLength: 1, maxLength: 40 } } } },
  }, (request, reply) => executar(reply,
    () => cancelarPendente(pool, { notaId: request.params.id, produto: request.body.produto, login: request.usuario.login }), true));

  app.post("/api/estoque/notas/importar", protegida, (request, reply) => executar(reply, () => importarNotasDoErp(pool), true));
}
