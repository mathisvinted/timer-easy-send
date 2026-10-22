// Planning de la semaine : les tâches d'Easy Desk en grand, à déplacer, rallonger ou modifier.
// Glisser un créneau = changer son jour ou son heure (pas de 15 min) ; le déposer sur le nom d'un jour = changer
// seulement le jour ; tirer son bas = changer l'heure de fin ; déposer sur « Journée » = garder le jour sans heure ;
// déposer à droite = retirer la date. « Au lendemain » (fiche) décale d'un jour en un clic.
// Chaque changement s'écrit tout de suite dans Easy Desk et peut être annulé depuis le message en bas.

const HEURE_PX = 56;       // hauteur d'une heure (même valeur que --heure dans planning.css)
const PAS_MIN = 15;
const DUREE_DEFAUT = 30;   // durée affichée d'une tâche sans heure de fin
const RAFRAICHIR_MS = 30000;
const JOURS = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'];
const PERSONNES = ['Mathis', 'Rémi', 'Noah'];

let taches = [];
let lundi = lundiDe(jourLocal(new Date()));
let heureMin = 7;
const heureMax = 24;
let glisse = null;    // { t, mode, el, x0, y0, prise, bouge, cible }
let edition = null;   // tâche ouverte dans la fiche
let creation = false; // la fiche crée une nouvelle tâche
let estConnecte = false;
let derniereMaj = null;
let horsLigne = false;
let aDefile = false;

function lundiDe(jour) {
  const d = versDate(jour);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return jourLocal(d);
}
const joursSemaine = () => Array.from({ length: 7 }, (_, i) => ajouterJours(lundi, i));
const snap = m => Math.round(m / PAS_MIN) * PAS_MIN;
const versHeureFin = m => (m >= 24 * 60 ? '23:59' : versHeure(m));
const vide = v => (v === '' || v === undefined ? null : v);

// Début et fin d'une tâche en minutes depuis minuit (fin estimée si elle n'en a pas).
function creneau(t) {
  const debut = enMinutes(t.start_time);
  let fin = t.end_time ? enMinutes(t.end_time) : null;
  const sansFin = fin === null || fin <= debut;
  if (sansFin) fin = Math.min(24 * 60, debut + DUREE_DEFAUT);
  return { debut, fin, sansFin };
}

// ---------- Données ----------
async function charger() {
  if (DEMO) {
    if (!taches.length) taches = tachesDemo();
    rendre();
    return;
  }
  if (!estConnecte) return;
  const dimanche = ajouterJours(lundi, 6);
  const aujourdhui = jourLocal(new Date());
  // La semaine affichée (toutes, terminées comprises), les tâches sans date et les retards.
  const rep = await client.from('qg_tasks').select(COLONNES)
    .or(`and(due_date.gte.${lundi},due_date.lte.${dimanche}),and(due_date.is.null,status.neq.Terminé),and(due_date.lt.${aujourdhui},status.neq.Terminé)`)
    .limit(1000);
  if (rep.error) {
    horsLigne = true;
    rendreReseau();
    return;
  }
  horsLigne = false;
  derniereMaj = new Date();
  taches = rep.data;
  if (!glisse) rendre();
}

// Écrit un changement, avec « Annuler » pour revenir à l'état d'avant.
async function modifier(t, champs, libelle, annulable = true) {
  const avant = {};
  for (const k of Object.keys(champs)) avant[k] = vide(t[k]) ?? null;
  if (Object.keys(champs).every(k => (vide(champs[k]) ?? null) === avant[k])) return;
  Object.assign(t, champs);
  rendre();
  const { error } = await majTache(t.id, champs);
  if (error) {
    Object.assign(t, avant);
    rendre();
    toast("Pas pu enregistrer dans Easy Desk, réessaie.");
    return;
  }
  pont.signalerModif();
  if (annulable) toast(libelle, 'Annuler', () => modifier(t, avant, 'Changement annulé', false));
  else toast(libelle);
}

