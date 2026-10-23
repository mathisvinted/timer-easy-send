// Timer Easy Send sur téléphone : la tâche du moment (même règle que le timer du PC, dans commun.js), la journée,
// la semaine, et la fiche d'une tâche pour la créer ou la modifier. Tout s'écrit dans Easy Desk (table qg_tasks).
// Chaque changement peut être annulé depuis le message en bas.

const RAFRAICHIR_MS = 20000;
const TOUR_ANNEAU = 2 * Math.PI * 44;
const JOURS = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'];
const PERSONNES = ['Mathis', 'Rémi', 'Noah'];

let taches = [];
let charge = false;
let estConnecte = false;
let focus = memoire.lire('focus-telephone', null);  // tâche lancée à la main sur le téléphone
let onglet = 'maintenant';
let lundi = lundiDe(jourLocal(new Date()));
let edition = null;    // tâche ouverte dans la fiche (ou nouvelle)
let creation = false;
let ideesMasquees = false;
let derniereMaj = null, horsLigne = false;
let signatureListes = '';

function lundiDe(jour) {
  const d = versDate(jour);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return jourLocal(d);
}
const el = (tag, classe, texte) => {
  const n = document.createElement(tag);
  if (classe) n.className = classe;
  if (texte !== undefined) n.textContent = texte;
  return n;
};
const vide = v => (v === '' || v === undefined ? null : v);

// ---------- Données ----------
async function charger() {
  if (DEMO) { if (!charge) { taches = tachesDemo(); charge = true; } rendre(true); return; }
  if (!estConnecte) return;
  const aujourdhui = jourLocal(new Date());
  const dimanche = ajouterJours(lundi, 6);
  // Tout ce qui reste à faire, la semaine affichée (terminées comprises), aujourd'hui, et ce qui a changé aujourd'hui.
  const rep = await client.from('qg_tasks').select(COLONNES)
    .or(`status.neq.Terminé,due_date.eq.${aujourdhui},and(due_date.gte.${lundi},due_date.lte.${dimanche}),updated_at.gte."${debutDuJour().toISOString()}"`)
    .limit(1000);
  if (rep.error) { horsLigne = true; rendreReseau(); return; }
  horsLigne = false;
  derniereMaj = new Date();
  taches = rep.data;
  charge = true;
  rendre(true);
}

// Écrit un changement, avec « Annuler » ; met à jour l'écran tout de suite.
async function modifier(t, champs, libelle, annulable = true) {
  const avant = {};
  for (const k of Object.keys(champs)) avant[k] = vide(t[k]) ?? null;
  if (Object.keys(champs).every(k => (vide(champs[k]) ?? null) === avant[k])) return;
  Object.assign(t, champs, { updated_at: new Date().toISOString() });
  rendre(true);
  const { error } = await majTache(t.id, champs);
  if (error) {
    Object.assign(t, avant);
    rendre(true);
    toast("Pas pu enregistrer dans Easy Desk, réessaie.");
    return;
  }
  if (annulable) toast(libelle, 'Annuler', () => modifier(t, avant, 'Changement annulé', false));
  else toast(libelle);
}

