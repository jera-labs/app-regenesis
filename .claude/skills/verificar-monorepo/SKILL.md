---
name: verificar-monorepo
description: Verificación estándar del monorepo Neurohackers (baseline verde). Usar antes y después de cualquier cambio en plataforma/public o regenesis/public, tras cada lote de una reorganización, y después de cada deploy. Corre integridad de referencias, sintaxis JS y smoke de producción.
---

# Verificar el monorepo (baseline verde)

## 1. Integridad local (obligatorio tras cada cambio)

```bash
python tools/check-integridad.py
```

Debe terminar en `BASELINE VERDE`. Valida que todo JS/CSS referenciado por los
HTML de las dos raíces servidas exista en disco, y que cada .js (no minificado)
parsee con `node --check`. Los AVISOS (img/html faltantes) se revisan pero no
bloquean; los ERRORES sí.

## 2. Smoke de producción (tras deploy o cambios de infra)

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://neurohackers.cloud/
curl -s -o /dev/null -w '%{http_code}\n' https://plataforma.neurohackers.cloud/login.html
curl -s -o /dev/null -w '%{http_code}\n' https://plataforma.neurohackers.cloud/regenesis/
```

Las tres deben dar 200. Si una página recién desplegada se ve vieja: falta el
bump de `?v=` o la purga de Cloudflare (ver skill `deploy-vps`); si cambió el
nav, invalidar `nav-cache-cliente`/`nav-cache-admin` de localStorage.

## 3. Verificación funcional mínima antes de mostrar a Frank

1. Abrir la página tocada, consola SIN errores.
2. Probar el flujo tocado con datos reales de prueba (login cliente demo
   `alex@marketingnativo.com` si aplica).
3. Mobile 320px (DevTools).
4. Si tocó BD o edge functions: revisar `cron_log`/logs de la función con MCP
   (`get_logs`).

## 4. Después de verificar

Commit pequeño y descriptivo. Si el cambio rompió la baseline y no hay fix
inmediato: revertir el lote (regla de oro de la reorganización).
