# GHL — Automatizaciones Re-Génesis (cómo funciona)

> Mapa real de los workflows de GoHighLevel de Frank (sub-cuenta `BAnlOGbwz5e0mw95HroC`), leído por la API interna el 2026-06-11. Cubre las dos carpetas que creó Alex: **RE-GENESIS** y **AUTOMATIZACIONES REGENESIS**. La carpeta `[AUT] EVENTOS PASADOS` (Pine Line) queda fuera. Cómo se leyó: ver memoria `project_ghl_internal_api_workflows`.

## Pipelines (resuelven los `create_opportunity`)

| ID | Nombre | Etapas (orden) |
|---|---|---|
| `FeVYpvdszZe2l41sc5Nc` | **Ventas Regénesis** | Lead nuevo · Presentación agendada · Presentación realizada · Link de pago enviado · **Cliente pagado** (`258f42ae`) · Perdido-no pagó · Perdido-no agendó |
| `G3l5s8p66e5Evs2KVumv` | **Clientes Activos Re-Génesis** | **Onboarding Administrativo** (`94500fee`) · Onboarding Experiencia · Activo en Programa · Programa Completado |
| `KUNZOmXMkdFkl4XYwSj8` | **[EVENTOS] CONFERENCIAS FRANK** | Lleno Form Life · Respondió Whatsapp · Envío formulario · Completó Formulario · Agendado Cita 1a1 · Asistió Webinar · Reunión de cierre · Cerrado · Perdido |

Otros pipelines existentes (no Re-Génesis): `Cliente Potencial`, `[FOR] Evolusha Evento 21 Marzo`, `Evento Miami 22 Marzo`.

## Webhooks → Supabase (puente GHL ↔ plataforma)
- `…/functions/v1/webhook-ghl` — recibe el pago (WF-04, WF Factura Pagada).
- `…/functions/v1/webhook-firma` — recibe la firma de cada contrato (los "Contrato X Firmado").

---

## Carpeta: RE-GENESIS (el funnel del programa)

### Fase 1 — Etiquetado de origen
- **WF-01 Tag Cliente Directo** `[pub]` — agrega tag `cliente-directo`.
- **WF-02 Tag Cerrado por Closer** `[pub]` — agrega tag `cerrado-por-closer`.

### Fase 2 — Envío de link de pago
- **WF-03 Envío de Link de Pago** `[pub]` (22 pasos) — ramifica por cuotas (1/2/3/4): email "¡Bienvenido a Re-Génesis! Tu link de pago está listo", crea oportunidad en **Ventas Regénesis**, tags `plan-N-cuotas` + `link-enviado`, notificación interna.
- **WF Solicitud efectivo** `[pub]` (18 pasos) — ruta de pago en efectivo: envía factura (Send Invoice, 4 variantes por cuotas), quita `pago-efectivo-pendiente`, agrega `pago-efectivo-invoice-enviado`.
- **WF Tag Efectivo** `[pub]` — agrega tag `pago-efectivo-pendiente` (marca que eligió efectivo).

### Fase 3 — Pago confirmado
- **WF-04 Pago Confirmado** `[pub]` (10 pasos) — el corazón:
  1. Oportunidad → Ventas Regénesis / **Cliente pagado**
  2. Oportunidad → Clientes Activos / **Onboarding Administrativo**
  3. Remove from workflow · 4. tags `onboarding-iniciado,pago-completo,pago-realizado` · 5. quita `link-enviado,seguimiento-activo`
  6. Email "¡Pago recibido! Bienvenido 🎉" · 7. notif interna
  8. **Webhook → `https://placeholder-n8n-frank.com/webhook/crear-carpeta-drive`** ⚠️ URL PLACEHOLDER, no existe
  9. Webhook → `webhook-ghl` (Supabase, correcto) · 10. Wait 2 min
- **WF Factura Pagada** `[pub]` (4 pasos) — pago por factura/efectivo confirmado: webhook `webhook-ghl`, quita `pago-efectivo-invoice-enviado`, agrega `pago-confirmado,pago-completo`, email "¡Confirmado! Tu acceso está listo".

### Fase 4 — Seguimiento al no-pago
- **WF-05 Alerta Ejecutivo 1h** `[pub]` — espera 1h, tarea de seguimiento, si sigue sin pagar → notif interna.
- **WF-06 Seguimiento Largo** `[pub]` (12 pasos) — nurture ~45 días: 20d→email, 2d→SMS Frank, 3d→tarea llamada Día 25, 5d→email "un regalo", tag `regalo-enviado`, tarea activar regalo en Skool, 15d→tag `perdido-no-pago`.

