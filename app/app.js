// Timer Easy Send : la tâche du moment d'Easy Desk (table qg_tasks), son temps qui s'écoule en direct, et la suite.
//
// Quelle tâche s'affiche :
// 1. une tâche à horaire d'aujourd'hui dont l'heure de début est passée (la dernière commencée) : compte à rebours
//    jusqu'à l'heure de fin, puis dépassement en rouge ; sans heure de fin, temps écoulé depuis le début ;
// 2. sinon la tâche lancée à la main (bouton ▶ de la liste) ou une nouvelle tâche sans horaire : temps écoulé ;
// 3. sinon la prochaine tâche à horaire : temps avant qu'elle commence.
// Quand une tâche arrive à l'écran, la fenêtre passe devant et sonne.
// Les outils partagés avec le planning (base, dates, démo) sont dans commun.js.

const RAFRAICHIR_MS = 15000;
const ANNULER_MS = 8000;
const TOUR_ANNEAU = 2 * Math.PI * 44;  // périmètre du cercle de l'anneau (r = 44)

let taches = [];
let vues = null;                        // ids déjà vus ; null tant que rien n'est chargé
let focus = memoire.lire('focus', null); // { id, depuis } : tâche lancée à la main ou arrivée sans horaire
let courante;                           // id affiché au dernier tic (undefined avant le premier affichage)
let finSignalee = null;                 // id dont la fin a déjà sonné
let ouvert = params.get('ouvert') === '1';
let enAttente = null;                   // { id, minuteur } : « Terminé » qu'on peut encore annuler
let bloqueJusqua = 0;                   // juste après « Terminé », le bouton suivant ne réagit pas (double clic)
const cachees = new Set();
let derniereMaj = null;
let horsLigne = false;
let signatureListe = '';
let boucles = false;
let estConnecte = false;
let ideesMasquees = false; // « Plus tard » : propositions cachées jusqu'à la prochaine tâche en cours
let signatureIdees = '';

const visible = t => t.status !== 'Terminé' && !cachees.has(t.id) && pourMoi(t);

// Quelle tâche afficher : la règle est dans commun.js (la même sur le téléphone).
function situation(maintenant) {
  const s = calculerSituation(taches, maintenant, focus, cachees);
  if (s.focusPerime && vues) { focus = null; memoire.ecrire('focus', null); }
  return s;
}

// ---------- Affichage ----------
function montrerVue(nom) {
  for (const v of ['chargement', 'connexion', 'timer']) $('vue-' + v).hidden = v !== nom;
}

const SVG_FINI = '<svg viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-7"/></svg>';
const SVG_LANCER = '<svg viewBox="0 0 12 12"><path d="M3 1.8v8.4L10 6z"/></svg>';
const SVG_RETABLIR = '<svg viewBox="0 0 16 16"><path d="M3.5 6.5h6.5a3 3 0 010 6H7"/><path d="M6 4L3.5 6.5 6 9"/></svg>';

