# Blueprint detallado de workflows por servicio (para revisar antes de construir)

> Cada workflow dibujado paso a paso: trigger, etiquetas que entran/salen, pipeline+etapa, esperas, correos (con su custom value de link), ramas y condiciones. Objetivo: que un lead se MUEVA con lógica, no workflows sueltos.
> Base: patrón real de WF-03/04/06/11. Emails: copy en `correos-recordatorios.md` (Frank revisa). Tiempos: mi criterio, Frank ajusta.

## A. Ciclo de vida de las ETIQUETAS (limpieza incluida)

| Etiqueta | Cuándo se AGREGA | Cuándo se QUITA | Para qué sirve |
|---|---|---|---|
| `terapia` / `growth` / `regenesis` | al entrar al form (intake) | nunca (identidad del servicio) | webhook (servicio), gating plataforma, ruteo de pipeline |
| `plan-1-cuota`..`plan-4-cuotas` | en la rama de plan del intake | nunca (registro del plan elegido) | saber qué plan tomó, cobranza |
| `link-enviado` | al enviar el link de pago | al confirmarse el pago | marca que está en venta abierta |
| `seguimiento-activo` | al enviar el link (solo tarjeta) | al pagar o al marcar perdido | dispara la secuencia de recuperación |
| `pago-efectivo` | rama efectivo del intake | al confirmarse el pago | el equipo cobra manual, no manda link |
| `pago-completo` | al confirmarse el pago | nunca | conversión; corta dunning/cobranza |
| `onboarding-iniciado` | al confirmarse el pago | al completar onboarding | dispara contratos / accesos |
| `onboarding-completado` | al firmar los contratos (WF-08) | — | dispara WF-11 (acceso) |
| `growth-provisionar-crm` | en onboarding Growth | cuando ops crea el CRM | tarea de provisión Live Lucky |
| `growth-activo` | fin onboarding Growth | en churn | cliente Growth operativo |
| `perdido-no-pago` | fin de recuperación sin pago | si vuelve y paga | mover oportunidad a "Perdido" |

**Regla de oro:** al pagar, SIEMPRE se quita `link-enviado` + `seguimiento-activo` y se hace `remove_from_workflow` de la recuperación, para que nadie reciba cobranza/recuperación después de pagar.

---

## B. TERAPIA

### TER · 01 · Intake + Link de pago
- **TRIGGER:** Form enviado = "Terapia Formulario Cuotas..." (`HKtVZzo97Cdp5ZCXxbDB`)
- **PASOS:**
  1. `+TAG` **terapia**
  2. `OPP` → pipeline **Ventas Terapia** (`Ttm8vpVfWibpTPfdNNKv`), etapa **Lead nuevo** (`e0e24b40`), nombre "{{contact.first_name}} · Terapia", status Open
  3. `IF` Método de Pago (`WEGbMclRbPwd1fYHmvn4`):
     - **Rama EFECTIVO** (== "Efectivo"):
       - `+TAG` pago-efectivo
       - `NOTIF-INTERNA` al closer: "Lead Terapia eligió efectivo, coordinar cobro · {{contact.first_name}} {{contact.phone}}"
       - `TASK` "Coordinar pago en efectivo · {{contact.first_name}}" (vence en 1 día)
       - (no se manda link ni se activa recuperación; se gestiona manual)
     - **Rama TARJETA** (else):
       - `IF` Cuotas Elegidas (`zQH8YILE4q34OkFvk7qR`):
         - "Pago único ($1,500…)" → `EMAIL` "Tu acceso a Re-Génesis Terapia, a un paso" (link `{{custom_values.link_pago_terapia_1_cuota}}`) + `+TAG` plan-1-cuota
         - "2 pagos…" → `EMAIL` (link `…terapia_2_cuotas`) + `+TAG` plan-2-cuotas
         - "3 pagos…" → `EMAIL` (link `…terapia_3_cuotas`) + `+TAG` plan-3-cuotas
         - "4 pagos…" → `EMAIL` (link `…terapia_4_cuotas`) + `+TAG` plan-4-cuotas
       - `OPP` mover a etapa **Link de pago enviado** (`8b1c294d`)
       - `+TAG` link-enviado, seguimiento-activo

### TER · 02 · Pago confirmado
- **TRIGGER:** Payment received, producto **Regénesis Terapia** (`6a2885bfa7bdaea6a54b8215`), precios [1pago `6a2885bfa7bdae2be14b822a`, 2 `…821a`, 3 `…823f`, 4 `…8244`], status succeeded · + Invoice paid del producto
- **PASOS:**
  1. `OPP` Ventas Terapia → etapa **Cliente pagado** (`fdc119e0`), status **WON**
  2. `OPP` crear en **Clientes Activos Re-Génesis** (`G3l5s8p66e5Evs2KVumv`) status WON (tracking de activos)
  3. `REMOVE_FROM_WF` → recuperación (TER · 03)
  4. `+TAG` pago-completo, onboarding-iniciado
  5. `-TAG` link-enviado, seguimiento-activo
  6. `EMAIL` "¡Pago recibido! Bienvenido a Re-Génesis Terapia 🎉"
  7. `WEBHOOK` → `https://eqyaddcidkywmedwscpu.supabase.co/functions/v1/webhook-ghl` (X-Webhook-Secret) → la plataforma crea el lead con servicio=terapia
  8. `WAIT` 2 min
  9. `NOTIF-INTERNA` "Nueva venta Terapia · {{contact.first_name}}"
