# Design System Neurohackers — referente único

Aplica a TODO el monorepo (plataforma, Re-Génesis y landings). Fuente de
tokens en código: `plataforma/public/shared/styles.css` (bloque `:root`) y
`regenesis/public/assets/styles/tokens.css` (sitio viejo, misma paleta).
Ante conflicto entre este doc y esos archivos, ganan los archivos.

## Identidad

Minimalismo estilo Apple + acento dorado mesurado (rebrand "OINL").
Tipografía **Geist** (sans) + **Geist Mono** (labels, SIEMPRE uppercase),
cargadas de Google Fonts con `preconnect`.

## Tokens principales

```
Fondos      --bg #FAFAFA (plataforma) / #F5F5F7 (regenesis) · --surface #FFFFFF
            --surface-2 #F5F5F7 · --surface-3 #EFEFF1
Bordes      --border #D2D2D7 · --border-soft #E8E8ED
Texto       --text #1D1D1F · --text-muted #6E6E73 · --text-faint #A1A1A6
Acento      --accent #D4AF37 · --accent-soft #F5E9B8 · --accent-bright #E5C147
            --accent-dark #B8941F · --accent-deeper #8E6F12
            --accent-glow rgba(212,175,55,.18)
Espaciado   --space-1..24 (múltiplos de 4px)
Radios      --radius-sm 8px … --radius-xl 24px
Sombras     --shadow-card / --shadow-card-hover (muy suaves, sin color)
Transición  150-250ms cubic-bezier(0.4, 0, 0.2, 1)
```

## Reglas duras (no negociables)

- **NUNCA:** emojis en UI, gradientes coloridos, sombras de color, cursivas,
  animaciones excesivas, grids decorativos, esquinas en L, eyebrows "v1.0".
- **Acento dorado SOLO en:** CTAs primarios, badges activos, líneas de label,
  status pulsante. Nunca en fondos grandes ni texto largo.
- **Iconos:** caracteres Unicode geométricos (▦ ◌ ◈ ≡ ∼ ◰ ⚙), no librerías.
- **Mobile-first:** breakpoint `@media (max-width: 968px)`; todo debe servir
  en 320px. Overrides mobile: ver skill `mobile-css-overrides` (orden de
  cascada con sticky/fixed).
- Variables CSS siempre; **nunca** hardcodear colores ni espaciado.
- Componente intocable: bloque de stats con **% de Compromiso** (validado por
  Frank).

## Estados y accesibilidad

- Estados de todo control: default, hover (sombra suave + borde), focus
  (outline accesible, no quitar), disabled (opacity .5 + cursor).
- Contraste mínimo AA sobre `--bg`/`--surface`; el dorado #D4AF37 NO alcanza
  AA sobre blanco para texto: usarlo en texto solo ≥18px/bold o con
  `--accent-deeper`.
- `escapeHtml()` en todo dato de usuario que entra al DOM (seguridad, pero
  también evita romper el layout).

## Navegación (plataforma)

Sidebar permanente `nav.js` con View Transitions API (el sidebar es shared
element, no se anima). Hrefs SIEMPRE absolutos (`data-turbo-permanent`).
Se cachea en localStorage: al cambiar el nav, invalidar `nav-cache-cliente`
y `nav-cache-admin` (lo maneja la skill `deploy-vps`).

## Desviaciones aceptadas por módulo

- **Landings** (`live-lucky/`, `regenesis-growth/`): pueden intensificar el
  dorado en héroe/CTA por conversión, manteniendo tipografía y tokens.
- **Sitio viejo** (`regenesis/public/`): congelado en su versión de tokens;
  no invertir en alinearlo (es legacy en retirada).
