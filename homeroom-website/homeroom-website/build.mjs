// Builds public/index.html from the files in src/. Run:  node build.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.existsSync(path.join(here, 'src')) ? path.join(here, 'src') : path.join(here, '..', 'src');
const read = f => fs.readFileSync(path.join(src, f), 'utf8');
const js = ['core.js', 'logic.js', 'backend-web.js', 'views.js', 'app.js'].map(read).join('\n');
new Function(js); // syntax check
const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Homeroom</title>
<meta name="description" content="Assignments, grades, due dates and announcements from all your school sites in one place.">
<meta name="theme-color" content="#5B8263">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" type="image/png" sizes="32x32" href="/icons/favicon-32.png">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Homeroom">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible+Next:ital,wght@0,400;0,600;0,700;1,400&family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700&display=swap" rel="stylesheet">
<style>
${read('styles.css')}
</style>
</head>
<body>
<div id="root"></div>
<div id="overlay"></div>
<div id="toasts" aria-live="polite"></div>
<script>
${js}
</script>
</body>
</html>
`;
fs.mkdirSync(path.join(here, 'public'), { recursive: true });
fs.writeFileSync(path.join(here, 'public', 'index.html'), html);
console.log('ok  public/index.html', html.length, 'bytes');
