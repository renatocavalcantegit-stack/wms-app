// POST /api/login   — usuário + PIN (+ código do aparelho) → token da sessão de turno.
// POST /api/logout  — o usuário saiu do aparelho: a sessão termina no servidor (Fase 1e).
//
// Login único (Fase 1e): separador, conferente e embarque ficam em um aparelho de cada vez.
// Com sessão ativa em OUTRO aparelho, o login é recusado (409) e o aparelho que já está conectado
// segue trabalhando. A regra está em compartilhado/regras/login-unico.js.
import { buscarUsuario, criarSessao, sessoesAtivas, encerrarSessao } from "../consultas/sessoes.js";
import { conferirPin } from "../senha.js";
import { sessaoQueBloqueia, mensagemDeOutroAparelho } from "../../../compartilhado/regras/login-unico.js";

const corpo = {
  type: "object",
  required: ["login", "pin"],
  properties: {
    login: { type: "string", maxLength: 50 },
    pin: { type: "string", maxLength: 20 },
    aparelho: { type: "string", maxLength: 64 }, // criado no aparelho na primeira vez (js/sessao.js)
  },
};

export function rotasDeLogin(app, { pool, exigirLogin, tempoReal }) {
  app.post("/api/login", { schema: { body: corpo } }, async (request, reply) => {
    // mesma regra do login de demonstração: ignora espaços e maiúsculas no usuário
    const login = request.body.login.trim().toLowerCase();
    const aparelho = request.body.aparelho || null;
    const usuario = await buscarUsuario(pool, login);

    // a mensagem é a mesma para usuário inexistente e PIN errado: não revela quais usuários existem
    if (!usuario || !usuario.ativo || !conferirPin(request.body.pin.trim(), usuario.pin_hash)) {
      return reply.code(401).send({ erro: "Usuário ou PIN incorretos." });
    }

    // só depois do PIN certo: quem não sabe o PIN não descobre onde a pessoa está conectada
    const bloqueio = sessaoQueBloqueia(usuario.perfil, await sessoesAtivas(pool, usuario.login), aparelho);
    if (bloqueio) {
      return reply.code(409).send({ erro: mensagemDeOutroAparelho(bloqueio), motivo: "outro-aparelho" });
    }

    const sessao = await criarSessao(pool, usuario.login, aparelho);
    tempoReal.avisar("dispositivos", { login: usuario.login });
    return { token: sessao.token, expiraEm: sessao.expira_em, login: usuario.login, nome: usuario.nome, perfil: usuario.perfil };
  });

  app.post("/api/logout", { preHandler: exigirLogin }, async (request) => {
    await encerrarSessao(pool, { token: request.token }, request.usuario.login, "saiu");
    tempoReal.avisar("dispositivos", { login: request.usuario.login });
    return { ok: true };
  });
}
