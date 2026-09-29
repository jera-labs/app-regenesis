# Configuración de GHL — Re-Génesis Platform

> Esta guía es para Frank (o quien administre GHL). Configura los workflows que conectan GHL con la plataforma de Re-Génesis.

## Resumen del flujo

```
Closer agenda llamada de cierre
    ↓
GHL workflow [RECORDATORIOS CIERRE] envía link prefilled al closer
(15 min antes, al inicio, 60 min después)
    ↓
Closer captura modalidad + cuotas en form GHL "Cierre"
    ↓
Cliente paga (1ra cuota) — modalidad y cuotas ya están en su contacto
    ↓
GHL workflow [PAGO] dispara webhook → crea lead en Supabase + envía invite email
    ↓
GHL redirige al cliente a /bienvenida.html
    ↓
Cliente firma Contrato de Servicio
    ↓
GHL workflow [FIRMA SERVICIO] → webhook a Supabase
    ↓
Cliente firma Waiver / Liability Release
    ↓
GHL workflow [FIRMA WAIVER] → webhook a Supabase
    ↓
Cliente firma Media Release
    ↓
GHL workflow [FIRMA MEDIA] → webhook a Supabase
    ↓
bienvenida.html detecta los 3 contratos → muestra "Entrar a Re-Génesis"
    ↓
Cliente entra a la plataforma con magic link auto-generado
```

> El **NDA** es opcional para acceso a la plataforma — si Frank lo activa más adelante, basta con agregar otro Workflow de firma con `tipo_contrato: "nda"` y se registrará en BD sin bloquear el ingreso.

## Datos que necesitas tener a mano

| Variable | Valor |
|---|---|
| **URL base Supabase** | `https://eqyaddcidkywmedwscpu.supabase.co` |
| **Webhook secret** | `wh_17df77139d534e5c9892e3da144815b2` |
| **URL del subdominio** | `https://neurohackers.cloud` |

---

## Workflow 1 — PAGO CONFIRMADO

**Trigger:** Pago recibido (Stripe / método integrado en GHL)

**Acciones (en este orden):**

### 1.1 — Aplicar tag `pago_confirmado`

### 1.2 — Llamar webhook a Supabase para crear el lead

- **Method:** `POST`
- **URL:** `https://eqyaddcidkywmedwscpu.supabase.co/functions/v1/webhook-ghl`
- **Headers:**
  - `Content-Type: application/json`
  - `X-Webhook-Secret: wh_17df77139d534e5c9892e3da144815b2`
- **Body (JSON):**
  ```json
  {
    "email": "{{contact.email}}",
    "firstName": "{{contact.first_name}}",
    "lastName": "{{contact.last_name}}",
    "phone": "{{contact.phone}}",
    "country": "{{contact.country}}",
    "city": "{{contact.city}}",
    "ghl_contact_id": "{{contact.id}}",
    "fecha_pago": "{{event.date_added}}",
    "precio_pagado": "{{customer.amount_paid}}",
    "modalidad": "{{contact.modalidad_programa}}",
    "cuotas_elegidas": "{{contact.cuotas_elegidas}}",
    "utm_source": "{{contact.attributionSource.utmSource}}",
    "utm_campaign": "{{contact.attributionSource.utmCampaign}}"
  }
  ```

> ℹ️ Los campos `modalidad_programa` y `cuotas_elegidas` los rellena el closer en el form de cierre **antes del pago** (ver "Workflow Cierre" más abajo). Si por alguna razón llegan vacíos, el lead se crea igual y los campos quedan NULL en Supabase — Frank/Tatiana los completan desde el admin.

### 1.3 — Enviar el contrato de servicio (Documents & Contracts)

GHL → Documents → enviar el contrato de servicio al contacto. Esto deja el documento en su perfil listo para firmar.

### 1.4 — Enviar el NDA

Igual que el anterior, con el NDA.

### 1.5 — Redirigir al cliente

En la confirmación del pago (la página de "Thank you" del producto/funnel), configura como **Redirect URL:**