function rendre() {
  if (vues === null) return;
  const maintenant = new Date();
  const s = situation(maintenant);
  const a = s.actuelle;
  const id = a ? a.t.id : null;
  const premierAffichage = courante === undefined;
  if (!premierAffichage && id && id !== courante) signaler();
  courante = id;

  const etiquette = $('etiquette'), pastille = $('pastille'), titre = $('titre');
  const temps = $('temps'), sous = $('sous'), action = $('btn-action');
  const jauge = $('jauge'), rempli = $('jauge-rempli');
  let depassee = false;
  let etat = 'repos';
  let avance = 0;   // 0 à 1 : la barre, ou le rond de progression
  pastille.className = 'pastille';
  jauge.hidden = true;
  action.hidden = false;
  action.disabled = Date.now() < bloqueJusqua;

  const affichee = a ? a.t : s.prochaine ? s.prochaine.t : null;
  if (affichee) titre.dataset.priorite = sansAccent(affichee.priority || 'Moyenne');
  else delete titre.dataset.priorite;

  if (a) {
    titre.textContent = a.t.title;
    action.innerHTML = SVG_FINI + 'Terminé';
    action.onclick = () => terminer(a.t.id);
    if (a.mode === 'compte') {
      const total = a.fin - a.debut;
      const reste = a.fin - maintenant;
      depassee = reste < 0;
      etat = depassee ? 'depassee' : reste < 5 * 60000 ? 'bientot' : 'en-cours';
      etiquette.textContent = `${depassee ? 'Dépassée' : 'En cours'} · ${heure(a.debut)} → ${heure(a.fin)}`;
      temps.textContent = depassee ? '+' + duree(-reste) : duree(reste);
      sous.textContent = depassee ? 'de retard' : a.avantSuite ? 'avant la tâche suivante' : 'restantes';
      jauge.hidden = false;
      avance = depassee ? 1 : (maintenant - a.debut) / total;
      if (depassee && finSignalee !== a.t.id) {
        finSignalee = a.t.id;
        if (!premierAffichage) signaler();
      }
    } else {
      etat = 'en-cours';
      etiquette.textContent = a.main ? `En cours · lancée à ${heure(a.depuis)}` : `En cours · depuis ${heure(a.depuis)}`;
      temps.textContent = duree(maintenant - a.depuis);
      sous.textContent = 'écoulées';
      avance = ((maintenant - a.depuis) % 3600000) / 3600000;  // le rond fait un tour par heure
    }
    pastille.classList.add(depassee ? 'depassee' : 'en-cours');
  } else if (s.prochaine) {
    const p = s.prochaine;
    etat = 'prochaine';
    etiquette.textContent = `Prochaine · ${heure(p.debut)}${p.fin ? ' → ' + heure(p.fin) : ''}`;
    titre.textContent = p.t.title;
    temps.textContent = duree(p.debut - maintenant);
    sous.textContent = 'avant de commencer';
    // Le rond se vide jusqu'au début : plein à 2 h ou plus, vide à l'heure de la tâche.
    avance = (p.debut - maintenant) / 7200000;
    action.innerHTML = SVG_LANCER + 'Lancer';
    action.onclick = () => lancer(p.t.id);
  } else {
    const reste = s.liste.length;
    etiquette.textContent = 'Rien en cours';
    titre.textContent = reste ? 'Rien de prévu à cette heure' : 'Tout est fait';
    temps.textContent = String(reste);
    sous.textContent = reste > 1 ? 'tâches sans horaire' : reste ? 'tâche sans horaire' : 'à faire';
    action.hidden = !reste;
    action.innerHTML = 'Voir la liste';
    action.onclick = () => basculer(true);
  }
  // Tant qu'aucune tâche ne tourne : de quoi avancer pendant le temps libre avant la suivante
  // (21/10 : « tant qu'il n'y a pas de tâche, la proposition s'affiche ») ; rien sous 5 min, trop court.
  const libre = s.prochaine ? s.prochaine.debut - maintenant : null;
  if (a) ideesMasquees = false;
  const montrerIdees = !a && !ideesMasquees && (libre === null || libre >= 5 * 60000);
  rendreIdees(montrerIdees ? idees(s, maintenant, libre) : [], libre, s);

  avance = Math.min(1, Math.max(0, avance));
  $('carte').dataset.etat = etat;
  rempli.style.width = avance * 100 + '%';
  $('arc').style.strokeDashoffset = String(TOUR_ANNEAU * (1 - avance));
  temps.classList.toggle('depassee', depassee);
  sous.classList.toggle('depassee', depassee);

  if (ouvert) rendreDetails(s, maintenant);
  rendreReseau();
}

