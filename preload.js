// Ce que les fenêtres ont le droit de demander à Windows : leur taille, se montrer, se cacher,
// ouvrir le planning, et se prévenir l'une l'autre quand une tâche change.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bureau', {
  plateforme: process.platform,
  taille: hauteur => ipcRenderer.send('taille', hauteur),
  echelle: (z, garder) => ipcRenderer.send('echelle', z, garder),
  redimDebut: () => ipcRenderer.invoke('redim-debut'),
  redimFin: (z, hauteur) => ipcRenderer.invoke('redim-fin', z, hauteur),
  surAncrage: fn => ipcRenderer.on('ancrage', (_e, a) => fn(a)),
  alerte: () => ipcRenderer.send('alerte'),
  masquer: () => ipcRenderer.send('masquer'),
  surDeconnexion: fn => ipcRenderer.on('deconnexion', () => fn()),
  ouvrirPlanning: () => ipcRenderer.send('planning'),
  signalerModif: () => ipcRenderer.send('modif'),
  surRecharger: fn => ipcRenderer.on('recharger', () => fn()),
  lancerTimer: id => ipcRenderer.send('lancer', id),
  surLancer: fn => ipcRenderer.on('lancer', (_e, id) => fn(id)),
});
