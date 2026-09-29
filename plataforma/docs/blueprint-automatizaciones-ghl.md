# Blueprint ejecutable — Automatizaciones GHL Re-Génesis

> Fuente única de verdad para ejecutar los cambios por API/MCP y a mano en GHL UI.
> Generado 2026-06-12 (workflow multi-agente). Consolida 4 diseños (Re-Génesis completo, Terapia, Growth, Plantillas WhatsApp) sin contradicciones.
> Complementa el plan `C:\Users\andre\.claude\plans\ok-entonces-trabajemos-en-steady-crown.md` y el mapa `ghl-automatizaciones-regenesis.md`.

## 0. Servicios (4, sobre el mismo CRM Live Lucky)

- **Re-Génesis (completo):** 70 días + plataforma con módulos de negocio. Cerebro = Supabase. Source of truth pagos = GHL.
- **Terapia:** mismo programa de 70 días, misma cara `/regenesis/`, SIN módulos de negocio. Reusa ~90% del aparato.
- **Growth:** NO entra a la plataforma, NO pasa por `webhook-ghl`, NO firma contratos. Ciclo 100% en GHL. Recibe CRM (sub-cuenta SaaS) + Skool.
- **CRM individual (4º servicio, nuevo):** venta del CRM solo, como sub-cuenta SaaS de GHL. Mismo motor de provisión que Growth.

### Modelo SaaS de sub-cuentas (Growth + CRM individual)
- Precio: **$70/mes** o **$700/año** por sub-cuenta (ya creado por Frank en el SaaS Configurator).
- **Trial: 15 días** (hay que cambiarlo, hoy está en 60).
- **Auto-provisión:** la sub-cuenta se crea automáticamente al pagar (GHL SaaS Mode, desde snapshot).
- Falta: **landing** + habilitar el servicio, todo en GHL.
- ⚠️ Esto es configuración **a nivel agencia** (SaaS Configurator: Stripe, plan, trial, snapshot, order form). El trial vive en `saas-billing-v2/billing-config`. Mayoría es UI/agencia; ver §8.

---

## 1. Taxonomía de etiquetas unificada

Convención: todo en `kebab-case` con guion. Prefijo de servicio `servicio-<x>`.

### 1.1 Servicio (canónico, se setea en el pago)
| Tag | Significado |
|---|---|
| `servicio-regenesis` | Programa completo (70 días + módulos de negocio). |
| `servicio-terapia` | Solo-terapia (70 días, sin módulos). Front recorta vía `leads.servicio`. |
| `servicio-growth` | Growth (CRM + comunidad, sin plataforma). |
| `servicio-crm` | CRM individual (solo sub-cuenta SaaS). |

### 1.2 Ventas / pre-venta (RG + Terapia)
`cliente-directo`, `cerrado-por-closer`, `cerrado-pendiente-pago`, `plan-N-cuotas`, `link-enviado`, `seguimiento-activo`, `recuperacion-prepago`.

### 1.3 Pago y onboarding (RG + Terapia)
**`pago-realizado`** = CANÓNICO único de pago (sustituye `pago-completo`, `pago-confirmado`, `pago_confirmado`). Luego: `onboarding-iniciado`, `contrato-servicio-firmado`, `contrato-waiver-firmado`, `contrato-media-firmado`, `onboarding-completado`, `cliente-activo`, `programa-bienvenida-enviada`.

### 1.4 En programa (RG + Terapia)
`en-programa`, `cuota-proxima`, `cuota-atrasada`, `sin-sesion-7d`, `sin-actividad-3d`, `riesgo-churn`, `programa-completado`.

### 1.5 Churn / win-back
`pausa`, `churn`, `reingreso`.

### 1.6 Growth + CRM individual
`growth-onboarding-iniciado`, `skool-invitado`/`skool-unido`, `crm-provisionado`, `growth-activo`, `growth-carrito-abandonado`, `growth-recuperado-preventa`, `growth-inactivo`, `growth-baja-solicitada`/`growth-churn`. (CRM individual reusa `crm-provisionado` + tags propios `crm-*` análogos.)

