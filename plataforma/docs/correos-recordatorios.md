# Correos de recordatorio — Re-Génesis / Terapia / Growth / CRM

> Copys listos para pegar en las acciones **Email** de los workflows de GHL.
> Tono: claro, cálido y profesional, sin emojis, sin guiones largos. Variables GHL entre `{{ }}`.
> Creado 2026-06-12. Ajustar remitente/firma según el servicio.

Variables comunes: `{{contact.first_name}}`, `{{contact.email}}`.
Enlaces base:
- Plataforma Re-Génesis: `https://plataforma.neurohackers.cloud/regenesis/index.html`
- Hub plataforma: `https://plataforma.neurohackers.cloud/`
- Landing CRM: `https://plataforma.neurohackers.cloud/live-lucky/`
- Comunidad Skool: `https://www.skool.com/neurohackers`

---

## 1. Re-Génesis (terapéutico) — seguimiento del cliente

### 1.1 Recordatorio diario: pregunta del día
**Asunto:** Tu pregunta de hoy te espera, {{contact.first_name}}
**Cuerpo:**
Hola {{contact.first_name}},

Tu reflexión de hoy ya está lista en la plataforma. Son unos minutos para ti, para avanzar en tu proceso sin perder el ritmo.

Entra aquí y respóndela: https://plataforma.neurohackers.cloud/regenesis/index.html

Cada día que escribes suma a tu transformación. Nos vemos adentro.

### 1.2 Tienes tareas pendientes en la plataforma
**Asunto:** {{contact.first_name}}, tienes algo pendiente en tu plataforma
**Cuerpo:**
Hola {{contact.first_name}},

Notamos que tienes actividades sin completar en tu espacio de Re-Génesis. No queremos que pierdas continuidad justo ahora que vas avanzando.

Retómalo en un minuto: https://plataforma.neurohackers.cloud/regenesis/index.html

Si algo te lo está impidiendo, responde a este correo y te ayudamos.

### 1.3 Contratos sin firmar (escalada 24 / 48 / 72 h)
**24 h — Asunto:** Falta un paso para activar tu acceso, {{contact.first_name}}
**Cuerpo:**
Hola {{contact.first_name}},

Tu pago quedó confirmado, gracias por confiar en Re-Génesis. Para activar tu acceso completo falta firmar tus documentos. Toma menos de dos minutos.

Fírmalos aquí: {{firma_link}}

En cuanto los firmes, entras directo a tu plataforma.

**48 h — Asunto:** {{contact.first_name}}, tu acceso sigue en pausa
**Cuerpo:**
Hola {{contact.first_name}},

Tu lugar está reservado, pero tu acceso no se activa hasta firmar tus documentos. No queremos que pierdas días de tu programa.

Fírmalos aquí: {{firma_link}}

Si tienes una duda antes de firmar, respóndenos y la resolvemos.

**72 h — Asunto:** Último recordatorio para activar tu programa
**Cuerpo:**
Hola {{contact.first_name}},

Este es nuestro último aviso automático. Para empezar tu proceso necesitamos tu firma en los documentos. A partir de aquí te contactamos en persona.

Fírmalos aquí: {{firma_link}}

### 1.4 Reenvío de acceso (no entró)
**Asunto:** Aquí tienes tu acceso a Re-Génesis, {{contact.first_name}}
**Cuerpo:**
Hola {{contact.first_name}},

Te dejamos de nuevo tu enlace para entrar a la plataforma. Guárdalo, es tu puerta de entrada cada día.

Entrar: https://plataforma.neurohackers.cloud/regenesis/index.html

Si no puedes acceder, responde a este correo y lo solucionamos contigo.

---

## 2. Cobranza de cuota (complemento por email del WhatsApp)

### 2.1 Cuota próxima (3 días antes)
**Asunto:** Tu próxima cuota de Re-Génesis es en pocos días
**Cuerpo:**
Hola {{contact.first_name}},

