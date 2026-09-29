# Inventario de credenciales, Plataforma Neurohackers

> **Este documento NO contiene ningún valor secreto.** Solo lista los nombres de
> las variables, para qué sirve cada una, dónde vive el valor real y cómo
> obtenerlo o rotarlo. Es seguro versionarlo y compartirlo.
>
> Los valores reales viven en archivos `.env` (excluidos de git por `.gitignore`)
> y en los paneles de cada proveedor. Para entregar los valores a otra persona,
> usar un gestor de contraseñas (1Password, Bitwarden) o un canal cifrado, nunca
> texto plano en el repositorio ni por chat.

Última actualización: 2026-07-07.

## Dónde vive cada grupo de secretos

| Almacén | Qué contiene | Acceso |
|---|---|---|
| `.env` (raíz del monorepo) | Todo lo de las tablas de abajo | Local, gitignored |
| Supabase (proyecto `eqyaddcidkywmedwscpu`) | Secrets de las Edge Functions (IA, GHL, Telegram) | Dashboard de Supabase, Edge Functions, Secrets |
| `ghl-mcp/.env` (proyecto separado) | Credenciales del MCP propio de GHL (refresh token Firebase, PIT) | Local, gitignored |
| Paneles de proveedor | Origen para rotar cada valor | Ver columna "Cómo obtener o rotar" |

## Supabase (base de datos, auth, edge functions)

| Variable | Para qué sirve | Cómo obtener o rotar |
|---|---|---|
| `SUPABASE_URL` | URL del proyecto (no secreta) | Dashboard, Project Settings, API |
| `SUPABASE_ANON_KEY` | Clave pública del cliente (RLS protege los datos) | Dashboard, Project Settings, API |
| `SUPABASE_SERVICE_ROLE_KEY` | Clave de administrador. **Solo backend y edge functions, jamás en HTML/JS de cliente** | Dashboard, Project Settings, API (rotar ahí) |
| `SUPABASE_ACCESS_TOKEN` | Token de la Management API (aplicar migraciones, desplegar funciones) | Supabase, Account, Access Tokens |

## Inteligencia artificial

| Variable | Para qué sirve | Cómo obtener o rotar |
|---|---|---|
| `ANTHROPIC_API_KEY` | Análisis de reflexiones y auditorías con Claude | console.anthropic.com, API Keys |
| `OPENAI_API_KEY` | Funciones de imagen y apoyo | platform.openai.com, API Keys |

## GoHighLevel (CRM, automatizaciones)

| Variable | Para qué sirve | Cómo obtener o rotar |
|---|---|---|
| `GHL_API_KEY` | PIT (Private Integration Token) de la sub-cuenta, API oficial | GHL sub-cuenta, Settings, Private Integrations |
| `GHL_PIT_AGENCY` | PIT a nivel agencia (snapshots, búsqueda de sub-cuentas) | GHL agencia, Settings, Private Integrations |
| `GHL_WEBHOOK_SECRET` | Verifica que los webhooks entrantes vienen de GHL | Se define al crear el webhook en GHL |
| `GHL_LOCATION_ID` | Identificador de la sub-cuenta (no secreto) | GHL, Settings, Business Info |
| `GHL_COMPANY_ID` | Identificador de la agencia (no secreto) | GHL agencia |
| `GHL_API_BASE`, `GHL_API_VERSION` | Endpoint y versión de la API (no secretos) | Fijos, ver docs de GHL |
| `GHL_MCP_URL` | Endpoint del MCP propio de GHL | Configuración local del MCP |

> El MCP propio de GHL (`ghl-mcp/`, repositorio separado) guarda su propio
> `refreshTokenV2` de Firebase y los PIT en su `.env`. Se capturan del navegador
> una sola vez; el MCP los renueva solo.

## Infraestructura (VPS, hosting, CDN)

| Variable | Para qué sirve | Cómo obtener o rotar |
|---|---|---|
| `VPS_HOST` | Host del servidor (no secreto) | Panel de Hostinger |
| `VPS_SSH_USER` | Usuario SSH (no secreto) | Panel de Hostinger |
| `VPS_SSH_PASSWORD` | Contraseña SSH del VPS (deploy de estáticos) | Panel de Hostinger, VPS, cambiar contraseña |
| `EASYPANEL_URL` | URL del panel de EasyPanel (no secreta) | Instalación de EasyPanel en el VPS |
| `EASYPANEL_API_KEY` | API de EasyPanel (dominios, servicios, deploy) | EasyPanel, Settings, API |
| `CLOUDFLARE` | Token de API de Cloudflare (DNS, purga de caché) | dash.cloudflare.com, My Profile, API Tokens |

## Notificaciones y cron

| Variable | Para qué sirve | Cómo obtener o rotar |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Bot que avisa a Frank (testimonios, salud del sistema) | Telegram, @BotFather |
| `TELEGRAM_CHAT_ID` | Chat destino de las notificaciones (no secreto) | Del chat con el bot |
| `CRON_SECRET` | Protege los endpoints llamados por el cron | Se define en `.env` y en el cron |

## Legacy (hosting viejo Cloudways, en retirada)

| Variable | Para qué sirve |
|---|---|
| `CLOUDWAYS_HOST`, `CLOUDWAYS_SSH_USER`, `CLOUDWAYS_SSH_PASSWORD` | Acceso al hosting anterior. Ya no se usa; conservar hasta confirmar que no queda nada apuntando ahí |

## Reglas de manejo (no negociables)

1. La `SUPABASE_SERVICE_ROLE_KEY` y cualquier PIT nunca van en HTML/JS servido al
   cliente. En el navegador solo se usa la `SUPABASE_ANON_KEY` (RLS protege).
2. Los secretos solo viven en `.env` (gitignored). La plantilla con los nombres,
   sin valores, es `.env.example`.
3. Al entregar credenciales a un tercero: gestor de contraseñas o canal cifrado.
4. Si una clave se expone, rotarla en el panel del proveedor y actualizar el
   `.env` y los secrets de las edge functions.