### 1.7 NPS
`nps-promotor`/`nps-pasivo`/`nps-detractor` (RG/Terapia); `growth-nps-*` (Growth/CRM).

### 1.8 Limpieza de tags por hito
| Hito | Aplica | Quita |
|---|---|---|
| Link enviado | `plan-N-cuotas`, `link-enviado`, `seguimiento-activo` | — |
| Pagó | `pago-realizado`, `onboarding-iniciado` | `link-enviado`, `seguimiento-activo`, `recuperacion-prepago`, `cerrado-pendiente-pago` |
| Onboarding completo | `onboarding-completado`, `cliente-activo` | `onboarding-iniciado` |
| Cuota atrasada | `cuota-atrasada`, `riesgo-churn` | `cuota-proxima` |
| Cuota al día | — | `cuota-atrasada`, `cuota-proxima`, `riesgo-churn` |
| Agendó sesión | — | `sin-sesion-7d` |
| Fin programa | `programa-completado` | `en-programa` |
| Churn / pausa | `churn` o `pausa` | `cliente-activo`, `en-programa` |
| Win-back | `reingreso` | `churn` |

> **Saneamiento crítico:** borrar `pago-completo` y `pago-confirmado` de WF-04 y WF-Factura; dejar solo `pago-realizado`.

---

## 2. Pipelines
| Servicio | Pipeline | Acción |
|---|---|---|
| Re-Génesis completo | "Ventas Regénesis" + "Clientes Activos Re-Génesis" | Reusar tal cual. |
| Terapia | mismos | Reusar. Diferencia = tag `servicio-terapia` + Smart List, no etapa distinta. |
| Growth | "Growth Re-Génesis" | **Crear nuevo.** |
| CRM individual | "Growth Re-Génesis" o propio "CRM Re-Génesis" | Decidir (probablemente propio, ciclo más corto). |

**Pipeline "Growth Re-Génesis" (NUEVO, 8 etapas):** Lead Growth → Carrito abandonado → Pago confirmado → Onboarding en curso → Activo en comunidad → En riesgo → Recuperado → Baja/Churn.

---

## 3. Catálogo de mensajes (resumen — borradores completos en transcript)

Tono: cercano, directo, sin emojis excesivos, sin em-dash. Variable `{{contact.first_name}}`.
**[Plantilla]** = fuera de ventana 24h (requiere plantilla Meta). **[Libre]** = dentro de 24h.

### RG + Terapia
- **A) Recuperación pre-venta** (link sin pago): A1 +1h, A2 +1d, A3 +3d, A4 +7d (última llamada) + A5 nurture día 20.
- **B) Onboarding** (pagó): B1 pago recibido + firmas, B2/B3 recordatorio firma, B4 acceso listo (variante RG vs Terapia), B5 día 1 arranque, B6 sala de espera.
- **C) En programa** (cola Supabase → GHL): C1/C2 cuota próxima 3d/1d, C3/C4 cuota atrasada 1d/3d, C5 atrasada 7d + tarea Frank, C6 sin sesión 7d, C7 fin programa 5d, C8 NPS, C9 sin actividad 3d (Terapia), C-hito mitad (Terapia).
- **D) Post-venta**: D1 riesgo-churn, D2 pausa, D3 win-back +14d, D4 fin sin upsell.

### Growth / CRM individual
GW-A bienvenida pago (WA+email), GW-B acceso Skool (+10min), GW-C acceso CRM (+30min, usuario+clave temporal), GW-D kickoff (+2h) + GW-D2 recordatorio, GW-E* nutrición días 2/5/9/16/30, GW-F NPS, GW-G1/2/3 carrito abandonado (30min/24h/72h), GW-H1/2 churn.

---

## 4. Plan de cambios en GHL (ordenado)

