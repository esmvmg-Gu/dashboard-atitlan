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
  "_2_Ubicaci_n_Nombre_del_observador",
  "_2_Nombre_del_observador",
  GRUPO + "_2_Nombre_del_observador",
  GRUPO + "_2_Ubicaci_n_Nombre_del_observador"
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
const UBICACION_FISICA_CANDIDATOS = [
  GRUPO + "_3_Lugar_donde_se_ubica_el_pluvi_metro",
  "_3_Lugar_donde_se_ubica_el_pluvi_metro"
];

// Tabla confirmada por la organización: código original -> nombre completo -> estación.
const LUGAR_INFO = {
  gladys:   { codigo:"SM",  nombre:"Gladys",         estacion:"Santa Maria Visitación" },
  eliseo:   { codigo:"PQ",  nombre:"Eliseo Bixcul",  estacion:"Paquip" },
  armando:  { codigo:"PJ",  nombre:"Armando",        estacion:"Pahaj" },
  juan:     { codigo:"PL",  nombre:"Juan Ajpacajá",  estacion:"Palestina, San Juan la Laguna" },
  pablo:    { codigo:"PS",  nombre:"Pablo Chacom",   estacion:"Pasajquim" },
  santos:   { codigo:"CEDRACC", nombre:"Santos Saminez", estacion:"Chuitzanchaj - CEDRACC" },
  emilio:   { codigo:"PMG", nombre:"Emilio Cuj",     estacion:null },
  vinicio:  { codigo:"BV",  nombre:"Vinicio",        estacion:null },
  eduardo:  { codigo:"CH",  nombre:"Eduardo Saloj",  estacion:"Chuquel" },
  pedro:    { codigo:"XP",  nombre:"Pedro Zabala",   estacion:"El Progreso Xajaxac" },
  luis:     { codigo:"QX",  nombre:"Luis",           estacion:"Quixaya, San Lucas Tolimán" },
  patricia: { codigo:"QX",  nombre:"Patricia",       estacion:"Quixaya, San Lucas Tolimán" },
  manuel:   { codigo:"PN",  nombre:"Manuel Juracan", estacion:"Panimatzalam" },
  victor:   { codigo:"PAT", nombre:"Victor Sacuj",   estacion:null },
  jeymi:    { codigo:"IX",  nombre:"Jeymi Yon",      estacion:"Nueva Santa Catarina Ixtahucan" },
  ubaldo:   { codigo:"CHQ", nombre:"Ubaldo Chumil",  estacion:"Chaquiya" },
  maynor:   { codigo:"SJC", nombre:"Maynor Cotuc",   estacion:null }
};
const INDICE_LUGAR = {};
Object.entries(LUGAR_INFO).forEach(([base, info]) => {
  INDICE_LUGAR[base] = info.nombre;
  INDICE_LUGAR[info.codigo.toLowerCase()] = info.nombre;
});

// Busca, entre TODOS los candidatos no vacíos, el primero cuyo contenido
// coincida con un nombre/código conocido. Si ninguno coincide, usa el primer
// candidato no vacío tal cual (sin traducir), para no perder el dato.
function mejorValorLugar(r, candidatos) {
  const noVacios = candidatos.map(k => r[k]).filter(v => v !== undefined && v !== null && v !== "");
  for (const val of noVacios) {
    const limpio = String(val).toLowerCase().replace(/^\d+/, "");
    const tokens = limpio.split(/[_\-\s]+/).filter(Boolean);
    for (const t of tokens) {
      if (INDICE_LUGAR[t]) return INDICE_LUGAR[t];
    }
  }
  return noVacios.length ? noVacios[0] : null;
}

// Traduce los códigos genéricos "option_N" al nombre real del punto, según el
// orden en que aparecen las opciones en el formulario. ADVERTENCIA: esto es una
// inferencia por posición (no confirmada campo por campo contra Kobo), así que
// el frontend la marca como "estimado" en el mapa.
const UBICACION_FISICA_MAP = {
  option_1: "santa_maria_visitacion", option_2: "paquip", option_3: "pahaj",
  option_4: "palestina", option_5: "pasajquim", option_6: "cedracc",
  option_7: "pampojila", option_8: "buena_vista", option_9: "chaquijya",
  option_10: "xesampual", option_11: "quixaya", option_12: "panimatzalam",
  option_13: "patanatic", option_14: "santa_catarina_ixtahuacan",
  option_15: "chuiquel", option_16: "san_jose_chacaya"
};

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
    if (url.pathname === "/api/audit") return handleAudit(env);
    if (url.pathname === "/api/foto") return handleFoto(request, env);
    return env.ASSETS.fetch(request);
  }
};