function rendreIdees(liste, libre, s) {
  const bloc = $('idees');
  if (!liste.length) { bloc.hidden = true; signatureIdees = ''; return; }
  const titre = libre === null
    ? "Plus rien de prévu aujourd'hui. De quoi avancer :"
    : `${minutesLisibles(libre)} de libre avant ${heure(s.prochaine.debut)}. De quoi avancer :`;
  bloc.hidden = false;
  const signature = JSON.stringify([liste.map(t => t.id), titre]);
  if (signature === signatureIdees) return;
  signatureIdees = signature;
  $('idees-titre').textContent = titre;
  const lignes = liste.map(t => {
    const ligne = document.createElement('div');
    ligne.className = 'tache';
    ligne.dataset.priorite = sansAccent(t.priority || 'Moyenne');
    const p = document.createElement('i'); p.className = 'prio'; p.title = `Priorité ${(t.priority || 'moyenne').toLowerCase()}`;
    const n = document.createElement('span'); n.className = 'nom'; n.textContent = t.title; n.title = t.title;
    ligne.append(p, n);
    const allouee = dureeAllouee(t);
    const texteNote = t.due_date && t.due_date < s.aujourdhui ? 'en retard' : allouee ? minutesLisibles(allouee) : '';
    if (texteNote) {
      const no = document.createElement('span');
      no.className = 'note' + (allouee && !(t.due_date < s.aujourdhui) ? ' attente' : '');
      no.textContent = texteNote;
      ligne.append(no);
    }
    const b = document.createElement('button');
    b.className = 'lancer';
    b.title = 'Lancer le timer sur cette tâche';
    b.setAttribute('aria-label', 'Lancer ' + t.title);
    b.innerHTML = SVG_LANCER;
    b.onclick = () => lancer(t.id);
    ligne.append(b);
    return ligne;
  });
  $('idees-liste').replaceChildren(...lignes);
}

function puce(texte, point) {
  const el = document.createElement('span');
  el.className = 'puce';
  if (point) { const i = document.createElement('i'); i.className = point; el.append(i); }
  el.append(texte);
  return el;
}

// Texte avec liens cliquables, sans jamais injecter de HTML.
function remplirTexte(el, texte) {
  el.replaceChildren();
  const morceaux = texte.split(/(https?:\/\/[^\s]+)/g);
  for (const m of morceaux) {
    if (/^https?:\/\//.test(m)) {
      const lien = document.createElement('a');
      lien.href = m; lien.target = '_blank'; lien.rel = 'noopener'; lien.textContent = m;
      el.append(lien);
    } else if (m) el.append(m);
  }
}

