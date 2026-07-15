// Worker principal: sirve los archivos estáticos (public/) y maneja /api/data
// como proxy seguro hacia KoboToolbox. El token vive como secret (KOBO_TOKEN),
// nunca en el código ni en el navegador.
//
// El formulario "monitoreo" cambió de estructura varias veces con los años,
// así que la cantidad de lluvia y el tipo de lluvia pueden vivir en distintos
// campos según cuándo se envió cada lectura. Este archivo combina todas las
// variantes conocidas (confirmadas contra una exportación real del formulario)
// en un solo valor limpio por registro.

const KOBO_SERVER = "https://eu.kobotoolbox.org";
const ASSET_UID = "ayNmjvKNvSNZTkQb8uMPPg";

// Nombres de campo confirmados contra la exportación XLSX técnica del formulario.
const FECHA_CANDIDATOS = ["_1_Fecha_y_hora_en_q_e_se_toma_la_lectura"];
const LUGAR_CANDIDATOS = ["_2_Ubicaci_n_Nombre_del_observador"];
const MM_DIRECTO_CANDIDATOS = ["_4_cantidad_de_lluvia_mm", "_4_Cantidad_de_lluvia_Plg_mm"];
const PLG_CANDIDATOS = ["_5_cantidad_de_lluvia_en_plg"];
const CONVERSION_CANDIDATOS = ["conversion", "conversion_plg_a_mm", "cantidad_en_mm_es_conversion", "cantidad_en_mm_es_conversion_plg_a_mm"];
const TIPO_CANDIDATOS = ["_6_Tipo_de_lluvia"];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/data") {
      return handleKoboProxy(env);
    }
    if (url.pathname === "/api/debug") {
      return handleDebug(env);
    }

    return env.ASSETS.fetch(request);
  }
};

async function handleKoboProxy(env) {
  if (!env.KOBO_TOKEN) {
    return jsonResponse({ error: "Falta configurar el secret KOBO_TOKEN en Cloudflare." }, 500);
  }

  try {
    const headers = { Authorization: `Token ${env.KOBO_TOKEN}` };

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

    const records = allResults.map(resolveRecord);

    return jsonResponse(
      { records, resolved: true, total: records.length },
      200,
      { "Cache-Control": "public, max-age=300" }
    );

  } catch (err) {
    return jsonResponse({ error: "No se pudo conectar con KoboToolbox.", detail: String(err) }, 500);
  }
}

function primerValor(r, candidatos) {
  for (const k of candidatos) {
    if (r[k] !== undefined && r[k] !== null && r[k] !== "") return r[k];
  }
  return null;
}

function numeroValido(v) {
  if (v === null || v === undefined || v === "" || v === "NaN") return null;
  const n = parseFloat(String(v).replace(",", "."));
  return isNaN(n) ? null : n;
}

function resolveRecord(r) {
  const fecha = primerValor(r, FECHA_CANDIDATOS) || r["_submission_time"];
  const lugar = primerValor(r, LUGAR_CANDIDATOS);

  // Cantidad de lluvia: prioridad mm directo -> conversión ya calculada -> pulgadas * 25.4
  let mm = numeroValido(primerValor(r, MM_DIRECTO_CANDIDATOS));
  if (mm === null) {
    mm = numeroValido(primerValor(r, CONVERSION_CANDIDATOS));
  }
  if (mm === null) {
    const plg = numeroValido(primerValor(r, PLG_CANDIDATOS));
    if (plg !== null) mm = Math.round(plg * 25.4 * 100) / 100;
  }

  // Tipo de lluvia: quitar prefijo numérico de versiones viejas del formulario (ej. "1__nublado" -> "nublado")
  let tipo = primerValor(r, TIPO_CANDIDATOS);
  if (tipo) tipo = String(tipo).replace(/^\d+__/, "");

  return { fecha, lugar, mm, tipo };
}

// Ruta de diagnóstico: confirma qué candidatos de campo sí tienen datos reales,
// sin tener que descargar el archivo completo.
async function handleDebug(env) {
  if (!env.KOBO_TOKEN) {
    return jsonResponse({ error: "Falta configurar el secret KOBO_TOKEN en Cloudflare." }, 500);
  }
  try {
    const headers = { Authorization: `Token ${env.KOBO_TOKEN}` };
    const res = await fetch(`${KOBO_SERVER}/api/v2/assets/${ASSET_UID}/data/?format=json&limit=5`, { headers });
    const page = res.ok ? await res.json() : null;
    const muestraCruda = page && page.results ? page.results[0] : null;
    const muestraResuelta = muestraCruda ? resolveRecord(muestraCruda) : null;

    return jsonResponse({
      total_reportado_por_kobo: page ? page.count : null,
      claves_del_registro_crudo: muestraCruda ? Object.keys(muestraCruda) : [],
      registro_crudo_de_muestra: muestraCruda,
      registro_resuelto_de_muestra: muestraResuelta
    }, 200);
  } catch (err) {
    return jsonResponse({ error: String(err) }, 500);
  }
}

function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders }
  });
}
