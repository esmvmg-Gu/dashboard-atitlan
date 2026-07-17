// Worker principal: sirve los archivos estáticos (public/) y maneja /api/data
// como proxy seguro hacia KoboToolbox. El token vive como secret (KOBO_TOKEN),
// nunca en el código ni en el navegador.
//
// El formulario "monitoreo" cambió de estructura varias veces con los años:
// campos sueltos -> campos dentro de un grupo (group_ki34l00/...), nombres
// renombrados, y hasta tres codificaciones distintas para las opciones de
// "tipo de lluvia" (option_N / N__nombre / nombre). Este archivo combina
// todas las variantes conocidas (confirmadas contra datos reales) en un
// solo valor limpio por registro.

const KOBO_SERVER = "https://eu.kobotoolbox.org";
const ASSET_UID = "ayNmjvKNvSNZTkQb8uMPPg";
const GRUPO = "group_ki34l00/";

const FECHA_CANDIDATOS = [
  GRUPO + "_1_Fecha_y_hora_en_q_e_se_toma_la_lectura",
  "_1_Fecha_y_hora_en_q_e_se_toma_la_lectura"
];
const LUGAR_CANDIDATOS = [
  GRUPO + "_2_Nombre_del_observador",
  GRUPO + "_2_Ubicaci_n_Nombre_del_observador",
  "_2_Ubicaci_n_Nombre_del_observador",
  "_2_Nombre_del_observador"
];
const MM_DIRECTO_CANDIDATOS = [
  GRUPO + "_4_cantidad_de_lluvia_mm",
  "_4_cantidad_de_lluvia_mm",
  GRUPO + "_4_Cantidad_de_lluvia_Plg_mm",
  "_4_Cantidad_de_lluvia_Plg_mm"
];
const PLG_CANDIDATOS = [
  GRUPO + "_4_Cantidad_de_lluvia_Plg",
  "_4_Cantidad_de_lluvia_Plg",
  GRUPO + "_5_cantidad_de_lluvia_en_plg",
  "_5_cantidad_de_lluvia_en_plg"
];
const CONVERSION_CANDIDATOS = [
  "conversion", GRUPO + "conversion",
  "conversion_plg_a_mm", GRUPO + "conversion_plg_a_mm"
];
const TIPO_CANDIDATOS = [
  GRUPO + "_6_Tipo_de_lluvia",
  "_6_Tipo_de_lluvia"
];

// Umbral físico razonable para una sola lectura de pluviómetro (mm). El récord
// mundial de lluvia en 24h ronda los 1800mm; cualquier valor por encima de esto
// casi seguro es un error de captura (ej. escribir "80000" en vez de "8.0").
const UMBRAL_MM_INVALIDO = 500;

// Traduce las 3 versiones de códigos que ha usado el formulario a través del tiempo
// a una sola etiqueta legible en español.
const TIPO_MAP = {
  option_1: "Nublado", option_2: "Llovizna", option_3: "Lluvia normal", option_4: "Lluvia fuerte",
  option_5: "Lluvia con viento", option_6: "Lluvia con trueno, aire y granizo",
  option_7: "Tormenta tropical", option_8: "Huracán",
  "1__nublado": "Nublado", "2__llovizna": "Llovizna", "3__lluvia_normal": "Lluvia normal",
  "4__lluvia_fuerte": "Lluvia fuerte", "5__lluvia_con_viento": "Lluvia con viento",
  "6__lluvia_con_trueno__aire_y_granizo": "Lluvia con trueno, aire y granizo",
  "7__tormenta_tropical": "Tormenta tropical", "8__huracan": "Huracán",
  nublado: "Nublado", llovizna: "Llovizna", lluvia_normal: "Lluvia normal", lluvia_fuerte: "Lluvia fuerte",
  lluvia_con_viento: "Lluvia con viento", lluvia_con_trueno_aire_y_granizo: "Lluvia con trueno, aire y granizo",
  tormenta_tropical: "Tormenta tropical", huracan: "Huracán"
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/data") return handleKoboProxy(env);
    if (url.pathname === "/api/debug") return handleDebug(env);
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
      if (!res.ok) return jsonResponse({ error: `KoboToolbox respondió con estado ${res.status}` }, 502);
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

function resolveTipo(raw) {
  if (!raw) return null;
  const key = String(raw).toLowerCase().trim();
  if (TIPO_MAP[key]) return TIPO_MAP[key];
  return key.replace(/^\d+__/, "").replace(/_+/g, " ").trim();
}

function resolveRecord(r) {
  const fecha = primerValor(r, FECHA_CANDIDATOS) || r["_submission_time"];
  const lugar = primerValor(r, LUGAR_CANDIDATOS);

  // Cantidad de lluvia: mm directo -> conversión ya calculada -> pulgadas * 25.4
  let mm = numeroValido(primerValor(r, MM_DIRECTO_CANDIDATOS));
  if (mm === null) mm = numeroValido(primerValor(r, CONVERSION_CANDIDATOS));
  if (mm === null) {
    const plg = numeroValido(primerValor(r, PLG_CANDIDATOS));
    if (plg !== null) mm = Math.round(plg * 25.4 * 100) / 100;
  }

  const tipo = resolveTipo(primerValor(r, TIPO_CANDIDATOS));

  let mmInvalido = false;
  if (mm !== null && mm > UMBRAL_MM_INVALIDO) {
    mmInvalido = true;
    mm = null; // se excluye de sumas/promedios, pero se conserva el aviso
  }

  return { fecha, lugar, mm, mm_invalido: mmInvalido, tipo };
}

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