### 4.1 Bugfixes RG (estado al 2026-06-12)
- ✅ F1 WF-04 webhook placeholder eliminado (v27).
- ✅ Rename acción "Contrato Media Firmado" (v4).
- ✅ NDA Firmado limpiada → borrador.
- ✅ F3 WF-10 `create_opportunity` → `opportunity_status:won` (mismo valor que WF-04 para el pipeline Clientes Activos), publicado v9. Resuelto el `undefined`.
- ✅ F4 Recipe Appointment **inglés** (`3f0d15a8`) despublicado → draft (v4); ya no manda correos en inglés en paralelo al español (`378893c4` se queda).
- ⏳ F2 unificar tags pago en WF-04/Factura → solo `pago-realizado`. **Pendiente: requiere verificar antes qué triggers/smart-lists escuchan `pago-completo`/`pago-confirmado` (los triggers viven en Firebase, no en el JSON del workflow) para no romper segmentación.**
- ⏳ F5 archivar en UI los 3 drafts: WF-07 (`3c85a62b`), WF-09 (`b91f09dc`), NDA (`d15fb852`). Ya están en draft (no corren); archivar es solo housekeeping. Endpoint de archive por API aún no descubierto.

### 4.2 SMS/email → WhatsApp en tramo crítico
WF-03 (link), WF-04 (pago), WF-06/07/08 (recordatorio firma), WF-11 (acceso, ramificar `servicio-terapia`).

### 4.3-ESTADO — Construidos como BORRADOR por API (2026-06-12)

Los 8 de seguimiento/cobranza ya existen como **draft** en la carpeta AUTOMATIZACIONES REGENESIS, cada uno con su acción WhatsApp (`whatsapp_v2`) y el texto del catálogo. **Falta por workflow (en GHL UI):** (1) agregar el trigger **Contact Tag = el tag indicado**, (2) revisar/ajustar el texto (sign-off Frank), (3) publicar. El trigger no se pudo escribir por API (vive en bucket Firebase); es 1 dropdown en el UI.

| Workflow (draft) | Trigger tag a poner | ID |
|---|---|---|
| RG · 20 · Cuota próxima 3d | `cuota-proxima` | d41beed1-2732-456a-be3f-7b8bbea9f88d |
| RG · 21 · Cuota próxima 1d | `cuota-proxima` | f76faf0d-8369-40d3-93a8-d68605de370f |
| RG · 22 · Cuota atrasada 1d | `cuota-atrasada` | e0781f97-5bde-4fdd-aac9-d426fbea723f |
| RG · 23 · Cuota atrasada 3d | `cuota-atrasada` | ad233857-af77-4bbc-b039-3d3d57d899d0 |
| RG · 24 · Cuota atrasada 7d | `cuota-atrasada` | 68174435-cd94-4248-89cc-c6e79dd1fe88 |
| RG · 25 · Sin sesión 7d | `sin-sesion-7d` | 3a129284-67f3-45b4-9f28-4c4e6589612b |
| RG · 26 · Fin de programa | `fin-programa-5d` | 06e7c63b-1596-405e-b89a-8b013f55adc7 |
| RG · 27 · NPS mensual | `nps-mensual` | c0ee961a-e55b-400e-9dd0-ec8d3f66e5cc |

> Nota: para los que llevan datos dinámicos (monto/fecha de cuota), el texto usa solo `{{contact.first_name}}`; los campos de cuota se insertan en UI como custom values cuando estén definidos. Falta aún: recuperación pre-venta (RG·30), win-back (RG·31), set Growth, y la variante Terapia (`sin-actividad-3d`).

### 4.2-B — FLUJO REAL de onboarding + registro en plataforma (verificado por API 2026-06-12)

**El "registro en la plataforma" NO lo dispara un tag: lo dispara un WEBHOOK dentro del workflow de pago.**

| Paso | Workflow | Tags que agrega | Tags que quita | Webhook |
|---|---|---|---|---|
| Pago tarjeta | WF-04 | `onboarding-iniciado`, `pago-completo`, `pago-realizado` | `link-enviado`, `seguimiento-activo` | **`webhook-ghl`** (crea lead en Supabase + `procesar_nuevo_cliente`) |
| Pago efectivo/factura | WF-Factura | `pago-confirmado`, `pago-completo` | `pago-efectivo-invoice-enviado` | **`webhook-ghl`** (mismo registro) |
| Firma servicio | Firma_Servicio | `contrato_servicio_firmado` | — | `webhook-firma` |
| Firma waiver | Firma_Waiver | `contrato_waiver_firmado` | — | `webhook-firma` |
| Firma media | Firma_Media | `contrato_media_firmado` | — | `webhook-firma` |
| Onboarding completo | WF-10 | `onboarding-completado` | — | (mueve oportunidad) |
| Acceso plataforma | WF-11 | `programa-bienvenida-enviada` | — | (email/SMS acceso) |

