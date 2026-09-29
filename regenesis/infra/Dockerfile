# Imagen nginx para EasyPanel.
# El contexto de build es la raíz del monorepo (EasyPanel clona el repo entero).
# En el panel, la ruta del Dockerfile tiene que ir con barras normales:
#   regenesis/infra/Dockerfile
#
# Layout dentro de la imagen, igual que el volumen del VPS:
#   /usr/share/nginx/html      ← regenesis/public
#   /usr/share/nginx/html/app  ← plataforma/public

FROM nginx:1.27-alpine

COPY regenesis/infra/nginx.conf /etc/nginx/conf.d/default.conf
COPY regenesis/public/ /usr/share/nginx/html/
COPY plataforma/public/ /usr/share/nginx/html/app/

RUN chown -R nginx:nginx /usr/share/nginx/html && \
    chmod -R 755 /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
    CMD wget --no-verbose --tries=1 --spider http://127.0.0.1/index.html || exit 1

CMD ["nginx", "-g", "daemon off;"]
