// Ce que le timer (app.js) et le planning (planning.js) partagent : la base, la mémoire locale, les dates, la démo.

const SUPABASE_URL = 'https://pgutbxtfsklazotlfcii.supabase.co';
const SUPABASE_CLE = 'sb_publishable_926mvaA1YdMl3Xqv8D7SRw_ngv7QhLv';
const COLONNES = 'id,title,project,category,assignee,owner,status,due_date,start_time,end_time,priority,description,created_at,updated_at';

const params = new URLSearchParams(location.search);
const DEMO = params.has('demo');

// Le lien avec Windows (preload.js) ; dans un navigateur (essais), des remplaçants qui ne font rien.
const pont = window.bureau || {
  taille() {}, echelle() {}, alerte() {}, masquer() {}, surDeconnexion() {},
  async redimDebut() { return null; }, async redimFin() {}, surAncrage() {},
  ouvrirPlanning() { window.open('planning.html' + (DEMO ? '?demo' : ''), '_blank'); },
  signalerModif() {}, surRecharger() {}, lancerTimer() {}, surLancer() {},
};

const $ = id => document.getElementById(id);
const memoire = {
  lire(cle, defaut) {
    try { const v = localStorage.getItem('timer.' + cle); return v == null ? defaut : JSON.parse(v); } catch { return defaut; }
  },
  ecrire(cle, valeur) {
    try { localStorage.setItem('timer.' + cle, JSON.stringify(valeur)); } catch {}
  },
};

document.documentElement.dataset.theme = params.get('theme') || memoire.lire('theme', 'vert');

let client = null;
let moi = null;    // prénom du compte connecté (« Mathis », « Remi »…)
let monId = null;  // son identifiant dans la base
// L'équipe (Mathis, Rémi, Noah) a des tâches en commun ; un membre d'Easy Send n'a que les siennes.
let estEquipe = true;
let acces = true;  // équipe, ou membre avec Easy Desk activé sur son compte

function creerClient() {
  return supabase.createClient(SUPABASE_URL, SUPABASE_CLE, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: 'timer-easy-send' },
  });
}

// Qui est connecté : son prénom, s'il fait partie de l'équipe (même règle que la base : qg_is_team) et s'il a
// accès à Easy Desk. Chacun ne voit de toute façon que ses tâches (et l'équipe, les tâches en commun) : la base le garantit.
async function lireMoi(user) {
  monId = user.id;
  const [profil, equipe] = await Promise.all([
    client.from('profiles').select('full_name,mod_qg,role').eq('id', user.id).maybeSingle(),
    client.rpc('qg_is_team'),
  ]);
  moi = profil.data && profil.data.full_name ? profil.data.full_name : null;
  // Si la question à la base échoue, on se fie au rôle (les trois de l'équipe sont admin).
  estEquipe = equipe.error ? !!(profil.data && profil.data.role === 'admin') : equipe.data === true;
  acces = estEquipe || !!(profil.data && profil.data.mod_qg);
}

const MESSAGE_SANS_ACCES = "Easy Desk n'est pas activé sur ton compte Easy Send. Demande à l'équipe Easy Send de l'activer.";

// Écrit des champs d'une tâche dans Easy Desk (rien en démo).
async function majTache(id, champs) {
  if (DEMO) return { error: null };
  return client.from('qg_tasks').update({ ...champs, updated_at: new Date().toISOString() }).eq('id', id);
}

// ---------- Dates ----------
const pad = n => String(n).padStart(2, '0');
const jourLocal = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function versDate(jour) {
  const [a, mo, j] = jour.split('-').map(Number);
  return new Date(a, mo - 1, j);
}
function aHeure(jour, hhmm) {
  if (!jour || !hhmm) return null;
  const [h, m] = String(hhmm).split(':').map(Number);
  if (Number.isNaN(h)) return null;
  const d = versDate(jour);
  d.setHours(h, m || 0, 0, 0);
  return d;
}
function duree(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}
const heure = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const hhmm = t => (t ? String(t).slice(0, 5) : '');
const enMinutes = t => { const [h, m] = hhmm(t).split(':').map(Number); return h * 60 + (m || 0); };
const versHeure = min => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
const dateCourte = jour => versDate(jour).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
const ajouterJours = (jour, n) => { const d = versDate(jour); d.setDate(d.getDate() + n); return jourLocal(d); };
const debutDuJour = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const sansAccent = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// Le temps prévu pour une tâche (de son heure de début à son heure de fin), en ms ; null si elle n'en a pas.
function dureeAllouee(t) {
  if (!t.start_time || !t.end_time) return null;
  const min = enMinutes(t.end_time) - enMinutes(t.start_time);
  return min > 0 ? min * 60000 : null;
}

