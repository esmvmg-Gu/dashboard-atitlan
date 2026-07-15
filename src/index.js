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
    const headers = { Authorization: `Token ${env.KOBO_TOKEN}` };

    // 1. Traer la definición del formulario (preguntas + opciones) para saber
    //    con certeza cuál es cada campo y traducir códigos de opciones a texto legible,
    //    en vez de adivinar por nombre de columna.
    let schema = null;
    try {
      const assetRes = await fetch(`${KOBO_SERVER}/api/v2/assets/${ASSET_UID}/?format=json`, { headers });
      if (assetRes.ok) {
        const assetJson = await assetRes.json();
        schema = buildSchema(assetJson);
      }
    } catch (e) {
      schema = null; // si falla, seguimos sin esquema y el frontend hace fallback
    }

    // 2. Traer TODOS los registros, siguiendo "next" hasta el final.
    //    Sin límite artificial de páginas (antes se cortaba a las 20 páginas).
    let allResults = [];
    let nextUrl = `${KOBO_SERVER}/api/v2/assets/${ASSET_UID}/data/?format=json`;
    let safety = 0;
    while (nextUrl && safety < 2000) {
      const res = await fetch(nextUrl, { headers });
      if (!res.ok) {
        return jsonResponse({ error: `KoboToolbox respondió con estado ${res.status}` }, 502);
      }
      const page = await res.json();
      allResults = allResults.concat(page.results ?? []);
      nextUrl = page.next || null;
      safety++;
    }

    const records = schema
      ? allResults.map(r => resolveRecord(r, schema))
      : allResults;

    return jsonResponse(
      { records, resolved: !!schema, schema, total: records.length },
      200,
      { "Cache-Control": "public, max-age=300" }
    );

  } catch (err) {
    return jsonResponse({ error: "No se pudo conectar con KoboToolbox.", detail: String(err) }, 500);
  }
}

// Construye un mapa: qué campo del formulario es la fecha, cuál el lugar/observador,
// cuál la cantidad de lluvia, y cuál el tipo de lluvia (con sus opciones reales).
function buildSchema(assetJson) {
  try {
    const survey = (assetJson && assetJson.content && assetJson.content.survey) || [];
    const choices = (assetJson && assetJson.content && assetJson.content.choices) || [];

    function findQuestion(labelRegex, typeRegex) {
      return survey.find(q => {
        if (typeRegex && !typeRegex.test(q.type || "")) return false;
        const label = Array.isArray(q.label) ? (q.label[0] || "") : (q.label || "");
        return labelRegex.test(label) || labelRegex.test(q.name || "");
      });
    }

    const qFecha = findQuestion(/fecha/i, /date/i) || findQuestion(/fecha/i);
    const qLugar = findQuestion(/ubicac|observador|nombre/i);
    const qLluvia = findQuestion(/lluvia|cantidad/i, /decimal|integer/i);
    const qTipo = findQuestion(/tipo/i, /^select_one/i);

    const tipoChoices = {};
    if (qTipo) {
      const listName = qTipo.select_from_list_name ||
        (qTipo.type && qTipo.type.indexOf(" ") > -1 ? qTipo.type.split(" ")[1] : null);
      choices
        .filter(c => c.list_name === listName)
        .forEach(c => {
          tipoChoices[c.name] = Array.isArray(c.label) ? c.label[0] : c.label;
        });
    }

    return {
      fechaKey: qFecha ? qFecha.name : null,
      lugarKey: qLugar ? qLugar.name : null,
      lluviaKey: qLluvia ? qLluvia.name : null,
      tipoKey: qTipo ? qTipo.name : null,
      tipoChoices
    };
  } catch (e) {
    return null;
  }
}

function resolveRecord(r, schema) {
  const fecha = (schema.fechaKey && r[schema.fechaKey]) || r["_submission_time"];
  const lugar = (schema.lugarKey && r[schema.lugarKey]) || null;
  const mm = (schema.lluviaKey && r[schema.lluviaKey]) || null;
  const tipoRaw = (schema.tipoKey && r[schema.tipoKey]) || null;
  const tipo = tipoRaw ? (schema.tipoChoices[tipoRaw] || tipoRaw) : null;

  return { fecha, lugar, mm, tipo };
}

function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders }
  });
}
