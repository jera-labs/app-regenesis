-- ============================================================================
-- Migración 85: slug amigable en application_links
--
-- URL del portal del cliente pasa de /aplicacion/<uuid> a
-- /aplicacion/<nombre>-<código4> (ej. maria-gelvez-x7k2). El nombre la hace
-- legible; el código corto la hace no adivinable (la página pre-carga PII) y
-- diferencia nombres repetidos automáticamente. Los enlaces UUID ya enviados
-- siguen funcionando (la ruta acepta ambos).
-- ============================================================================

ALTER TABLE application_links ADD COLUMN IF NOT EXISTS slug text UNIQUE;

-- Backfill de enlaces existentes: nombre slugificado + 4 chars aleatorios.
-- (translate en vez de unaccent para no depender de la extensión.)
UPDATE application_links
SET slug = regexp_replace(
             regexp_replace(
               lower(translate(coalesce(nombre_contacto,'cliente'),
                               'áéíóúñüÁÉÍÓÚÑÜ', 'aeiounuaeiounu')),
               '[^a-z0-9]+', '-', 'g'),
             '(^-+|-+$)', '', 'g'
           ) || '-' || substr(md5(random()::text || id::text), 1, 4)
WHERE slug IS NULL;

CREATE INDEX IF NOT EXISTS application_links_slug_idx ON application_links(slug);
