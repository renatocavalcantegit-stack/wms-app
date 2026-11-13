// Service worker: mantém o app funcionando offline.
const CACHE = "wms-bb-v12";
const V = "?v=12";
const ASSETS = ["./", "index.html", "conferencia.html", "gestao.html", "gestao.css" + V, "gestao.js" + V, "gestao-regras.js" + V, "styles.css" + V, "app.js" + V, "embarque.js" + V, "data.js" + V, "conferencia.css" + V, "conferencia.js" + V, "etiqueta.js" + V, "etiqueta.css" + V, "vendor/qrcode.js" + V, "manifest.json", "assets/logo.png", "assets/icon.svg", "assets/icon-180.png", "assets/icon-192.png", "assets/icon-512.png"];

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
