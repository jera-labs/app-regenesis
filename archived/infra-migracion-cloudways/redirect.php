<?php
// ============================================================================
// Re-Génesis — Redirect 301 server-side
// Cualquier path que llegue aquí (porque no es un .html servido por nginx)
// se redirige a neurohackers.cloud preservando path + query.
// ============================================================================
$path  = isset($_SERVER['REQUEST_URI']) ? $_SERVER['REQUEST_URI'] : '/';
$target = 'https://neurohackers.cloud' . $path;

header('HTTP/1.1 301 Moved Permanently');
header('Location: ' . $target);
header('Cache-Control: public, max-age=3600');
header('X-Redirect-Source: regenesis.hubnativo.com');
exit;
