# Rediseño de embudos por servicio (basado en el funnel real de Re-Génesis)

> Escrito tras estudiar a fondo los workflows reales (WF-01..WF-11). Corrige el error de los workflows "mueve pipeline" que eran solo un gate de etiqueta sin lógica. Aquí está el patrón real y cómo replicarlo para Terapia y Growth.

## 1. Cómo funciona REALMENTE el sistema (lo aprendido)

El lead NO entra por una etiqueta suelta. La secuencia real es:

1. **Intake = FORMULARIO.** Cada servicio tiene su form de "Cuotas + Modalidad". Al enviarlo dispara el workflow de venta.
2. **WF-03 (Envío de Link de Pago)** se dispara con `form_submission`. Adentro:
   - Ramas (`if_else`) según **Método de Pago** (`WEGbMclRbPwd1fYHmvn4` = Tarjeta/Efectivo) y **Cuotas Elegidas** (1/2/3/4 pagos).
   - Envía **email de bienvenida con el link de pago** correcto por plan (el link es un `{{custom_values.link_pago_X_cuota}}`).
   - Crea la **oportunidad** en etapa "Link de pago enviado".
   - Pone tags `link-enviado` + `plan-X-cuota(s)` + `seguimiento-activo`.
3. **WF-04 (Pago Confirmado)** se dispara con `payment_received` (filtrado por product + price ids, `payment_status=succeeded`) e `invoice paid`. Adentro:
   - Mueve la oportunidad a "Cliente pagado" (won) en Ventas Y en Clientes Activos.
   - `remove_from_workflow` (corta los seguimientos).
   - +tags `pago-completo, onboarding-iniciado` / -tags `link-enviado, seguimiento-activo`.
   - Email "Pago recibido", webhook a Supabase (`webhook-ghl`), notificación interna.
4. **WF-06 (Seguimiento Largo)** se dispara con tag `seguimiento-activo` → secuencia multi-touch de recuperación (wait 20d → email → wait 2d → SMS de Frank → wait 3d → tarea llamar → wait 5d → email "regalo" → tarea Skool 30d → wait 15d → tag `perdido-no-pago`).
5. **WF-11 (Skool + Bienvenida)** se dispara con tag `onboarding-completado` → wait → email acceso plataforma → SMS bienvenida → tag.

**Lección:** un workflow de venta real = trigger de FORM + ramas por plan + email con link + oportunidad + tags + (luego) secuencia de recuperación. NO un gate de etiqueta que solo mueve una oportunidad.

## 2. Acciones disponibles en workflows (verificadas en uso)
`email`, `sms`, `whatsapp_v2`, `wait` (time días/min + relativo a cita), `add_contact_tag`, `remove_contact_tag`, `create_opportunity` (multi-pipeline), `remove_from_workflow`, `if_else`, `internal_notification`, `webhook`, `assign_user` / `remove_assigned_user`, `task`, `dnd_contact`, `payments_create_invoice`, `manual-call`, `internal-add-contact-followers`. Triggers: `form_submission`, `payment_received`, `invoice`, `contact_tag`, `appointment`, `contact_changed`.

## 3. IDs reales para el rediseño

### Forms (intake)
| Servicio | Form id | Campo Cuotas | Campo Método | Campo Modalidad |
|---|---|---|---|---|
| Re-Génesis | `R44gBGDszvOwYiJ1Gy4s` + `eazZSMiIa9aDRcgtDDLq` | `kwqZ5uZ2c46sytm2e7mU` | `WEGbMclRbPwd1fYHmvn4` | `IlOLlwjTzc735u2GEr9K` |
| Terapia | `HKtVZzo97Cdp5ZCXxbDB` | `zQH8YILE4q34OkFvk7qR` | `WEGbMclRbPwd1fYHmvn4` | `IlOLlwjTzc735u2GEr9K` |
| Growth | `6fKxuX9jNPFmfF2YOczu` | `5QZ3PfccE1SM1DQ5KkOe` | `WEGbMclRbPwd1fYHmvn4` | `IlOLlwjTzc735u2GEr9K` |

Método de Pago es el MISMO id en los 3. Cuotas difiere por servicio. Opciones Terapia/Growth: "Pago único ($1,500 USD)", "2 pagos ($825)", "3 pagos ($600)", "4 pagos ($500)". Re-Génesis: $1,987 / $1,100 / $800 / $622.

