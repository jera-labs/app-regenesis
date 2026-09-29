# Studio (ARCHIVADO — 2026-05-31)

**Estado:** retirado del flujo principal de Neurohackers Platform porque GoHighLevel Social Planner ya cubre el caso de uso (generación AI + scheduling + publishing) y Frank ya paga Agency Unlimited. Mantener Studio era duplicar la rueda.

## Por qué se archivó

Frank tiene GHL Agency SaaS. GHL Social Planner (2026) trae:
- Content AI con Brand Panel auto-llenado (10+ campos)
- AI Image Generator (4 opciones por prompt + One-Click brand styling)
- Editor de imagen integrado
- Scheduling, queue evergreen, recurring, CSV bulk, RSS auto-publish
- 10 redes nativas (FB, IG, Threads, GBP, LinkedIn, TikTok, YouTube, Pinterest, Bluesky, X)
- API pública (`POST /social-media-posting/:locationId/posts`)
- $0 incremental — incluido en plan que ya paga

Studio competía en este territorio con menos features, sin publicación real y duplicando lo que GHL hace mejor.

## Lo único que GHL no replica (y por qué la plataforma sigue valiendo)

La plataforma Neurohackers conserva su **DNA del cliente** (4 capas: datos, esencia, negocio, diagnóstico + N productos con su ICP/promesa). GHL Brand Panel tiene ~10 campos básicos; nuestro DNA tiene 60+ incluyendo:
- `palabras_si` / `palabras_no` (lista negra de términos)
- `referencias` (inspiraciones explícitas)
- `historia_personal` + `diferenciador`
- Diagnóstico emocional profundo (códigos corruptos, miedo escalar, epifanía de pago, techo financiero)
- Productos con `promesa`, `ICP`, `entregables`, `siguiente_escalon` por producto

**Estrategia nueva:** edge function `sync-dna-to-ghl-brand-panel` mapea los campos compatibles del DNA al Brand Panel de GHL via API. El cliente llena DNA en plataforma (con cuestionario guiado + bloqueo de campos), eso se proyecta automáticamente a GHL, y el cliente usa Content AI + Social Planner de GHL para generar y publicar. Plataforma = source of truth del contexto; GHL = motor de ejecución.

## Cuándo podría reactivarse

- Si Neurohackers o algún cliente quiere usar la plataforma SIN GHL.
- Si Frank decide construir un producto blanco con generador propio (sin depender del rebilling de GHL).
- Como base de código para un Studio de otra herramienta interna.

Para reactivarlo: `git mv archived/studio studio`, restaurar links en `plataforma/public/shared/nav.js`, redeployar edge functions, configurar secrets `OPENAI_API_KEY` / `LEGACY_SERVICE_ROLE_KEY`.

## Migraciones BD relacionadas (NO se reversan)

- `62_modulos_cliente.sql` — tabla genérica de feature flags. Se mantiene; otras features podrán usarla.
- `63_contenido_imagen_columnas.sql` — columnas `imagen_*` en `contenido_generado`. Se mantienen.
- `64_cliente_api_keys.sql` — tabla de API keys por cliente. Se mantiene cifrada.
- `65_cliente_api_keys_encriptadas.sql` — cifrado AES-256. Se mantiene.
- `66_cliente_api_keys_toggles_admin_only.sql` — trigger seguridad. Se mantiene.
- `67_rls_perf_initplan_wrap.sql` — optimización RLS aplicada a TODAS las tablas. Crítica.

## Edge functions Studio (siguen vivas en Supabase deployment)

- `generar-imagen-dalle` (v9 ACTIVE) — se mantiene desplegada por si reactivamos. Costo solo si se invoca.
- `generar-contenido` (v9 ACTIVE) — usa flag `from_studio: true` para resolver per-client. Plataforma sin ese flag sigue usando env directamente.

Si quieres desactivarlas para evitar invocaciones accidentales, revoca grants de `resolve_api_key` y/o cambia `verify_jwt=true` (ya lo está).

---

## Documentación original (V1 launch state)

> Generador y editor de contenido para redes sociales (Instagram, LinkedIn, Facebook) personalizado por el perfil DNA + productos de cada cliente. Imágenes generadas con gpt-image-2, editor canvas Fabric.js con plantillas, descarga directa y eventual publicación via GHL Social Planner.

### Estructura preservada

```
archived/studio/
├── public/
│   ├── index.html                          Dashboard cliente
│   ├── modules/
│   │   ├── instagram/                      Generador (1024² gpt-image-2)
│   │   ├── linkedin/                       Generador (1536×1024)
│   │   ├── facebook/                       Generador (1536×1024)
│   │   └── editor/                         Fabric.js canvas editor
│   ├── configuracion/                      UI API keys cifradas por cliente
│   ├── admin/
│   │   ├── index.html                      Activar módulos por cliente
│   │   └── uso.html                        Reportes de costo cliente / admin
│   └── shared/
│       ├── styles.css
│       ├── turbo.min.js
│       └── scripts/
│           ├── studio-auth.js              Gate por módulo
│           ├── studio-nav.js               Sidebar colapsable
│           ├── studio-contenido.js         API + sizeRecomendado(canal)
│           └── studio-edit-modal.js        Modal editar texto
└── supabase-functions/
    └── generar-imagen-dalle/               gpt-image-2 + resolve_api_key
```

### Trazabilidad histórica

Commits clave del desarrollo de Studio:
- `c01359e` — generación V1
- `647687d` — LinkedIn + Facebook + gpt-image-2
- `521408a` — API keys por cliente + costos
- `28db771` — cifrado AES-256
- `e4f1094` — seguridad + dropdown sidebar + cards
- `6576b6c` — edición inline de texto + SKILL.md
- `3e9ccbb` — gate por módulo
