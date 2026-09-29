---
name: ghl-automation
description: Crear/editar workflows, pipelines y carpetas en GoHighLevel (cuenta de Frank / Live Lucky) vía la API interna backend.leadconnectorhq.com. Usar cuando el usuario pida construir, renombrar, organizar o auditar automatizaciones, embudos, pipelines o etiquetas en GHL, o montar SaaS Mode. Contiene la autenticación correcta (el error #1), los formatos de paso, y los errores ya cometidos para no repetirlos.
---

# GHL Automation — protocolo de la API interna

> Fuente de verdad operativa: memoria `project_ghl_internal_api_workflows.md` y `project_automatizaciones_estado.md`.
> Cuenta: company `D18ZOgbtIhbop0Zo2jjG` · location Frank `BAnlOGbwz5e0mw95HroC` · user `7Wm9QrOZOYhMRrSEo643` · from_phone `995867923613636`.

## 1. Autenticación (EL ERROR #1, no repetirlo)

Hay DOS tokens distintos. Se sacan del Network tab del navegador (app.livelucky.io), copiando un cURL:

| Token | De dónde | Cómo se manda | Sirve para |
|---|---|---|---|
| **token-id** (Firebase, RS256, iss securetoken.google.com) | header `token-id:` del cURL | **header `token-id:`** (NO `authorization`) | workflows (lectura/escritura), pipelines, funnels, carpetas |
| **authClass:User** (RS256, payload tiene `"authClass":"User"`) | header `authorization: Bearer` del cURL | `authorization: Bearer` | workflows (variante alterna) |

**Errores que cometimos:**
- Mandar el `token-id` como `authorization: Bearer` → **401**. Va como header `token-id:`.
- El token `spm-ts` (HS256, `source:WEB_USER`) de reselling/calendars NO sirve para workflows.
- Los tokens expiran **~1h** (campo `exp`). Calcular restante: `echo $((EXP - $(date +%s)))`. Pedir uno fresco si caduca.

Headers estándar: `token-id: <TID>`, `channel: APP`, `source: WEB_USER`, `content-type: application/json`. Base: `https://backend.leadconnectorhq.com`.

Guardar el token en `C:/Users/andre/AppData/Local/Temp/ghl_tokid.txt` y leerlo con `tr -d '\r\n '`.

## 2. Workflows

- **Listar**: `GET /workflow/{loc}/list?parentId=root&limit=200` → respuesta en `rows[]` (NO `data`/`workflows`). `type` = `directory` | `workflow`.
- **Listar dentro de carpeta**: `parentId=<folderId>`.
- **Detalle**: `GET /workflow/{loc}/{wfId}` → pasos en `workflowData.templates[]`. (A veces devuelve vacío por `if-none-match`/304: reintentar sin ese header.)
- **Crear**: `POST /workflow/{loc}` con body `{name, status:'draft', parentId, meta:{advanceCanvasMeta:{enabled:true,enabledAt:'<ISO fijo>'}}, updatedBy, workflowData:{templates:[]}, company_id, ...}` → devuelve `{_id|id}`.
- **Cargar pasos**: GET base → `PUT /workflow/{loc}/{id}` con `Object.assign(base, {status:'draft', version:base.version, workflowData:{templates:steps}, createdSteps:steps, modifiedSteps:[], deletedSteps:[], triggersChanged:false, oldTriggers:[], newTriggers:[]})`.
- **Mover a carpeta**: `PUT /workflow/{loc}/move-directory/{wfId}` body `{parentId}` → 200.
- **Renombrar workflow**: GET base, PUT con `name` cambiado (mismo body). NO hay endpoint corto conocido.

### Triggers (SÍ se crean por API — receta verificada 2026-06-12)
Requiere **User Bearer** (`authorization: Bearer` authClass:User, del origin `client-app-automation-workflows`), NO el token-id. Secuencia de 4 pasos (saltarse el auto-save deja el trigger huérfano = no dispara):
1. **POST** `/workflow/{loc}/trigger` → `{status:'draft', workflowId, schedule_config:{}, conditions:[{operator:'index-of-true', field:'tagsAdded', value:'<tag>', title:'Tag added', type:'select', id:'tag-added'}], type:'contact_tag', masterType:'highlevel', name:'Contact Tag', actions:[{workflow_id, type:'add_to_workflow'}], advanceCanvasMeta:{position:{x:0,y:0}}, active:true, triggersChanged:true, location_id, company_id, company_age:1}` → devuelve `{id}`. (ERROR viejo: `type:'contact_changed'`+`field:'contact.tags'` NO bindea.)
2. **A draft**: `PUT /workflow/{loc}/{wf}` con `{...base, status:'draft', triggersChanged:false}` (auto-save exige draft, si no: 422 "Cannot auto save workflow which is not draft").
3. **auto-save** (bindea): `PUT /workflow/{loc}/{wf}/auto-save` con `{...base, scheduledPauseDates:[], modifiedSteps:[], deletedSteps:[], createdSteps:[], senderAddress:{}, triggersChanged:true, newTriggers:[{...trigger..., id:<trigId>, location_id}], isAutoSave:true, autoSaveSession:{workflowId, id:<uuid>, userId, version:base.version}}`.
4. **publish** (activa): `PUT /workflow/{loc}/{wf}` con `{...base, status:'published', triggersChanged:false}`. Solo tras publicar `active` pasa a true.
LEER: `GET /workflow/{loc}/trigger?workflowId={wf}`. BORRAR: `DELETE /workflow/{loc}/trigger/{id}`. Builder: `Temp/ghl_batch.mjs` función `activate(wf,tags)`. Otros tipos de trigger: capturar su `conditions`/`type` del catálogo o de un workflow real.

### Carpetas (directories)
- **Crear**: `POST /workflow/{loc}/directory` body `{name, parentId}`. **Anidamiento SÍ funciona** (parentId de otra carpeta).
- **Borrar / renombrar carpeta**: endpoint desconocido (DELETE y PUT dieron **404**). Workaround: crear con el nombre correcto; borrar duplicados en la UI.

## 3. Pipelines (oportunidades)

- **Listar**: `GET /opportunities/pipelines?locationId={loc}` (+ header `version: 2021-07-28`) → `pipelines[]`, cada uno con `stages[]`.
- **Crear**: `POST /opportunities/pipelines` body:
  ```
  { locationId, name, showInFunnel:true, showInPieChart:true, useOpportunityProbability:false,
    colorRenderMode:'dot',   // SOLO 'dot'|'bg-tint'|'none' (otro valor = 422)
    stages:[{ name, position, showInFunnel:true, showInPieChart:true, stageWinProbability, color }] }
  ```
- **Errores que cometimos**: mandar `id` en los stages → **422** ("property id should not exist"); `colorRenderMode:'stage'` → **422**. Stages SIN id en create; el server los genera.

## 4. Formatos de paso (builder)

Patrón: construir el array `steps` **de atrás hacia adelante** (cada paso referencia el `id` del siguiente). `order` se asigna por orden de push. El nodo raíz = el que nadie referencia como `next`. IDs = `crypto.randomUUID()` (Node 24, sin `require`).

Plantillas de formato (tag/remove/if_else) se copian de un workflow real cacheado (`wf10.json` = WF-10 export). Snippets probados:
- `whatsapp_v2`: nodo con `transitions` Delivered/Undelivered + 2 nodos `transition` (next a deliveredNext/undeliveredNext). `from_phone_number` = PHONE.
- `wait`: `{type:'time', startAfter:{type:'minutes'|'days', value, when:'after'}}`.
- `add_contact_tag`: copiar `attributes` de `tagTpl`, setear `.tags=[...]`.
- `if_else`: parent + branch-yes + branch-no; condición HAS_TAG con `conditionType:'contact_detail', conditionSubType:'tags', conditionOperator:'index-of-true', conditionValue:[tag]`.
- `remove_from_workflow`: copiar `attributes` de `remTpl`.
- `create_opportunity` (mover pipeline): copiar formato de los workflows `Respondió Whatsapp` (338b7bdb-89aa-4b72-8970-c6201a966ad5) o `[FOR] Pine Line` (83f67cf9).

Scripts builder de referencia en `C:/Users/andre/AppData/Local/Temp/ghl_*.mjs` (build, smart, growth, pipes, folders). Ejecutar con `TOK=$(cat ...) node ghl_x.mjs` (o leer token-id dentro del script).

## 5. Arquitectura acordada (no re-litigar)

- **Etiquetas a secas**: `terapia` / `growth` / `regenesis` (una por lead, puesta al comprar). Es la fuente de verdad para: webhook (servicio), gating de plataforma, y enrutamiento de pipeline.
- **Opción A**: un workflow comercial **por servicio**, con trigger filtrado por su etiqueta, que mueve la oportunidad por SU pipeline (TER→Ttm8vpVfWibpTPfdNNKv, GRW→K6FuvzpDvuqD2wKrNXAn, RG→FeVYpvdszZe2l41sc5Nc). La entrega del programa (recordatorios 70 días) SÍ se comparte.
- **Convención de nombres**: `TER · / GRW · / RG ·` por servicio; `COM ·` para compartidos.
- **Carpetas**: `Servicios/` (09393675-d0a6-4188-873f-29a0538db339) con subcarpetas Growth (c3dec86a), Re-Génesis (7756b7c9), Terapia (8f003e64); compartidos directo en Servicios.
- **WhatsApp = utilidad** (sin tono de Frank). Plantillas utility a Meta aparte (no hay API de creación de plantillas).

## 6. Deploy de Edge Functions (Supabase) y VPS

- **Edge function**: Management API multipart (evita pegar 300 líneas inline):
  ```
  curl -X POST "https://api.supabase.com/v1/projects/{ref}/functions/deploy?slug={fn}" \
    -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
    -F 'metadata={"name":"{fn}","entrypoint_path":"index.ts","verify_jwt":false};type=application/json' \
    -F 'file=@path/index.ts;type=application/typescript'
  ```
  Verificar primero la versión DESPLEGADA (puede ser más nueva que el local) para no regresar fixes. `verify_jwt:false` para webhooks GHL.
- **VPS / landings**: usar la skill `deploy-vps` (pscp + hostkey + cache bump `?v=YYYYMMnn`). Verificar SIEMPRE con curl en producción.

## 7. SaaS Mode (CRM Live Lucky)

- El alta automática de sub-cuentas es **GHL SaaS Mode** (config de Agencia UI: SaaS Configurator + Stripe + plan + funnel de registro). NO se monta por la API de la sub-cuenta.
- El plan "Premium" ya existe ($70/mes, $700/año, trial 15d). Los **"Copy sale link"** del plan son los enlaces de registro (van en la landing `live-lucky/`, constante `MONTHLY_URL`/`ANNUAL_URL`).
- La sub-cuenta "Live Lucky" es el centro de facturación SaaS, NO un cliente. Cada cliente que paga recibe su propia sub-cuenta.
- Pendiente: probar que el sale link cree la sub-cuenta; adjuntar snapshot (sin él, el cliente entra a un CRM vacío).

## Checklist al trabajar
1. ¿Token-id fresco y mandado como header `token-id:`? (mirar `exp`).
2. ¿Construir como draft, sin trigger (avisar que se agrega en UI)?
3. ¿Verificar en vivo lo creado (leer de vuelta el workflow/pipeline)?
4. ¿Actualizar `project_automatizaciones_estado.md` con IDs y estado?