```
https://neurohackers.cloud/bienvenida.html?gid={{contact.id}}
```

> ⚠️ Importante: el `{{contact.id}}` se reemplaza automáticamente por GHL con el ID real del contacto. Es lo que la página de bienvenida usa para identificar al cliente.

---

## Workflow 2 — FIRMA CONTRATO DE SERVICIO

**Documento en GHL:** `Contrato de Prestación de Servicios`
**URL pública:** `https://link.neurohackers.top/documents/doc-form/69f2bd1a51631f52b3a5951c`

**Trigger:** Document Signed (filtrar por este documento)

**Acciones:**

### 2.1 — Aplicar tag `contrato_servicio_firmado`

### 2.2 — Webhook a Supabase

- **Method:** `POST`
- **URL:** `https://eqyaddcidkywmedwscpu.supabase.co/functions/v1/webhook-firma`
- **Headers:**
  - `Content-Type: application/json`
  - `X-Webhook-Secret: wh_17df77139d534e5c9892e3da144815b2`
- **Body (JSON):**
  ```json
  {
    "email": "{{contact.email}}",
    "tipo_contrato": "servicio",
    "documento_url": "{{document.url}}"
  }
  ```

### 2.3 — Redirigir tras la firma

En el documento (Documents → contrato → Settings → After Sign Redirect):

```
https://neurohackers.cloud/bienvenida.html?gid={{contact.id}}
```

Después de firmar, el cliente vuelve a bienvenida y ve el paso 02 ✓ y el 03 desbloqueado.

---

## Workflow 3 — FIRMA WAIVER (Liability Release)

**Documento en GHL:** `Waiver — Liability Release`
**URL pública:** `https://link.neurohackers.top/documents/doc-form/69fb5c949e75ad690e4b5b6e`

**Trigger:** Document Signed (filtrar por este documento)

**Acciones:**

### 3.1 — Aplicar tag `contrato_waiver_firmado`

### 3.2 — Webhook a Supabase

- **Method:** `POST`
- **URL:** `https://eqyaddcidkywmedwscpu.supabase.co/functions/v1/webhook-firma`
- **Headers:** mismos que workflow 2.
- **Body (JSON):**
  ```json
  {
    "email": "{{contact.email}}",
    "tipo_contrato": "waiver",
    "documento_url": "{{document.url}}"
  }
  ```

### 3.3 — Redirigir tras la firma

```
https://neurohackers.cloud/bienvenida.html?gid={{contact.id}}
```

---

## Workflow 4 — FIRMA MEDIA RELEASE

**Documento en GHL:** `Media Release — Derechos de Imagen`
**URL pública:** `https://link.neurohackers.top/documents/doc-form/69faaef2b202948fdae2ed45`

**Trigger:** Document Signed (filtrar por este documento)

**Acciones:**

### 4.1 — Aplicar tag `contrato_media_firmado`

### 4.2 — Webhook a Supabase

- **Method:** `POST`
- **URL:** `https://eqyaddcidkywmedwscpu.supabase.co/functions/v1/webhook-firma`
- **Headers:** mismos que workflow 2.
- **Body (JSON):**
  ```json
  {
    "email": "{{contact.email}}",
    "tipo_contrato": "media",
    "documento_url": "{{document.url}}"
  }
  ```

### 4.3 — Redirigir tras la firma

```
https://neurohackers.cloud/bienvenida.html?gid={{contact.id}}
```

### 4.4 — (Opcional) Aplicar tag `cliente_activo`

Cuando se firma este último (es el 3ro y desbloquea acceso), aplicar tag global de "onboarding completo". Útil para segmentación futura.

---

## Workflow 5 — FIRMA NDA (opcional, futuro)

Si Frank define un NDA aparte y lo monta como Documents & Contracts:

**Body del webhook:**
```json
{
  "email": "{{contact.email}}",
  "tipo_contrato": "nda",
  "documento_url": "{{document.url}}"
}
```

