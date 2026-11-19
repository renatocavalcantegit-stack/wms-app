// Service worker: mantém o app funcionando offline.
const CACHE = "wms-bb-v69";
const V = "?v=69";
const ASSETS = ["./", "index.html", "conferencia.html", "gestao.html", "montagem.html", "gestao.css" + V, "gestao.js" + V, "styles.css" + V, "app.js" + V, "conferencia.css" + V, "conferencia.js" + V, "etiqueta.css" + V, "vendor/qrcode.js" + V,
  "estoque.html", "gestao-estoque.html", "estoque.css" + V, "estoque.js" + V, "gestao-estoque.css" + V, "gestao-estoque.js" + V, "etiqueta-recebimento.css" + V,
  // módulos importados pelas telas (o import não leva ?v; o service worker busca sempre a versão nova na rede)
  "etiqueta.js", "embarque.js", "js/util.js", "js/ui-coletor.js", "js/som.js", "js/sessao.js", "js/demo-dados.js", "js/demo-catalogo.js", "js/demo-estoque-real.js", "js/demo-clientes.js", "js/dados/separacao.js", "js/dados/conferencia.js", "js/dados/clientes.js",
  "compartilhado/regras/rotas.js", "compartilhado/regras/volumes.js", "compartilhado/regras/etiqueta-volume.js", "compartilhado/regras/produtos.js",
  "js/qr.js", "js/etiqueta-produto.js", "js/dados/estoque.js",
  "compartilhado/regras/enderecos.js", "compartilhado/regras/embalagens.js", "compartilhado/regras/etiqueta-produto.js",
  "estoque-recepcao.js", "gestao-entrada.js", "js/ui-estoque.js", "js/dados/recebimento.js", "js/etiqueta-recebimento.js", "compartilhado/regras/recebimento.js",
  "estoque-movimentacao.js", "gestao-movimentacao.js", "js/dados/movimentacao.js", "compartilhado/regras/movimentacao.js",
  "estoque-inventario.js", "gestao-inventario.js", "js/dados/inventario.js", "compartilhado/regras/inventario.js", "compartilhado/regras/separacao.js",
  "gestao-ocorrencias.js", "js/dados/ocorrencias.js", "js/dados/embarque.js", "compartilhado/regras/ocorrencias.js", "compartilhado/regras/quantidade.js", "js/dados/fila.js", "js/sincronizacao.js", "modo.json",
  "gestao-ao-vivo.js", "js/dados/painel.js", "compartilhado/regras/painel.js", "compartilhado/regras/juntar-pedidos.js", "compartilhado/regras/aguardando.js", "compartilhado/regras/distribuicao.js",
  "js/sair.js", "js/dados/quadro.js", "gestao-separacao-real.js", "gestao-conferencia-real.js", "gestao-dispositivos.js", "compartilhado/regras/login-unico.js", "compartilhado/regras/fila-do-separador.js", "compartilhado/regras/fila-do-conferente.js",
  "manifest.json", "assets/logo.png", "assets/icon.svg", "assets/icon-180.png", "assets/icon-192.png", "assets/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Rede primeiro (pega atualizações), cache como reserva quando estiver offline.
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  // a API do servidor nunca passa pelo cache: login, sincronização e o canal de tempo real (que não termina)
  if (new URL(e.request.url).pathname.includes("/api/")) return;
  e.respondWith(
    // ignora o cache HTTP do navegador para sempre pegar a versão publicada
    (new URL(e.request.url).origin === location.origin
      ? fetch(e.request.url, { cache: "no-cache", credentials: "same-origin" })
      : fetch(e.request))
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
