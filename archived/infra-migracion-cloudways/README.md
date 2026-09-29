# Infra de la migración Cloudways → Hostinger (archivado 2026-07-06)

Stubs y configs de la transición de hosting (mayo-junio 2026), ya fuera de uso:

- `redirect.html` / `redirect.php` / `.htaccess.redirect`: redirects 301 que se
  montaron en Cloudways (`regenesis.hubnativo.com`) para enviar el tráfico al
  dominio nuevo `neurohackers.cloud`. Cloudways ya se desconectó.
- `nginx.conf`: config nginx original del service `regenesis` en EasyPanel
  (un solo server block, 2026-05-31).
- `nginx-redirect.conf`: variante intermedia con redirect (2026-06-03).

La config VIGENTE es `regenesis/infra/nginx-new.conf` (2 server blocks). El
archivo nginx real en el VPS vive en el mount de EasyPanel (`files/1.txt`, ver
memoria `project_easypanel_vps_gotchas`).
