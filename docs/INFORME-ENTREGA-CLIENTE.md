# Informe de Entrega, Plataforma Neurohackers

**Cliente:** Frank Ruiz (Neurohackers)
**Responsable técnico:** Alexander González (alex@marketingnativo.com)
**Fecha:** 2026-07-07

---

## 1. Resumen ejecutivo

Se entrega el ecosistema digital de Neurohackers organizado, documentado y
verificado, con tres frentes de trabajo terminados en esta etapa:

1. **La plataforma de negocio y el programa Re-Génesis** quedaron reorganizados
   en una estructura modular limpia, sin romper nada que estuviera en
   producción, con documentación por área y verificación automática.
2. **El SaaS de agentes** (seguros y bienes raíces) quedó separado en su propio
   proyecto, listo para evolucionar de forma independiente.
3. **Las automatizaciones de GoHighLevel** para dos verticales (seguros con
   Seguros Voraus, y bienes raíces con Evelyn Santodomingo) quedaron reparadas,
   traducidas al español y probadas de punta a punta, listas para convertirse en
   plantillas reutilizables (snapshots) para nuevos clientes.

Todo lo que estaba vivo en producción sigue funcionando. Nada se rompió durante
el trabajo.

---

## 2. Arquitectura general

El sistema son **dos aplicaciones web** que comparten **una sola base de datos**
(Postgres en Supabase):

| Aplicación | Dominio | Qué es |
|---|---|---|
| Plataforma | plataforma.neurohackers.cloud | Aplicación principal: portal del cliente, módulos de trabajo y CRM de administración |
| Re-Génesis | neurohackers.cloud | Sitio del programa terapéutico de 70 días |
| SaaS de agentes | insurance.neurohackers.cloud | Producto para agentes de seguros y bienes raíces (proyecto aparte) |

Las webapps son de tecnología liviana (HTML y JavaScript, sin dependencias
pesadas ni pasos de compilación), lo que las hace rápidas y fáciles de mantener.
El backend (base de datos, autenticación, funciones y tareas programadas) está
en Supabase. El CRM operativo y las automatizaciones de mensajería viven en
GoHighLevel. El alojamiento es un servidor propio (VPS) administrado con
EasyPanel, con Cloudflare al frente para seguridad y velocidad.

---

## 3. La Plataforma (plataforma.neurohackers.cloud)

Es el sistema todo en uno del negocio. Tiene dos caras:

**Cara del cliente:** un tablero de inicio y una serie de módulos de trabajo:
Mi DNA, Esencia, Herramientas, Marca y Oferta (P.A.C.T.O.), Perfil y Tracker de
hábitos. Cada módulo es autocontenido y comparte un núcleo común (sesión,
navegación, estilos).

**Cara de administración (CRM):** un panel completo de operación con clientes,
pipeline de ventas, seguimiento, sesiones uno a uno, finanzas y pagos,
comisiones, cohortes, catálogos, tableros de indicadores, automatizaciones y
configuración del sistema. Incluye además un sub-panel específico para operar
Re-Génesis (inicio, mensajes, testimonios, configuración y tareas programadas).

La plataforma también contiene la **copia operativa vigente de Re-Génesis**, que
es la versión más actualizada del programa (ver punto 4).

---

## 4. Re-Génesis (el programa de 70 días)

Es la experiencia del cliente que compra el programa terapéutico: acompaña 70
días con pregunta diaria, reflexión libre, análisis con inteligencia artificial,
diario acumulado y un libro final al completar el recorrido. Gestiona la entrada
por pago (a través de GoHighLevel), la firma de contratos y la sala de espera
para quienes pagan en días distintos al inicio de cohorte.

**Nota importante sobre las dos versiones:** existe el sitio viejo
(neurohackers.cloud) que sigue vivo, y la copia dentro de la plataforma, que es
la más nueva y es la **fuente de verdad**. Cualquier mejora futura del programa
se hace primero en la copia de la plataforma. Queda documentado el paso
pendiente (decisión suya) de redirigir el dominio viejo a la plataforma cuando
lo consideres oportuno.

---

## 5. SaaS de agentes (seguros y bienes raíces)

Producto para vender a agentes: cada agente recibe su propia cuenta con un
formulario de captación de leads y un portal de aplicación donde su cliente
completa los datos que se sincronizan a su CRM. Está en vivo en
insurance.neurohackers.cloud.

En esta etapa se **separó a su propio repositorio** (fuera del monorepo de
Re-Génesis) para que evolucione de forma independiente, con su propia
documentación de entrega. Comparte con Neurohackers únicamente la base de datos
(Postgres) y una función de recepción de formularios, lo cual quedó documentado.

---

## 6. Automatizaciones de GoHighLevel (los snapshots)

Se prepararon dos plantillas de automatización completas, una por vertical,
listas para clonar a cada nuevo cliente que contrate el CRM. En ambos casos el
punto de partida (el snapshot original) venía roto y en inglés; se reparó,
tradujo y probó.

### 6.1 Vertical Seguros (cuenta Seguros Voraus)

18 flujos de trabajo publicados y activos, organizados en tres carpetas:
Captación y Citas, Renovaciones y Alertas, y Acompañamiento de Vida. Incluye
captación de leads, confirmación y recordatorios de citas, gestión de no
asistencia, solicitud de reseñas, nutrición a largo plazo, alertas de pago,
renovaciones y acompañamiento de casos. Pipelines de ventas por producto,
calendarios, formularios y plantillas de correo, todo en español.

