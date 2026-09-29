---
name: mobile-css-overrides
description: Author CSS overrides for mobile that actually win the cascade. Use whenever you add `@media (max-width: ...)` rules, especially to override `position: sticky`, `position: fixed`, or layouts that misbehave on phones. Documents the cascade order bug that caused the DNA stepper to remain sticky on mobile despite a media query trying to disable it.
---

# CSS mobile overrides — patrón correcto

## Bug histórico (NUNCA repetir)

Cuando dos reglas CSS tienen la **misma specificity**, gana la **última declarada en el código**, INCLUSO si una está dentro de un `@media query`. El media query NO suma specificity; solo restringe cuándo aplica la regla.

Resultado típico del bug: el media query "para mobile" no funciona porque la regla general está declarada más abajo en el archivo.

```css
/* ❌ MAL — esto NO desactiva sticky en mobile */
@media (max-width: 920px) {
  .stepper { position: static; top: auto; }  /* declara primero */
}
.stepper {
  position: sticky;                           /* declara después → gana en mobile también */
  top: var(--space-4);
}
```

## Patrón correcto (opción A — orden)

Declara la regla mobile DESPUÉS de la general:

```css
.stepper {
  position: sticky;
  top: var(--space-4);
}

/* en mobile, esta gana porque está después y aplica igual specificity */
@media (max-width: 920px) {
  .stepper { position: static; top: auto; }
}
```

## Patrón correcto (opción B — defensivo con `!important`)

Si hay reglas adicionales que no controlas (estilos de framework, third-party, otro archivo CSS), usa `!important` en la override de mobile. Es aceptable aquí porque el patrón explícito es "mobile gana":

```css
@media (max-width: 920px) {
  .stepper {
    position: static !important;
    top: auto !important;
    max-height: none !important;  /* por si hay max-height heredado */
  }
}
```

**Solo usa `!important` en overrides de media queries**, no en reglas generales (rompe la cascada normal).

## Patrón correcto (opción C — específica con selector)

Sube la specificity con un selector más específico:

```css
.stepper { position: sticky; top: var(--space-4); }

@media (max-width: 920px) {
  body .stepper { position: static; top: auto; }  /* +1 specificity */
}
```

## Reglas operativas

1. **Antes de agregar un `@media (max-width: ...)`** que sobrescribe una propiedad, busca con grep TODAS las definiciones del selector en el archivo. Si la regla general está DESPUÉS, mueve el media después de ella o usa `!important`.

2. **Layout patterns frágiles a inspeccionar en mobile**:
   - `position: sticky` con `top: ...`
   - `position: fixed`
   - `grid-template-columns` con valores fijos (debe colapsar a `1fr` en mobile)
   - `min-width` o `max-width` con valores en px no responsivos
   - `padding-left` / `padding-right` grandes
   - `width: <Npx>` (debe ser `100%` o `auto` en mobile)
   - `transform: translateX(...)` (puede tapar contenido)

3. **Breakpoints estándar del proyecto**:
   - `920px` — sidebar colapsa, layout cambia a 1 columna
   - `760px` — móviles medianos
   - `540px` — móviles pequeños
   - `390px` — iPhone SE/mini

4. **Test mental obligatorio**: para CADA `position: sticky` o `fixed`, pregúntate:
   - ¿Qué pasa en pantalla de 375px de alto?
   - ¿Tapa contenido al hacer scroll?
   - ¿El usuario puede interactuar con lo que está detrás?

5. **Sidebar global del proyecto** ([shared/styles.css:146-378](plataforma/public/shared/styles.css)):
   - Es `position: fixed` siempre.
   - En mobile (`≤920px`) se oculta con `transform: translateX(-100%)` y se muestra con clase `.open`.
   - Si tu página tiene otros `position: fixed` o `sticky`, considera que pueden chocar con el burger menu del topbar (z-index 70).

## Audit rápido del proyecto

Buscar bombas potenciales:

```bash
# Sticky / fixed en archivos del cliente
grep -rn "position:\s*\(sticky\|fixed\)" plataforma/public/modules/ plataforma/public/regenesis/

# Por cada hit, verificar si tiene override en @media:
# Si NO la tiene → potencial bug en mobile.
```

## Diagnóstico — "esto tapa contenido en mobile"

1. Identifica el elemento que tapa (DevTools → inspeccionar).
2. Lee su `position`. Si es `sticky` o `fixed`, ahí está el bug 90% de las veces.
3. Busca TODAS las definiciones del selector en el archivo (`grep -n`).
4. Comprueba el orden de las reglas.
5. Aplica una de las opciones A/B/C de arriba.
6. **Después del fix, bumpe cache busting** (`?v=YYYYMMnn`) y deploya, o el cliente no verá el cambio durante 4h por cache de Cloudflare.

## Cuándo NO desactivar sticky en mobile

Si el header sticky es la NAVEGACIÓN principal (no progreso/sidebar de paso), mantenerlo sticky puede ser correcto. Pero entonces:
- Limita su altura: `max-height: 60px` para no tapar mucho.
- Considera reducir su contenido en mobile (ocultar elementos no críticos).
- Asegúrate de que `scroll-margin-top` en los anchor targets compense la altura del header.