// ---------- Affichage ----------
function rendre() {
  const jours = joursSemaine();
  const maintenant = new Date();
  const aujourdhui = jourLocal(maintenant);
  const liste = taches.filter(pourMoi);
  const debuts = liste.filter(t => jours.includes(t.due_date) && t.start_time).map(t => Math.floor(enMinutes(t.start_time) / 60));
  heureMin = Math.min(7, ...debuts);

  $('semaine').textContent = libelleSemaine(jours);
  rendreTetes(jours, aujourdhui);
  rendreJournee(jours, liste);
  rendreGrille(jours, liste, aujourdhui, maintenant);
  rendreCote(liste, jours, aujourdhui);
  const equipe = memoire.lire('equipe', false);
  $('filtre-moi').parentNode.hidden = !estEquipe;
  $('filtre-moi').classList.toggle('actif', !equipe);
  $('filtre-equipe').classList.toggle('actif', equipe);
  rendreReseau();
  const defile = $('defile');
  document.documentElement.style.setProperty('--barre-defilement', defile.offsetWidth - defile.clientWidth + 'px');
  if (!aDefile) {
    aDefile = true;
    const cible = jours.includes(aujourdhui) ? maintenant.getHours() * 60 + maintenant.getMinutes() - 90 : 8 * 60;
    defile.scrollTop = Math.max(0, (cible - heureMin * 60) * HEURE_PX / 60);
  }
}

function libelleSemaine(jours) {
  const d1 = versDate(jours[0]), d7 = versDate(jours[6]);
  const mois = d => d.toLocaleDateString('fr-FR', { month: 'long' });
  return d1.getMonth() === d7.getMonth()
    ? `${d1.getDate()} – ${d7.getDate()} ${mois(d7)} ${d7.getFullYear()}`
    : `${d1.getDate()} ${mois(d1)} – ${d7.getDate()} ${mois(d7)} ${d7.getFullYear()}`;
}

function el(tag, classe, texte) {
  const n = document.createElement(tag);
  if (classe) n.className = classe;
  if (texte !== undefined) n.textContent = texte;
  return n;
}

function rendreTetes(jours, aujourdhui) {
  const tetes = $('tetes');
  tetes.replaceChildren(el('div'));
  jours.forEach((jour, i) => {
    const tete = el('div', 'jour-tete' + (jour === aujourdhui ? ' aujourdhui' : ''));
    tete.dataset.jour = jour;
    tete.append(el('span', '', JOURS[i]), el('span', 'num', String(versDate(jour).getDate())));
    tetes.append(tete);
  });
}

function rendreJournee(jours, liste) {
  const journee = $('journee');
  journee.replaceChildren(el('div', 'libelle', 'Journée'));
  for (const jour of jours) {
    const zone = el('div', 'zone-journee');
    zone.dataset.jour = jour;
    for (const t of liste.filter(x => x.due_date === jour && !x.start_time)) {
      const puce = el('div', 'puce-tache' + (t.status === 'Terminé' ? ' fait' : ''));
      puce.dataset.id = t.id;
      puce.dataset.priorite = sansAccent(t.priority || 'Moyenne');
      puce.title = `${t.title}\nPriorité ${(t.priority || 'moyenne').toLowerCase()}`;
      puce.append(el('i', 'prio'), el('span', '', t.title));
      zone.append(puce);
    }
    journee.append(zone);
  }
}

function placerEnVoies(items) {
  const groupes = [];
  let groupe = [], finGroupe = -1;
  for (const it of items) {
    if (groupe.length && it.debut >= finGroupe) { groupes.push(groupe); groupe = []; finGroupe = -1; }
    groupe.push(it);
    finGroupe = Math.max(finGroupe, it.fin);
  }
  if (groupe.length) groupes.push(groupe);
  for (const g of groupes) {
    const voies = [];
    for (const it of g) {
      let v = voies.findIndex(f => f <= it.debut);
      if (v === -1) { v = voies.length; voies.push(it.fin); } else voies[v] = it.fin;
      it.voie = v;
    }
    for (const it of g) it.nbVoies = voies.length;
  }
}

