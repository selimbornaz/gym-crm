/**
 * Application de bureau Castle : le même CRM, servi localement par le processus
 * « server » et connecté à la même base Supabase. Sans Internet, il lit la copie
 * locale chiffrée. Aucune clé d'administration n'est embarquée : connexion, rôles
 * et règles restent ceux du site. La page reçoit les droits d'un site web ordinaire
 * (pas de Node.js) et ne peut pas quitter le CRM.
 */
const { app, BrowserWindow, dialog, Menu, net, safeStorage, session, shell, utilityProcess } = require("electron");
const { createHash, randomBytes } = require("node:crypto");
const { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } = require("node:fs");
const path = require("node:path");
const tcp = require("node:net");

// Sans ce refus, un autre programme pourrait piloter la fenêtre et lire les données.
const DEBUG_SWITCHES = ["remote-debugging-port", "remote-debugging-pipe", "inspect", "inspect-brk"];
if (app.isPackaged && DEBUG_SWITCHES.some((name) => app.commandLine.hasSwitch(name))) {
  app.exit(1);
}

const TEST_URL = !app.isPackaged && process.env.CASTLE_URL ? process.env.CASTLE_URL : null;
const PREFERRED_PORT = 47615;
const SYNC_INTERVAL_MS = 30_000;
const SERVER_START_TIMEOUT_MS = 60_000;
let CRM_URL = TEST_URL ?? "";
let CRM_ORIGIN = TEST_URL ? new URL(TEST_URL).origin : "";
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
let serverProcess = null;
let syncTimer = null;
let quitting = false;
let syncAfterLoad = true;
let firstPageLogged = false;
const localToken = randomBytes(32).toString("hex");

/** Journal technique du poste (états et erreurs, jamais de données de membres). */
function logLine(message) {
  try {
    const dir = path.join(app.getPath("userData"), "logs");
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "castle.log");
    if (existsSync(file) && statSync(file).size > 1024 * 1024) rmSync(file);
    appendFileSync(file, `${new Date().toISOString()} ${message}\n`);
  } catch {
    // Le journal ne doit jamais empêcher le logiciel de fonctionner.
  }
}

/** Clé de la copie locale, protégée par le coffre de Windows pour ce compte. */
function loadDataKey() {
  if (!app.isPackaged && process.env.CASTLE_TEST_DATA_KEY) return process.env.CASTLE_TEST_DATA_KEY;
  if (!safeStorage.isEncryptionAvailable()) throw new Error("le coffre sécurisé de Windows est indisponible");
  const file = path.join(app.getPath("userData"), "data-key.bin");
  const fingerprint = (key) => createHash("sha256").update(key).digest("hex").slice(0, 8);
  if (existsSync(file)) {
    try {
      const key = safeStorage.decryptString(readFileSync(file));
      logLine(`[clé] chargée ${fingerprint(key)} (version ${app.getVersion()})`);
      return key;
    } catch (err) {
      // Arrêt brutal juste après le premier lancement : Windows n'a pas conservé de quoi
      // relire la clé. Le logiciel doit quand même démarrer : l'ancienne clé est mise de
      // côté, la copie locale aussi (par le serveur), et tout est retéléchargé.
      logLine(`[clé] illisible, nouvelle clé créée : ${err.message}`);
      renameSync(file, `${file}.illisible-${Date.now()}`);
    }
  }
  const key = randomBytes(32).toString("base64");
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, safeStorage.encryptString(key), { mode: 0o600 });
  logLine(`[clé] créée ${fingerprint(key)} (version ${app.getVersion()})`);
  return key;
}

function freePort() {
  const tryPort = (port) => new Promise((resolve, reject) => {
    const probe = tcp.createServer();
    probe.once("error", reject);
    probe.listen(port, "127.0.0.1", () => {
      const { port: chosen } = probe.address();
      probe.close(() => resolve(chosen));
    });
  });
  return tryPort(PREFERRED_PORT).catch(() => tryPort(0));
}

function startServer(port, dataKey) {
  const dir = app.isPackaged ? path.join(process.resourcesPath, "server") : path.join(__dirname, "server");
  serverProcess = utilityProcess.fork(path.join(__dirname, "server-entry.cjs"), [], {
    cwd: dir,
    serviceName: "Castle CRM Server",
    stdio: "pipe",
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      CASTLE_DATA_DIR: (!app.isPackaged && process.env.CASTLE_TEST_DATA_DIR) || path.join(app.getPath("userData"), "data"),
      CASTLE_DATA_KEY: dataKey,
      CASTLE_LOCAL_TOKEN: localToken,
      CASTLE_SERVER_DIR: dir,
      CASTLE_COMPILE_CACHE: path.join(app.getPath("userData"), "compile-cache"),
    },
  });
  serverProcess.stderr?.on("data", (chunk) => logLine(`[serveur] ${String(chunk).trim().slice(0, 800)}`));
  serverProcess.on("exit", (code) => {
    logLine(`[serveur] arrêté, code ${code}`);
    if (quitting) return;
    // Arrêt inattendu : relance automatique, la page d'attente prend le relais.
    setTimeout(() => {
      if (!quitting) startServer(port, dataKey);
    }, 1000);
  });
}

