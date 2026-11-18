// SQL de usuários e sessões.
import { randomBytes } from "node:crypto";

// duração da sessão de turno: o aparelho faz login uma vez e segue trabalhando, mesmo sem rede
export const HORAS_DO_TURNO = 14;

export async function buscarUsuario(pool, login) {
  const { rows } = await pool.query(
    "SELECT login, nome, perfil, pin_hash, ativo FROM usuarios WHERE login = $1",
    [login],
  );
  return rows[0] || null;
}

// cria a sessão e devolve o token (texto aleatório e impossível de adivinhar).
// O login já conta como o primeiro contato do aparelho (ver registrarContato).
export async function criarSessao(pool, login) {
  const token = randomBytes(32).toString("base64url");
  const { rows } = await pool.query(
    `INSERT INTO sessoes (token, login, expira_em, ultimo_contato)
     VALUES ($1, $2, now() + make_interval(hours => $3), now())
     RETURNING token, expira_em`,
    [token, login, HORAS_DO_TURNO],
  );
  return rows[0];
}

// quem é o dono deste token? (só sessão dentro do prazo e de usuário ativo)
export async function usuarioDaSessao(pool, token) {
  const { rows } = await pool.query(
    `SELECT u.login, u.nome, u.perfil, s.setor
       FROM sessoes s
       JOIN usuarios u ON u.login = s.login
      WHERE s.token = $1 AND s.expira_em > now() AND u.ativo`,
    [token],
  );
  return rows[0] || null;
}

// o aparelho deu sinal de vida (ação ou batimento): a Gestão mostra "último contato" com esta hora
export async function registrarContato(pool, token) {
  await pool.query("UPDATE sessoes SET ultimo_contato = now() WHERE token = $1", [token]);
}