function rendreGrille(jours, liste, aujourdhui, maintenant) {
  const grille = $('grille');
  const hauteur = (heureMax - heureMin) * HEURE_PX;
  grille.replaceChildren();
  grille.style.height = hauteur + 'px';

  const heures = el('div', 'heures');
  for (let h = heureMin; h < heureMax; h++) {
    const s = el('span', '', `${pad(h)}:00`);
    s.style.top = (h - heureMin) * HEURE_PX + 'px';
    heures.append(s);
  }
  grille.append(heures);

  const minutesMaintenant = maintenant.getHours() * 60 + maintenant.getMinutes();
  jours.forEach((jour, i) => {
    const col = el('div', 'colonne' + (i >= 5 ? ' weekend' : '') + (jour === aujourdhui ? ' aujourdhui' : ''));
    col.dataset.jour = jour;
    const items = liste
      .filter(t => t.due_date === jour && t.start_time)
      .map(t => ({ t, ...creneau(t) }))
      .sort((a, b) => a.debut - b.debut || b.fin - a.fin);
    placerEnVoies(items);
    for (const it of items) col.append(bloc(it, jour, aujourdhui, minutesMaintenant));
    if (jour === aujourdhui) {
      const ligne = el('div', 'maintenant-ligne');
      ligne.style.top = (minutesMaintenant - heureMin * 60) * HEURE_PX / 60 + 'px';
      col.append(ligne);
    }
    grille.append(col);
  });
}

function bloc(it, jour, aujourdhui, minutesMaintenant) {
  const { t } = it;
  const b = el('div', 'bloc');
  b.dataset.id = t.id;
  b.dataset.priorite = sansAccent(t.priority || 'Moyenne');
  const haut = (it.debut - heureMin * 60) * HEURE_PX / 60;
  const h = Math.max(22, (it.fin - it.debut) * HEURE_PX / 60 - 2);
  b.style.top = haut + 'px';
  b.style.height = h + 'px';
  b.style.left = `calc(${it.voie} * 100% / ${it.nbVoies} + 4px)`;
  b.style.width = `calc(100% / ${it.nbVoies} - 8px)`;
  const passee = jour < aujourdhui || (jour === aujourdhui && it.fin <= minutesMaintenant);
  if (t.status === 'Terminé') b.classList.add('fait');
  else if (t.status === 'En attente') b.classList.add('attente');
  else if (passee) b.classList.add('retard');
  if (jour === aujourdhui && it.debut <= minutesMaintenant && minutesMaintenant < it.fin && t.status !== 'Terminé') b.classList.add('maintenant');
  if (it.sansFin) b.classList.add('sans-fin');
  if (h < 44) b.classList.add('court');
  const qui = t.assignee && (!moi || sansAccent(t.assignee) !== sansAccent(moi)) ? ` · ${t.assignee}` : '';
  const horaire = it.sansFin ? hhmm(t.start_time) : `${hhmm(t.start_time)} – ${hhmm(t.end_time)}`;
  const retard = b.classList.contains('retard') ? ' · pas faite' : '';
  const titre = el('div', 'bloc-titre');
  titre.append(el('i', 'prio'), t.title);
  b.append(titre, el('div', 'bloc-heure', horaire + qui + retard));
  b.title = `${t.title}\n${horaire}${qui}\nPriorité ${(t.priority || 'moyenne').toLowerCase()}${retard}`;
  // La poignée pour rallonger n'existe que sur les créneaux assez hauts : sur un créneau de 30 min,
  // elle prenait un tiers de la place et un glisser rallongeait au lieu de déplacer.
  if (!it.sansFin && h >= 40) b.append(el('div', 'poignee'));
  return b;
}

