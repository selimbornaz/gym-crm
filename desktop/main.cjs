/**
 * Application de bureau Castle : une fenêtre sécurisée sur le CRM en ligne.
 *
 * Aucune donnée ni clé n'est embarquée : connexion, rôles et règles restent ceux
 * du site. La page reçoit les droits d'un site web ordinaire (pas de Node.js) et
 * ne peut pas quitter le CRM.
 */
const { app, BrowserWindow, Menu, net, session, shell } = require("electron");
const path = require("node:path");

const CRM_URL = (!app.isPackaged && process.env.CASTLE_URL) || "https://gym-crm-sand.vercel.app";
const CRM_ORIGIN = new URL(CRM_URL).origin;
const RETRY_MS = app.isPackaged ? 10_000 : 1_000;
// Autorisées pour le CRM seulement : caméra (scan QR à l'accueil) et copie.
const ALLOWED_PERMISSIONS = new Set(["media", "clipboard-sanitized-write", "fullscreen"]);

const isCrm = (url) => {
  try {
    return new URL(url).origin === CRM_ORIGIN;
  } catch {
    return false;
  }
};

/** Un lien externe s'ouvre dans le navigateur, et seulement en https. */
function openExternally(url) {
  try {
    if (new URL(url).protocol === "https:") shell.openExternal(url);
  } catch {
    // URL invalide : ignorée.
  }
}

let mainWindow = null;
let lastUrl = CRM_URL;
let retryTimer = null;

function stopRetrying() {
  if (retryTimer) clearInterval(retryTimer);
  retryTimer = null;
}

/** Page d'attente sans connexion ; le CRM revient seul dès que le site répond. */
function showOffline() {
  mainWindow.loadFile(path.join(__dirname, "offline.html"), { query: { url: lastUrl } });
  stopRetrying();
  retryTimer = setInterval(async () => {
    try {
      await net.fetch(`${CRM_ORIGIN}/login`, { method: "HEAD", cache: "no-store" });
    } catch {
      return;
    }
    stopRetrying();
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL(lastUrl);
  }, RETRY_MS);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 800,
    minHeight: 600,
    show: false,
    title: "Castle CRM",
    backgroundColor: "#0a0808",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
    },
  });
  const { webContents } = mainWindow;

  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("closed", () => {
    stopRetrying();
    mainWindow = null;
  });

  webContents.on("will-navigate", (event, url) => {
    if (isCrm(url)) return;
    event.preventDefault();
    openExternally(url);
  });
  webContents.on("did-navigate", (_event, url) => {
    if (isCrm(url)) lastUrl = url;
  });
  webContents.on("did-navigate-in-page", (_event, url, isMainFrame) => {
    if (isMainFrame && isCrm(url)) lastUrl = url;
  });
  webContents.setWindowOpenHandler(({ url }) => {
    if (isCrm(url)) webContents.loadURL(url);
    else openExternally(url);
    return { action: "deny" };
  });

  webContents.on("did-fail-load", (_event, code, _description, url, isMainFrame) => {
    // -3 : navigation annulée (changement de page), pas une panne.
    if (isMainFrame && code !== -3 && isCrm(url)) showOffline();
  });
  webContents.on("render-process-gone", (_event, details) => {
    if (details.reason !== "clean-exit") webContents.reload();
  });

  mainWindow.loadURL(CRM_URL);
}

function buildMenu() {
  const reload = { label: "Actualiser", accelerator: "F5", click: () => mainWindow?.webContents.reload() };
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "Fichier",
        submenu: [
          { label: "Imprimer…", accelerator: "CmdOrCtrl+P", click: () => mainWindow?.webContents.print() },
          { type: "separator" },
          { label: "Quitter", role: "quit" },
        ],
      },
      {
        label: "Édition",
        submenu: [
          { label: "Annuler", role: "undo" },
          { label: "Rétablir", role: "redo" },
          { type: "separator" },
          { label: "Couper", role: "cut" },
          { label: "Copier", role: "copy" },
          { label: "Coller", role: "paste" },
          { label: "Tout sélectionner", role: "selectAll" },
        ],
      },
      {
        label: "Affichage",
        submenu: [
          reload,
          { type: "separator" },
          { label: "Zoom avant", role: "zoomIn" },
          { label: "Zoom arrière", role: "zoomOut" },
          { label: "Taille normale", role: "resetZoom" },
          { type: "separator" },
          { label: "Plein écran", role: "togglefullscreen" },
          ...(app.isPackaged ? [] : [{ label: "Outils de développement", role: "toggleDevTools" }]),
        ],
      },
    ]),
  );
}

// Une seule fenêtre : relancer l'application ramène celle déjà ouverte.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.setAppUserModelId("tn.castle.crm");

  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.on("web-contents-created", (_event, contents) => {
    contents.on("will-attach-webview", (event) => event.preventDefault());
  });
  app.on("window-all-closed", () => app.quit());

  app.whenReady().then(() => {
    session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => {
      callback(ALLOWED_PERMISSIONS.has(permission) && isCrm(contents.getURL()));
    });
    session.defaultSession.setPermissionCheckHandler((_contents, permission, origin) =>
      ALLOWED_PERMISSIONS.has(permission) && isCrm(origin),
    );
    buildMenu();
    createWindow();
  });
}
