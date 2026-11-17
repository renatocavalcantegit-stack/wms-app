// Cria o banco (se ainda não existe) e aplica, em ordem, os arquivos .sql de db/migracoes/
// que ainda não foram aplicados. Uso: npm run migrar
import { readdir, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { conectar, emTransacao } from "../src/banco.js";

const PASTA = new URL("./migracoes/", import.meta.url);

// cria o banco pelo nome do .env; o nome entra direto no SQL, por isso só aceita letras, números e _
export async function criarBancoSeFaltar(nome) {
  if (!/^[a-z_][a-z0-9_]*$/.test(nome)) throw new Error(`Nome de banco inválido: ${nome}`);
  const admin = conectar("postgres");
  try {
    const existe = (await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [nome])).rowCount > 0;
    if (!existe) await admin.query(`CREATE DATABASE ${nome}`);
    return !existe;
  } finally {
    await admin.end();
  }
}

// aplica as migrações pendentes; devolve a lista das que foram aplicadas agora
export async function migrar(pool) {
  // a tabela "migracoes" lembra quais arquivos já rodaram neste banco
  await pool.query("CREATE TABLE IF NOT EXISTS migracoes (nome text PRIMARY KEY, aplicada_em timestamptz NOT NULL DEFAULT now())");
  const jaAplicadas = new Set((await pool.query("SELECT nome FROM migracoes")).rows.map((r) => r.nome));
  const arquivos = (await readdir(PASTA)).filter((a) => a.endsWith(".sql")).sort();

  const aplicadasAgora = [];
  for (const arquivo of arquivos) {
    if (jaAplicadas.has(arquivo)) continue;
    const sql = await readFile(new URL(arquivo, PASTA), "utf8");
    // cada arquivo roda numa transação: se der erro no meio, o banco fica como estava
    await emTransacao(pool, async (conexao) => {
      await conexao.query(sql);
      await conexao.query("INSERT INTO migracoes (nome) VALUES ($1)", [arquivo]);
    });
    aplicadasAgora.push(arquivo);
  }
  return aplicadasAgora;
}

// rodando direto pelo terminal
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const nome = process.env.PGBANCO;
  if (await criarBancoSeFaltar(nome)) console.log(`Banco "${nome}" criado.`);
  const pool = conectar(nome);
  const aplicadas = await migrar(pool);
  console.log(aplicadas.length ? `Migrações aplicadas: ${aplicadas.join(", ")}` : "Nenhuma migração pendente.");
  await pool.end();
}