function rendreCote(liste, jours, aujourdhui) {
  const carte = (t, info) => {
    const c = el('div', 'carte-tache');
    c.dataset.id = t.id;
    const m = el('div', 'm');
    const point = el('i', sansAccent(t.priority));
    m.append(point, info);
    if (t.assignee && (!moi || sansAccent(t.assignee) !== sansAccent(moi))) m.append(` · ${t.assignee}`);
    if (t.status === 'En attente') m.append(' · en attente');
    c.append(el('div', 't', t.title), m);
    return c;
  };
  const sansDate = liste.filter(t => !t.due_date && t.status !== 'Terminé');
  const retards = liste
    .filter(t => t.due_date && t.due_date < aujourdhui && t.status !== 'Terminé' && !jours.includes(t.due_date))
    .sort((a, b) => a.due_date.localeCompare(b.due_date));
  const pile1 = $('sans-date'), pile2 = $('en-retard');
  pile1.replaceChildren(...(sansDate.length ? sansDate.map(t => carte(t, `Priorité ${(t.priority || 'moyenne').toLowerCase()}`))
    : [el('p', 'vide', 'Rien sans date.')]));
  pile2.replaceChildren(...retards.map(t => carte(t, dateCourte(t.due_date))));
  $('titre-retard').hidden = !retards.length;
}

function rendreReseau() {
  const r = $('reseau');
  r.classList.toggle('hors-ligne', horsLigne);
  r.textContent = horsLigne ? 'Hors ligne, nouvel essai…' : derniereMaj ? `À jour · ${heure(derniereMaj)}` : '';
}

let minuteurToast = null;
function toast(texte, bouton, auClic) {
  $('toast-texte').textContent = texte;
  const b = $('toast-bouton');
  b.hidden = !bouton;
  b.textContent = bouton || '';
  b.onclick = auClic ? () => { $('toast').hidden = true; auClic(); } : null;
  $('toast').hidden = false;
  clearTimeout(minuteurToast);
  minuteurToast = setTimeout(() => { $('toast').hidden = true; }, 9000);
}

// ---------- Glisser-déposer ----------
let fantome = null, repere = null;

function demarrerGlisse(g) {
  g.el.classList.add('en-glisse');
  document.body.classList.add(g.mode === 'duree' ? 'glisse-duree' : 'glisse-actif');
  if (g.mode === 'deplacer') {
    fantome = el('div', 'fantome', g.t.title);
    document.body.append(fantome);
  }
}

function afficherRepere(col, debut, fin) {
  if (!repere) repere = el('div', 'repere');
  if (repere.parentNode !== col) col.append(repere);
  repere.style.top = (debut - heureMin * 60) * HEURE_PX / 60 + 'px';
  repere.style.height = Math.max(20, (fin - debut) * HEURE_PX / 60 - 2) + 'px';
  repere.replaceChildren(el('span', '', `${versHeure(debut)} – ${versHeureFin(fin)}`));
}

function effacerSurvol() {
  for (const n of document.querySelectorAll('.survol')) n.classList.remove('survol');
}

