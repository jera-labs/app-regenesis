# SKILL · Studio (generador de contenido para redes)

> Este archivo documenta las convenciones, decisiones técnicas y patrones del **Studio**, el tercer proyecto del monorepo. Léelo antes de tocar `studio/`.

## 0. Qué es Studio

Generador IA de contenido para Instagram, LinkedIn y Facebook. Vive bajo el path `/studio/*` de `plataforma.neurohackers.cloud` pero es un **proyecto aislado** (su propio sidebar, su propio auth gate, sus propias edge functions y su propia carpeta `studio/`). Si algo en Studio se rompe, NO debe afectar a Re-Génesis ni a Plataforma.

URLs públicas:
- Dashboard: `https://plataforma.neurohackers.cloud/studio/`
- Generadores: `/studio/modules/{instagram|linkedin|facebook}/`
- Editor canvas: `/studio/modules/editor/?id={contenido_id}`
- API keys: `/studio/configuracion/`
- Costo / Uso: `/studio/admin/uso.html`
- Admin (legacy, ahora reside en plataforma): `/studio/admin/`

## 1. Estructura

```
studio/
├── public/
│   ├── index.html                          Dashboard (cards por red)
│   ├── modules/
│   │   ├── instagram/                      1024x1024
│   │   ├── linkedin/                       1536x1024
│   │   ├── facebook/                       1536x1024
│   │   └── editor/                         Fabric.js canvas editor
│   ├── configuracion/                      Gestión API keys
│   ├── admin/
│   │   ├── index.html                      Activar módulos (deprecated → ver plataforma)
│   │   └── uso.html                        Vistas cliente / admin con costos
│   └── shared/
│       ├── styles.css                      Tokens y componentes (clon de plataforma)
│       ├── turbo.min.js                    Hotwire Turbo
│       └── scripts/
│           ├── config.js                   NEURO_CONFIG (URL, ANON_KEY)
│           ├── supabase-client.js          window.db (storageKey neurohackers-auth)
│           ├── utils.js                    escapeHtml, toast en window.utils
│           ├── studio-auth.js              requireStudioAuth / requireStudioAdmin
│           ├── studio-nav.js               Sidebar (grupos colapsables nativos)
│           ├── studio-contenido.js         API helpers + sizeRecomendado(canal)
│           └── studio-edit-modal.js        Modal compartido de edición de texto
└── supabase-functions/
    └── generar-imagen-dalle/               gpt-image-2 + resolve_api_key per-client
```

## 2. Reglas duras (NO violar)

1. **`window.db` siempre**, nunca `supabase` (colisiona con la global).
2. **`window.utils.escapeHtml`**, NO `window.escapeHtml` (en plataforma sí, en studio NO). Usa el fallback `(window.utils?.escapeHtml || ((x)=>String(x??'')))(s)`.
3. **`window.NEURO_CONFIG.SUPABASE_URL`**, NUNCA `window.SUPABASE_URL` (no existe → genera `undefined/functions/v1/...` → 404 → nginx fallback a home plataforma).
4. **Hrefs absolutos** `/studio/...` en sidebar y links. Relativos acumulan paths en cada navegación.
5. **`data-turbo="false"`** en links que salen del editor (editor oculta sidebar con CSS; al volver vía Turbo, la clase `with-sidebar` no se reaplica). Para entrar al editor desde IG/LinkedIn/FB Turbo está OK porque sidebar se persiste con `data-turbo-permanent`.
6. **Edge function `generar-contenido`** debe recibir `from_studio: true` cuando se llama desde Studio para que use `resolve_api_key`. Si no, usa env (compat plataforma).
7. **`generar-imagen-dalle`** siempre usa `resolve_api_key` (solo lo llama Studio).
8. **NO se mencionan modelos IA al cliente** ("Generación de imagen IA" sí; "DALL-E", "Anthropic Claude" solo en `/studio/configuracion/` donde es necesario para que sepa qué cuenta crear).

## 3. Patrón de seguridad

| Recurso | Cliente puede | Admin puede |
|---|---|---|
| `modulos_cliente` | SELECT propio | ALL |
| `modulos_catalogo.default_activo` | SELECT | UPDATE (toggle global) |
| `cliente_api_keys.anthropic_key`, `.openai_key` | INSERT/UPDATE propio (el trigger cifra) | INSERT/UPDATE de cualquiera |
| `cliente_api_keys.usar_plataforma_*` | **NO** (trigger BD `_cak_enforce_toggles_admin_only` lo bloquea) | INSERT/UPDATE |
| `contenido_generado` | CRUD propio | ALL |
| Storage `contenido-imagenes` | CRUD path `{lead_id}/...` propio | ALL |

Defensa en profundidad: UI deshabilita controles para no-admin + trigger BD bloquea operación si llega a saltarse la UI. Probado vía `RAISE EXCEPTION 42501` con mensaje en español.

## 4. Cifrado de API keys

