// Worker principal: sirve los archivos estáticos (public/) y maneja /api/data
// como proxy seguro hacia KoboToolbox. El token vive como secret (KOBO_TOKEN),
// nunca en el código ni en el navegador.

const KOBO_SERVER = "https://eu.kobotoolbox.org";
const ASSET_UID = "ayNmjvKNvSNZTkQb8uMPPg";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/data") {
      return handleKoboProxy(env);
    }

    // Cualquier otra ruta: sirve el archivo estático correspondiente (index.html, etc.)
    return env.ASSETS.fetch(request);
  }
};

async function handleKoboProxy(env) {
  if (!env.KOBO_TOKEN) {
    return jsonResponse({ error: "Falta configurar el secret KOBO_TOKEN en Cloudflare." }, 500);
  }

  try {
    let allResults = [];
    let nextUrl = `${KOBO_SERVER}/api/v2/assets/${ASSET_UID}/data/?format=json&limit=10000`;
    let safetyCounter = 0;

    // Kobo pagina los resultados (por defecto ~30 por página). Seguimos "next"
    // hasta traer todos los registros, con un límite de seguridad de 20 páginas.
    while (nextUrl && safetyCounter < 20) {
      const res = await fetch(nextUrl, {
        headers: { Authorization: `Token ${env.KOBO_TOKEN}` }
      });

      if (!res.ok) {
        return jsonResponse({ error: `KoboToolbox respondió con estado ${res.status}` }, 502);
      }

      const page = await res.json();
      allResults = allResults.concat(page.results ?? []);
      nextUrl = page.next || null;
      safetyCounter++;
    }

    return jsonResponse(allResults, 200, { "Cache-Control": "public, max-age=300" });

  } catch (err) {
    return jsonResponse({ error: "No se pudo conectar con KoboToolbox.", detail: String(err) }, 500);
  }
}

function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders }
  });
}
