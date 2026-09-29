-- loadtest/cleanup_users.sql
-- Borra los usuarios de prueba creados por seed_users.sql.
-- Ejecuta DESPUÉS de terminar las pruebas para no dejar basura.

-- Borrar dependencias primero (journaling, interacciones, etc.)
DELETE FROM journaling_respuestas WHERE lead_id IN (SELECT id FROM leads WHERE fuente = 'loadtest');
DELETE FROM ia_analisis           WHERE lead_id IN (SELECT id FROM leads WHERE fuente = 'loadtest');
DELETE FROM interacciones         WHERE lead_id IN (SELECT id FROM leads WHERE fuente = 'loadtest');
DELETE FROM sesiones_app          WHERE lead_id IN (SELECT id FROM leads WHERE fuente = 'loadtest');
DELETE FROM cliente_alertas       WHERE lead_id IN (SELECT id FROM leads WHERE fuente = 'loadtest');

-- Borrar leads (las FKs ON DELETE CASCADE limpian el resto)
DELETE FROM leads WHERE fuente = 'loadtest';

-- Borrar auth.users
DELETE FROM auth.users WHERE email LIKE 'loadtest+%@neurohackers.test';

SELECT 'Cleanup completado' AS status,
       (SELECT count(*) FROM leads WHERE fuente = 'loadtest') AS leads_restantes,
       (SELECT count(*) FROM auth.users WHERE email LIKE 'loadtest+%@neurohackers.test') AS users_restantes;
