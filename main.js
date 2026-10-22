// Timer Easy Send : une petite fenêtre toujours au-dessus des autres, reliée à la to-do d'Easy Desk,
// et le planning de la semaine en grand (bouton calendrier du timer).
// Les pages (app/) font tout le travail ; ici : les fenêtres, l'icône près de l'horloge, le lancement au démarrage.
const { app, BrowserWindow, Tray, Menu, ipcMain, screen, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const LARGEUR = 420;      // largeur du timer à 100 %
const HAUTEUR_MAX = 660;
// Taille du timer réglable (poignée en bas à droite, ou Ctrl + molette), de 75 % à 200 %, gardée d'une fois sur l'autre.
const borner = z => Math.min(2, Math.max(0.75, Number(z) || 1));
const MARGE = 0;  // la page garde déjà 20 px de marge transparente autour de la carte
const DEMO = process.argv.find(a => a.startsWith('--demo'));
const CAPTURE = (process.argv.find(a => a.startsWith('--capture=')) || '').slice('--capture='.length);
const ICONE = path.join(__dirname, 'app', 'icone.ico');
// Sur Mac : l'icône va dans la barre du haut (image « Template » noire, que macOS adapte au clair et au sombre),
// et les boutons de fenêtre sont à gauche.
const MAC = process.platform === 'darwin';
const ICONE_BARRE = MAC ? path.join(__dirname, 'app', 'iconeBarreTemplate.png') : ICONE;

// Toujours le même dossier de réglages (connexion, position), que l'appli tourne depuis ce dossier ou installée :
// sans ça, le nom « Timer Easy Send » de l'installateur en créerait un autre et il faudrait se reconnecter.
app.setPath('userData', path.join(app.getPath('appData'), 'timer-easy-send'));

// Le timer doit pouvoir sonner sans clic préalable, et tourner même caché.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.setAppUserModelId('Timer Easy Send');

let fenetre = null;
let echelle = 1;
const largeur = () => Math.round(LARGEUR * echelle);
let planning = null;
let plateau = null;
let quitter = false;

const fichier = nom => path.join(app.getPath('userData'), nom);
function lire(nom, defaut) {
  try { return JSON.parse(fs.readFileSync(fichier(nom), 'utf8')); } catch { return defaut; }
}
function ecrire(nom, valeur) {
  try { fs.writeFileSync(fichier(nom), JSON.stringify(valeur)); } catch {}
}

// Garde la fenêtre entière dans l'écran où elle se trouve.
function dansEcran(b) {
  const zone = screen.getDisplayMatching(b).workArea;
  const x = Math.min(Math.max(b.x, zone.x), zone.x + zone.width - b.width);
  const y = Math.min(Math.max(b.y, zone.y), zone.y + zone.height - b.height);
  return { ...b, x, y };
}

// Posée dans le haut de l'écran, la fenêtre garde son haut fixe et grandit vers le bas ; posée dans le bas,
// elle garde son bas fixe et grandit vers le haut. Ainsi elle ne glisse pas quand on ouvre et ferme les détails.
function enHaut(b) {
  const zone = screen.getDisplayMatching(b).workArea;
  return b.y + Math.min(b.height, 200) / 2 < zone.y + zone.height / 2;
}

function positionDeDepart(hauteur) {
  const p = lire('position.json', null);
  if (p) {
    const y = p.y !== undefined && enHaut({ x: p.x, y: p.y, width: largeur(), height: hauteur }) ? p.y : p.bas - hauteur;
    return dansEcran({ x: p.x, y, width: largeur(), height: hauteur });
  }
  const zone = screen.getPrimaryDisplay().workArea;
  return { x: zone.x + zone.width - largeur() - MARGE, y: zone.y + zone.height - hauteur - MARGE, width: largeur(), height: hauteur };
}

// Le planning ouvert à l'écran remplace le timer (21/10 : « quand le calendrier s'affiche, le petit timer disparaît »).
const planningALEcran = () => planning && planning.isVisible() && !planning.isMinimized();

function montrer() {
  if (!fenetre) return;
  if (planningALEcran()) {
    // Une tâche commence pendant qu'il est sur le planning : le timer sonne (caché) et le planning clignote.
    planning.flashFrame(true);
    setTimeout(() => planning && planning.flashFrame(false), 3000);
    return;
  }
  if (!fenetre.isVisible()) fenetre.showInactive();
  fenetre.setAlwaysOnTop(true, 'floating');
  fenetre.moveTop();
  fenetre.flashFrame(true);
  setTimeout(() => fenetre && fenetre.flashFrame(false), 3000);
}

function lancementAuDemarrage(actif) {
  // Installée (installateur), l'appli est son propre .exe ; en développement, electron.exe + le dossier.
  const reglage = { path: process.execPath, args: app.isPackaged ? [] : [app.getAppPath()] };
  if (actif === undefined) return app.getLoginItemSettings(reglage).openAtLogin;
  app.setLoginItemSettings({ ...reglage, openAtLogin: actif });
  return actif;
}

function menuPlateau() {
  return Menu.buildFromTemplate([
    { label: 'Afficher le timer', click: () => { fenetre.show(); montrer(); } },
    { label: 'Ouvrir le planning', click: ouvrirPlanning },
    { label: MAC ? 'Ouvrir au démarrage du Mac' : 'Lancer au démarrage de Windows', type: 'checkbox', checked: lancementAuDemarrage(),
      click: item => { lancementAuDemarrage(item.checked); } },
    { type: 'separator' },
    { label: 'Se déconnecter', click: () => fenetre.webContents.send('deconnexion') },
    { label: 'Quitter', click: () => { quitter = true; app.quit(); } },
  ]);
}

function creerFenetre() {
  echelle = borner(lire('affichage.json', {}).echelle);
  const depart = positionDeDepart(Math.round(190 * echelle));
  fenetre = new BrowserWindow({
    ...depart,
    frame: false, transparent: true, resizable: false, maximizable: false, minimizable: false,
    fullscreenable: false, skipTaskbar: true, alwaysOnTop: true, hasShadow: false, show: false,
    backgroundColor: '#00000000', title: 'Timer Easy Send', icon: ICONE,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      backgroundThrottling: false,
    },
  });
  fenetre.setAlwaysOnTop(true, 'floating');
  if (MAC) fenetre.setVisibleOnAllWorkspaces(true);  // il suit d'un bureau à l'autre
  const query = { echelle: String(echelle) };
  if (DEMO) query.demo = '1';
  if (DEMO === '--demo=ouvert') query.ouvert = '1';
  fenetre.loadFile(path.join(__dirname, 'app', 'index.html'), { query });
  fenetre.once('ready-to-show', () => fenetre.showInactive());

  fenetre.on('moved', () => {
    if (redim) return;  // fenêtre agrandie le temps d'un changement de taille : pas sa vraie place
    const b = fenetre.getBounds();
    ecrire('position.json', { x: b.x, y: b.y, bas: b.y + b.height });
    envoyerAncrage();
  });
  fenetre.webContents.on('did-finish-load', envoyerAncrage);
  // Fermer = cacher (l'icône près de l'horloge la rouvre).
  fenetre.on('close', e => { if (!quitter) { e.preventDefault(); fenetre.hide(); } });
  proteger(fenetre);
  if (CAPTURE && DEMO !== '--demo=planning') capturer(fenetre);
}