**Importante:** la plataforma actualmente NO bloquea el acceso por NDA — los 3 obligatorios son servicio + waiver + media. Si quieres que el NDA se vuelva obligatorio, hay que ampliar la lógica de `bienvenida-estado` y `bienvenida.html` (avísame cuando llegue).

---

## Workflows recomendados de recordatorio

Para que el cliente no se quede a medias en alguno de los 3 contratos obligatorios:

### Workflow 6 — Recordatorio si no firma Contrato de Servicio

**Trigger:** Tag `pago_confirmado` aplicado, esperar 1 hora.

**Condición:** Tag `contrato_servicio_firmado` NO aplicado.

**Acción:** Enviar SMS/Email — "Hola {{contact.first_name}}, tu pago ya está confirmado pero te falta firmar el contrato de servicio para empezar. Toma 2 minutos: [link al contrato]"

Repetir con esperas de 24h y 72h, escalando el copy.

### Workflow 7 — Recordatorio si no firma Waiver

**Trigger:** Tag `contrato_servicio_firmado` aplicado, esperar 1 hora.
**Condición:** Tag `contrato_waiver_firmado` NO aplicado.
Mismo patrón.

### Workflow 8 — Recordatorio si no firma Media Release

**Trigger:** Tag `contrato_waiver_firmado` aplicado, esperar 1 hora.
**Condición:** Tag `contrato_media_firmado` NO aplicado.
Mismo patrón.

---

## Workflow Cierre — Captura de modalidad y cuotas (pre-pago)

Antes del pago, el closer toma una llamada de cierre con el lead. Durante o después de esa llamada captura **modalidad del programa** (presencial/virtual) y **cuotas elegidas** (1, 2, 3, 4, 6, 12) en un form GHL. Esos custom fields se persisten en el contacto y los leemos cuando llega el webhook de pago.

### Setup único

**1. Custom fields del contacto (Settings → Custom Fields):**
- `modalidad_programa` · Single Options · valores: `Presencial`, `Virtual`
- `cuotas_elegidas` · Single Options · valores: `1`, `2`, `3`, `4`, `6`, `12` (ajustar a tu oferta real)
- `resultado_cierre` · Single Options · valores: `Cerrado`, `No interesado`, `No se presentó`, `Reagendado`, `Necesita más info`

**2. Form GHL "Cierre — Datos del programa"** (Sites → Forms → + Create Form):

| Campo | Tipo | Visibilidad | Conditional Logic |
|---|---|---|---|
| `first_name` (estándar) | Text | Visible (prefilled) | siempre |
| `email` (estándar) | Email | **Hidden** (prefilled) | siempre |
| `resultado_cierre` | Custom · Radio | Visible | siempre |
| `modalidad_programa` | Custom · Radio | Visible | solo si `resultado_cierre = Cerrado` |
| `cuotas_elegidas` | Custom · Dropdown | Visible | solo si `resultado_cierre = Cerrado` |

URL pública del form (a 2026-05-04): `https://link.neurohackers.top/widget/form/eazZSMiIa9aDRcgtDDLq`

**Link prefilled que se manda al closer:**
```
https://link.neurohackers.top/widget/form/eazZSMiIa9aDRcgtDDLq?email={{contact.email}}&first_name={{contact.first_name}}&last_name={{contact.last_name}}
```

### Workflow 6 — Cierre · Recordatorios al closer

**Trigger:** `Customer Booked Appointment` (filter por el calendario de los closers).

**Acciones en orden:**

1. **Wait until:** 15 minutes BEFORE appointment start time
2. **If/Else:** `resultado_cierre is empty` → continúa solo si todavía no capturó
3. **Create Task** asignada a `{{appointment.assigned_user}}`
   - Title: `Captura cierre · {{contact.first_name}} {{contact.last_name}}`
   - Description: `Llamada en 15 min. Form: <link prefilled>`
   - Due: `{{appointment.start_time}}`
