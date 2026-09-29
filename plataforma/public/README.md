# Neurohackers Platform — `plataforma/public/`

Sistema todo-en-uno para llevar al cliente a $20K-$50K. Se sirve en
**plataforma.neurohackers.cloud** (VPS Hostinger vía EasyPanel; el contenido de
esta carpeta se sube a `/etc/easypanel/projects/website/regenesis/html/app/`).

> El estado completo y actualizado del proyecto vive en
> [docs/entrega-proyecto.md](../../docs/entrega-proyecto.md). Las convenciones
> duras (paleta, vanilla JS, RLS, `db`) están en el CLAUDE.md de la raíz.

## Filosofía

1. **El producto/servicio es la unidad atómica.** Diagnósticos, contenido y tareas se generan por producto.
2. **Una acción al día.** El Hub (`index.html`) prioriza 3 acciones; el cliente no busca qué hacer.
3. **GHL es plomería, Neurohackers es inteligencia.** El cliente jamás abre GHL.
4. **La plataforma es source of truth del DNA del cliente.**

## Estructura real

```
public/
├── index.html                Hub diario · 3 acciones priorizadas por estado
├── login.html                Login 2 columnas (+ gate de password temporal)
├── cambiar-password.html     Cambio de clave (primer login con temporal)
├── mas.html                  Atajos secundarios
├── admin/                    Panel de operación (17 páginas: clientes, pipeline,
│   │                         cohortes, finanzas, sesiones, comisiones, dashboards,
│   │                         tracker-admin, equipo, automatizaciones, salud, …)
│   └── regenesis/            Admin del módulo terapéutico (mensajes, calendario, …)
├── modules/
│   ├── dna/                  Cuestionario guiado 4 capas (bloqueo de campos llenos)
│   ├── perfil/               Mi perfil (capas progresivas)
│   ├── esencia/              Voz, valores, tono
│   ├── marca-oferta/         Productos + auditoría IA (P.A.C.T.O)
│   ├── tracker/              KPIs diarios + tareas + facturación mensual
│   └── herramientas/         Utilidades (script de venta IA, …)
├── regenesis/                Copia operativa de Re-Génesis (un solo login)
└── shared/
    ├── styles.css            Sistema visual dorado OINL
    ├── nav.js                Sidebar dual cliente/admin con cache en localStorage
    ├── turbo.min.js          Turbo Drive (única lib de terceros junto a supabase-js)
    └── scripts/              config, supabase-client (`db`), auth, admin-gate,
                              utils + APIs por dominio (crm, estados, pipeline,
                              finanzas, tracker, sesiones, comisiones, dashboards,
                              equipo, salud, usuarios, seguimiento, …)
```

## Deploy

Ver skill `deploy-vps` (pscp + cache buster `?v=YYYYMMnn` + verificación curl).
Nunca subir sin bumpear el `?v=` de los HTML que referencian assets modificados.