Solo un aviso amable: tu próxima cuota se cobra en unos días. No necesitas hacer nada si tu método de pago está al día.

Si quieres revisar o actualizar tu pago, escríbenos y lo vemos juntos.

### 2.2 Cuota próxima (1 día antes)
**Asunto:** Mañana se procesa tu cuota
**Cuerpo:**
Hola {{contact.first_name}},

Mañana se procesa tu cuota de Re-Génesis. Si tu tarjeta cambió o necesitas reacomodar la fecha, respóndenos hoy y lo ajustamos.

### 2.3 Cuota atrasada — D1
**Asunto:** No pudimos procesar tu cuota, {{contact.first_name}}
**Cuerpo:**
Hola {{contact.first_name}},

Intentamos procesar tu cuota y no se completó, normalmente es un tema de la tarjeta. No queremos que se interrumpa tu proceso.

Puedes resolverlo en un minuto o, si prefieres, respóndenos y lo hacemos juntos.

### 2.4 Cuota atrasada — D3
**Asunto:** Sigue pendiente tu cuota, lo resolvemos hoy
**Cuerpo:**
Hola {{contact.first_name}},

Tu cuota continúa sin procesarse. Justo ahora que vas avanzando, no queremos pausar tu programa.

Escríbenos y lo solucionamos hoy mismo.

### 2.5 Cuota atrasada — D7 (último automático)
**Asunto:** Último aviso sobre tu cuota
**Cuerpo:**
Hola {{contact.first_name}},

Esta es nuestra última nota automática sobre tu cuota. Para no pausar tu acceso necesitamos ponerla al día esta semana. A partir de aquí te contactamos en persona.

---

## 3. Growth — onboarding y recuperación

### 3.1 Bienvenida + accesos (al pagar)
**Asunto:** Bienvenido a Re-Génesis Growth, {{contact.first_name}}
**Cuerpo:**
Hola {{contact.first_name}},

Tu acceso a Growth ya está activo. Aquí tienes todo para empezar:

Comunidad (Skool): https://www.skool.com/neurohackers
Tu CRM (Live Lucky): recibirás un correo aparte con tu usuario para entrar.

Entra a la comunidad hoy y preséntate. Ahí están las clases, los recursos y el calendario.

### 3.2 Recuperación de carrito (recibió link, no pagó)
**Asunto:** {{contact.first_name}}, tu lugar en Growth sigue disponible
**Cuerpo:**
Hola {{contact.first_name}},

Vimos que empezaste tu acceso a Growth pero el pago no se completó. Si tuviste algún inconveniente, con el mismo enlace lo retomas en un minuto.

Si tienes una duda antes de entrar, respóndenos y la resolvemos.

---

## 4. CRM Live Lucky (SaaS)

### 4.1 Bienvenida al trial
**Asunto:** Tu CRM ya está listo, {{contact.first_name}}
**Cuerpo:**
Hola {{contact.first_name}},

Tu cuenta de Live Lucky está activa y tienes 15 días para probarlo todo. Entra, conecta tu WhatsApp e importa tus contactos para arrancar.

Si quieres que te ayudemos a configurarlo, responde a este correo.

### 4.2 Tu prueba termina pronto (día 12 del trial)
**Asunto:** Te quedan 3 días de prueba en Live Lucky
**Cuerpo:**
Hola {{contact.first_name}},

Tu prueba de Live Lucky termina en 3 días. Si ya lo estás usando, no tienes que hacer nada, tu plan continúa automáticamente.

Si tienes dudas antes de continuar, escríbenos y lo vemos.

---

## Notas de implementación
- En GHL, cada bloque es una acción **Email** dentro del workflow correspondiente (mismo punto donde está el WhatsApp).
- El recordatorio diario de Re-Génesis (1.1) debe enlazar a la pregunta del día; la plataforma ya la tiene habilitada.
- `{{firma_link}}` se reemplaza por el enlace real de firma de contratos de GHL.
- Las plantillas WhatsApp de utilidad equivalentes deben someterse a Meta por separado.
