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

// sessões que ainda valem (não encerradas e dentro do prazo) de um usuário (login único, Fase 1e)
export async function sessoesAtivas(pool, login) {
  const { rows } = await pool.query(
    `SELECT id, aparelho, criada_em, ultimo_contato
       FROM sessoes
      WHERE login = $1 AND encerrada_em IS NULL AND expira_em > now()
      ORDER BY criada_em`,
    [login],
  );
  return rows;
}

// cria a sessão e devolve o token (texto aleatório e impossível de adivinhar).
// O login já conta como o primeiro contato do aparelho (ver registrarContato).
// Entrou de novo no MESMO aparelho: a sessão antiga dele ali termina (motivo "novo-login"),
// para a lista de Dispositivos não mostrar o aparelho duas vezes.
export async function criarSessao(pool, login, aparelho = null) {
  const token = randomBytes(32).toString("base64url");
  await pool.query(
    `UPDATE sessoes SET encerrada_em = now(), encerrada_por = $1, motivo = 'novo-login'
      WHERE login = $1 AND aparelho IS NOT DISTINCT FROM $2 AND encerrada_em IS NULL`,
    [login, aparelho],
  );
  const { rows } = await pool.query(
    `INSERT INTO sessoes (token, login, aparelho, expira_em, ultimo_contato)
     VALUES ($1, $2, $3, now() + make_interval(hours => $4), now())
     RETURNING token, expira_em`,
    [token, login, aparelho, HORAS_DO_TURNO],
  );
  return rows[0];
}

// quem é o dono deste token? (só sessão não encerrada, dentro do prazo e de usuário ativo)
export async function usuarioDaSessao(pool, token) {
  const { rows } = await pool.query(
    `SELECT u.login, u.nome, u.perfil, s.setor, s.id::int AS sessao
       FROM sessoes s
       JOIN usuarios u ON u.login = s.login
      WHERE s.token = $1 AND s.expira_em > now() AND s.encerrada_em IS NULL AND u.ativo`,
    [token],
  );
  return rows[0] || null;
}

// por que este token não vale mais? ("coordenador", "saiu", "novo-login" ou null: vencida ou inventada)
export async function motivoDoFim(pool, token) {
  const { rows } = await pool.query("SELECT motivo FROM sessoes WHERE token = $1 AND encerrada_em IS NOT NULL", [token]);
  return rows[0]?.motivo || null;
}

// o aparelho deu sinal de vida (ação ou batimento): a Gestão mostra "último contato" com esta hora.
// pendentes = quantas ações ainda estavam na fila do aparelho (a tela de Dispositivos mostra)
export async function registrarContato(pool, token, pendentes = null) {
  await pool.query(
    "UPDATE sessoes SET ultimo_contato = now(), acoes_pendentes = coalesce($2, acoes_pendentes) WHERE token = $1",
    [token, pendentes],
  );
}

// encerra uma sessão. Pelo token (o próprio usuário saiu) ou pelo número (o coordenador desconectou).
// Devolve o login do dono, ou null se a sessão não existe ou já tinha terminado.
export async function encerrarSessao(pool, { token = null, id = null }, por, motivo) {
  const { rows } = await pool.query(
    `UPDATE sessoes SET encerrada_em = now(), encerrada_por = $3, motivo = $4
      WHERE (token = $1 OR id = $2) AND encerrada_em IS NULL
      RETURNING login`,
    [token, id, por, motivo],
  );
  return rows[0]?.login || null;
}

// tela de Dispositivos da Gestão: todos os aparelhos conectados agora (o token nunca sai daqui)
export async function listarDispositivos(pool) {
  const { rows } = await pool.query(
    `SELECT s.id::int AS id, s.login, u.nome, u.perfil, s.setor, s.aparelho, s.criada_em, s.ultimo_contato, s.acoes_pendentes
       FROM sessoes s
       JOIN usuarios u ON u.login = s.login
      WHERE s.encerrada_em IS NULL AND s.expira_em > now() AND u.ativo
      ORDER BY u.nome, s.criada_em`,
  );
  return rows;
}
