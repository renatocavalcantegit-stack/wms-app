// IMPRESSORAS de etiqueta da rede (v81).
// GET  /api/impressoras               — gestor de estoque: todas (com IP); estoquista: só as ativas (id, nome, setor)
// POST /api/impressoras               — gestor: cadastra { nome, setor, ip, porta, modelo, larguraMm, alturaMm, ativa }
// PUT  /api/impressoras/:id           — gestor: altera
// POST /api/impressoras/:id/teste     — gestor: imprime uma etiqueta de exemplo
// POST /api/imprimir                  — estoquista ou gestor: { impressora, etiquetas: [{ codigo, tipo, nota, fornecedor, dia }] }
//                                       o servidor monta as etiquetas e manda direto para a impressora (porta 9100)
import { listarImpressoras, salvarImpressora, imprimirEtiquetas, imprimirTeste, ErroDaImpressora } from "../consultas/impressoras.js";
import { MAXIMO_VOLUMES_DE_UMA_VEZ } from "../../../compartilhado/regras/recebimento.js";

const PODEM_IMPRIMIR = ["estq", "gest"];
const curto = (max) => ({ type: "string", maxLength: max });
const impressora = {
  type: "object",
  required: ["nome", "ip"],
  properties: {
    nome: curto(40), setor: curto(40), ip: curto(15), porta: { type: "integer" }, modelo: curto(20),
    larguraMm: { type: "integer" }, alturaMm: { type: "integer" }, ativa: { type: "boolean" },
  },
};

export function rotasDasImpressoras(app, { pool, exigirLogin }) {
  async function exigirGestor(request, reply) {
    if (request.usuario.perfil !== "gest") return reply.code(403).send({ erro: "Só o gestor de estoque cadastra impressoras." });
  }
  async function exigirQuemImprime(request, reply) {
    if (!PODEM_IMPRIMIR.includes(request.usuario.perfil)) return reply.code(403).send({ erro: "Este perfil não imprime etiquetas." });
  }
  async function executar(reply, fn) {
    try { return await fn(); } catch (erro) {
      if (erro instanceof ErroDaImpressora) return reply.code(erro.status).send({ erro: erro.message });
      throw erro;
    }
  }
  const comId = { type: "object", required: ["id"], properties: { id: { type: "integer", minimum: 1 } } };

  app.get("/api/impressoras", { preHandler: [exigirLogin, exigirQuemImprime] },
    (request) => listarImpressoras(pool, { apenasAtivas: request.usuario.perfil !== "gest" }));
  app.post("/api/impressoras", { preHandler: [exigirLogin, exigirGestor], schema: { body: impressora } },
    (request, reply) => executar(reply, () => salvarImpressora(pool, request.body)));
  app.put("/api/impressoras/:id", { preHandler: [exigirLogin, exigirGestor], schema: { params: comId, body: impressora } },
    (request, reply) => executar(reply, () => salvarImpressora(pool, request.body, request.params.id)));
  app.post("/api/impressoras/:id/teste", { preHandler: [exigirLogin, exigirGestor], schema: { params: comId } },
    (request, reply) => executar(reply, () => imprimirTeste(pool, request.params.id)));

  app.post("/api/imprimir", {
    preHandler: [exigirLogin, exigirQuemImprime],
    schema: {
      body: {
        type: "object",
        required: ["impressora", "etiquetas"],
        properties: {
          impressora: { type: "integer", minimum: 1 },
          etiquetas: {
            type: "array", minItems: 1, maxItems: MAXIMO_VOLUMES_DE_UMA_VEZ,
            items: {
              type: "object", required: ["codigo"],
              properties: { codigo: curto(40), tipo: curto(20), nota: curto(30), fornecedor: curto(80), dia: curto(20) },
            },
          },
        },
      },
    },
  }, (request, reply) => executar(reply, () => imprimirEtiquetas(pool, request.body.impressora, request.body.etiquetas)));
}