/** Test direct du port : indépendant du réseau de la fenêtre et des proxys du système. */
function portOpen(port) {
  return new Promise((resolve) => {
    const socket = tcp.connect({ port, host: "127.0.0.1" });
    const done = (open) => {
      socket.destroy();
      resolve(open);
    };
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
    socket.setTimeout(1000, () => done(false));
  });
}

async function waitForServer(port) {
  const end = Date.now() + SERVER_START_TIMEOUT_MS;
  while (Date.now() < end) {
    if (await portOpen(port)) return true;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

/**
 * Télécharge les nouveautés avec la session de l'utilisateur ; sans effet hors ligne.
 * La requête part de la page : c'est là que les cookies de session (SameSite) sont
 * envoyés, et que leur renouvellement est enregistré.
 */
async function syncNow() {
  if (TEST_URL || quitting || !mainWindow || mainWindow.isDestroyed()) return;
  const { webContents } = mainWindow;
  const url = webContents.getURL();
  if (!isCrm(url) || new URL(url).pathname === "/login") return;
  try {
    const result = await webContents.executeJavaScript(`
      fetch("/api/desktop/sync", { method: "POST", headers: { "x-castle-token": ${JSON.stringify(localToken)} }, redirect: "manual" })
        .then(async (r) => ({ http: r.status, ...(await r.json().catch(() => ({}))) }))
        .catch((e) => ({ status: "fetch_error", detail: String(e) }))
    `);
    logLine(`[sync] ${JSON.stringify(result)}`);
  } catch (err) {
    logLine(`[sync] ${err.message}`);
  }
}

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

  mainWindow.once("ready-to-show", () => logLine("[fenêtre] prête"));
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
    if (!isCrm(url)) return;
    const previous = lastUrl;
    lastUrl = url;
    // Juste après la connexion : première copie sans attendre le prochain cycle.
    if (previous.includes("/login") && !url.includes("/login")) syncAfterLoad = true;
  });
  webContents.on("did-finish-load", () => {
    const url = webContents.getURL();
    if (!isCrm(url)) return;
    if (!firstPageLogged) {
      firstPageLogged = true;
      logLine("[démarrage] première page affichée");
    }
    if (!syncAfterLoad || new URL(url).pathname === "/login") return;
    syncAfterLoad = false;
    syncNow();
  });
  webContents.on("did-navigate-in-page", (_event, url, isMainFrame) => {
    if (!isMainFrame || !isCrm(url)) return;
    const previous = lastUrl;
    lastUrl = url;
    // La connexion aboutit sans rechargement de page : première copie immédiate.
    if (previous.includes("/login") && !url.includes("/login")) syncNow();
  });
  webContents.setWindowOpenHandler(({ url }) => {
    if (isCrm(url)) webContents.loadURL(url);
    else openExternally(url);
    return { action: "deny" };
  });

  webContents.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
    // -3 : navigation annulée (changement de page), pas une panne.
    if (isMainFrame && code !== -3 && isCrm(url)) {
      logLine(`[page] échec ${code} ${description}`);
      showOffline();
    }
  });
  webContents.on("render-process-gone", (_event, details) => {
    logLine(`[page] processus arrêté : ${details.reason} (${details.exitCode})`);
    if (details.reason !== "clean-exit") webContents.reload();
  });

  // Le logo s'affiche tout de suite ; le CRM prend sa place dès que le serveur local répond.
  if (TEST_URL) mainWindow.loadURL(CRM_URL);
  else mainWindow.loadFile(path.join(__dirname, "splash.html"));
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
  process.on("uncaughtException", (err) => {
    logLine(`[erreur] ${err.stack ?? err.message}`);
  });
  process.on("unhandledRejection", (reason) => {
    logLine(`[erreur] ${reason?.stack ?? reason}`);
  });
  app.on("before-quit", () => {
    logLine("[arrêt] fermeture demandée");
    quitting = true;
    clearInterval(syncTimer);
    serverProcess?.kill();
  });

  app.whenReady().then(async () => {
    session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => {
      callback(ALLOWED_PERMISSIONS.has(permission) && isCrm(contents.getURL()));
    });
    session.defaultSession.setPermissionCheckHandler((_contents, permission, origin) =>
      ALLOWED_PERMISSIONS.has(permission) && isCrm(origin),
    );
    buildMenu();
    logLine(`[démarrage] version ${app.getVersion()}`);
    createWindow();

    if (!TEST_URL) {
      try {
        const dataKey = loadDataKey();
        const port = await freePort();
        logLine(`[démarrage] port ${port}`);
        // Même nom d'hôte que les redirections du serveur : sinon les cookies de session se perdent.
        CRM_URL = `http://localhost:${port}/dashboard`;
        CRM_ORIGIN = new URL(CRM_URL).origin;
        lastUrl = CRM_URL;
        startServer(port, dataKey);
        if (!(await waitForServer(port))) throw new Error("le CRM local n'a pas démarré");
        logLine("[démarrage] serveur prêt");
      } catch (err) {
        logLine(`[démarrage] ÉCHEC ${err.message}`);
        dialog.showErrorBox("Castle CRM", `Démarrage impossible : ${err.message}.`);
        app.quit();
        return;
      }
      syncTimer = setInterval(syncNow, SYNC_INTERVAL_MS);
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL(CRM_URL);
    }
  });
}
