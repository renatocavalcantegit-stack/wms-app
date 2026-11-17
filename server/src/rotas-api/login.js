// POST /api/login — usuário + PIN → token da sessão de turno.
import { buscarUsuario, criarSessao } from "../consultas/sessoes.js";
import { conferirPin } from "../senha.js";

const corpo = {
  type: "object",
  required: ["login", "pin"],
  properties: {
    login: { type: "string", maxLength: 50 },
    pin: { type: "string", maxLength: 20 },
  },
};

export function rotasDeLogin(app, { pool }) {
  app.post("/api/login", { schema: { body: corpo } }, async (request, reply) => {
    // mesma regra do login de demonstração: ignora espaços e maiúsculas no usuário
    const login = request.body.login.trim().toLowerCase();
    const usuario = await buscarUsuario(pool, login);

    // a mensagem é a mesma para usuário inexistente e PIN errado: não revela quais usuários existem
    if (!usuario || !usuario.ativo || !conferirPin(request.body.pin.trim(), usuario.pin_hash)) {
      return reply.code(401).send({ erro: "Usuário ou PIN incorretos." });
    }

    const sessao = await criarSessao(pool, usuario.login);
    return { token: sessao.token, expiraEm: sessao.expira_em, login: usuario.login, nome: usuario.nome, perfil: usuario.perfil };
  });
}