### Productos + price ids (para triggers de pago)
- **Regénesis Terapia** `6a2885bfa7bdaea6a54b8215`: 1pago `6a2885bfa7bdae2be14b822a` ($1500) · 2 `6a2885bfa7bdae16b14b821a` · 3 `6a2885bfa7bdae8d734b823f` · 4 `6a2885bfa7bdae104f4b8244`.
- **Regénesis Growth** `6a288655988da3076f821bed`: 1pago `6a288655988da32d93821bf7` · 2 `6a288655988da34d45821bf2` · 3 `6a288655988da34833821bfc` · 4 `6a288655988da3c2fb821c01`.
- (Hay también "Terapia Regenesis" `6a038543e41b44b42ef647e3" con sus 4 precios; confirmar con Frank cuál producto es el vivo para Terapia.)

### Pipelines / etapas (ya creados)
- TER `Ttm8vpVfWibpTPfdNNKv`: Lead nuevo `e0e24b40` · Link enviado `8b1c294d` · Pagado `fdc119e0`.
- GRW `K6FuvzpDvuqD2wKrNXAn`: Lead nuevo `d24a47eb` · Link enviado `b5fc09b0` · Pagado `c2a3743e` · Onboarding `ef837cb0` · Activo `40364cd8`.

## 4. Plan de rediseño (reemplaza los skeletons)

Los 3 "· Ventas (mueve pipeline)" actuales se **reemplazan** por, **por servicio (Terapia y Growth)**:

1. **`TER/GRW · 01 · Intake + Link de pago`** = clon de WF-03. Trigger: form del servicio. Ramas por Cuotas (campo del servicio) → email bienvenida+link por plan → opp "Link enviado" → tags `link-enviado, plan-X, <servicio>, seguimiento-activo`.
2. **`TER/GRW · 02 · Pago confirmado`** = clon de WF-04. Trigger: `payment_received` con los price ids del producto del servicio → opp "Cliente pagado" won → tags `pago-completo, onboarding-iniciado, <servicio>` / quita `link-enviado, seguimiento-activo` → email pago recibido → webhook Supabase → notif interna.
3. **Recuperación**: reutilizar WF-06 (`seguimiento-activo` es genérico) o clonar por servicio si Frank quiere copy distinto.
4. **Growth · 03 · Onboarding** = invitación Skool + provisión CRM (Live Lucky) + emails de bienvenida (ya redactados en `correos-recordatorios.md`).
5. **Re-Génesis full**: ya está completo (WF-01..11). El `RG · Ventas` skeleton se descarta (redundante con WF-03).

### Etiquetado de servicio (lo que pediste)
La etiqueta `terapia`/`growth` se pone **en el workflow del form** (paso `add_contact_tag`), no antes. Así el form de Terapia agrega `terapia` y el de Growth `growth`, y de ahí fluye toda la secuencia + el gating de plataforma.

## 5. Custom values de links de pago (CREADOS 2026-06-12)
Los emails de link usan custom values. Ya creados y apuntando a los payment links reales (`link.neurohackers.top/payment-link/{id}`):

| Merge field | Payment link |
|---|---|
| `{{custom_values.link_pago_terapia_1_cuota}}` | 6a288b1903b17c94f571574d (Terapia 1 Pago $1500) |
| `{{custom_values.link_pago_terapia_2_cuotas}}` | 6a288b4303b17c94f571574f (Terapia 2 Pagos $825) |
| `{{custom_values.link_pago_terapia_3_cuotas}}` | 6a28a12903b17c94f5715799 (Terapia 3 Pagos $600) |
| `{{custom_values.link_pago_terapia_4_cuotas}}` | 6a28a15303b17c94f571579a (Terapia 4 Pagos $500) |
| `{{custom_values.link_pago_growth_1_cuota}}` | 6a29e52771a0aa761e4641ec (Growth 1 Pago $1500) |
| `{{custom_values.link_pago_growth_2_cuotas}}` | 6a29e58e03b17c94f5715aab (Growth 2 Pagos $825) |
| `{{custom_values.link_pago_growth_3_cuotas}}` | 6a29e5c503b17c94f5715aad (Growth 3 Pagos $600) |
| `{{custom_values.link_pago_growth_4_cuotas}}` | 6a29e5e271a0aa761e4641ee (Growth 4 Pagos $500) |

Re-Génesis (existentes): `link_pago_1_cuota`/`_2_cuotas`/`_3_cuotas`/`_4_cuotas`.

## 6. Estado de los skeletons actuales
`TER/GRW/RG · Ventas (mueve pipeline)` quedan como **a descartar** (publicados pero conceptualmente incompletos). Se reemplazan por lo de arriba. El recordatorio diario (RG, 70 emails) sí sirve y se conserva.