**Hallazgos críticos del análisis:**
1. **Registro plataforma = webhook `webhook-ghl`** (dentro de WF-04 y WF-Factura). Ese webhook crea el lead y emite el acceso. No hay un "tag de registro" único; el evento es el pago.
2. **Inconsistencia de tag de pago confirmada:** tarjeta pone `pago-realizado`, efectivo pone `pago-confirmado`; el **único común a ambas rutas es `pago-completo`**. Cualquier automatización que pregunte "¿pagó?" debe usar `pago-completo`, NO `pago-realizado` (que no se pone en pagos por efectivo).
3. **Corrección a "RG · Cobranza de cuota (lógica)":** el if/else "¿ya pagó?" NO debe mirar `pago-realizado` (sería un falso negativo en efectivo). Para COBRANZA DE CUOTA el signal correcto es que **la plataforma quite el tag `cuota-atrasada`** cuando registra el pago de esa cuota. El if/else debe ser: "¿sigue con `cuota-atrasada`?" → No = pagó = salir. (Pendiente: confirmar que el edge function/cron quite `cuota-atrasada` al pagar la cuota; ver reglas_automatizacion.)
4. **Onboarding se dispara por `onboarding-iniciado`** (lo pone WF-04). Las firmas avanzan con `contrato_*_firmado`; cuando los 3 están, WF-10 pone `onboarding-completado` y WF-11 abre el acceso.

### 4.2-C — HALLAZGO de integración (verificado en Supabase 2026-06-12)

Cómo dispara realmente la plataforma a GHL (`procesar-cola-automatizaciones`):
- Lee `notificaciones_pendientes` (estado=pendiente) → setea custom fields en GHL → **`POST /contacts/{contactId}/workflow/{workflowId}`** (añade el contacto DIRECTO al workflow por ID). **NO agrega un tag.**
- Las 5 reglas de cuota existen pero están **inactivas y sin `ghl_workflow_id`** (`cuota_atrasada_1d/3d/7d`, `cuota_proxima_1d/3d`, canal `ghl_workflow`).

**Implicaciones (importantes):**
1. **El modelo es "añadir contacto al workflow por ID", no "tag → trigger".** Mis workflows igual corren cuando la plataforma mete al contacto (los pasos se ejecutan aunque el trigger sea por tag). Pero el if/else que mira el tag `cuota-atrasada` está mal: la plataforma no agrega ese tag.
2. **`sync-ghl-pagos` solo REGISTRA el pago en la tabla `pagos`. NO detiene la secuencia de cobranza** (no quita tag, no saca al contacto del workflow). **→ Falta el cierre del ciclo: cuando el cliente paga la cuota, nada le dice a GHL que pare de cobrarle.**

**Diseño correcto (decidido):**
- **Un solo workflow inteligente** `RG · Cobranza de cuota (lógica)` (id `e33b755c`) maneja toda la escalada (D1/D3/D7) internamente con waits. Por tanto:
  - Mapear solo `cuota_atrasada_1d.ghl_workflow_id = e33b755c` y activarla. `cuota_atrasada_3d`/`7d` quedan **redundantes** (el workflow ya escala solo) → desactivar.
  - `cuota_proxima_3d → d41beed1` (RG·20), `cuota_proxima_1d → f76faf0d` (RG·21).
- **Cierre del ciclo (a construir):** cuando `sync-ghl-pagos` detecte el pago de la cuota, debe **sacar al contacto del workflow de cobranza** (`DELETE /contacts/{id}/workflow/{wfid}`) o setear un custom field `cuota_estado=al_dia` que el if/else mire. Sin esto, el dunning no se detiene al pagar. (Cambio en edge function productiva → requiere confirmación.)
- El if/else del workflow de cobranza debe basarse en ese **custom field** (`cuota_estado`), no en un tag que nadie pone. Lo ajusto cuando definamos el campo.