function suivre(g, x, y) {
  effacerSurvol();
  const sous = document.elementsFromPoint(x, y);
  const trouver = test => sous.find(n => n.classList && test(n));
  const col = trouver(n => n.classList.contains('colonne'));
  const zone = trouver(n => n.classList.contains('zone-journee'));
  const tete = trouver(n => n.classList.contains('jour-tete'));
  const cote = trouver(n => n.id === 'cote');
  const colJour = document.querySelector(`.colonne[data-jour="${g.t.due_date}"]`);
  // On rallongeait, mais la souris sort de la colonne du jour : c'est finalement un déplacement.
  if (g.mode === 'duree' && ((col && col !== colJour) || tete || zone || cote)) {
    g.mode = 'deplacer';
    g.prise = Math.min(g.y0 - g.el.getBoundingClientRect().top, 20);
    document.body.classList.replace('glisse-duree', 'glisse-actif');
    fantome = el('div', 'fantome', g.t.title);
    document.body.append(fantome);
  }
  if (fantome) fantome.style.transform = `translate(${x + 14}px, ${y + 14}px)`;

  if (g.mode === 'duree') {
    const { debut } = creneau(g.t);
    const rect = colJour.getBoundingClientRect();
    const fin = Math.min(24 * 60, Math.max(debut + PAS_MIN, snap(heureMin * 60 + (y - g.prise + 2 - rect.top) * 60 / HEURE_PX)));
    g.cible = { type: 'duree', fin };
    afficherRepere(colJour, debut, fin);
    return;
  }
  if (col) {
    const rect = col.getBoundingClientRect();
    const duree = g.t.start_time ? creneau(g.t).fin - creneau(g.t).debut : DUREE_DEFAUT;
    let debut = snap(heureMin * 60 + (y - g.prise - rect.top) * 60 / HEURE_PX);
    debut = Math.max(heureMin * 60, Math.min(24 * 60 - duree, debut));
    g.cible = { type: 'creneau', jour: col.dataset.jour, debut, fin: debut + duree };
    afficherRepere(col, debut, debut + duree);
    return;
  }
  if (repere) repere.remove();
  if (tete) { g.cible = { type: 'jour', jour: tete.dataset.jour }; tete.classList.add('survol'); return; }
  if (zone) { g.cible = { type: 'journee', jour: zone.dataset.jour }; zone.classList.add('survol'); return; }
  if (cote) { g.cible = { type: 'sans-date' }; cote.classList.add('survol'); return; }
  g.cible = null;
}

function finirGlisse(g) {
  g.el.classList.remove('en-glisse');
  document.body.classList.remove('glisse-actif', 'glisse-duree');
  effacerSurvol();
  if (fantome) { fantome.remove(); fantome = null; }
  if (repere) { repere.remove(); repere = null; }
  const c = g.cible, t = g.t;
  if (!c) { rendre(); return; }
  if (c.type === 'duree') {
    modifier(t, { end_time: versHeureFin(c.fin) }, `« ${t.title} » finit à ${versHeureFin(c.fin)}`);
  } else if (c.type === 'creneau') {
    const champs = { due_date: c.jour, start_time: versHeure(c.debut) };
    // Une tâche sans heure de fin la garde ainsi ; une tâche qui arrive sans horaire reçoit 30 min.
    if (t.end_time || !t.start_time) champs.end_time = versHeureFin(c.fin);
    modifier(t, champs, `« ${t.title} » : ${dateCourte(c.jour)} à ${versHeure(c.debut)}`);
  } else if (c.type === 'jour') {
    modifier(t, { due_date: c.jour }, `« ${t.title} » : ${dateCourte(c.jour)}${t.start_time ? ' à ' + hhmm(t.start_time) : ''}`);
  } else if (c.type === 'journee') {
    modifier(t, { due_date: c.jour, start_time: null, end_time: null }, `« ${t.title} » : ${dateCourte(c.jour)}, sans heure`);
  } else if (c.type === 'sans-date') {
    modifier(t, { due_date: null, start_time: null, end_time: null }, `« ${t.title} » n'a plus de date`);
  }
  rendre();
}

// Un clic sur une case vide crée une tâche à cette heure (ou ce jour, sur la ligne « Journée »).
let clicVide = null;
function caseVide(x, y) {
  const sous = document.elementsFromPoint(x, y);
  const col = sous.find(n => n.classList && n.classList.contains('colonne'));
  if (col) {
    const rect = col.getBoundingClientRect();
    const debut = Math.floor((heureMin * 60 + (y - rect.top) * 60 / HEURE_PX) / PAS_MIN) * PAS_MIN;
    return { col, jour: col.dataset.jour, debut: Math.min(debut, 24 * 60 - DUREE_DEFAUT) };
  }
  const zone = sous.find(n => n.classList && n.classList.contains('zone-journee'));
  return zone ? { jour: zone.dataset.jour } : null;
}

