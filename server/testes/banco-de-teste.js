// Prepara o banco de TESTE (PGBANCO_TESTE no .env) do zero: apaga tudo, aplica as migrações e carrega a demonstração.
// Nunca usa o banco do sistema (PGBANCO).
import { conectar } from "../src/banco.js";
import { criarBancoSeFaltar, migrar } from "../db/migrar.js";
import { semear } from "../db/semear.js";

export async function prepararBancoDeTeste() {
  const nome = process.env.PGBANCO_TESTE;
  if (!nome || nome === process.env.PGBANCO) throw new Error("Configure PGBANCO_TESTE no .env com um banco diferente do PGBANCO.");
  await criarBancoSeFaltar(nome);
  const pool = conectar(nome);
  // apaga todas as tabelas do banco de teste e recomeça
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await migrar(pool);
  await semear(pool, { conferencia: true }); // com os pedidos já na conferência (testes da Fase 2)
  return pool;
}
