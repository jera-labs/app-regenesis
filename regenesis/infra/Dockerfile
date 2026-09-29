# ============================================================================
# Re-Génesis Platform — Dockerfile para servir los HTMLs estáticos
#
# Imagen base: nginx:alpine (ligera, ~25MB).
# Copia public/ al docroot de nginx.
# Headers de seguridad (CSP, HSTS, etc.) configurados en nginx.conf.
#
# Build:  docker build -t regenesis:latest .
# Run:    docker run -p 8080:80 regenesis:latest
# ============================================================================

FROM nginx:1.27-alpine

# Reemplazar config default de nginx con la nuestra (incluye headers de seguridad)
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copiar todos los archivos estáticos al docroot
COPY public/ /usr/share/nginx/html/

# Permisos correctos para el usuario nginx
RUN chown -R nginx:nginx /usr/share/nginx/html && \
    chmod -R 755 /usr/share/nginx/html

EXPOSE 80

# Healthcheck simple: HEAD a /index.html cada 30s
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
    CMD wget --no-verbose --tries=1 --spider http://127.0.0.1/index.html || exit 1

CMD ["nginx", "-g", "daemon off;"]