document.addEventListener('pointerdown', e => {
  if (e.button !== 0 || edition) return;
  const cible = e.target.closest('[data-id]');
  if (!cible) {
    const c = e.target.closest('.colonne, .zone-journee') ? caseVide(e.clientX, e.clientY) : null;
    clicVide = c ? { ...c, x0: e.clientX, y0: e.clientY } : null;
    return;
  }
  const t = taches.find(x => x.id === cible.dataset.id);
  if (!t) return;
  const mode = e.target.closest('.poignee') ? 'duree' : 'deplacer';
  // Où la souris tient le créneau : le haut se déplace sous elle, ou le bas quand on rallonge.
  const rect = cible.getBoundingClientRect();
  const prise = mode === 'duree' ? e.clientY - rect.bottom : cible.classList.contains('bloc') ? e.clientY - rect.top : 0;
  glisse = { t, mode, el: cible, x0: e.clientX, y0: e.clientY, prise, bouge: false, cible: null };
  e.preventDefault();
});
document.addEventListener('pointermove', e => {
  if (!glisse) { survolCreation(e); return; }
  if (!glisse.bouge) {
    const dx = e.clientX - glisse.x0, dy = e.clientY - glisse.y0;
    if (Math.hypot(dx, dy) < 5) return;
    // Pris par le bas mais tiré sur le côté : c'est un déplacement, pas un rallongement.
    if (glisse.mode === 'duree' && Math.abs(dx) > Math.abs(dy)) {
      glisse.mode = 'deplacer';
      glisse.prise = glisse.y0 - glisse.el.getBoundingClientRect().top;
    }
    glisse.bouge = true;
    demarrerGlisse(glisse);
  }
  suivre(glisse, e.clientX, e.clientY);
});
document.addEventListener('pointerup', e => {
  if (clicVide) {
    const c = clicVide;
    clicVide = null;
    if (Math.hypot(e.clientX - c.x0, e.clientY - c.y0) < 5 && !edition) {
      ouvrirFiche(null, c.debut === undefined
        ? { due_date: c.jour }
        : { due_date: c.jour, start_time: versHeure(c.debut), end_time: versHeureFin(c.debut + DUREE_DEFAUT) });
    }
    return;
  }
  if (!glisse) return;
  const g = glisse;
  glisse = null;
  if (g.bouge) finirGlisse(g); else ouvrirFiche(g.t);
});

// Au survol d'une case vide, un créneau « + 14:30 » montre qu'un clic y crée une tâche.
let survol = null;
function survolCreation(e) {
  const surCase = !edition && e.target.closest && e.target.closest('.colonne') && !e.target.closest('[data-id]');
  const c = surCase ? caseVide(e.clientX, e.clientY) : null;
  if (!c || !c.col) { if (survol) { survol.remove(); survol = null; } return; }
  if (!survol) survol = el('div', 'repere creer');
  if (survol.parentNode !== c.col) c.col.append(survol);
  survol.style.top = (c.debut - heureMin * 60) * HEURE_PX / 60 + 'px';
  survol.style.height = DUREE_DEFAUT * HEURE_PX / 60 - 2 + 'px';
  survol.replaceChildren(el('span', '', `+ ${versHeure(c.debut)}`));
}

// ---------- Fiche d'une tâche ----------
function choisir(groupe, valeur) {
  for (const b of $(groupe).querySelectorAll('button')) b.classList.toggle('actif', b.dataset.valeur === valeur);
}
const valeurChoisie = groupe => {
  const b = $(groupe).querySelector('button.actif');
  return b ? b.dataset.valeur : null;
};

