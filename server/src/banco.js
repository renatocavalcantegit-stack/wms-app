// Conexão com o PostgreSQL, usando as configurações do arquivo .env.
import pg from "pg";

// Colunas "numeric" (ex.: saldos.qtd) chegam do PostgreSQL como texto ("101.500"), para não perder precisão
// em números enormes. As quantidades do WMS cabem com folga num número do JavaScript, então converte.
const TIPO_NUMERIC = 1700;
pg.types.setTypeParser(TIPO_NUMERIC, (texto) => Number(texto));

// Um "pool" mantém algumas conexões abertas e reaproveita entre as chamadas da API.
export function conectar(banco = process.env.PGBANCO) {
  return new pg.Pool({
    host: process.env.PGHOST,
    port: Number(process.env.PGPORTA),
    user: process.env.PGUSUARIO,
    password: process.env.PGSENHA,
    database: banco,
  });
}

// Executa `fn` dentro de uma transação: ou tudo dá certo (COMMIT), ou nada fica gravado (ROLLBACK).
export async function emTransacao(pool, fn) {
  const conexao = await pool.connect();
  try {
    await conexao.query("BEGIN");
    const resultado = await fn(conexao);
    await conexao.query("COMMIT");
    return resultado;
  } catch (erro) {
    await conexao.query("ROLLBACK");
    throw erro;
  } finally {
    conexao.release();
  }
}