// Un lien dans une tâche s'ouvre dans le navigateur ; la page elle-même ne quitte jamais l'appli.
function proteger(f) {
  f.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  f.webContents.on('will-navigate', e => e.preventDefault());
}

// Essais : enregistre une image de la fenêtre puis quitte (--capture=<fichier.png>).
function capturer(f) {
  f.webContents.on('console-message', e => console.log(`[page] ${e.message}`));
  f.webContents.once('did-finish-load', () => setTimeout(async () => {
    const image = await f.webContents.capturePage();
    fs.writeFileSync(CAPTURE, image.toPNG());
    quitter = true;
    app.quit();
  }, 3000));
}

// Le planning de la semaine : une vraie fenêtre, ouverte en grand.
function ouvrirPlanning() {
  if (planning) {
    if (planning.isMinimized()) planning.restore();
    planning.show();
    planning.focus();
    fenetre.hide();
    return;
  }
  planning = new BrowserWindow({
    width: 1280, height: 820, minWidth: 980, minHeight: 600, show: false,
    title: 'Planning · Timer Easy Send', icon: ICONE, backgroundColor: '#0B130F',
    ...(MAC
      ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 17 } }
      : { titleBarStyle: 'hidden', titleBarOverlay: { color: '#11231B', symbolColor: '#F2EFE8', height: 48 } }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
    },
  });
  planning.loadFile(path.join(__dirname, 'app', 'planning.html'), { query: DEMO ? { demo: '1' } : {} });
  planning.once('ready-to-show', () => {
    planning.show();
    // Lancée par un autre programme, l'appli peut hériter d'un « démarrer réduit » de Windows : on la remet à l'écran.
    if (planning.isMinimized()) planning.restore();
    planning.maximize();
    planning.focus();
    fenetre.hide();
  });
  // Planning réduit ou fermé : le timer revient ; planning rouvert : il repart.
  planning.on('minimize', () => fenetre.showInactive());
  planning.on('restore', () => fenetre.hide());
  planning.on('closed', () => { planning = null; fenetre.showInactive(); });
  proteger(planning);
  if (CAPTURE && DEMO === '--demo=planning') capturer(planning);
}

