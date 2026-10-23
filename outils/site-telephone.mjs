// Rassemble la page téléphone dans site-telephone/ (prête à mettre en ligne) : mobile/ + commun.js + supabase.js
// + polices + icônes. Usage : node outils/site-telephone.mjs
import { mkdirSync, copyFileSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const racine = join(dirname(fileURLToPath(import.meta.url)), '..');
const sortie = join(racine, 'site-telephone');
rmSync(sortie, { recursive: true, force: true });
mkdirSync(join(sortie, 'fonts'), { recursive: true });

for (const f of readdirSync(join(racine, 'mobile'))) copyFileSync(join(racine, 'mobile', f), join(sortie, f));
copyFileSync(join(racine, 'app', 'commun.js'), join(sortie, 'commun.js'));
copyFileSync(join(racine, 'node_modules', '@supabase', 'supabase-js', 'dist', 'umd', 'supabase.js'), join(sortie, 'supabase.js'));
for (const f of readdirSync(join(racine, 'app', 'fonts'))) copyFileSync(join(racine, 'app', 'fonts', f), join(sortie, 'fonts', f));
console.log('Page téléphone prête dans', sortie);