// Ouvre la fiche d'une tâche ; sans tâche, une fiche vierge pour en créer une (préremplie avec le jour et l'heure cliqués).
function ouvrirFiche(t, nouvelle = {}) {
  creation = !t;
  if (creation) {
    t = {
      title: '', due_date: null, start_time: null, end_time: null, description: '',
      assignee: (moi && PERSONNES.find(p => sansAccent(p) === sansAccent(moi))) || moi || null,
      priority: 'Moyenne', status: 'À faire', project: 'Organisation', category: 'Autre', ...nouvelle,
    };
  }
  if (survol) { survol.remove(); survol = null; }
  edition = t;
  $('p-etiquette').textContent = creation ? 'Nouvelle tâche'
    : [t.project, t.category !== 'Autre' ? t.category : null].filter(Boolean).join(' · ') || 'Tâche';
  $('p-valider').textContent = creation ? 'Créer' : 'Enregistrer';
  $('p-actions').hidden = creation;
  $('p-titre').value = t.title || '';
  $('p-date').value = t.due_date || '';
  $('p-debut').value = hhmm(t.start_time);
  $('p-fin').value = hhmm(t.end_time);
  const pour = $('p-pour');
  const options = [['', "Toute l'équipe"], ...PERSONNES.map(p => [p, p])];
  if (t.assignee && !PERSONNES.includes(t.assignee)) options.push([t.assignee, t.assignee]);
  pour.replaceChildren(...options.map(([v, l]) => { const o = el('option', '', l); o.value = v; return o; }));
  pour.value = t.assignee || '';
  pour.closest('.champ').hidden = !estEquipe;  // un membre ne crée et ne voit que ses propres tâches
  choisir('p-priorite', t.priority || 'Moyenne');
  choisir('p-statut', t.status || 'À faire');
  $('p-description').value = t.description || '';
  $('p-erreur').textContent = '';
  $('voile').hidden = false;
  $('panneau').hidden = false;
  $('p-titre').focus();
}

function fermerFiche() {
  edition = null;
  $('voile').hidden = true;
  $('panneau').hidden = true;
}

$('panneau').addEventListener('submit', e => {
  e.preventDefault();
  const t = edition;
  const titre = $('p-titre').value.trim();
  if (!titre) { $('p-erreur').textContent = 'Il faut un titre.'; return; }
  const date = $('p-date').value || null;
  const debut = date ? $('p-debut').value || null : null;
  const fin = debut ? $('p-fin').value || null : null;
  if (debut && fin && fin <= debut) { $('p-erreur').textContent = "L'heure de fin doit être après le début."; return; }
  const voulu = {
    title: titre, due_date: date, start_time: debut, end_time: fin,
    assignee: $('p-pour').value || null, priority: valeurChoisie('p-priorite'), status: valeurChoisie('p-statut'),
    description: $('p-description').value.trim() || null,
  };
  if (creation) {
    fermerFiche();
    creer({ ...voulu, project: t.project, category: t.category });
    return;
  }
  const changements = {};
  for (const [k, v] of Object.entries(voulu)) if ((vide(v) ?? null) !== (vide(t[k]) ?? null)) changements[k] = v;
  fermerFiche();
  if (Object.keys(changements).length) modifier(t, changements, `« ${titre} » modifiée`);
});

// Crée la tâche dans Easy Desk. Une tâche pour soi reste à soi (comme celles qu'il crée dans Easy Desk) ;
// pour l'équipe ou pour quelqu'un d'autre, toute l'équipe la voit.
async function creer(champs) {
  const pourSoi = monId && moi && champs.assignee && sansAccent(champs.assignee) === sansAccent(moi);
  // Un membre d'Easy Send n'a pas de tâches en commun : les siennes sont toujours à lui.
  const ligne = { ...champs, owner: pourSoi || !estEquipe ? monId : null };
  let cree;
  if (DEMO) {
    cree = { ...ligne, id: 'n' + Date.now(), created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  } else {
    const { data, error } = await client.from('qg_tasks').insert(ligne).select(COLONNES).single();
    if (error) { toast("Pas pu créer la tâche dans Easy Desk, réessaie."); return; }
    cree = data;
  }
  taches.push(cree);
  rendre();
  pont.signalerModif();
  const quand = cree.due_date ? ` : ${dateCourte(cree.due_date)}${cree.start_time ? ' à ' + hhmm(cree.start_time) : ''}` : '';
  toast(`« ${cree.title} » ajoutée${quand}`, 'Annuler', async () => {
    if (!DEMO) {
      const { error } = await client.from('qg_tasks').delete().eq('id', cree.id);
      if (error) { toast("Pas pu l'annuler, supprime-la dans Easy Desk."); return; }
    }
    taches = taches.filter(x => x.id !== cree.id);
    rendre();
    pont.signalerModif();
    toast('Ajout annulé');
  });
}

$('p-titre').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('panneau').requestSubmit(); }
});