// « Au lendemain » : le jour après sa date, ou demain si sa date est déjà passée (ou s'il n'y en a pas).
function auLendemain(jour) {
  const aujourdhui = jourLocal(new Date());
  return jour && jour >= aujourdhui ? ajouterJours(jour, 1) : ajouterJours(aujourdhui, 1);
}

// « Mes tâches » = ses tâches perso et celles mises en commun, sauf celles attribuées à quelqu'un d'autre ;
// « Toute l'équipe » montre tout. (21/10 : il a préféré garder les communs : « on fera gaffe de bien les mettre ».)
function pourMoi(t) {
  if (!estEquipe || memoire.lire('equipe', false) || !moi || !t.assignee) return true;
  return sansAccent(t.assignee) === sansAccent(moi);
}

// ---------- Démo (pour vérifier l'affichage sans compte) ----------
function tachesDemo() {
  const m = new Date();
  const dans = min => heure(new Date(m.getTime() + min * 60000));
  const jour = d => ajouterJours(jourLocal(m), d);
  const depassee = params.get('demo') === 'depassee';  // pour voir l'état « dépassée »
  const t = (id, title, due_date, start_time, end_time, autres = {}) => ({
    id, title, due_date, start_time, end_time, project: 'Organisation', category: 'Autre', assignee: 'Mathis', owner: 'moi',
    status: 'À faire', priority: 'Moyenne', description: '', created_at: m.toISOString(), updated_at: m.toISOString(), ...autres,
  });
  return [
    t('d1', 'Trier mes prompts sur Easy Send', jour(0), dans(depassee ? -40 : -12), dans(depassee ? -6 : 18), {
      priority: 'Basse',
      description: 'Ranger les prompts par type (FACE/DOS miroir, sacs, chaussures) et supprimer les doublons.\nGarder les noms sans accent pour le bouton « Créer les mannequins ».' }),
    t('d2', 'Trier mes fonds sur Easy Send', jour(0), dans(18), dans(48), { assignee: null, priority: 'Basse' }),
    t('d3', 'Tournage vidéo', jour(0), dans(-140), dans(-60), { priority: 'Haute', category: 'Création de contenu' }),
    t('d4', "Proposer l'entrepôt à un client", null, null, null, { project: 'Formation' }),
    t('d5', 'Appeler assurance voiture', jour(-7), null, null, { category: 'Perso' }),
    t('d6', 'Remboursement Amazon', jour(3), null, null, { assignee: null, status: 'En attente' }),
    t('d7', 'Rd comptable', jour(0), '09:00', null, { assignee: null, status: 'Terminé', updated_at: new Date(m.getTime() - 3 * 3600000).toISOString() }),
    t('d8', 'Appel client · 11:00', jour(1), '11:00', '11:30', { priority: 'Haute', project: 'Formation', category: 'Marketing' }),
    t('d9', 'Montage reel « tier list »', jour(1), '14:00', '16:30', { category: 'Création de contenu' }),
    t('d10', 'Point équipe', jour(2), '10:00', '11:00', { assignee: null }),
    t('d11', 'Préparer les colis', jour(2), '10:30', '12:00', { assignee: 'Rémi', owner: null }),
    t('d15', 'Planning mensuel tournage vidéo formation', null, null, null, { assignee: null, owner: null }),
    t('d12', 'Shooting photos Vinted', jour(-1), '15:00', '17:00'),
    t('d13', 'Relancer un prospect', jour(4), null, null, { assignee: null }),
    t('d14', 'Sécuriser le site', null, null, null, { assignee: null, priority: 'Haute' }),
  ];
}