### 6.2 Vertical Bienes Raíces (cuenta Evelyn Santodomingo)

Entregada y verificada en esta sesión. Contenido:

- **6 flujos de trabajo** publicados y activos, en la carpeta Captación y Citas:
  1. Nutrición de Lead Nuevo (Fast 5)
  2. Confirmación de Cita y Recordatorios
  3. Cita No Asistió (No-Show)
  4. Nueva Venta, Solicitar Reseña
  5. Nutrición a Largo Plazo
  6. Leads Estancados
- **1 pipeline** de ventas: Captación de Leads (Marketing), con etapas Lead
  nuevo, Contactado, Lead caliente, Cita agendada, Negociación y Cerrado.
- **5 calendarios** activos en español: Agendar una Cita (el principal),
  Búsqueda de Propiedades, Análisis de Propiedades, Networking de Inversionistas
  y Cesión de Contratos.
- **1 formulario** de captación en español (Reclama tu Oferta).
- **Plantillas de correo** de nutrición en español (Búsqueda de Propiedades,
  Análisis de Propiedades, Cesión de Contratos, Networking de Inversionistas).
- Etiquetas y campos personalizados depurados: se eliminó todo lo del snapshot
  de seguros cargado por error y se conservaron los campos genéricos útiles.

**Prueba de punta a punta realizada y superada:** se creó un contacto de
prueba, se hizo entrar al flujo de nutrición, el sistema creó automáticamente la
oportunidad en el pipeline y la etapa correctos, y luego se eliminó todo rastro
de la prueba. Confirma que el cableado funciona en vivo.

**Pendiente suyo:** crear el snapshot desde el panel de agencia de GoHighLevel
(esa acción no tiene API y se hace desde la interfaz). Al instalarlo en cada
agente nuevo conviene personalizar el nombre de la promoción, el horario, los
enlaces de privacidad del formulario, y reconectar las integraciones de
teléfono, Facebook e Instagram (esas no viajan en el snapshot).

---

## 7. Infraestructura, despliegue y verificación

- **Alojamiento:** VPS en Hostinger, administrado con EasyPanel (contenedores),
  con Cloudflare al frente. Los estáticos se sirven con nginx.
- **Despliegue de las webapps:** procedimiento documentado y semiautomatizado
  (copia de archivos, versionado de caché y purga de Cloudflare). Se verifica
  siempre en producción después de cada publicación.
- **Base de datos:** las migraciones están numeradas y documentadas; el esquema
  nunca se toca sin confirmación, por seguridad de los datos en producción.
- **Verificación automática:** se creó una comprobación (`tools/check-integridad.py`)
  que valida que todas las referencias de la web existan y que el código no
  tenga errores de sintaxis. Debe dar verde antes y después de cualquier cambio.
  En la entrega, da verde, y los tres dominios responden correctamente.

---

## 8. Organización del código y documentación

El repositorio se reorganizó en una estructura modular clara, sin mover ninguna
URL en producción (en estas webapps, las carpetas servidas son las direcciones
públicas, así que moverlas rompería enlaces; por eso la modularización fue de
organización y documentación, no de rutas).

La documentación quedó en capas, cada una acotada a su tema:

| Documento | Contenido |
|---|---|
| `CLAUDE.md` (raíz) | Mapa de módulos y reglas del proyecto |
| `plataforma/CLAUDE.md` | Detalle de la plataforma y su CRM |
| `regenesis/CLAUDE.md` | Detalle del programa Re-Génesis |
| `supabase/CLAUDE.md` | Base de datos y política de migraciones |
| `docs/design-system.md` | Guía única de diseño (colores, tipografía, estilo) |
| `docs/deploy-y-entornos.md` | Cómo desplegar y diferencias local/servidor |
| `docs/CREDENCIALES.md` | Inventario de credenciales (solo nombres) |
| `HANDOVER.md` | Resumen técnico de entrega |

Se realizó también una limpieza de código muerto verificada (respaldos viejos,
archivos temporales y material del cliente que no debía estar en el control de
versiones), y se movió a `.env` una contraseña que estaba en texto plano dentro
de un procedimiento.

---

## 9. Estado actual y pendientes

**Todo lo entregado está en verde y verificado.** Lo que queda son acciones que
dependen de ti o de decisiones de negocio:

- Crear el snapshot de bienes raíces desde el panel de agencia de GoHighLevel.
- Cuando decidas, redirigir el dominio viejo de Re-Génesis a la plataforma.
- El módulo Academia está construido pero no lanzado (esperando tu visto bueno).
- Registrar la app de GoHighLevel en su marketplace para activar la conexión por
  OAuth del SaaS (hoy funciona con el método alternativo, no es bloqueante).

---

## 10. Cómo continuar

Toda la información para operar y continuar el proyecto está en el propio
repositorio, empezando por el `CLAUDE.md` de la raíz, que enlaza al resto. Los
procedimientos repetibles (desplegar, crear una migración, verificar) están
documentados como guías paso a paso. Las credenciales están inventariadas por
nombre en `docs/CREDENCIALES.md`; los valores reales se entregan por un canal
seguro, nunca en el repositorio.

Para cualquier duda o continuación, quedo disponible.

Alexander González
alex@marketingnativo.com