function rendreDetails(s, maintenant) {
  const montree = s.actuelle ? s.actuelle.t : s.prochaine ? s.prochaine.t : null;
  const signature = JSON.stringify([
    s.liste.map(t => [t.id, t.status, t.title, t.start_time, t.end_time, t.due_date, t.description]),
    s.terminees.map(t => t.id), montree && montree.id, Math.floor(maintenant / 60000), memoire.lire('equipe', false),
  ]);
  if (signature === signatureListe) return;
  signatureListe = signature;

  const meta = $('meta'), description = $('description');
  meta.replaceChildren();
  if (montree) {
    const prio = sansAccent(montree.priority);
    meta.append(puce(`Priorité ${(montree.priority || 'moyenne').toLowerCase()}`, prio));
    if (montree.project) meta.append(puce(montree.project));
    if (montree.category && montree.category !== 'Autre') meta.append(puce(montree.category));
    if (montree.assignee || estEquipe) meta.append(puce(montree.assignee ? `Pour ${montree.assignee}` : "Pour l'équipe"));
    if (montree.due_date) {
      const h = montree.start_time ? ` · ${hhmm(montree.start_time)}${montree.end_time ? '–' + hhmm(montree.end_time) : ''}` : '';
      meta.append(puce(dateCourte(montree.due_date) + h));
    }
    if (montree.status === 'En attente') meta.append(puce('En attente'));
    const texte = (montree.description || '').trim();
    description.className = 'description' + (texte ? '' : ' vide');
    if (texte) remplirTexte(description, texte); else description.textContent = 'Pas de détails pour cette tâche.';
    description.hidden = false;
    $('actions-tache').hidden = false;
    $('btn-lendemain').onclick = () => reporter(montree.id);
  } else {
    description.hidden = true;
    $('actions-tache').hidden = true;
  }

  const autres = s.liste.filter(t => !montree || t.id !== montree.id);
  const aujourdhui = autres
    .filter(t => t.due_date === s.aujourdhui && t.start_time)
    .sort((a, b) => hhmm(a.start_time).localeCompare(hhmm(b.start_time)));
  const sansHoraire = autres.filter(t => !t.due_date || (t.due_date === s.aujourdhui && !t.start_time));
  const enRetard = autres.filter(t => t.due_date && t.due_date < s.aujourdhui).sort((a, b) => a.due_date.localeCompare(b.due_date));
  const aVenir = autres.filter(t => t.due_date && t.due_date > s.aujourdhui).sort((a, b) => a.due_date.localeCompare(b.due_date));

  const liste = $('liste');
  liste.replaceChildren();
  const section = (nom, items, quand, note, bouton = 'lancer') => {
    if (!items.length) return;
    const bloc = document.createElement('div');
    bloc.className = 'section';
    const h = document.createElement('h2');
    h.textContent = nom;
    bloc.append(h);
    for (const t of items) {
      const ligne = document.createElement('div');
      ligne.className = 'tache' + (t.status === 'Terminé' ? ' faite' : '');
      ligne.dataset.priorite = sansAccent(t.priority || 'Moyenne');
      const q = document.createElement('span'); q.className = 'quand'; q.textContent = quand(t);
      const p = document.createElement('i'); p.className = 'prio'; p.title = `Priorité ${(t.priority || 'moyenne').toLowerCase()}`;
      const n = document.createElement('span'); n.className = 'nom'; n.textContent = t.title; n.title = t.title;
      ligne.append(q, p, n);
      const texteNote = t.status === 'En attente' ? 'en attente' : note ? note(t) : '';
      if (texteNote) {
        const no = document.createElement('span');
        no.className = 'note' + (t.status === 'En attente' ? ' attente' : '');
        no.textContent = texteNote;
        ligne.append(no);
      }
      const b = document.createElement('button');
      if (bouton === 'retablir') {
        b.className = 'retablir';
        b.title = 'Remettre à faire';
        b.setAttribute('aria-label', 'Remettre à faire : ' + t.title);
        b.innerHTML = SVG_RETABLIR + 'Remettre';
        b.onclick = () => retablir(t.id);
      } else {
        b.className = 'lancer';
        b.title = 'Lancer le timer sur cette tâche';
        b.setAttribute('aria-label', 'Lancer ' + t.title);
        b.innerHTML = SVG_LANCER;
        b.onclick = () => lancer(t.id);
      }
      ligne.append(b);
      bloc.append(ligne);
    }
    liste.append(bloc);
  };
  section("Aujourd'hui", aujourdhui, t => hhmm(t.start_time),
    t => {
      const fin = aHeure(t.due_date, t.end_time) || aHeure(t.due_date, t.start_time);
      return fin && fin < maintenant ? 'pas terminée' : '';
    });
  section('Sans horaire', sansHoraire, () => '—');
  section('En retard', enRetard, t => dateCourte(t.due_date).replace(/\.$/, '').split(' ').slice(1).join(' '));
  section('À venir', aVenir.slice(0, 6), t => dateCourte(t.due_date).split(' ').slice(1).join(' '));
  section("Terminées aujourd'hui", s.terminees.slice(0, 8), t => heure(new Date(t.updated_at)), null, 'retablir');
  if (!liste.children.length) {
    const vide = document.createElement('p');
    vide.className = 'calme section';
    vide.textContent = "Rien d'autre dans la liste.";
    liste.append(vide);
  }

  const equipe = memoire.lire('equipe', false);
  $('filtre-moi').parentNode.hidden = !estEquipe;  // un membre n'a que ses tâches : rien à filtrer
  $('filtre-moi').classList.toggle('actif', !equipe);
  $('filtre-equipe').classList.toggle('actif', equipe);
  $('qui').textContent = moi ? `Connecté : ${moi}` : '';
}

function rendreReseau() {
  const el = $('reseau');
  el.classList.toggle('hors-ligne', horsLigne);
  el.textContent = horsLigne ? 'Hors ligne, nouvel essai…' : derniereMaj ? `À jour · ${heure(derniereMaj)}` : '';
}