// De quel côté le timer est collé : à droite de l'écran, il garde son bord droit ; en bas, son bord bas.
// La poignée de taille va au coin opposé (le coin libre), pour suivre la souris.
function ancrage(b = fenetre.getBounds()) {
  const zone = screen.getDisplayMatching(b).workArea;
  return { droite: b.x + b.width / 2 > zone.x + zone.width / 2, bas: !enHaut(b) };
}
function envoyerAncrage() {
  if (fenetre && !redim) fenetre.webContents.send('ancrage', ancrage());
}

ipcMain.on('taille', (_e, hauteur) => {
  if (!fenetre || redim) return;
  const b = fenetre.getBounds();
  const zone = screen.getDisplayMatching(b).workArea;
  const h = Math.max(100, Math.min(Math.round(HAUTEUR_MAX * echelle), zone.height, Math.round(hauteur)));
  const w = largeur();
  if (b.height === h && b.width === w) return;
  const { droite, bas } = ancrage(b);
  fenetre.setBounds(dansEcran({ x: droite ? b.x + b.width - w : b.x, y: bas ? b.y + b.height - h : b.y, width: w, height: h }));
});
// Nouvelle taille choisie à la molette (la fenêtre suit au message « taille » qui arrive juste après).
ipcMain.on('echelle', (_e, z, garder) => {
  echelle = borner(z);
  if (garder) ecrire('affichage.json', { echelle });
});

// Poignée de taille. Changer la taille d'une fenêtre à chaque mouvement de souris saccade ; alors au début du geste
// la fenêtre prend d'un coup sa plus grande taille du côté libre (elle est transparente : rien ne se voit), et pendant
// le geste seule la page change d'échelle, sans toucher à la fenêtre. À la fin, la fenêtre reprend la taille du timer.
let redim = null;  // pendant le geste : coin fixe (ax, ay, en pixels d'écran) et côtés collés
ipcMain.handle('redim-debut', () => {
  if (!fenetre) return null;
  const b = fenetre.getBounds();
  const zone = screen.getDisplayMatching(b).workArea;
  const { droite, bas } = ancrage(b);
  const ax = droite ? b.x + b.width : b.x;
  const ay = bas ? b.y + b.height : b.y;
  const x = droite ? Math.max(zone.x, ax - LARGEUR * 2) : ax;
  const y = bas ? Math.max(zone.y, ay - HAUTEUR_MAX * 2) : ay;
  const w = droite ? ax - x : Math.min(LARGEUR * 2, zone.x + zone.width - ax);
  const h = bas ? ay - y : Math.min(HAUTEUR_MAX * 2, zone.y + zone.height - ay);
  redim = { droite, bas, ax, ay };
  fenetre.setBounds({ x, y, width: Math.round(w), height: Math.round(h) });
  return redim;
});
ipcMain.handle('redim-fin', (_e, z, hauteur) => {
  if (!fenetre || !redim) return;
  echelle = borner(z);
  ecrire('affichage.json', { echelle });
  const { droite, bas, ax, ay } = redim;
  const w = largeur(), h = Math.round(hauteur);
  redim = null;
  fenetre.setBounds(dansEcran({ x: droite ? ax - w : ax, y: bas ? ay - h : ay, width: w, height: h }));
  const b = fenetre.getBounds();
  ecrire('position.json', { x: b.x, y: b.y, bas: b.y + b.height });
});
ipcMain.on('alerte', montrer);
ipcMain.on('masquer', () => fenetre && fenetre.hide());
ipcMain.on('planning', ouvrirPlanning);
// Une fenêtre a changé une tâche : l'autre relit tout de suite.
ipcMain.on('modif', e => {
  for (const f of [fenetre, planning]) if (f && !f.isDestroyed() && f.webContents !== e.sender) f.webContents.send('recharger');
});
// « Lancer le timer » depuis le planning (le timer se montrera à la fermeture du planning).
ipcMain.on('lancer', (_e, id) => {
  if (fenetre) fenetre.webContents.send('lancer', id);
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { fenetre.show(); montrer(); });
  app.whenReady().then(() => {
    // Première ouverture : on le lance avec Windows (décochable depuis l'icône près de l'horloge).
    if (!DEMO && !CAPTURE && !lire('reglages.json', null)) {
      lancementAuDemarrage(true);
      ecrire('reglages.json', { demarrageRegle: true });
    }
    creerFenetre();
    if (DEMO === '--demo=planning') ouvrirPlanning();
    plateau = new Tray(ICONE_BARRE);
    plateau.setToolTip('Timer Easy Send');
    plateau.setContextMenu(menuPlateau());
    plateau.on('click', () => { fenetre.show(); montrer(); });
  });
  app.on('window-all-closed', e => e.preventDefault());
  // Quitter (menu, Cmd+Q sur Mac) ferme vraiment, au lieu de seulement cacher le timer.
  app.on('before-quit', () => { quitter = true; });
  // Mac : un clic sur l'icône du Dock ramène le timer.
  app.on('activate', () => { if (fenetre) { fenetre.show(); montrer(); } });
}