### 4.3 Workflows nuevos RG/Terapia (cola Supabase → GHL)
Cada uno: trigger Inbound Webhook (lo dispara `procesar-cola-automatizaciones`), una acción Send WhatsApp. Tras crear, copiar `workflowId` → `reglas_automatizacion.ghl_workflow_id` y `activa=true`.
`RG·20` cuota próx 3d, `RG·21` próx 1d, `RG·22/23/24` atrasada 1d/3d/7d, `RG·25` sin sesión 7d, `RG·26` fin programa, `RG·27` NPS, `RG·28` sin actividad 3d (Terapia), `RG·30` recuperación prepago, `RG·31` win-back.

### 4.4-DECISIÓN — Terapia REUSA los mismos workflows (no se duplica nada) [decidido 2026-06-12]

**Decisión:** Terapia Re-Génesis **reusa exactamente los mismos workflows** que Re-Génesis completo. NO se crean workflows separados de cobranza/sesión/NPS/recuperación. Razón: todos disparan por tags operativos (`cuota-atrasada`, `sin-sesion-7d`, `nps-mensual`) idénticos para ambos servicios; el programa de 70 días es el mismo. Duplicar sería redundancia pura y más difícil de mantener.

**Lo único que difiere en Terapia** (vía rama por tag `servicio-terapia`):
1. **Acceso (WF-11):** copy propio que menciona solo `/regenesis/` (diario, pregunta del día), sin módulos de negocio.
2. **Tag `servicio-terapia`** (lo pone WF-04 si el form de Cierre marcó servicio=terapia). Segmenta y permite al front recortar módulos.
3. **Opcional:** workflow `sin-actividad-3d` (no escribe en diario), más relevante en Terapia.

Todo lo demás es **compartido**: una sola fuente por lógica, segmentada por tag de servicio. Sistema simple y fácil de recorrer.

### 4.4-B — Etiqueta de pago canónica (redundancia) [decidido 2026-06-12]
**Canónica = `pago-completo`** (única presente en AMBAS rutas: tarjeta y efectivo). Toda automatización que pregunte "¿pagó?" usa `pago-completo`.
- `pago-realizado` (solo tarjeta) y `pago-confirmado` (solo efectivo) son redundantes.
- ⚠️ **NO se quitan aún de WF-04/WF-Factura:** son workflows de pago en producción y algún workflow de contratos podría DISPARARSE con esos tags (triggers en bucket Firebase, no verificables sin riesgo). Cleanup recomendado aparte: leer triggers de los workflows de contrato, confirmar que disparan por `onboarding-iniciado`, y recién ahí limpiar.

### 4.4 Terapia (ramificación, sin duplicar)
T1 custom field `servicio_programa` (regenesis/terapia/growth/crm). T2 radio en form "Cierre". T3 condicional en WF-04 + `"servicio"` en body del webhook. T4 ramificar WF-11. T5 reusar firmas/efectivo/cierre/pipeline. T6 reusar `ghl_workflow_id` de cuota/sesión/NPS.

### 4.5 Growth (carpeta nueva)
Pre-req: pipeline Growth, custom values (`skool_invite_url`, `crm_login_url`, `growth_payment_url`, `kickoff_calendar_url`), custom field `crm_temp_password`, producto/payment-link Growth separado.
GW-01 pago, GW-02 entrega accesos, GW-03 coordinación arranque, GW-04 nutrición, GW-08 carrito, GW-09 NPS, GW-10 churn, GW-11 provisión CRM (hoy: con SaaS Mode auto-provisiona; ver §8).

---

## 5. Plantillas WhatsApp a someter a Meta (~20-23)
Categoría UTILITY, idioma es, variables posicionales `{{1}}…`, valor de muestra obligatorio, links en botón URL (no en cuerpo), nunca variable al inicio/fin.