let minuteurBandeau = null;
function bandeau(texte, bouton, auClic, dureeMs = 6000) {
  $('bandeau-texte').textContent = texte;
  const b = $('bandeau-bouton');
  b.hidden = !bouton;
  b.textContent = bouton || '';
  b.onclick = auClic || null;
  $('bandeau').hidden = false;
  clearTimeout(minuteurBandeau);
  minuteurBandeau = setTimeout(() => { $('bandeau').hidden = true; }, dureeMs);
}

function basculer(etat = !ouvert) {
  ouvert = etat;
  $('details').hidden = !ouvert;
  $('btn-ouvrir').setAttribute('aria-expanded', String(ouvert));
  signatureListe = '';
  rendre();
}

// ---------- Alerte : la fenêtre passe devant et sonne ----------
function carillon() {
  try {
    const ctx = new AudioContext();
    [[784, 0], [1046.5, 0.18]].forEach(([freq, decalage]) => {
      const o = ctx.createOscillator(), g = ctx.createGain(), t0 = ctx.currentTime + decalage;
      o.type = 'sine'; o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.2, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.9);
      o.connect(g).connect(ctx.destination);
      o.start(t0); o.stop(t0 + 1);
    });
    setTimeout(() => ctx.close(), 1600);
  } catch {}
}
function signaler() {
  pont.alerte();
  carillon();
  const carte = $('carte');
  carte.classList.remove('eclat');
  void carte.offsetWidth;
  carte.classList.add('eclat');
}

// ---------- Actions ----------
function lancer(id) {
  focus = { id, depuis: Date.now() };
  memoire.ecrire('focus', focus);
  courante = id;  // lancé à la main : pas de sonnerie
  signatureListe = '';
  rendre();
}

function terminer(id) {
  if (Date.now() < bloqueJusqua) return;
  if (enAttente) { clearTimeout(enAttente.minuteur); enregistrerTermine(enAttente.id); }
  const t = taches.find(x => x.id === id);
  cachees.add(id);
  courante = undefined;  // la tâche suivante s'affiche sans sonner : c'est lui qui vient de cliquer
  bloqueJusqua = Date.now() + 1500;
  setTimeout(rendre, 1600);
  enAttente = { id, minuteur: setTimeout(() => enregistrerTermine(id), ANNULER_MS) };
  bandeau(`« ${t ? t.title : 'Tâche'} » terminée`, 'Annuler', () => {
    clearTimeout(enAttente.minuteur);
    enAttente = null;
    cachees.delete(id);
    courante = id;
    $('bandeau').hidden = true;
    rendre();
  }, ANNULER_MS);
  rendre();
}

async function enregistrerTermine(id) {
  if (enAttente && enAttente.id === id) enAttente = null;
  if (focus && focus.id === id) { focus = null; memoire.ecrire('focus', null); }
  const { error } = await majTache(id, { status: 'Terminé' });
  if (error) {
    cachees.delete(id);
    bandeau("« Terminé » n'a pas pu être enregistré, réessaie.");
    rendre();
    return;
  }
  taches = taches.map(t => (t.id === id ? { ...t, status: 'Terminé', updated_at: new Date().toISOString() } : t));
  cachees.delete(id);
  pont.signalerModif();
  rendre();
}

// Remet à faire une tâche terminée (clic de trop, ici ou dans Easy Desk).
async function retablir(id) {
  const t = taches.find(x => x.id === id);
  if (!t) return;
  courante = undefined;
  taches = taches.map(x => (x.id === id ? { ...x, status: 'À faire' } : x));
  signatureListe = '';
  rendre();
  const { error } = await majTache(id, { status: 'À faire' });
  if (error) {
    taches = taches.map(x => (x.id === id ? { ...x, status: 'Terminé' } : x));
    bandeau("Pas pu la remettre à faire, réessaie.");
  } else {
    bandeau(`« ${t.title} » est de nouveau à faire.`);
    pont.signalerModif();
  }
  signatureListe = '';
  rendre();
}