async function creer(champs) {
  const ligne = { ...champs, owner: proprietaire(champs.assignee) };
  let cree;
  if (DEMO) {
    cree = { ...ligne, id: 'n' + Date.now(), created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  } else {
    const { data, error } = await client.from('qg_tasks').insert(ligne).select(COLONNES).single();
    if (error) { toast("Pas pu créer la tâche dans Easy Desk, réessaie."); return; }
    cree = data;
  }
  taches.push(cree);
  rendre(true);
  toast(`« ${cree.title} » ajoutée`, 'Annuler', async () => {
    if (!DEMO) {
      const { error } = await client.from('qg_tasks').delete().eq('id', cree.id);
      if (error) { toast("Pas pu l'annuler, supprime-la dans Easy Desk."); return; }
    }
    taches = taches.filter(x => x.id !== cree.id);
    rendre(true);
    toast('Ajout annulé');
  });
}

const terminer = t => modifier(t, { status: 'Terminé' }, `« ${t.title} » terminée`);
const retablir = t => modifier(t, { status: 'À faire' }, `« ${t.title} » est de nouveau à faire`);
const lendemain = t => {
  const jour = auLendemain(t.due_date);
  modifier(t, { due_date: jour }, `« ${t.title} » décalée au ${dateCourte(jour)}`);
};
function lancer(t) {
  focus = { id: t.id, depuis: Date.now() };
  memoire.ecrire('focus-telephone', focus);
  montrerOnglet('maintenant');
  rendre(true);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ---------- Affichage ----------
function montrerVue(nom) {
  for (const v of ['chargement', 'connexion', 'appli']) $('vue-' + v).hidden = v !== nom;
}
function montrerOnglet(nom) {
  onglet = nom;
  $('onglet-maintenant').hidden = nom !== 'maintenant';
  $('onglet-semaine').hidden = nom !== 'semaine';
  for (const b of document.querySelectorAll('[data-onglet]')) b.classList.toggle('actif', b.dataset.onglet === nom);
  signatureListes = '';
  rendre(true);
}

function rendre(tout = false) {
  if (!charge) return;
  const maintenant = new Date();
  $('date-jour').textContent = maintenant.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  const s = calculerSituation(taches, maintenant, focus);
  if (s.focusPerime) { focus = null; memoire.ecrire('focus-telephone', null); }
  rendreTimer(s, maintenant);
  const signature = JSON.stringify([onglet, lundi, Math.floor(maintenant / 60000), memoire.lire('equipe', false),
    taches.map(t => [t.id, t.status, t.title, t.due_date, t.start_time, t.end_time, t.priority])]);
  if (tout || signature !== signatureListes) {
    signatureListes = signature;
    if (onglet === 'maintenant') rendreJour(s, maintenant); else rendreSemaine(maintenant);
  }
}

function rendreTimer(s, maintenant) {
  const a = s.actuelle;
  const p = s.prochaine;
  const carte = $('carte'), titre = $('titre'), temps = $('temps'), sous = $('sous');
  const action = $('btn-action'), second = $('btn-second'), pastille = $('pastille');
  let etat = 'repos', avance = 0, depassee = false;
  const affichee = a ? a.t : p ? p.t : null;
  if (affichee) titre.dataset.priorite = sansAccent(affichee.priority || 'Moyenne'); else delete titre.dataset.priorite;
  pastille.className = 'pastille';
  action.hidden = false;
  second.hidden = false;

  if (a) {
    titre.textContent = a.t.title;
    if (a.mode === 'compte') {
      const reste = a.fin - maintenant;
      depassee = reste < 0;
      etat = depassee ? 'depassee' : 'en-cours';
      $('etiquette').textContent = `${depassee ? 'Dépassée' : 'En cours'} · ${heure(a.debut)} → ${heure(a.fin)}`;
      temps.textContent = depassee ? '+' + duree(-reste) : duree(reste);
      sous.textContent = depassee ? 'de retard' : a.avantSuite ? 'avant la tâche suivante' : 'restantes';
      avance = depassee ? 1 : (maintenant - a.debut) / (a.fin - a.debut);
    } else {
      etat = 'en-cours';
      $('etiquette').textContent = `En cours · depuis ${heure(a.depuis)}`;
      temps.textContent = duree(maintenant - a.depuis);
      sous.textContent = 'écoulées';
      avance = ((maintenant - a.depuis) % 3600000) / 3600000;
    }
    pastille.classList.add(depassee ? 'depassee' : 'en-cours');
    action.textContent = '✓ Terminé';
    action.onclick = () => terminer(a.t);
    second.textContent = 'Au lendemain';
    second.onclick = () => lendemain(a.t);
  } else if (p) {
    etat = 'prochaine';
    $('etiquette').textContent = `Prochaine · ${heure(p.debut)}${p.fin ? ' → ' + heure(p.fin) : ''}`;
    titre.textContent = p.t.title;
    temps.textContent = duree(p.debut - maintenant);
    sous.textContent = 'avant de commencer';
    avance = (p.debut - maintenant) / 7200000;
    action.textContent = '▶ Lancer';
    action.onclick = () => lancer(p.t);
    second.textContent = 'Détails';
    second.onclick = () => ouvrirFiche(p.t);
  } else {
    const reste = s.liste.length;
    $('etiquette').textContent = 'Rien en cours';
    titre.textContent = reste ? 'Rien de prévu à cette heure' : 'Tout est fait';
    temps.textContent = String(reste);
    sous.textContent = reste > 1 ? 'tâches à faire' : reste ? 'tâche à faire' : 'bravo';
    action.textContent = '+ Ajouter une tâche';
    action.onclick = () => ouvrirFiche(null, { due_date: jourLocal(maintenant) });
    second.hidden = true;
  }
  carte.dataset.etat = etat;
  temps.classList.toggle('depassee', depassee);
  sous.classList.toggle('depassee', depassee);
  $('arc').style.strokeDashoffset = String(TOUR_ANNEAU * (1 - Math.min(1, Math.max(0, avance))));

  // Temps libre : de quoi avancer avant la tâche suivante (rien sous 5 min).
  const libre = p ? p.debut - maintenant : null;
  if (a) ideesMasquees = false;
  const liste = !a && !ideesMasquees && (libre === null || libre >= 5 * 60000) ? idees(s, maintenant, libre) : [];
  $('idees').hidden = !liste.length;
  if (liste.length) {
    const titreIdees = libre === null ? "Plus rien de prévu aujourd'hui. De quoi avancer :"
      : `${minutesLisibles(libre)} de libre avant ${heure(p.debut)}. De quoi avancer :`;
    if ($('idees-titre').textContent !== titreIdees || $('idees-liste').dataset.ids !== liste.map(t => t.id).join()) {
      $('idees-titre').textContent = titreIdees;
      $('idees-liste').dataset.ids = liste.map(t => t.id).join();
      $('idees-liste').replaceChildren(...liste.map(t => ligneTache(t, { quand: null, bouton: 'lancer' })));
    }
  }
}

// Une ligne de tâche : heure, point de priorité, nom (toucher = fiche), et un bouton.
function ligneTache(t, { quand, note, bouton }) {
  const ligne = el('div', 'tache' + (t.status === 'Terminé' ? ' faite' : ''));
  ligne.dataset.priorite = sansAccent(t.priority || 'Moyenne');
  if (quand !== null && quand !== undefined) ligne.append(el('span', 'quand', quand));
  ligne.append(el('i', 'prio'));
  const nom = el('span', 'nom', t.title);
  nom.onclick = () => ouvrirFiche(t);
  ligne.append(nom);
  const texteNote = t.status === 'En attente' ? 'en attente' : note;
  if (texteNote) ligne.append(el('span', 'note' + (t.status === 'En attente' ? ' calme-note' : ''), texteNote));
  if (bouton === 'lancer') {
    const b = el('button', 'btn-ligne lecture');
    b.setAttribute('aria-label', 'Lancer le timer sur ' + t.title);
    b.innerHTML = '<svg viewBox="0 0 12 12"><path d="M3 1.8v8.4L10 6z"/></svg>';
    b.onclick = () => lancer(t);
    ligne.append(b);
  } else if (bouton === 'remettre') {
    const b = el('button', 'btn-ligne', 'Remettre');
    b.onclick = () => retablir(t);
    ligne.append(b);
  }
  return ligne;
}

function section(nom, lignes) {
  const bloc = el('div', 'section');
  bloc.append(el('h2', '', nom), ...lignes);
  return bloc;
}

function rendreJour(s, maintenant) {
  const montree = s.actuelle ? s.actuelle.t : s.prochaine ? s.prochaine.t : null;
  const autres = s.liste.filter(t => !montree || t.id !== montree.id);
  const aujourdhui = autres.filter(t => t.due_date === s.aujourdhui && t.start_time)
    .sort((a, b) => hhmm(a.start_time).localeCompare(hhmm(b.start_time)));
  const sansHoraire = autres.filter(t => !t.due_date || (t.due_date === s.aujourdhui && !t.start_time));
  const enRetard = autres.filter(t => t.due_date && t.due_date < s.aujourdhui).sort((a, b) => a.due_date.localeCompare(b.due_date));
  const blocs = [];
  if (aujourdhui.length) blocs.push(section("Aujourd'hui", aujourdhui.map(t => {
    const fin = aHeure(t.due_date, t.end_time) || aHeure(t.due_date, t.start_time);
    return ligneTache(t, { quand: hhmm(t.start_time), note: fin && fin < maintenant ? 'pas terminée' : '', bouton: 'lancer' });
  })));
  if (sansHoraire.length) blocs.push(section('Sans horaire', sansHoraire.map(t => ligneTache(t, { quand: '—', bouton: 'lancer' }))));
  if (enRetard.length) blocs.push(section('En retard', enRetard.map(t =>
    ligneTache(t, { quand: dateCourte(t.due_date).split(' ').slice(1).join(' ').replace(/\.$/, ''), bouton: 'lancer' }))));
  if (s.terminees.length) blocs.push(section("Terminées aujourd'hui", s.terminees.slice(0, 10).map(t =>
    ligneTache(t, { quand: heure(new Date(t.updated_at)), bouton: 'remettre' }))));
  if (!blocs.length) blocs.push(el('p', 'vide section', "Rien d'autre aujourd'hui."));
  $('liste-jour').replaceChildren(...blocs);
}

function rendreSemaine(maintenant) {
  const aujourdhui = jourLocal(maintenant);
  const jours = Array.from({ length: 7 }, (_, i) => ajouterJours(lundi, i));
  const d1 = versDate(jours[0]), d7 = versDate(jours[6]);
  const mois = d => d.toLocaleDateString('fr-FR', { month: 'long' });
  $('titre-semaine').textContent = d1.getMonth() === d7.getMonth()
    ? `${d1.getDate()} – ${d7.getDate()} ${mois(d7)}` : `${d1.getDate()} ${mois(d1)} – ${d7.getDate()} ${mois(d7)}`;
  const liste = taches.filter(pourMoi);
  const blocs = jours.map((jour, i) => {
    const bloc = el('div', 'jour' + (jour === aujourdhui ? ' est-aujourdhui' : ''));
    const tete = el('div', 'jour-tete');
    tete.append(el('span', 'nom-jour', jour === aujourdhui ? "aujourd'hui" : JOURS[i]), el('span', 'num', String(versDate(jour).getDate())));
    bloc.append(tete);
    const du = liste.filter(t => t.due_date === jour)
      .sort((a, b) => (a.start_time ? hhmm(a.start_time) : '99').localeCompare(b.start_time ? hhmm(b.start_time) : '99'));
    for (const t of du) {
      const quand = t.start_time ? hhmm(t.start_time) : '—';
      bloc.append(ligneTache(t, { quand, bouton: t.status === 'Terminé' ? null : 'lancer' }));
    }
    const ajouter = el('button', 'ajouter-jour', '+ Ajouter ce jour-là');
    ajouter.onclick = () => ouvrirFiche(null, { due_date: jour });
    bloc.append(ajouter);
    return bloc;
  });
  const sansDate = liste.filter(t => !t.due_date && t.status !== 'Terminé');
  if (sansDate.length) blocs.push(section('Sans date', sansDate.map(t => ligneTache(t, { quand: '—', bouton: 'lancer' }))));
  $('semaine').replaceChildren(...blocs);
}

function rendreReseau() {
  $('reseau').textContent = horsLigne ? 'Hors ligne, nouvel essai…' : derniereMaj ? `À jour à ${heure(derniereMaj)}` : '';
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
  minuteurToast = setTimeout(() => { $('toast').hidden = true; }, 8000);
}

// ---------- Fiche d'une tâche ----------
function choisir(groupe, valeur) {
  for (const b of $(groupe).querySelectorAll('button')) b.classList.toggle('actif', b.dataset.valeur === valeur);
}
const valeurChoisie = groupe => { const b = $(groupe).querySelector('button.actif'); return b ? b.dataset.valeur : null; };

function ouvrirFiche(t, nouvelle = {}) {
  creation = !t;
  if (creation) {
    t = {
      title: '', due_date: null, start_time: null, end_time: null, description: '',
      assignee: (moi && PERSONNES.find(p => sansAccent(p) === sansAccent(moi))) || moi || null,
      priority: 'Moyenne', status: 'À faire', project: 'Organisation', category: 'Autre', ...nouvelle,
    };
  }
  edition = t;
  $('f-etiquette').textContent = creation ? 'Nouvelle tâche'
    : [t.project, t.category !== 'Autre' ? t.category : null].filter(Boolean).join(' · ') || 'Tâche';
  $('f-titre').value = t.title || '';
  $('f-date').value = t.due_date || '';
  $('f-debut').value = hhmm(t.start_time);
  $('f-fin').value = hhmm(t.end_time);
  const pour = $('f-pour');
  const options = [['', "Toute l'équipe"], ...PERSONNES.map(p => [p, p])];
  if (t.assignee && !PERSONNES.includes(t.assignee)) options.push([t.assignee, t.assignee]);
  pour.replaceChildren(...options.map(([v, l]) => { const o = el('option', '', l); o.value = v; return o; }));
  pour.value = t.assignee || '';
  $('f-pour-champ').hidden = !estEquipe;
  choisir('f-priorite', t.priority || 'Moyenne');
  choisir('f-statut', t.status || 'À faire');
  $('f-description').value = t.description || '';
  $('f-erreur').textContent = '';
  $('f-valider').textContent = creation ? 'Créer' : 'Enregistrer';
  $('f-actions').hidden = creation;
  $('toast').hidden = true;
  $('voile').hidden = false;
  $('feuille').hidden = false;
  $('feuille').scrollTop = 0;
  if (creation) $('f-titre').focus();
}

function fermerFeuilles() {
  edition = null;
  $('voile').hidden = true;
  $('feuille').hidden = true;
  $('reglages').hidden = true;
}

$('feuille').addEventListener('submit', e => {
  e.preventDefault();
  const t = edition;
  const titre = $('f-titre').value.trim();
  if (!titre) { $('f-erreur').textContent = 'Il faut un titre.'; return; }
  const date = $('f-date').value || null;
  const debut = date ? $('f-debut').value || null : null;
  const fin = debut ? $('f-fin').value || null : null;
  if (debut && fin && fin <= debut) { $('f-erreur').textContent = "L'heure de fin doit être après le début."; return; }
  const voulu = {
    title: titre, due_date: date, start_time: debut, end_time: fin,
    assignee: estEquipe ? $('f-pour').value || null : t.assignee || moi,
    priority: valeurChoisie('f-priorite'), status: valeurChoisie('f-statut'),
    description: $('f-description').value.trim() || null,
  };
  const estCreation = creation;
  fermerFeuilles();
  if (estCreation) { creer({ ...voulu, project: t.project, category: t.category }); return; }
  const changements = {};
  for (const [k, v] of Object.entries(voulu)) if ((vide(v) ?? null) !== (vide(t[k]) ?? null)) changements[k] = v;
  if (Object.keys(changements).length) modifier(t, changements, `« ${titre} » modifiée`);
});

// ---------- Boutons ----------
document.addEventListener('click', e => {
  const o = e.target.closest('[data-onglet]');
  if (o) montrerOnglet(o.dataset.onglet);
  const b = e.target.closest('[data-action]');
  if (b) {
    const a = b.dataset.action;
    if (a === 'nouvelle') ouvrirFiche(null, { due_date: onglet === 'semaine' && lundi !== lundiDe(jourLocal(new Date())) ? lundi : jourLocal(new Date()) });
    if (a === 'fermer') fermerFeuilles();
    if (a === 'sans-date') { $('f-date').value = ''; $('f-debut').value = ''; $('f-fin').value = ''; }
    if (a === 'lancer-feuille' && edition) { const t = edition; fermerFeuilles(); lancer(t); }
    if (a === 'lendemain-feuille' && edition) { const t = edition; fermerFeuilles(); lendemain(t); }
    if (a === 'precedente' || a === 'suivante' || a === 'aujourdhui') {
      lundi = a === 'aujourdhui' ? lundiDe(jourLocal(new Date())) : ajouterJours(lundi, a === 'precedente' ? -7 : 7);
      if (DEMO) rendre(true); else charger();
    }
    if (a === 'reglages') {
      $('qui').textContent = moi ? `Connecté : ${moi}` : '';
      $('filtre-champ').hidden = !estEquipe;
      const equipe = memoire.lire('equipe', false);
      $('filtre-moi').classList.toggle('actif', !equipe);
      $('filtre-equipe').classList.toggle('actif', equipe);
      rendreReseau();
      $('voile').hidden = false;
      $('reglages').hidden = false;
    }
    if (a === 'deconnexion') { fermerFeuilles(); if (!DEMO) client.auth.signOut(); }
  }
  const choix = e.target.closest('.choix button[data-valeur]');
  if (choix) choisir(choix.parentNode.id, choix.dataset.valeur);
  const f = e.target.closest('[data-filtre]');
  if (f) {
    memoire.ecrire('equipe', f.dataset.filtre === 'equipe');
    $('filtre-moi').classList.toggle('actif', f.dataset.filtre !== 'equipe');
    $('filtre-equipe').classList.toggle('actif', f.dataset.filtre === 'equipe');
    rendre(true);
  }
});
$('voile').addEventListener('click', fermerFeuilles);
$('idees-fermer').addEventListener('click', () => { ideesMasquees = true; rendre(true); });

$('form-connexion').addEventListener('submit', async e => {
  e.preventDefault();
  const bouton = e.target.querySelector('button');
  bouton.disabled = true;
  $('erreur-connexion').textContent = '';
  const { data, error } = await client.auth.signInWithPassword({ email: $('email').value.trim(), password: $('mdp').value });
  bouton.disabled = false;
  $('mdp').value = '';
  if (error) {
    $('erreur-connexion').textContent = /invalid/i.test(error.message) ? 'E-mail ou mot de passe incorrect.' : 'Connexion impossible : ' + error.message;
    return;
  }
  connecte(data.user);
});

async function connecte(user) {
  montrerVue('chargement');
  await lireMoi(user);
  if (!acces) {
    await client.auth.signOut();
    montrerVue('connexion');
    $('erreur-connexion').textContent = MESSAGE_SANS_ACCES;
    return;
  }
  estConnecte = true;
  montrerVue('appli');
  await charger();
}

// ---------- Démarrage ----------
setInterval(() => rendre(false), 1000);
setInterval(() => { if (!document.hidden) charger(); }, RAFRAICHIR_MS);
document.addEventListener('visibilitychange', () => { if (!document.hidden) charger(); });

(async function demarrer() {
  if (DEMO) {
    moi = 'Mathis';
    monId = 'moi';
    montrerVue('appli');
    charger();
    return;
  }
  client = creerClient();
  client.auth.onAuthStateChange(evenement => {
    if (evenement === 'SIGNED_OUT') { estConnecte = false; charge = false; taches = []; montrerVue('connexion'); }
  });
  const { data: { session } } = await client.auth.getSession();
  if (session) connecte(session.user); else montrerVue('connexion');
})();