4. **Send Internal Notification** (Email + Push) a Assigned User
   - Subject: `Cierre con {{contact.first_name}} en 15 min`
   - Body: `Captura: <link prefilled>`
5. **Wait until:** appointment START time
6. **If/Else:** `resultado_cierre is empty`
7. **Send Internal Notification** a Assigned User
   - Subject: `⏰ Llamada AHORA con {{contact.first_name}} · form listo`
8. **Wait:** 60 minutes after appointment start time
9. **If/Else:** `resultado_cierre is empty`
10. **Send Internal Notification + Create Task**
    - Title: `PENDIENTE · captura resultado {{contact.first_name}}`
    - Body: `La llamada terminó. Aunque haya sido no-show o no-interesado, marca el resultado para cerrar el ciclo. Form: <link>`
11. **Wait:** 24 hours
12. **If/Else:** `resultado_cierre still empty`
13. **Send Internal Notification al manager** (Frank/Alex) — escalada operativa.

### Tags por resultado del cierre (workflow paralelo)

Cuando llega el form submit, dispara un workflow que aplica tags según `resultado_cierre`:
- `Cerrado` → tag `cerrado_pendiente_pago` (luego se complementa con el workflow de pago)
- `No interesado` → tag `descalificado_no_interes`
- `No se presentó` → tag `no_show_1`
- `Reagendado` → tag `reagendado`
- `Necesita más info` → tag `nurturing`

### Test antes de producción

1. Asígnate a ti mismo (Alex) como `assigned_user` de un calendario de prueba.
2. Crea un contacto dummy con un email de prueba.
3. Agéndale una cita 20 minutos en el futuro.
4. Verifica que recibes los 3 recordatorios (15 min antes, en t=0, 60 min después si no llenaste el form).
5. Llena el form con `resultado_cierre = Cerrado` + modalidad + cuotas.
6. En GHL → Contact → Custom Fields, verifica que los 3 campos quedaron seteados.
7. Verifica que el recordatorio del minuto 60 NO te llega (la condición `is empty` lo cortó).

---

## Cómo verificar que todo funciona

1. En tu cuenta admin de Re-Génesis, entra a **Cron & Webhooks**
2. Verás cada evento que llega de GHL en la tabla "Webhooks GHL recibidos"
3. Cada fila muestra: HTTP status, resultado, lead asociado, error si hubo
4. Si algo falla, el `error` te dice qué corregir

## Test antes de poner en producción

Crea un workflow temporal con un email tuyo de prueba. Dispáralo manualmente:

1. Aplica tag `pago_confirmado` a tu propio contacto en GHL
2. Verifica que el lead aparece en Re-Génesis admin → Clientes
3. Verifica que recibes el invite email
4. Abre `https://neurohackers.cloud/bienvenida.html?gid=TU_CONTACT_ID` y deberías ver tu nombre y los 4 pasos
5. Firma el contrato de servicio en GHL
6. Espera 4 segundos en la página de bienvenida — debería aparecer ✓ en el paso 02
7. Repite con NDA
8. Cuando ambos firmados, click en "Entrar a Re-Génesis"
9. Auto-login → debería caer al dashboard

## Si algo no funciona

| Síntoma | Posible causa |
|---|---|
| "cliente no encontrado" en bienvenida.html | El webhook de pago no creó el lead. Revisa el Cron & Webhooks del admin. |
| El paso 02 no se marca tras firmar | El workflow de firma no envió el webhook. Revisa que `tipo_contrato` sea exactamente `"servicio"` o `"nda"`. |
| El cliente entra a la plataforma sin firmar | Verifica que las columnas `contrato_servicio_firmado_at` y `contrato_nda_firmado_at` estén en NULL para ese lead. El frontend redirige correctamente solo si está bien en BD. |
| HTTP 401 en webhook_log | El `X-Webhook-Secret` está mal escrito. Cópialo exacto del .env. |
| HTTP 400 "tipo_contrato debe ser..." | El body del webhook no manda `tipo_contrato` o lo manda con otro valor. Debe ser literal `"servicio"` o `"nda"`. |

