#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Verificador de integridad del monorepo (baseline de la reorganización).

Para cada HTML bajo las raíces servidas, comprueba que los assets locales
referenciados (script src, link href, img src) existan en disco. Además corre
`node --check` sobre cada .js para validar sintaxis.

Raíces servidas (nginx en el VPS):
  regenesis/public   -> https://neurohackers.cloud/           (rutas absolutas / = esta raíz)
  plataforma/public  -> https://plataforma.neurohackers.cloud/ (rutas absolutas / = esta raíz)

Uso: python tools/check-integridad.py   (exit 0 = verde)
"""
import os, re, subprocess, sys, io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOTS = {
    "regenesis/public": os.path.join(REPO, "regenesis", "public"),
    "plataforma/public": os.path.join(REPO, "plataforma", "public"),
}
ATTR_RE = re.compile(r"""(?:src|href)\s*=\s*["']([^"'#?]+)""", re.I)

errores = []
avisos = []

def es_local(url):
    return not url.startswith(("http://", "https://", "//", "mailto:", "tel:", "data:", "javascript:", "{"))

for nombre, root in ROOTS.items():
    for dirpath, dirs, files in os.walk(root):
        for fn in files:
            if not fn.endswith(".html"):
                continue
            path = os.path.join(dirpath, fn)
            rel = os.path.relpath(path, REPO).replace("\\", "/")
            html = open(path, encoding="utf-8", errors="replace").read()
            for url in ATTR_RE.findall(html):
                if not es_local(url):
                    continue
                # solo assets (no anclas de navegación entre páginas sin extensión)
                ext = os.path.splitext(url)[1].lower()
                if ext not in (".js", ".css", ".png", ".jpg", ".jpeg", ".svg", ".webp", ".ico", ".woff", ".woff2", ".mp3", ".mp4", ".html"):
                    continue
                if url.startswith("/"):
                    destino = os.path.join(root, url.lstrip("/"))
                else:
                    destino = os.path.join(dirpath, url)
                destino = os.path.normpath(destino)
                if not os.path.exists(destino):
                    (errores if ext in (".js", ".css") else avisos).append(f"{rel}: {url} NO EXISTE")

# sintaxis de todos los .js servidos
js_files = []
for nombre, root in ROOTS.items():
    for dirpath, dirs, files in os.walk(root):
        js_files += [os.path.join(dirpath, f) for f in files if f.endswith(".js") and not f.endswith(".min.js")]
js_err = 0
for jf in js_files:
    r = subprocess.run(["node", "--check", jf], capture_output=True, text=True)
    if r.returncode != 0:
        js_err += 1
        errores.append(f"SINTAXIS JS: {os.path.relpath(jf, REPO)}: {r.stderr.strip().splitlines()[0] if r.stderr else 'error'}")

print(f"HTML revisados en 2 raíces; JS chequeados: {len(js_files)} ({js_err} con error de sintaxis)")
if avisos:
    print(f"\nAVISOS ({len(avisos)}) — assets no críticos faltantes (img/html):")
    for a in avisos[:20]:
        print("  -", a)
    if len(avisos) > 20:
        print(f"  ... y {len(avisos)-20} más")
if errores:
    print(f"\nERRORES ({len(errores)}) — JS/CSS referenciados que no existen o no parsean:")
    for e in errores[:40]:
        print("  -", e)
    sys.exit(1)
print("\nBASELINE VERDE: sin errores críticos de integridad.")