### Fase 5 — Contratos (envío)
Mismo esqueleto los 4 (wait → email contrato → wait 24h → notif → SMS Frank → wait 24h → tarea):
- **WF-08 Contrato de Servicio** `[pub]`
- **WF-08.1 Contrato de Waiver** `[pub]` (ojo: nombre sin prefijo "Re-Génesis —")
- **WF-08.2 Contrato de Media** `[pub]`
- **WF-09 Contrato de Confidencialidad** `[draft]` ⚠️ NO está activo

### Fase 6 — Contratos (firma recibida)
Mismo esqueleto los 4 (remove from workflow → tag `contrato_X_firmado` → webhook `webhook-firma`):
- **Contrato Servicio Firmado** `[pub]`
- **Contrato Waiver Firmado** `[pub]`
- **Contrato Media Firmado** `[pub]` ⚠️ la acción de tag se llama "Contrato servicio firmado" (etiqueta el tag correcto `contrato_media_firmado`, pero el nombre quedó copiado)
- **Contrato NDA Firmado** `[draft]` ⚠️ NO está activo

### Fase 7 — Onboarding + acceso
- **WF-10 Onboarding Completado** `[pub]` (7 pasos) — si contratos firmados → remove + tag `onboarding-completado`; si no → crea oportunidad en Clientes Activos (⚠️ `status=undefined`), notif interna.
- **WF-11 Acceso a Skool + Bienvenida** `[pub]` (6 pasos) — wait 30min, email "Tu acceso a la plataforma", wait 5min, SMS bienvenida, tag `programa-bienvenida-enviada`, notif interna.

### Apoyo a ventas
- **Cierre — Recordatorios al closer - Formulario** `[pub]` (11 pasos) — recordatorios basados en la cita: crea oportunidad en Conferencias, 5 min antes asigna closer + notif + tarea, 10 min después reasigna + notif.
- **Recipe - Appointment Confirmation + Reminder** `[pub]` ⚠️ **en INGLÉS** ("Appointment Confirmation", "Your Meeting is in 24 Hours"). Es la plantilla original sin localizar (ver duplicado en la otra carpeta).

---

## Carpeta: AUTOMATIZACIONES REGENESIS

- **Recipe - Appointment Confirmation + Reminder** `[pub]` — versión **en español** ("Confirmación de reunión - Admisión Regénesis", "¡Tu reunión es en 24 horas!"). Esta es la buena; la inglesa de la otra carpeta es el sobrante.
- **Asistencia Conferencia** `[pub]` — tag `confirma_asistencia`, oportunidad en Conferencias, wait 24 días.
- **Respondió Whatsapp** `[pub]` — crea oportunidad en Conferencias (etapa "Respondió Whatsapp").
- **Form Realtor** `[pub]` — oportunidad en Conferencias, tag `realtor_interesado`, wait 20 días.
- **Envio Formulario Realtor** `[pub]` — WhatsApp + DND + transiciones (entregado/no entregado).

> Nota: los dos "Realtor" parecen de un público/imán distinto (inmobiliario). Confirmar con Frank si pertenecen a Re-Génesis o deberían ir a otra carpeta/sub-cuenta.

---

## Hallazgos para "poner orden" (priorizados)

**🔴 Bugs / a arreglar ya**
1. **WF-04 paso 8: webhook a `placeholder-n8n-frank.com`** — URL inventada, nunca reemplazada. La intención era "crear carpeta Drive". O se cablea al endpoint real, o se elimina el paso.
2. **`create_opportunity` con `status=undefined`** en WF-10, Cierre y Asistencia — definir el status (open/won) o la etapa explícita.

**🟡 Redundancias / limpieza**
3. **Recipe Appointment Confirmation duplicado**: la versión inglesa (carpeta RE-GENESIS) es sobrante de la española (carpeta AUTOMATIZACIONES). Archivar/eliminar la inglesa.
4. **Tags redundantes de pago**: WF-04 agrega `pago-completo` Y `pago-realizado` (y existe además `pago-confirmado` en WF Factura). Unificar a UN tag canónico de "pagó".
5. **Etiqueta mal nombrada** en "Contrato Media Firmado" (acción se llama "Contrato servicio firmado").

**🟢 Naming / consistencia**
6. Esquema de nombres mixto: la mayoría usa `Re-Génesis — WF-XX …`, pero `WF-08.1 Contrato de Waiver`, los `Contrato X Firmado`, `Cierre — …` y los `WF Factura/efectivo/Tag` no siguen el patrón. Definir UN esquema (ej. `RG · NN · Fase · Nombre`).

**⚪ Borradores a decidir**
7. `WF-07 Email Bienvenida con Video`, `WF-09 Contrato de Confidencialidad`, `Contrato NDA Firmado` están en **draft** (no corren). Terminar o archivar.
