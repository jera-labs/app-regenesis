# Audit end-to-end — Journey de un cliente que paga (Re-Génesis)

> Simulación de clienta ficticia (María González) por todo el sistema, leyendo el código real. Generado 2026-06-12 (workflow multi-agente, 7 agentes). Honestidad: el flujo feliz funciona hasta firmar; **el dinero (cuotas) y Terapia están rotos.**

> **ACTUALIZACIÓN 2026-06-12 (sesión cobranza):** P0-2 RESUELTO. `sync-ghl-pagos` v14 desplegado: failure-driven, idempotente, auto-sanador. Verificado con datos reales que GHL lista cobros `failed`; los 8 fallos históricos eran reintentos resueltos (reconciliados a `perdonado`, 0 falsos morosos). **Decisión:** el motor de cobranza es failure-driven (no calendario adivinado); por eso P0-1/P1-8 se DESCARTAN a propósito (cablear `crear_calendario_cuotas` crearía falsos morosos). Cron `sync-ghl-pagos` corre cada hora. Falta solo `COBRANZA_AUTO=on` cuando se publiquen los workflows GHL. Terapia (P0-4/P1-5) sigue code-ready sin deploy.

## Semáforo por etapa
| Etapa | Estado | Veredicto |
|---|:--:|---|
| 1 · Pre-pago (cierre→link→pago) | ⚠ | Ruta TARJETA sin auto-avance al pago (depende de email+click). |
| 2 · Pago → registro (webhook-ghl) | ✓ | Robusto. El pago crea el lead (no un tag ni la firma). |
| 3 · Contratos + bienvenida + magic link | ⚠ | Si NO firma, **nadie le recuerda**. Magic link caduca sin reenvío. |
| 4 · Acceso + primeros días | ⚠ | Invite y recovery compiten (doble email); riesgo redirect dominio. |
| 5 · En programa (cuotas) | ✗ | **Roto de punta a punta** (ver abajo). |
| 6 · Variante Terapia | ✗ | **Terapia ≡ Re-Génesis**: no existe `leads.servicio`, sin gating de módulos. |

## Bloqueos P0 (dejan al cliente fuera o le cobran de más)
1. **Ciclo de cuota roto:** `webhook-ghl` nunca llama `crear_calendario_cuotas` (`cliente_finanzas_programa`=0 filas) · `marcar_pagos_atrasados()` existe pero **ningún cron la corre** · `sync-ghl-pagos` solo hace INSERT, **pagar NO detiene la cobranza** (el workflow le sigue cobrando) · dos motores de cobranza se anulan.
2. **Terapia no se diferencia:** `leads.servicio` no existe · webhook no lo persiste · gating de módulos borrado en migración 70, `nav.js` ya no filtra → cliente Terapia ve DNA/Tracker/P.A.C.T.O.
3. **Sin recordatorio de firma:** 12 crons, ninguno mira firmas; 8 reglas, ninguna de firma y todas inactivas. Cliente paga, no firma, queda en `pagado_calentamiento` indefinido sin que nadie se entere.

## Plan P0 (bloqueante)
| # | Acción | Pieza | Toca producción |
|---|---|---|---|
| P0-1 | Cablear pago→`crear_calendario_cuotas` | webhook-ghl:222 | sí (edge) |
| P0-2 | Cerrar cobranza al pagar: conciliar cuota + `DELETE /contacts/{id}/workflow/e33b755c` + `cuota_estado=al_dia` | sync-ghl-pagos:251 | sí (edge) |
| P0-3 | Cron `marcar_pagos_atrasados()` diario | pg_cron | sí (cron) |
| P0-4 | `ALTER TABLE leads ADD COLUMN servicio` + persistir en webhook | migración + webhook-ghl | sí (schema) |
| P0-5 | Recordatorio contratos no firmados (reglas `firma_pendiente_24/48/72h` + cron) | reglas + cron | aditivo |

## Plan P1 (importante)
- P1-1 Auto-avance al pago en tarjeta (redirect condicional del form de cierre → `pago.html?...&metodo=tarjeta`).
- P1-2 Unificar "crear contraseña" en un solo camino (quitar/demorar `inviteUserByEmail` del webhook).
- P1-3 Botón "Reenviar mi enlace de acceso" (envía recovery por email, no solo a la pestaña).
- P1-4 Verificar Site URL / redirect allowlist de Supabase Auth → siempre `neurohackers.cloud/index.html`.
- P1-5 Recorte de módulos en `nav.js` cuando `servicio==='terapia'` + guard por URL.
- P1-6 Activar reglas cuota (cuando workflows publicados); desactivar `cuota_atrasada_3d/7d` (redundantes).
- P1-7 Elegir UN motor de cuota, borrar `encolar_recordatorios_cuotas` (roto).
- P1-8 Crear `cliente_finanzas_programa` al pagar.
- P1-9 Guard en `procesar_nuevo_cliente` si `tema_para_fecha` NULL.
- P1-10 Endurecer `pago.html` (no default a 1 cuota; garantizar `&servicio=`).
- P1-11 Self-service "olvidé mi contraseña" en `login.html`.

## Automatizaciones faltantes (concretas)
1. **Form → pago automático (tarjeta).**
2. **Recordatorio de contratos no firmados** (cron + escalada 24/48/72h + plantilla `rg_recordatorio_firma_pendiente`).
3. **Reenvío de enlace de acceso** (regla `acceso_no_usado_24h`; variante por servicio: RG→`/index.html`, Terapia→`/regenesis/index.html`; botón on-demand en admin).
4. **Cierre del ciclo de cobranza** (P0-2).
5. **Detector de atraso** (P0-3).
6. **Alerta de datos faltantes post-pago** (modalidad/cuotas NULL → tarea a Frank).

## Top 5 acciones inmediatas
1. Cablear pago→calendario de cuotas + cierre de cobranza al pagar (P0-1+P0-2+P0-3). *Es el agujero que cobra de más a quien ya pagó.*
2. Recordatorio de contratos no firmados + reenvío de acceso (P0-5 + autom. 3). *Cierra el abandono silencioso entre pago y primer login.*
3. Unificar "crear contraseña" + fijar redirect de Auth (P1-2 + P1-4).
4. Aplicar `leads.servicio` + recortar módulos en `nav.js` (P0-4 + P1-5). *Sin esto Terapia no existe como producto.*
5. Auto-avance al pago en tarjeta (P1-1).