---

# Pago en efectivo (flow paralelo a Stripe)

Algunos clientes quieren pagar en efectivo (cash, transferencia local, etc.). El flujo es paralelo al de tarjeta:

```
Cliente elige "Pago en efectivo" en el form de cierre
    ↓
Form GHL setea metodo_pago = "efectivo" + tag "pago-efectivo-pendiente"
    ↓
Redirige a /pago.html?metodo=efectivo&cuotas=N&email=...&first_name=...
    ↓
pago.html muestra pantalla "Solicitud registrada" (sin redirect a Stripe)
    ↓
GHL Workflow [SOLICITUD EFECTIVO] dispara por el tag
    ├─ If cuotas = 1 → Create Invoice desde template "Regénesis · 1ra de 1" ($1987)
    ├─ If cuotas = 2 → Create Invoice desde template "Regénesis · 1ra de 2" ($1100)
    ├─ If cuotas = 3 → Create Invoice desde template "Regénesis · 1ra de 3" ($800)
    └─ If cuotas = 4 → Create Invoice desde template "Regénesis · 1ra de 4" ($622)
    ↓
Workflow envía invoice al cliente (email + SMS)
    ↓
Frank recibe el pago en efectivo
    ↓
Frank marca el invoice como "Paid" en GHL (manualmente)
    ↓
GHL Workflow [INVOICE PAID] dispara webhook a Supabase
    ↓
webhook-ghl crea/actualiza lead → estado='pagado_calentamiento'
    ↓
Cliente recibe email con link a /bienvenida.html → firma los 3 contratos
```

## Paso 1 — Templates de invoice (4 templates)

En GHL → Payments → Invoices → Templates, crear 4 templates con **quantity = 1** (no la cantidad total de cuotas, solo la primera):

| Template | Producto | Quantity | Precio | Subtotal |
|---|---|---|---|---|
| **Regénesis · 1ra de 1** | Regénesis | 1 | $1987 | $1987 |
| **Regénesis · 1ra de 2** | Regénesis | 1 | $1100 | $1100 |
| **Regénesis · 1ra de 3** | Regénesis | 1 | $800 | $800 |
| **Regénesis · 1ra de 4** | Regénesis | 1 | $622 | $622 |

> ⚠️ Los templates con qty=4 que ya creaste (que dan total de $2488) NO sirven para activar el lead en la primera cuota — el trigger `Invoice Paid` solo dispara cuando el invoice está totalmente pagado. Hay que crear los 4 templates de arriba (qty=1) o editarlos para que cobren solo la primera cuota.

Las cuotas 2, 3 y 4 las cobras tú aparte (recordatorio manual + nuevo invoice).

## Paso 2 — Form de cierre: agregar campo `metodo_pago`

En el form GHL "Cierre", agrega un radio button:

- **Campo:** `metodo_pago` (custom field tipo Radio o Dropdown)
- **Opciones:** `tarjeta` / `efectivo`
- **Default:** `tarjeta`

Y configura el redirect del form para que pase el `metodo_pago` como query param:

```
https://neurohackers.cloud/pago.html?metodo={{custom_values.metodo_pago}}&cuotas={{custom_values.cuotas_elegidas}}&email={{contact.email}}&first_name={{contact.first_name}}&last_name={{contact.last_name}}&phone={{contact.phone}}
```

## Paso 3 — Workflow `SOLICITUD EFECTIVO`

**Trigger:** Contact Tag Added → `pago-efectivo-pendiente`

**Acciones:**

### 3.1 — If/Else por cuotas_elegidas

- Branch `cuotas_elegidas == 1` → **Create Invoice** desde template "Regénesis · 1ra de 1"
- Branch `cuotas_elegidas == 2` → **Create Invoice** desde template "Regénesis · 1ra de 2"
- Branch `cuotas_elegidas == 3` → **Create Invoice** desde template "Regénesis · 1ra de 3"
- Branch `cuotas_elegidas == 4` → **Create Invoice** desde template "Regénesis · 1ra de 4"