- Después: los contratos (WF-08 servicio/waiver/media, ya existentes) firman → `onboarding-completado` → WF-11 da acceso. La plataforma muestra SOLO /regenesis/ (gating ya hecho).

### TER · 03 · Recuperación (no pagó)
- **TRIGGER:** tag **seguimiento-activo**
- **PASOS** (multi-toque, como WF-06):
  1. `WAIT` 1 día → `EMAIL` "¿Quedó alguna duda con tu acceso, {{first_name}}?"
  2. `WAIT` 2 días → `WHATSAPP/SMS` recordatorio corto
  3. `WAIT` 3 días → `TASK` "Llamar a {{first_name}} (Terapia, no pagó)"
  4. `WAIT` 5 días → `EMAIL` "Última oportunidad + bonus"
  5. `WAIT` 4 días → `IF` tiene `pago-completo`? sí → salir / no → `+TAG` perdido-no-pago + `OPP` mover a **Perdido - no pagó** (`08a67383`)
- (Se reutiliza la lógica de WF-06; copy adaptado a Terapia.)

---

## C. GROWTH (no entra a plataforma; tras pagar = CRM + Skool)

### GRW · 01 · Intake + Link de pago
- **TRIGGER:** Form enviado = "Growth Formulario Cuotas..." (`6fKxuX9jNPFmfF2YOczu`)
- **PASOS:** idéntico a TER·01 pero:
  - `+TAG` **growth**
  - `OPP` pipeline **Ventas Growth** (`K6FuvzpDvuqD2wKrNXAn`), Lead nuevo (`d24a47eb`) → Link enviado (`b5fc09b0`)
  - Cuotas field `5QZ3PfccE1SM1DQ5KkOe`; emails con `{{custom_values.link_pago_growth_1_cuota}}`..`_4_cuotas`
  - `+TAG` link-enviado, seguimiento-activo (rama tarjeta)

### GRW · 02 · Pago confirmado
- **TRIGGER:** Payment received producto **Regénesis Growth** (`6a288655988da3076f821bed`), precios [1 `6a288655988da32d93821bf7`, 2 `…bf2`, 3 `…bfc`, 4 `…c01`], succeeded
- **PASOS:**
  1. `OPP` Ventas Growth → **Cliente pagado** (`c2a3743e`) WON
  2. `REMOVE_FROM_WF` recuperación (GRW·03)
  3. `+TAG` pago-completo, onboarding-iniciado, growth-pagado / `-TAG` link-enviado, seguimiento-activo
  4. `EMAIL` "¡Bienvenido a Re-Génesis Growth!"
  5. `WEBHOOK` → webhook-ghl (servicio=growth) — NOTA: Growth no usa la plataforma terapéutica; confirmar con Frank si el webhook debe crear lead o no (quizá saltarlo)
  6. `WAIT` 2 min → `NOTIF-INTERNA` "Nueva venta Growth"

### GRW · 03 · Recuperación (no pagó)
- Igual que TER·03 con pipeline Growth (Perdido `3e81272c`).

### GRW · 04 · Onboarding (Skool + CRM)
- **TRIGGER:** tag **growth-pagado**
- **PASOS:**
  1. `OPP` Ventas Growth → etapa **Onboarding (Skool + CRM)** (`ef837cb0`)
  2. `EMAIL` "Tu acceso: comunidad Skool" (link Skool)
  3. `WAIT` 10 min
  4. `TASK` (ops) "Provisionar CRM Live Lucky · {{first_name}}" + `+TAG` growth-provisionar-crm
  5. `EMAIL` "Tu CRM Live Lucky (te llega el acceso)"
  6. `WAIT` 1 día
  7. `OPP` → etapa **Activo** (`40364cd8`) + `+TAG` growth-activo
  8. `NOTIF-INTERNA` "Growth {{first_name}} activo (verificar Skool + CRM)"

---

## D. RE-GÉNESIS (full) — YA EXISTE, no se toca
WF-01..WF-11 cubren el funnel completo (forms → WF-03 link → WF-04 pago → WF-06 recuperación → contratos → WF-11 Skool/plataforma). El `RG · Ventas (mueve pipeline)` skeleton se DESCARTA (redundante).

---

## E. Qué se hace con lo que ya construí (skeletons)
- `TER/GRW/RG · Ventas (mueve pipeline)`: **borrar** (eran gate de etiqueta sin lógica).
- `RG · Recordatorio diario` (70 emails): **conservar** (sirve; falta ventana 8am en Settings).
- `New Workflow 78839356` (prueba): borrar.
- Cobranza RG·20-27 + lógica: se quedan; se conectan cuando se enciendan las reglas.

## F. Preguntas para Frank antes de construir
1. **Efectivo**: ¿la rama efectivo solo notifica al equipo y crea tarea, o también manda algún mensaje al lead?
2. **Growth + webhook**: ¿Growth debe crear lead en la plataforma (webhook-ghl) o se salta (solo CRM+Skool)?
3. **Tiempos de recuperación**: ¿1/2/3/5/4 días está bien o prefieres otra cadencia?
4. **Skool link de Growth**: ¿es el mismo `skool.com/neurohackers` u otro grupo?
5. **CRM Growth**: ¿la provisión del CRM es manual (tarea a ops) por ahora, o ya hay auto-provisión SaaS?
