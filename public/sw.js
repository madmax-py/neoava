// Service worker do NeoAVA: guarda só o "casco" do app (HTML, JS, CSS, fontes, ícones) para abrir
// instalado e sem rede. Nunca guarda nada do AVA: requisições para outros domínios (API, arquivos com
// token) passam direto, sem cópia. Os dados continuam no cache do próprio app (localStorage).

const CACHE = "neoava-shell-v1";
/** Arquivos com hash no nome (/assets/…) nunca mudam; o resto é revalidado. */
const MAX_ASSETS = 80;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(["/", "/manifest.webmanifest", "/favicon.png", "/icon-192.png"]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Página: rede primeiro (pega a versão nova do app); sem rede, a última que abriu.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put("/", copy));
          }
          return res;
        })
        .catch(() => caches.match("/").then((r) => r ?? Response.error())),
    );
    return;
  }

  // Arquivos com hash: do cache, se tiver.
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ??
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy).then(() => trim(c)));
            }
            return res;
          }),
      ),
    );
    return;
  }

  // Ícones, manifesto: mostra o guardado e atualiza por trás.
  event.respondWith(
    caches.match(req).then((hit) => {
      const fresh = fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => hit ?? Response.error());
      return hit ?? fresh;
    }),
  );
});

/** Versões antigas do app deixam arquivos para trás: guarda só os mais recentes. */
async function trim(cache) {
  const assets = (await cache.keys()).filter((r) => new URL(r.url).pathname.startsWith("/assets/"));
  for (const r of assets.slice(0, Math.max(0, assets.length - MAX_ASSETS))) await cache.delete(r);
}