// Décale la tâche au lendemain (même heure), avec « Annuler ».
async function reporter(id) {
  const t = taches.find(x => x.id === id);
  if (!t) return;
  const avant = t.due_date || null;
  const jour = auLendemain(t.due_date);
  const poser = date => {
    taches = taches.map(x => (x.id === id ? { ...x, due_date: date } : x));
    courante = undefined;
    signatureListe = '';
    rendre();
  };
  if (focus && focus.id === id) { focus = null; memoire.ecrire('focus', null); }
  poser(jour);
  const { error } = await majTache(id, { due_date: jour });
  if (error) {
    poser(avant);
    bandeau("Pas pu la décaler, réessaie.");
    return;
  }
  pont.signalerModif();
  bandeau(`« ${t.title} » décalée au ${dateCourte(jour)}`, 'Annuler', async () => {
    $('bandeau').hidden = true;
    poser(avant);
    const r = await majTache(id, { due_date: avant });
    if (!r.error) pont.signalerModif();
  }, ANNULER_MS);
}

// ---------- Données ----------
async function charger() {
  let data;
  if (DEMO) {
    data = taches;
  } else {
    if (!estConnecte) return;
    // Les tâches à faire, celles d'aujourd'hui déjà terminées (elles disent quel créneau est passé)
    // et celles terminées aujourd'hui (pour pouvoir les remettre à faire).
    const rep = await client.from('qg_tasks').select(COLONNES)
      .or(`status.neq.Terminé,due_date.eq.${jourLocal(new Date())},updated_at.gte."${debutDuJour().toISOString()}"`)
      .limit(500);
    if (rep.error) {
      horsLigne = true;
      rendreReseau();
      return;
    }
    data = rep.data;
  }
  horsLigne = false;
  derniereMaj = new Date();
  const premier = vues === null;
  const nouvelles = premier ? [] : data.filter(t => !vues.has(t.id));
  vues = vues || new Set();
  for (const t of data) vues.add(t.id);
  taches = data;
  if (premier) { montrerVue('timer'); basculer(ouvert); }
  arrivees(nouvelles.filter(visible));
  rendre();
}

// Une nouvelle tâche : sans horaire (pour aujourd'hui ou sans date), le timer se lance dessus,
// sauf si une tâche à horaire est en plein dans son créneau ; sinon on l'annonce.
function arrivees(nouvelles) {
  if (!nouvelles.length) return;
  const maintenant = new Date();
  const aujourdhui = jourLocal(maintenant);
  const s = situation(maintenant);
  const creneauEnCours = s.actuelle && s.actuelle.mode === 'compte' && s.actuelle.fin > maintenant;
  const aLancer = nouvelles.find(t => !t.start_time && (!t.due_date || t.due_date <= aujourdhui));
  if (aLancer && !creneauEnCours) {
    focus = { id: aLancer.id, depuis: Date.now() };
    memoire.ecrire('focus', focus);
    bandeau('Nouvelle tâche : le timer est lancé.');
    return;  // le changement de tâche fait sonner au prochain affichage
  }
  const t = nouvelles[0];
  const quand = t.due_date === aujourdhui && t.start_time ? ` à ${hhmm(t.start_time)}`
    : t.due_date && t.due_date > aujourdhui ? ` pour ${dateCourte(t.due_date)}` : '';
  bandeau(`Nouvelle tâche${quand} : ${t.title}`);
  signaler();
}

function boucler() {
  if (boucles) return;
  boucles = true;
  setInterval(rendre, 1000);
  if (!DEMO) setInterval(charger, RAFRAICHIR_MS);
  window.addEventListener('focus', () => { if (!DEMO) charger(); });
}

async function connecte(user) {
  await lireMoi(user);
  if (!acces) {
    await client.auth.signOut();
    montrerVue('connexion');
    $('erreur-connexion').textContent = MESSAGE_SANS_ACCES;
    return;
  }
  estConnecte = true;
  await charger();
  boucler();
}

