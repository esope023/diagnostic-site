// Proxy minimal pour les API qui bloquent le CORS (PVGIS, DRIAS…).
// Déploiement : Cloudflare Workers (offre gratuite).
//   1. npm i -g wrangler && wrangler login
//   2. wrangler deploy worker/pvgis-proxy.js --name diagnostic-proxy
//   3. Mettre l'URL du worker dans .env -> VITE_PROXY_BASE
//
// Usage côté front : `${PROXY_BASE}?url=<url PVGIS encodée>`
// Une allowlist empêche d'en faire un proxy ouvert.

const ALLOWED = ["re.jrc.ec.europa.eu"]; // hôtes autorisés

export default {
  async fetch(request) {
    const { searchParams } = new URL(request.url);
    const target = searchParams.get("url");

    if (!target) {
      return new Response("Paramètre 'url' manquant", { status: 400 });
    }

    let host;
    try {
      host = new URL(target).hostname;
    } catch {
      return new Response("URL invalide", { status: 400 });
    }
    if (!ALLOWED.includes(host)) {
      return new Response("Hôte non autorisé", { status: 403 });
    }

    const upstream = await fetch(target, { headers: { Accept: "application/json" } });
    const body = await upstream.text();

    return new Response(body, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") ?? "application/json",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=86400",
      },
    });
  },
};