// Sirve una foto adjunta de una lectura sin exponer el token al navegador.
// Solo permite proxiar URLs que apunten al propio asset de Kobo (por seguridad).
async function handleFoto(request, env) {
  if (!env.KOBO_TOKEN) {
    return new Response("Falta configurar KOBO_TOKEN", { status: 500 });
  }
  const fotoUrl = new URL(request.url).searchParams.get("url");
  if (!fotoUrl || !fotoUrl.startsWith(`${KOBO_SERVER}/api/v2/assets/${ASSET_UID}/`)) {
    return new Response("URL de foto no válida", { status: 400 });
  }
  try {
    const res = await fetch(fotoUrl, { headers: { Authorization: `Token ${env.KOBO_TOKEN}` } });
    if (!res.ok) return new Response("No se pudo obtener la foto", { status: 502 });
    return new Response(res.body, {
      headers: {
        "Content-Type": res.headers.get("Content-Type") || "image/jpeg",
        "Cache-Control": "public, max-age=3600"
      }
    });
  } catch (err) {
    return new Response("Error al obtener la foto: " + String(err), { status: 500 });
  }
}

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
      { "Cache-Control": "no-store" }
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
  const lugar = mejorValorLugar(r, LUGAR_CANDIDATOS);

  // Cantidad de lluvia: mm directo -> conversión ya calculada -> pulgadas * 25.4
  let mm = numeroValido(primerValor(r, MM_DIRECTO_CANDIDATOS));
  if (mm === null) mm = numeroValido(primerValor(r, CONVERSION_CANDIDATOS));
  if (mm === null) {
    const plg = numeroValido(primerValor(r, PLG_CANDIDATOS));
    if (plg !== null) mm = Math.round(plg * 25.4 * 100) / 100;
  }

  const tipo = resolveTipo(primerValor(r, TIPO_CANDIDATOS));

  const ubicacionRaw = primerValor(r, UBICACION_FISICA_CANDIDATOS);
  const ubicacion_fisica = ubicacionRaw
    ? (UBICACION_FISICA_MAP[String(ubicacionRaw).toLowerCase().trim()] || null)
    : null;

  let mmInvalido = false;
  if (mm !== null && mm > UMBRAL_MM_INVALIDO) {
    mmInvalido = true;
    mm = null; // se excluye de sumas/promedios, pero se conserva el aviso
  }

  // Foto adjunta (si el observador subió una) y campos crudos, para el detalle de la lectura.
  const attachment = Array.isArray(r._attachments) && r._attachments.length ? r._attachments[0] : null;
  const foto_url = attachment ? (attachment.download_large_url || attachment.download_url) : null;

  const camposCrudos = {};
  for (const k of Object.keys(r)) {
    if (["_attachments", "_geolocation", "_validation_status", "meta/instanceID", "meta/rootUuid", "formhub/uuid"].includes(k)) continue;
    camposCrudos[k] = r[k];
  }

  return {
    id: r._id,
    fecha, lugar, mm, mm_invalido: mmInvalido, tipo,
    ubicacion_fisica,
    foto_url,
    campos: camposCrudos
  };
}

async function handleAudit(env) {
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

    // Agrupa por el valor CRUDO de lugar (antes de cualquier traducción/unificación
    // de nombres), mostrando cuántas lecturas hay y el rango real de fechas de cada uno.
    const porLugarCrudo = {};
    allResults.forEach(r => {
      const rec = resolveRecord(r);
      const key = rec.lugar === null ? "(vacío)" : String(rec.lugar);
      if (!porLugarCrudo[key]) porLugarCrudo[key] = { count: 0, min: rec.fecha, max: rec.fecha };
      porLugarCrudo[key].count++;
      if (rec.fecha && (!porLugarCrudo[key].min || rec.fecha < porLugarCrudo[key].min)) porLugarCrudo[key].min = rec.fecha;
      if (rec.fecha && (!porLugarCrudo[key].max || rec.fecha > porLugarCrudo[key].max)) porLugarCrudo[key].max = rec.fecha;
    });

    return jsonResponse({
      total_registros: allResults.length,
      valores_crudos_de_lugar: porLugarCrudo
    }, 200);
  } catch (err) {
    return jsonResponse({ error: String(err) }, 500);
  }
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