- **P0 acceso plataforma:** `rg_pago_recibido_onboarding`, `rg_recordatorio_firma_pendiente`, `rg_acceso_plataforma_listo` (+ `terapia_acceso_plataforma_listo`), `rg_dia_1_arranque`, `rg_sala_de_espera`.
- **P1 seguimiento:** `rg_cuota_proxima`, `rg_cuota_atrasada`, `rg_cuota_atrasada_final`, `rg_sin_sesion_reagenda`, `rg_fin_programa_cierre`, `rg_nps_mensual`, `rg_sin_actividad`.
- **P2 recuperación:** `rg_carrito_link_pago`, `rg_carrito_cupo`, `rg_carrito_ultima_llamada`, `rg_winback_pausa`, `rg_winback_reingreso`.
- **P3 Growth/CRM:** `gw_bienvenida_pago`, `gw_acceso_skool`, `gw_acceso_crm`, `gw_kickoff_agenda`, `gw_carrito_abandonado`, `gw_nps_mensual`.

> **Aprobación Meta:** GHL es el BSP; **no hay endpoint/MCP estable para crear plantillas por API** → se crean **a mano en GHL UI** (Marketing → WhatsApp Templates). Meta revisa en minutos–48h. Riesgo de recategorización a MARKETING en carrito/win-back (solo cambia costeo).

---

## 6. Decisiones que requieren a Frank (bloqueantes)
1. **Sign-off de textos de marca** (§3) antes de enviar a clientes reales.
2. **Migración Supabase** (BD productiva, requiere confirmación): `ALTER TABLE leads ADD COLUMN servicio text DEFAULT 'regenesis' CHECK (...)`, `webhook-ghl` persiste `leads.servicio`, nueva regla `sin_actividad_3d`, front recorta módulos en Terapia.
3. **Growth/CRM — SaaS Mode:** confirmar snapshot base de la sub-cuenta, conexión Stripe, trial 15d, landing/order-form. (Ver §8.)
4. **Producto/payment-link separado** por servicio para disparos limpios.
5. **CRM individual:** ¿pipeline propio? ¿se vende desde landing GHL nueva?

---

## 7. Orden de ejecución
- **Fase 0 saneamiento:** unificar tags pago (API/MCP) + bugfixes UI (F2-F5).
- **Fase 1 P0 acceso:** crear+someter plantillas P0 a Meta (24-48h) ∥ convertir WF-03/04/06/07/08/11 a WhatsApp.
- **Fase 2 Terapia:** confirmar+aplicar migración `leads.servicio` + custom field + condicional WF-04.
- **Fase 3 P1 seguimiento:** plantillas P1 + workflows `RG·20-28` + cablear `reglas_automatizacion` por SQL + encender 1 a 1.
- **Fase 4 P2 recuperación:** plantillas P2 + `RG·30/31`.
- **Fase 5 Growth+CRM:** SaaS Mode (§8) + pipeline + plantillas P3 + GW-01…GW-11.

### Qué se puede por API/MCP vs manual UI
| API/MCP | Manual GHL UI |
|---|---|
| Aplicar/quitar tags; mover oportunidades; leer conversaciones; editar/publicar workflows (API interna) | Crear/someter plantillas a Meta; crear pipelines/custom fields/forms; aprobar Meta |
| Migración SQL + `reglas_automatizacion` (con confirmación) | SaaS Mode configurator (Stripe, snapshot, order form) |

---

## 8. SaaS Mode (Growth + CRM individual) — qué es API vs UI

| Tarea | Vía | Nota |
|---|---|---|
| Precio $70/$700 | ✅ hecho (Frank, UI) | SaaS Configurator. |
| Trial 60 → **15 días** | API (`saas-billing-v2/billing-config`) o UI | Billing config, nivel agencia/company. Sensible (afecta cobro real). Hacer con backup+verify o por UI. |
| Auto-provisión sub-cuenta al pagar | UI (agencia) | SaaS Mode + snapshot base + Stripe conectado. No es workflow. |
| Snapshot base de la sub-cuenta | UI | Define qué trae cada CRM nuevo (pipelines, plantillas, automatizaciones). |
| Landing / order-form del servicio | UI (Funnels GHL) | Página de venta + checkout SaaS. |
| Aviso de credenciales al cliente | Workflow GHL (GW-C) | Tras provisión, dispara WhatsApp/email con login. |

**Conclusión:** el grueso de SaaS Mode es configuración de agencia en UI. Lo automatizable por API: el trial-days (con cuidado) y todo el ciclo de mensajería/tags/pipeline alrededor.