Migración 65:
- Master key en **Supabase Vault** (`vault.secrets` con name `cak_master_key`), generada con `gen_random_bytes(32)` en base64.
- Trigger BEFORE INSERT/UPDATE `_cak_encrypt_keys`: cualquier valor en `anthropic_key`/`openai_key` se cifra con `pgp_sym_encrypt` (AES-256), se guarda en `*_key_enc bytea`, se preserva `*_key_last4` para identificación UI, y se limpia el plaintext (NULL).
- `resolve_api_key(lead, provider)` desencripta solo cuando la edge function lo necesita.
- Helper `_cak_master_key()` con grants revocados de `public`/`authenticated`/`anon`. Solo el trigger y resolve_api_key (ambos SECURITY DEFINER) pueden invocarlo indirectamente.

**Garantías:** ni admin ni cliente pueden recuperar la key tras guardar (solo last4); backups/dumps de Postgres no exponen plaintext.

## 5. Resolución de tamaño por canal

`window.studioContenidoApi.sizeRecomendado(canal)`:
- `instagram` → `1024x1024` (1:1)
- `linkedin` → `1536x1024` (3:2, cerca del 1.91:1 nativo)
- `facebook` → `1536x1024` (3:2)
- `tiktok` (futuro) → `1024x1536` (2:3 vertical)

gpt-image-2 NO soporta otros tamaños; estos son los más cercanos al ratio nativo de cada red.

## 6. Sidebar grupos colapsables

Usa `<details>/<summary>` nativos (cero JS extra). El estado `open` se activa automáticamente cuando el item active está dentro del grupo. CSS: `.side-group`, `.side-group-summary`, `.side-group-caret` (rotación 180° al abrir), `.side-sub-item` (padding-left 32px para indentar).

## 7. Costos: dos vistas en /studio/admin/uso.html

- **Cliente (`#cliente`)**: ve TODO su consumo (texto Anthropic + imagen OpenAI, plataforma + propio). Sin filtros.
- **Admin (`#todos`)**: solo agrega lo que pagó la plataforma. Piezas con key propia del cliente NO aparecen al admin (privacidad del cliente).

Trackeo: columnas `costo_a_plataforma_anthropic` y `costo_a_plataforma_openai` en `contenido_generado`, se setean cuando la pieza se genera basadas en lo que devolvió `resolve_api_key`.

## 8. Patrones cliente

- **Edición inline de texto**: cada pieza tiene botón `✎ Editar texto`. Carga `studio-edit-modal.js` que expone `window.openEditarPiezaModal(pieza, onSave)`. Edita: `titulo, hook, cuerpo, cta, hashtags`. El modal devuelve el patch al callback que llama `studioContenidoApi.actualizar(id, patch)`.
- **Edición de imagen**: botón "Editar imagen" abre `/studio/modules/editor/?id={contenido_id}`. El editor Fabric.js auto-redimensiona el canvas al aspect ratio de la imagen IA, soporta plantillas acumulativas (no borran lo previo), duplicación de elementos y z-order.
- **Persistencia**: la edge function `generar-contenido` NO inserta en BD, solo devuelve piezas. El frontend hace el INSERT en `contenido_generado` después (esto es legacy de plataforma; estaba pensado para que plataforma decidiera qué guardar).

## 9. Migración a nuevo modelo / extensión

- **Nueva red social** (ej. TikTok):
  1. Agregar en `studio-nav.js` REDES_ITEMS.
  2. Agregar slug en `modulos_catalogo` (migración).
  3. Clonar `modules/instagram/` → `modules/tiktok/` ajustando CANAL, formatos default, aspect ratio del thumbnail, y descarga.
  4. Actualizar `sizeRecomendado()` en `studio-contenido.js`.
  5. Bumpear cache versions.
- **Nuevo modelo IA**: solo Anthropic + OpenAI en MVP. Si se agrega Google/Gemini etc., crear secret + nuevo flujo en `resolve_api_key` con tercer provider.

## 10. Deploys

VPS Hostinger via plink/pscp:
```bash
tar czf /tmp/studio-X.tar.gz -C studio/public .
pscp -hostkey "<fp>" /tmp/studio-X.tar.gz $VPS_SSH_USER@$VPS_HOST:/tmp/
plink "cd /etc/easypanel/projects/website/regenesis/html/app/studio && tar xzf /tmp/studio-X.tar.gz"
```

Cache busting: incrementar `?v=YYYYMMDD` en todos los `<script>` y `<link>` references. Sin esto, el browser sirve la versión cacheada y los fixes nuevos no aplican.

## 11. Lo que NO está implementado (roadmap consciente)

- Publicación automática via GHL Social Planner (sub-locations por cliente). Edge function `publicar-ghl-social` preparada pero no creada.
- ZIP descargable (imagen + texto + hashtags) por pieza.
- Más plantillas en el editor canvas (testimonio, antes/después, tip numerado).
- TikTok / Twitter pages.
- Estado `programado` con cron que dispare publicación en fecha futura.
- Vista de "Cola compartida" en plataforma con preview cards más ricos.

---

**Última actualización:** 2026-05-31 · Studio v2 con cifrado AES-256 de API keys, editor inline de texto, sidebar colapsable.