// ---------- Démarrage ----------
document.addEventListener('click', e => {
  const b = e.target.closest('[data-action]');
  if (b) {
    const action = b.dataset.action;
    if (action === 'masquer') pont.masquer();
    if (action === 'ouvrir') basculer();
    if (action === 'planning') pont.ouvrirPlanning();
    if (action === 'deconnexion') deconnexion();
  }
  if (e.target.closest('#idees-fermer')) { ideesMasquees = true; rendre(); }
  const f = e.target.closest('[data-filtre]');
  if (f) { memoire.ecrire('equipe', f.dataset.filtre === 'equipe'); signatureListe = ''; rendre(); }
});

// ---------- Taille du timer (22/10 : « agrandir et rapetisser comme je veux », et qu'il la garde) ----------
// Tout le timer grossit ou rapetisse d'un bloc (zoom de la page) ; la fenêtre suit.
const LARGEUR_TIMER = 420;
let echelle = Math.min(2, Math.max(0.75, Number(params.get('echelle')) || 1));

let etendu = null;  // souris sur la poignée : fenêtre agrandie (invisible), { a: coin fixe et côtés, H }
let geste = null;   // poignée tenue

function ajusterFenetre() {
  if (etendu) return;
  // offsetHeight est en pixels de la page (avant zoom) : la fenêtre fait la carte + ses 20 px de marge, zoomées.
  pont.taille(Math.ceil(($('carte').offsetHeight + 40) * echelle));
}
function appliquerEchelle(z, garder) {
  echelle = Math.min(2, Math.max(0.75, Math.round(z * 100) / 100));
  document.documentElement.style.zoom = String(echelle);
  pont.echelle(echelle, garder);
  ajusterFenetre();
}
document.documentElement.style.zoom = String(echelle);
new ResizeObserver(ajusterFenetre).observe($('carte'));

// La poignée est au coin libre, à l'opposé du côté où le timer est collé (main.js envoie ce côté).
pont.surAncrage(a => {
  document.body.classList.toggle('ancre-droite', !!a.droite);
  document.body.classList.toggle('ancre-bas', !!a.bas);
});

// Poignée (22/10 : « fluide, qui suit mon curseur ») : le coin libre du timer reste sous la souris ; le coin opposé
// ne bouge pas. Dès que la souris arrive sur la poignée, la fenêtre prend sa taille maximale (elle est transparente :
// rien ne bouge à l'écran) ; pendant le geste, seule la page change d'échelle, une fois par image, et la fenêtre ne
// bouge plus, donc Windows ne perd jamais la souris. Elle reprend la taille du timer quand la souris s'en va.
// Double-clic = 100 %.
const poignee = $('poignee-taille');
const borne = z => Math.min(2, Math.max(0.75, z));
const STYLES_ETENDU = ['position', 'width', 'left', 'right', 'top', 'bottom'];
let file = Promise.resolve();  // agrandir et réduire la fenêtre, l'un après l'autre, jamais en même temps
const enFile = f => (file = file.then(f, f));

const etendre = () => enFile(async () => {
  if (etendu) return;
  const carte = $('carte');
  const H = carte.offsetHeight + 40;
  const a = await pont.redimDebut();
  if (!a) return;  // navigateur (essais) : pas de fenêtre à gérer
  // La carte reste collée au coin fixe : la fenêtre agrandie autour d'elle ne change rien à l'écran.
  Object.assign(carte.style, { position: 'fixed', width: '380px', [a.droite ? 'right' : 'left']: '20px', [a.bas ? 'bottom' : 'top']: '20px' });
  etendu = { a, H };
});

const reduire = () => enFile(async () => {
  if (!etendu || geste) return;
  const carte = $('carte');
  await pont.redimFin(echelle, Math.ceil((carte.offsetHeight + 40) * echelle));
  for (const k of STYLES_ETENDU) carte.style[k] = '';
  etendu = null;
  ajusterFenetre();
});

