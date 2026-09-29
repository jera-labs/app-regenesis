---
name: deploy-vps
description: Deploy files to the Neurohackers VPS (Hostinger, srv1573426.hstgr.cloud). Use whenever you modify any file under plataforma/public/ or regenesis/public/ and the user says "deploy", "push to prod", "subir al servidor", or you need to make a change visible in production. Handles host key pinning, cache busting, and Cloudflare cache invalidation.
---

# Deploy a VPS — Patrón canónico

## Contexto

El sitio vive en un VPS Hostinger administrado vía EasyPanel. nginx sirve estáticos desde una ruta bind-mounted. Cloudflare cachea los assets por 4h (`max-age=14400`) pero respeta el query string `?v=YYYYMMxx` como cache buster.

| Dominio | Path en VPS | Origen local |
|---|---|---|
| `plataforma.neurohackers.cloud` | `/etc/easypanel/projects/website/regenesis/html/app/` | `plataforma/public/` |
| `neurohackers.cloud` (legacy) | `/etc/easypanel/projects/website/regenesis/html/` | `regenesis/public/` |

## Hechos críticos (no negociables)

1. **Host key pinning obligatorio**. `pscp -batch` falla con "Cannot confirm a host key" si no le pasas `-hostkey '...'`. La fingerprint del VPS es:
   ```
   ssh-ed25519 255 SHA256:cA0lfqg+Sipqov1FOjnL1ZKe9fNIk49D0bjNd3SvrEg
   ```

2. **La password vive en `.env` como `VPS_SSH_PASSWORD` (NUNCA inline en archivos).** Empieza con `+`, que `cmd.exe` interpreta como redirect: SIEMPRE cargarla de `.env` y pasarla entre comillas simples en bash:
   ```bash
   PW=$(grep -oP '^VPS_SSH_PASSWORD=\K.*' .env)
   pscp ... -pw "$PW" ...
   ```

3. **El classifier bloquea password en línea sin `dangerouslyDisableSandbox: true`** en la Bash tool. SIEMPRE usar ese flag para el deploy, está autorizado por el usuario para esta operación específica.

4. **El usuario está en Colombia, el VPS en Hostinger** (servers normalmente EU). RTT ~150ms. Un deploy completo de plataforma/public/* tarda 30-90 seg.

5. **NO uses la API de EasyPanel** (`m7zv0q.easypanel.host/api/...`) sin autorización explícita — el classifier la bloquea.

## Comando canónico — UN archivo

```bash
PW=$(grep -oP '^VPS_SSH_PASSWORD=\K.*' .env)
pscp -hostkey 'ssh-ed25519 255 SHA256:cA0lfqg+Sipqov1FOjnL1ZKe9fNIk49D0bjNd3SvrEg' \
  -batch -P 22 -pw "$PW" \
  'c:/Users/andre/OneDrive/Documentos/regenesis-platform/plataforma/public/<RUTA_LOCAL>' \
  root@srv1573426.hstgr.cloud:/etc/easypanel/projects/website/regenesis/html/app/<RUTA_REMOTA>
```

Con `dangerouslyDisableSandbox: true` en la Bash call.

## Comando canónico — directorio completo

```bash
PW=$(grep -oP '^VPS_SSH_PASSWORD=\K.*' .env)
pscp -hostkey 'ssh-ed25519 255 SHA256:cA0lfqg+Sipqov1FOjnL1ZKe9fNIk49D0bjNd3SvrEg' \
  -batch -P 22 -pw "$PW" -r \
  'c:/Users/andre/OneDrive/Documentos/regenesis-platform/plataforma/public/*' \
  root@srv1573426.hstgr.cloud:/etc/easypanel/projects/website/regenesis/html/app/
```

## Flujo completo (haz SIEMPRE en este orden)

### 1. Bumpe el cache buster ANTES de subir

Si modificaste un `.js` o `.css`, los HTMLs deben pedir la versión nueva o Cloudflare seguirá sirviendo el viejo. Para bump global:

```bash
find c:/Users/andre/OneDrive/Documentos/regenesis-platform/plataforma/public/ \
  -type f \( -name "*.html" -o -name "*.js" -o -name "*.css" \) \
  -exec sed -i 's|?v=2026[0-9]\{4\}|?v=<NUEVA_VERSION>|g' {} \;
```

Formato: `?v=YYYYMMnn` (ej. `20260751`). Incrementa el `nn` final cada deploy.

### 2. Verifica que los archivos modificados estén bumpeados

```bash
grep -rh '?v=' --include="*.html" plataforma/public/ | grep -oE '\?v=2026[0-9]+' | sort -u
```

Debería retornar solo la versión nueva, no múltiples.

### 3. Sube al VPS

Usa el comando del directorio completo si hay >3 archivos cambiados; el de UN archivo si solo cambia uno.

### 4. Verifica EN producción

```bash
# El HTML pide la versión correcta?
curl -s "https://plataforma.neurohackers.cloud/<ruta>" | grep "?v=" | head -3

# El asset sirve el contenido nuevo? (Cloudflare ya lo cacheó porque la URL es nueva)
curl -s "https://plataforma.neurohackers.cloud/shared/<asset>?v=<NUEVA_VERSION>" | grep "<patrón_esperado>"

# Si dudas si es Cloudflare, bypass con IP directa:
curl -s -k --resolve "plataforma.neurohackers.cloud:443:72.62.96.30" \
  "https://plataforma.neurohackers.cloud/shared/<asset>" | grep "<patrón>"
```

### 5. Si los clientes siguen viendo viejo

- Hard refresh: `Ctrl+Shift+R`
- Sidebar cacheado en localStorage (script preload en cada HTML). Para limpiar:
  ```js
  localStorage.removeItem('nav-cache-cliente');
  localStorage.removeItem('nav-cache-admin');
  location.reload();
  ```
- Cloudflare cache: respeta `?v=` nuevo automáticamente. Si necesitas purgar URL específica sin bump, NO uses la API directa, dile al usuario que lo haga desde el dashboard CF.

## Errores frecuentes a evitar

- ❌ Olvidar `-hostkey` → "Cannot confirm a host key in batch mode"
- ❌ Password sin comillas simples → cmd.exe come el `+`
- ❌ Subir el JS sin bumpear cache → clientes siguen viendo el viejo durante 4h
- ❌ Bumpear solo el HTML modificado → otros HTMLs que cargan ese asset siguen pidiendo versión vieja
- ❌ Hacer "verificación" solo en local → siempre `curl` contra producción
- ❌ Editar nginx config en el VPS sin confirmar antes (es `files/1.txt`, no `nginx.conf`)
- ❌ Reiniciar el contenedor con `docker restart` → es Swarm, usa `docker service update --force <servicio>`

## Confirmación final al usuario

Después del deploy verificado, di al usuario:
- Qué archivos subiste
- Qué patrón verificaste en producción (curl que ejecutaste)
- Versión nueva de cache
- Si necesita hacer algo (hard refresh, limpiar localStorage)

NO digas "deploy hecho" sin verificar con curl que el contenido nuevo está sirviéndose.
