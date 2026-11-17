// Guarda contra função usada sem import nas telas (aconteceu na v34: a Separação chamava ehCodigoDoProduto
// sem importar e todo bipe de produto falhava em silêncio). As telas não rodam no Node, então este teste
// lê o texto dos arquivos: para cada função exportada pelas regras e pela camada de dados, quem a CHAMA
// precisa importá-la (ou ter uma função própria com o mesmo nome).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const RAIZ = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const arquivosJs = (pasta) => readdirSync(join(RAIZ, pasta)).filter((f) => f.endsWith(".js")).map((f) => join(pasta, f));

// nomes exportados (export function x / export const x) pelas regras e pela camada de dados
const fontes = [...arquivosJs("compartilhado/regras"), ...arquivosJs("js/dados")];
const exportados = new Set(fontes.flatMap((f) =>
  [...readFileSync(join(RAIZ, f), "utf8").matchAll(/export\s+(?:async\s+)?(?:function|const|let)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1])));

// telas e módulos do front que usam essas funções
const telas = [...arquivosJs("."), ...arquivosJs("js")].filter((f) => !/demo-(catalogo|clientes|estoque-real)\.js$/.test(f));

test("toda função das regras/dados chamada numa tela está importada", () => {
  const faltando = [];
  for (const f of telas) {
    // sem comentários: "sem rota (precisa de ação)" num comentário não é chamada de função
    const src = readFileSync(join(RAIZ, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
    const importados = new Set([...src.matchAll(/import\s*\{([^}]*)\}\s*from/g)]
      .flatMap((m) => m[1].split(",").map((x) => x.trim().split(/\s+as\s+/).pop()).filter(Boolean)));
    for (const nome of exportados) {
      if (!new RegExp(`(?<![\\w$.])${nome.replace(/\$/g, "\\$")}\\s*\\(`).test(src)) continue; // não chama
      if (importados.has(nome)) continue;
      // definida no próprio arquivo (função, const ou parâmetro com o mesmo nome)
      if (new RegExp(`(function\\s+${nome}\\b|(const|let|var)\\s+${nome}\\b|export\\s+(function|const)\\s+${nome}\\b)`).test(src)) continue;
      faltando.push(`${f}: ${nome}`);
    }
  }
  assert.deepEqual(faltando, []);
});