function zoomerVers(g) {
  g.image = 0;
  // L'échelle qui amène la poignée au plus près de la souris (projection sur la diagonale du timer).
  const vx = g.x - g.a.ax, vy = g.y - g.a.ay;
  echelle = borne((vx * g.ux + vy * g.uy) / (g.ux * g.ux + g.uy * g.uy));
  document.documentElement.style.zoom = String(echelle);
}

poignee.addEventListener('pointerenter', etendre);
poignee.addEventListener('pointerleave', () => { if (!geste) reduire(); });

poignee.addEventListener('pointerdown', e => {
  e.preventDefault();
  e.stopPropagation();
  poignee.setPointerCapture(e.pointerId);
  const g = { x: e.screenX, y: e.screenY, a: null, image: 0 };
  geste = g;
  etendre();
  enFile(() => {
    if (!etendu || geste !== g) return;
    const { a, H } = etendu;
    const W = LARGEUR_TIMER, sx = a.droite ? -1 : 1, sy = a.bas ? -1 : 1;
    // Où est la souris par rapport au coin fixe, pour une échelle de 1 : la poignée grandit avec le timer, donc cet
    // écart aussi. Ainsi la poignée reste exactement sous la souris pendant tout le geste.
    const fx = a.ax + sx * W * echelle, fy = a.ay + sy * H * echelle;  // coin libre au départ
    g.ux = sx * W + (e.screenX - fx) / echelle;
    g.uy = sy * H + (e.screenY - fy) / echelle;
    g.a = a;
  });
});
poignee.addEventListener('pointermove', e => {
  const g = geste;
  if (!g) return;
  g.x = e.screenX;
  g.y = e.screenY;
  if (g.a && !g.image) g.image = requestAnimationFrame(() => zoomerVers(g));
});
function lacher() {
  const g = geste;
  if (!g) return;
  geste = null;
  if (g.image) cancelAnimationFrame(g.image);
  if (g.a) {
    zoomerVers(g);
    appliquerEchelle(echelle, true);  // arrondie et gardée ; la fenêtre suivra en quittant la poignée
  }
  if (!poignee.matches(':hover')) reduire();
}
poignee.addEventListener('pointerup', lacher);
poignee.addEventListener('pointercancel', lacher);
poignee.addEventListener('lostpointercapture', lacher);
poignee.addEventListener('dblclick', () => appliquerEchelle(1, true));
// Ctrl + molette sur le timer : plus grand / plus petit.
window.addEventListener('wheel', e => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  appliquerEchelle(echelle + (e.deltaY < 0 ? 0.1 : -0.1), true);
}, { passive: false });

async function deconnexion() {
  if (DEMO) return;
  await client.auth.signOut();
}

$('form-connexion').addEventListener('submit', async e => {
  e.preventDefault();
  const bouton = e.target.querySelector('button');
  const erreur = $('erreur-connexion');
  bouton.disabled = true;
  erreur.textContent = '';
  const { data, error } = await client.auth.signInWithPassword({ email: $('email').value.trim(), password: $('mdp').value });
  bouton.disabled = false;
  $('mdp').value = '';
  if (error) {
    erreur.textContent = /invalid/i.test(error.message) ? 'E-mail ou mot de passe incorrect.' : 'Connexion impossible : ' + error.message;
    return;
  }
  montrerVue('chargement');
  connecte(data.user);
});

pont.surDeconnexion(deconnexion);
// Le planning a modifié une tâche : on relit tout de suite.
pont.surRecharger(() => { signatureListe = ''; charger(); });
// « Lancer le timer » depuis le planning.
pont.surLancer(id => { lancer(id); pont.alerte(); });

(async function demarrer() {
  if (DEMO) {
    moi = 'Mathis';
    monId = 'moi';
    taches = tachesDemo();
    await charger();
    boucler();
    return;
  }
  client = creerClient();
  client.auth.onAuthStateChange(evenement => {
    if (evenement === 'SIGNED_OUT') {
      estConnecte = false;
      vues = null; taches = []; courante = undefined; moi = null;
      montrerVue('connexion');
    }
  });
  const { data: { session } } = await client.auth.getSession();
  if (session) connecte(session.user); else montrerVue('connexion');
})();
