# Dashboard de Monitoreo Hídrico — Cuenca de Atitlán (formato Worker)

Cloudflare cambió su flujo de despliegue: ya no hay una opción separada "Pages" en el
dashboard — todo se crea como un **Worker**, que puede servir tanto archivos estáticos
como lógica de servidor (nuestro proxy hacia Kobo). Esta es la estructura correcta
para ese formato.

## Estructura del proyecto

```
dashboard-atitlan/
├── wrangler.jsonc       ← configuración del Worker (reemplaza el "build output directory" de Pages)
├── src/
│   └── index.js         ← Worker: sirve el HTML y maneja /api/data (proxy a Kobo)
└── public/
    └── index.html        ← el dashboard (mapa, KPIs, gráficas, tabla) — ya tiene los datos de estaciones embebidos
```

## Pasos en GitHub

1. **Reemplaza** el contenido de tu repo `dashboard-atitlan` con esta nueva estructura
   (borra la carpeta `functions/` y `assets/` anteriores, y el `index.html` viejo en la raíz).
2. Sube: `wrangler.jsonc`, `src/index.js`, `public/index.html`.
3. Commit.

## Pasos en Cloudflare (borra el proyecto viejo primero)

1. En el proyecto `dashboard-atitlan` actual → **Settings** → baja hasta el final → **Delete**.
2. **Workers & Pages → Create application**.
3. Busca la opción **Import a repository** (o el equivalente — la interfaz ha ido cambiando; si ves pestañas, elige la que dice "Workers" ya que Pages fue absorbido ahí).
4. Selecciona tu repo `matheo84/dashboard-atitlan`.
5. Configuración de build:
   - **Build command:** vacío (no necesitamos build, es JS plano)
   - **Deploy command:** déjalo en su valor por defecto, `npx wrangler deploy` — Wrangler lee automáticamente `wrangler.jsonc` y sabe qué desplegar.
   - **Root directory:** `/`
6. **Save and Deploy**.

## Configurar el token (como Secret, no como variable normal)

Los Workers distinguen entre **Variables** (texto plano, visibles) y **Secrets** (encriptados). Usa Secret para el token:

1. Dentro del proyecto → **Settings → Variables and Secrets**.
2. **Add** → tipo **Secret** → nombre `KOBO_TOKEN` → pega tu token.
3. Guarda y vuelve a desplegar (**Deployments → Retry deployment**) si no se aplicó automáticamente.

## Por qué falló la primera vez

El log mostraba `Executing user build command: /` y `Permission denied` — Cloudflare
intentó ejecutar `/` como si fuera un comando de terminal porque configuramos
"Build output directory" (`/`), un campo que **ya no existe** en el formato Worker;
ese valor ahora vive dentro de `wrangler.jsonc` como `assets.directory`. Por eso
movimos esa configuración al archivo en vez del campo del dashboard.