// ---------- Boutons et clavier ----------
document.addEventListener('click', e => {
  const b = e.target.closest('[data-action]');
  if (b) {
    const a = b.dataset.action;
    if (a === 'precedente' || a === 'suivante' || a === 'aujourdhui') {
      lundi = a === 'aujourdhui' ? lundiDe(jourLocal(new Date())) : ajouterJours(lundi, a === 'precedente' ? -7 : 7);
      aDefile = a !== 'aujourdhui';
      if (DEMO) rendre(); else charger();
    }
    if (a === 'fermer') fermerFiche();
    if (a === 'nouvelle' && !edition) ouvrirFiche(null, { due_date: jourLocal(new Date()) });
    if (a === 'sans-date') { $('p-date').value = ''; $('p-debut').value = ''; $('p-fin').value = ''; }
    if (a === 'lendemain' && edition) {
      const t = edition;
      const jour = auLendemain(t.due_date);
      fermerFiche();
      modifier(t, { due_date: jour }, `« ${t.title} » décalée au ${dateCourte(jour)}`);
    }
    if (a === 'lancer-timer' && edition) {
      pont.lancerTimer(edition.id);
      toast(`Timer lancé sur « ${edition.title} »`);
      fermerFiche();
    }
  }
  const choix = e.target.closest('.choix.large button');
  if (choix) choisir(choix.parentNode.id, choix.dataset.valeur);
  const f = e.target.closest('[data-filtre]');
  if (f) { memoire.ecrire('equipe', f.dataset.filtre === 'equipe'); rendre(); }
});
$('voile').addEventListener('click', fermerFiche);

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && edition) fermerFiche();
  const dansChamp = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
  if (!edition && !dansChamp && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    lundi = ajouterJours(lundi, e.key === 'ArrowLeft' ? -7 : 7);
    aDefile = true;
    if (DEMO) rendre(); else charger();
  }
});

// ---------- Démarrage ----------
// Sur Mac, les boutons de la fenêtre sont en haut à gauche : la barre leur laisse la place.
if (pont.plateforme === 'darwin') document.body.classList.add('mac');

function message(texte) {
  $('message').textContent = texte;
  $('message').hidden = !texte;
}

pont.surRecharger(() => charger());
window.addEventListener('focus', () => charger());
setInterval(() => { if (!glisse) charger(); }, RAFRAICHIR_MS);
window.addEventListener('resize', () => { if (!glisse) rendre(); });

(async function demarrer() {
  if (DEMO) {
    moi = 'Mathis';
    monId = 'moi';
    charger();
    return;
  }
  client = creerClient();
  client.auth.onAuthStateChange(evenement => {
    if (evenement === 'SIGNED_OUT') { estConnecte = false; message("Connecte-toi d'abord dans le timer, puis rouvre le planning."); }
  });
  const { data: { session } } = await client.auth.getSession();
  if (!session) { message("Connecte-toi d'abord dans le timer, puis rouvre le planning."); return; }
  await lireMoi(session.user);
  if (!acces) { message(MESSAGE_SANS_ACCES); return; }
  estConnecte = true;
  await charger();
})();
