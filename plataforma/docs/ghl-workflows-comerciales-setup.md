# GHL — Workflows comerciales por servicio + recordatorio diario (setup en UI)

> Construido por API el 2026-06-12. Todo quedó como **borrador (draft) sin trigger**, porque la API no escribe triggers de forma fiable (viven en un bucket de Firebase). Esta guía es lo que falta hacer **a mano en la UI de GHL** para activarlo.
> Cuenta: location Frank `BAnlOGbwz5e0mw95HroC`.

## 1. Lo que ya quedó construido (Opción A)

Carpeta **Servicios** (la estructura nueva):

```
Servicios/
├── Growth/
│   ├── GRW · Bienvenida + Accesos            fcd9c657
│   ├── GRW · Recuperación carrito            83a2eaf0
│   └── GRW · Ventas (mueve pipeline)         a7f839b8   ← NUEVO
├── Re-Génesis/
│   ├── RG · Ventas (mueve pipeline)          b6de8dbe   ← NUEVO
│   └── RG · Recordatorio diario pregunta…    40e5428e   ← NUEVO
├── Terapia/
│   └── TER · Ventas (mueve pipeline)         f7622003   ← NUEVO
└── (compartidos, directo en Servicios)
    ├── RG · 20..27 (cuotas, sesión, fin, NPS)
    └── RG · Cobranza de cuota (lógica)       e33b755c
```

### Cómo funcionan los 3 workflows comerciales
Cada uno está **filtrado por su etiqueta de servicio** y mueve la oportunidad por **su** pipeline:

| Workflow | Etiqueta | Pipeline destino |
|---|---|---|
| TER · Ventas | `terapia` | Ventas Terapia Re-Génesis (`Ttm8vpVfWibpTPfdNNKv`) |
| GRW · Ventas | `growth` | Ventas Growth Re-Génesis (`K6FuvzpDvuqD2wKrNXAn`) |
| RG · Ventas | `regenesis` | Ventas Regénesis (`FeVYpvdszZe2l41sc5Nc`) |

Lógica interna (cascada, gana la etapa más avanzada):
1. Si el contacto **no** tiene la etiqueta del servicio → sale del workflow (no hace nada). Esto evita que un lead de Growth caiga en el pipeline de Terapia al compartir triggers.
2. Si tiene `pago-completo` → crea/mueve la oportunidad a **Cliente pagado** (status won).
3. Si tiene `link-enviado` → **Link de pago enviado**.
4. Si no → **Lead nuevo**.

Como GHL "crea o actualiza" la oportunidad del mismo contacto, cada re-entrada la mueve a la etapa correcta.

## 2. Triggers a agregar en la UI (obligatorio para que corran)

Abre cada workflow comercial y agrega estos triggers (todos del tipo **Contact Tag**):

Para **TER · Ventas**:
- Contact Tag added = `terapia`
- Contact Tag added = `link-enviado`
- Contact Tag added = `pago-completo`

Para **GRW · Ventas**: igual pero la 1ª es `growth`.
Para **RG · Ventas**: igual pero la 1ª es `regenesis`.

> El gate interno por etiqueta de servicio hace que solo el workflow correcto actúe, aunque `link-enviado`/`pago-completo` disparen los tres.

Marca **Allow re-entry / Allow multiple** en cada uno (para que avance de etapa en cada re-entrada).

## 3. Etiquetado al comprar (la pieza que enciende todo)

La etiqueta de servicio (`terapia` / `growth` / `regenesis`) debe ponerse **al comprar**. Una etiqueta por lead, excluyentes. Configúralo donde nace la venta:

- **Si la venta entra por un order form / producto distinto por servicio:** en cada producto/funnel, automatización "al pagar → add tag `<servicio>`".
- **Si entra por el mismo form con un campo "servicio":** workflow corto que al pagar lea ese campo y agregue la etiqueta correcta.
- La etiqueta `pago-completo` ya es el tag canónico de pago (úsalo, no `pago-realizado`/`pago-confirmado`).

Esta misma etiqueta de servicio es la que la plataforma usa para el gating (Terapia ve solo /regenesis/) y la que el `webhook-ghl` mapea a `leads.servicio`. Una sola fuente de verdad.

## 4. Recordatorio diario (RG · Recordatorio diario pregunta del día — 40e5428e)

- Es un **drip de 70 días**: Email "pregunta del día" → esperar 1 día → Email → ... (cubre el programa completo). El correo enlaza a `https://plataforma.neurohackers.cloud/regenesis/index.html`.
- **Para fijarlo a las 8:00 AM:** en Settings del workflow activa la ventana de envío ("Allow execution only between") y ponla a las 8:00 AM en `America/New_York` (timezone de Frank). Así cada email del drip sale a las 8am aunque el lead haya entrado a otra hora.
- **Trigger a agregar:** Contact Tag added = `regenesis` (o el evento de activación del programa). Marca que NO permita múltiples entradas para no duplicar el drip.
- El texto del correo ya está aprobado (de `correos-recordatorios.md`, copy 1.1).

## 5. Publicar y activar (orden seguro)

1. Revisa cada workflow en la UI, agrega triggers (secciones 2 y 4).
2. **Publica** (de draft → published) los 3 comerciales + el recordatorio diario.
3. Para cobranza automática: cuando los workflows de cuotas estén publicados, setea el secret `COBRANZA_AUTO=on` en Supabase y enciende las reglas `reglas_automatizacion` una por una validando en `cron_log`.
4. Prueba en vivo con un contacto de prueba por servicio antes de soltarlo a tráfico real.

## 6. Pendiente (no bloquea lo anterior)
- Meter los correos de `correos-recordatorios.md` como pasos Email dentro de los workflows de cobranza/recuperación (hoy son WhatsApp).
- Plantillas WhatsApp UTILITY a Meta.
- Snapshot del CRM para el alta SaaS (Live Lucky).