### 3.2 — En cada branch, Send Invoice (después del Create)

GHL manda el invoice automáticamente al cliente por email. Si quieres también por SMS/WhatsApp, agrégalo después del Send Invoice.

### 3.3 — Remover tag `pago-efectivo-pendiente`

Para que el workflow no se dispare dos veces si el cliente vuelve a enviar el form por error.

### 3.4 — Aplicar tag `pago-efectivo-invoice-enviado`

Permite filtrar en GHL los clientes que están esperando pagar la factura.

## Paso 4 — Workflow `INVOICE PAID`

**Trigger:** Invoice Status → Paid

> Esto se dispara cuando tú marcas el invoice como pagado en GHL después de recibir el efectivo.

**Acciones:**

### 4.1 — Custom Webhook → webhook-ghl

Mismo webhook que usa el flow de tarjeta:

- **URL:** `https://eqyaddcidkywmedwscpu.supabase.co/functions/v1/webhook-ghl`
- **Method:** `POST`
- **Headers:**
  - `X-Webhook-Secret: wh_17df77139d534e5c9892e3da144815b2`
  - `Content-Type: application/json`
- **Body:**

```json
{
  "email": "{{contact.email}}",
  "first_name": "{{contact.first_name}}",
  "last_name": "{{contact.last_name}}",
  "phone": "{{contact.phone}}",
  "contact_id": "{{contact.id}}",
  "country": "{{contact.country}}",
  "city": "{{contact.city}}",
  "customData": {
    "modalidad_programa": "{{contact.custom_field.modalidad_programa}}",
    "cuotas_elegidas": "{{contact.custom_field.cuotas_elegidas}}",
    "metodo_pago": "efectivo"
  },
  "payment": {
    "total_amount": "{{invoice.amountPaid}}",
    "created_at": "{{invoice.updatedAt}}"
  }
}
```

> El payload es prácticamente idéntico al del flow de Stripe — webhook-ghl detecta automáticamente que hay `payment.total_amount` y activa el lead con `estado='pagado_calentamiento'`.

### 4.2 — Remover tag `pago-efectivo-invoice-enviado` y aplicar `pago-confirmado`

### 4.3 — Enviar email al cliente con link a `bienvenida.html`

```
Subject: ¡Confirmado! Tu acceso a Re-Génesis está listo
Body:
Hola {{contact.first_name}},

Recibimos tu pago. Para activar tu programa, entra al siguiente enlace y firma los 3 acuerdos:

👉 https://neurohackers.cloud/bienvenida.html?gid={{contact.id}}

Cualquier cosa, respondes a este correo.

— Frank
```

## Paso 5 — Cobro de cuotas siguientes (manual)

Las cuotas 2, 3, 4 (si el cliente eligió 2/3/4 cuotas) **no están automatizadas**. Frank las cobra mensualmente creando un nuevo invoice manual desde el mismo template y enviándolo.

Si más adelante quieres automatizarlas, sería un workflow tipo cron en GHL que ejecute "después de 30/60/90 días desde el primer pago en efectivo".

## Test del flow en efectivo

1. Llena el form de cierre con tu email de prueba, marca `metodo_pago = efectivo`.
2. Al enviar, debes caer en `/pago.html?metodo=efectivo&...` con la pantalla "Solicitud registrada".
3. En GHL → Contact → Activity, verifica que el tag `pago-efectivo-pendiente` se aplicó.
4. Confirma que el workflow `SOLICITUD EFECTIVO` se disparó y creó el invoice.
5. Verifica que el cliente recibió el invoice por email.
6. Marca manualmente el invoice como Paid.
7. Confirma que el workflow `INVOICE PAID` se disparó.
8. En Supabase admin → Webhooks GHL recibidos, deberías ver el evento con resultado `lead_creado_y_marcado_pagado` o `lead_actualizado_y_marcado_pagado`.
9. El cliente recibe el email con el link a `bienvenida.html` → firma → entra a la plataforma.
