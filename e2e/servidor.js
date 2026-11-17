// Servidor de arquivos só para os testes de ponta a ponta (porta 5175, separada da do dia a dia).
// Serve a pasta do projeto como o GitHub Pages serve: arquivo pedido → arquivo devolvido.
// Por que não o "python -m http.server"? Ele às vezes segurava um arquivo sem responder e a página
// ficava em branco, derrubando um teste ao acaso.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";

const RAIZ = resolve(import.meta.dirname, "..");
const PORTA = Number(process.env.PORTA || 5175);
const TIPOS = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
};

createServer(async (req, res) => {
  let caminho = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (caminho.endsWith("/")) caminho += "index.html";
  const arquivo = normalize(join(RAIZ, caminho));
  if (!arquivo.startsWith(RAIZ)) { res.writeHead(403).end(); return; } // nada fora da pasta do projeto
  try {
    const conteudo = await readFile(arquivo);
    res.writeHead(200, { "Content-Type": TIPOS[extname(arquivo)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(conteudo);
  } catch {
    res.writeHead(404).end("não encontrado");
  }
}).listen(PORTA, "127.0.0.1", () => console.log(`testes: http://localhost:${PORTA}`));
