// O servidor entrega as telas do app (Fase 1b): tela e API no mesmo endereço.
// Por quê? O navegador bloqueia uma página https (GitHub Pages) falando com um servidor http da rede interna.
// Servindo as telas daqui, tudo fica no mesmo endereço. O GitHub Pages continua como demonstração.
//
// SEGURANÇA: entrega só o que é do app. Lista do que pode sair:
//   - na raiz: telas (.html), scripts (.js), estilos (.css) e manifest.json;
//   - nas pastas js/, compartilhado/ e assets/.
// Nada mais: nem server/ (tem o .env com a senha do banco), nem .git, node_modules, testes, e2e...
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

const RAIZ = resolve(import.meta.dirname, "..", ".."); // a pasta do projeto (acima de server/)
const PASTAS_DO_APP = ["js", "compartilhado", "assets"];
const TIPOS = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
};

// endereço pedido → arquivo no disco, ou null se não pode ser entregue
export function arquivoDoApp(url) {
  let caminho;
  try { caminho = decodeURIComponent(new URL(url, "http://x").pathname); } catch { return null; }
  if (caminho === "/") caminho = "/index.html";
  const partes = caminho.split("/").filter(Boolean);
  // ".." (subir de pasta), arquivos e pastas escondidos (.env, .git) e barra invertida: nunca
  if (!partes.length || partes.some((p) => p === ".." || p.startsWith(".") || p.includes("\\"))) return null;
  const tipo = extname(caminho);
  if (!TIPOS[tipo]) return null;
  if (partes.length === 1) {
    if (tipo === ".json" && partes[0] !== "manifest.json") return null; // package.json, por exemplo, não
    if (partes[0].endsWith(".config.js")) return null;                 // configuração dos testes
  } else if (!PASTAS_DO_APP.includes(partes[0])) return null;
  const arquivo = resolve(RAIZ, ...partes);
  return arquivo.startsWith(RAIZ + sep) ? arquivo : null; // conferência final: continua dentro da pasta do projeto
}

export function rotasDasTelas(app) {
  // o app pergunta "tem servidor?" lendo este arquivo. No GitHub Pages, o modo.json do repositório diz false.
  app.get("/modo.json", async () => ({ servidor: true }));

  async function entregar(request, reply) {
    const arquivo = arquivoDoApp(request.url);
    if (!arquivo) return reply.code(404).send({ erro: "não encontrado" });
    try {
      const conteudo = await readFile(arquivo);
      // no-cache: o navegador confere se mudou; quem guarda para usar sem rede é o service worker (sw.js)
      return reply.type(TIPOS[extname(arquivo)]).header("cache-control", "no-cache").send(conteudo);
    } catch {
      return reply.code(404).send({ erro: "não encontrado" });
    }
  }
  app.get("/", entregar);
  app.get("/*", entregar); // as rotas /api/... vêm antes: o Fastify escolhe sempre a rota mais específica
}
