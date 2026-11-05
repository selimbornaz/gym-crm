/**
 * Tests de l'application de bureau, pilotée via le protocole de débogage Chromium.
 *
 *   npm test                                   lance Electron en mode développement
 *   CASTLE_EXE="C:\...\Castle CRM.exe" npm test   vérifie aussi le logiciel installé
 *
 * Un petit serveur local joue le rôle du CRM ; un test vérifie le vrai site.
 */
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const electronBinary = createRequire(import.meta.url)("electron");
const LIVE_HOST = "gym-crm-sand.vercel.app";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures.push(name);
    console.log(`  ✗ ${name}\n      ${err.message}`);
  }
}
const assert = (cond, message) => {
  if (!cond) throw new Error(message);
};
async function until(fn, message, ms = 25_000) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    try {
      last = await fn();
      if (last) return last;
    } catch {
      // pas encore prêt
    }
    await sleep(250);
  }
  throw new Error(`${message} (dernier état : ${JSON.stringify(last)})`);
}

let port = 9400;
function launch({ crmUrl, profile, exe } = {}) {
  const debugPort = ++port;
  const dir = profile ?? mkdtempSync(join(tmpdir(), "castle-test-"));
  const args = [`--remote-debugging-port=${debugPort}`, `--user-data-dir=${dir}`];
  const child = exe
    ? spawn(exe, args, { stdio: "ignore" })
    : spawn(electronBinary, [".", ...args], {
        stdio: "ignore",
        cwd: import.meta.dirname,
        env: { ...process.env, CASTLE_URL: crmUrl ?? "", ELECTRON_RUN_AS_NODE: undefined },
      });
  const exited = new Promise((resolve) => child.on("exit", (code) => resolve(code ?? 0)));
  return {
    child, exited, dir, debugPort,
    async page() {
      const list = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      return list.find((t) => t.type === "page");
    },
    async evaluate(expression) {
      const target = await this.page();
      const ws = new WebSocket(target.webSocketDebuggerUrl);
      await new Promise((resolve, reject) => {
        ws.onopen = resolve;
        ws.onerror = () => reject(new Error("connexion au débogueur impossible"));
      });
      const result = await new Promise((resolve, reject) => {
        ws.onmessage = (m) => {
          const data = JSON.parse(m.data);
          if (data.id === 1) resolve(data.result);
        };
        ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
        setTimeout(() => reject(new Error("pas de réponse")), 10_000);
      });
      ws.close();
      return result.result?.value;
    },
    async stop() {
      child.kill();
      await Promise.race([exited, sleep(5000)]);
      await sleep(300);
      if (!profile) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    },
  };
}

/** Faux CRM : le code HTTP vaut pour toutes les pages. */
function fakeCrm(listenPort) {
  const server = createServer((_req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.end("<!doctype html><title>Faux CRM</title><h1>CRM</h1>");
  });
  return new Promise((resolve) => server.listen(listenPort, "127.0.0.1", () => resolve(server)));
}
const stopServer = (server) => new Promise((resolve) => {
  server.closeAllConnections();
  server.close(resolve);
});

const CRM_PORT = 9391;
const CRM = `http://127.0.0.1:${CRM_PORT}`;

console.log("Fenêtre et sécurité");
{
  const server = await fakeCrm(CRM_PORT);
  const app = launch({ crmUrl: `${CRM}/` });
  await test("ouvre le CRM au démarrage", async () => {
    await until(async () => (await app.page())?.title === "Faux CRM", "CRM non affiché");
  });
  await test("la page n'a aucun accès à Node.js", async () => {
    const r = await app.evaluate("[typeof require, typeof process, typeof module].join()");
    assert(r === "undefined,undefined,undefined", r);
  });
  await test("impossible de quitter le CRM vers un autre site", async () => {
    await app.evaluate("location.href = 'http://example.com/'; 1");
    await sleep(1500);
    assert((await app.page()).url.startsWith(CRM), (await app.page()).url);
  });
  await test("impossible d'ouvrir un fichier de l'ordinateur", async () => {
    await app.evaluate("location.href = 'file:///C:/Windows/win.ini'; 1");
    await sleep(1000);
    assert((await app.page()).url.startsWith(CRM), (await app.page()).url);
  });
  await test("aucune nouvelle fenêtre ne s'ouvre", async () => {
    const r = await app.evaluate("window.open('http://example.com/') === null");
    assert(r === true, String(r));
    const pages = (await (await fetch(`http://127.0.0.1:${app.debugPort}/json/list`)).json()).filter((t) => t.type === "page");
    assert(pages.length === 1, `${pages.length} fenêtres`);
  });
  await test("un lien du CRM en nouvelle fenêtre s'ouvre dans la même fenêtre", async () => {
    await app.evaluate(`window.open('${CRM}/membres'); 1`);
    await until(async () => (await app.page()).url === `${CRM}/membres`, "lien interne non suivi", 5000);
  });
  await test("géolocalisation refusée, caméra autorisée pour le CRM", async () => {
    const geo = await app.evaluate("navigator.permissions.query({name:'geolocation'}).then(p => p.state)");
    assert(geo === "denied", `géolocalisation : ${geo}`);
    const cam = await app.evaluate("navigator.permissions.query({name:'camera'}).then(p => p.state)");
    assert(cam === "granted", `caméra : ${cam}`);
  });
  await test("relancer l'application ne crée pas de seconde fenêtre", async () => {
    const second = launch({ crmUrl: `${CRM}/`, profile: app.dir });
    const code = await Promise.race([second.exited, sleep(15_000).then(() => "toujours lancée")]);
    if (code === "toujours lancée") second.child.kill();
    assert(code === 0, String(code));
    assert((await app.page()).url.startsWith(CRM), "première fenêtre perdue");
  });

  console.log("\nCoupure et reprise de connexion");
  await test("site injoignable : page d'attente Dopamine Fitness, puis retour automatique à la même page", async () => {
    await app.evaluate(`location.href = '${CRM}/paiements'; 1`);
    await until(async () => (await app.page()).url === `${CRM}/paiements`, "page de départ");
    await stopServer(server);
    await app.evaluate("location.reload(); 1");
    await until(async () => (await app.page()).url.includes("offline.html"), "page d'attente absente");
    const text = await app.evaluate("document.body.innerText");
    assert(text.includes("Dopamine Fitness redémarre"), text);
    const again = await fakeCrm(CRM_PORT);
    await until(async () => (await app.page()).url === `${CRM}/paiements`, "pas de retour automatique");
    await stopServer(again);
  });
  await app.stop();
}
await test("démarrage sans Internet : page d'attente, Réessayer sans danger, puis retour automatique", async () => {
  const app = launch({ crmUrl: `${CRM}/` });
  try {
    await until(async () => (await app.page())?.url.includes("offline.html"), "page d'attente absente");
    // Réessayer alors que le site reste injoignable : retour à la page d'attente, sans plantage.
    await app.evaluate("document.getElementById('retry').click(); 1");
    await sleep(800);
    await until(async () => (await app.page())?.url.includes("offline.html"), "page d'attente perdue après Réessayer");
    const server = await fakeCrm(CRM_PORT);
    await until(async () => (await app.page()).url.startsWith(CRM), "pas de reprise");
    await stopServer(server);
  } finally {
    await app.stop();
  }
});

console.log("\nVrai site");
await test(`l'application affiche la connexion Dopamine Fitness de ${LIVE_HOST}`, async () => {
  const app = launch({ crmUrl: `https://${LIVE_HOST}/` });
  try {
    await until(async () => (await app.page())?.title === "Connexion · Dopamine Fitness", "page de connexion absente", 40_000);
    assert((await app.page()).url.startsWith(`https://${LIVE_HOST}/login`), (await app.page()).url);
    await until(async () => /Se connecter/.test(await app.evaluate("document.body.innerText")), "formulaire de connexion absent");
  } finally {
    await app.stop();
  }
});

if (process.env.CASTLE_EXE) {
  console.log("\nLogiciel installé");
  const exe = process.env.CASTLE_EXE;
  await test("refuse de démarrer avec une option de débogage", async () => {
    for (const option of ["--remote-debugging-port=9499", "--inspect=9498"]) {
      const child = spawn(exe, [option], { stdio: "ignore" });
      const code = await Promise.race([
        new Promise((resolve) => child.on("exit", (c) => resolve(c ?? 0))),
        sleep(15_000).then(() => "toujours lancé"),
      ]);
      if (code === "toujours lancé") child.kill();
      assert(code !== "toujours lancé", `${option} : l'application a démarré`);
    }
  });
  await test("arrêt brutal au premier lancement : le logiciel redémarre quand même", async () => {
    const dir = mkdtempSync(join(tmpdir(), "castle-crash-"));
    const log = join(dir, "logs", "castle.log");
    const pagesShown = () => (existsSync(log) ? readFileSync(log, "utf8").split("première page affichée").length - 1 : 0);
    const start = () => spawn(exe, [`--user-data-dir=${dir}`], { stdio: "ignore" });
    const killTree = (child) => spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    const first = start();
    await until(() => pagesShown() >= 1, "premier lancement sans page", 90_000);
    killTree(first);
    await sleep(1500);
    const second = start();
    try {
      await until(() => pagesShown() >= 2, `second lancement bloqué : ${existsSync(log) ? readFileSync(log, "utf8").slice(-300) : ""}`, 90_000);
      assert(!readFileSync(log, "utf8").includes("ÉCHEC"), "échec au démarrage");
    } finally {
      killTree(second);
      await sleep(1000);
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    }
  });
  await test("démarre seul le CRM local et affiche la connexion Dopamine Fitness", async () => {
    const child = spawn(exe, [], { stdio: "ignore" });
    const exited = new Promise((resolve) => child.on("exit", resolve));
    try {
      const body = await until(async () => {
        const r = await fetch("http://localhost:47615/login");
        const html = await r.text();
        return r.status === 200 && html.includes("Connexion") ? html : null;
      }, "CRM local absent", 90_000);
      assert(!/service_role/.test(body), "clé présente");
      const sync = await fetch("http://localhost:47615/api/desktop/sync", { method: "POST", redirect: "manual" });
      assert(sync.status === 403, `synchronisation sans jeton : ${sync.status}`);
    } finally {
      child.kill();
      await Promise.race([exited, sleep(5000)]);
    }
  });
}

console.log(`\n${passed} réussis, ${failures.length} échoués`);
process.exit(failures.length ? 1 : 0);
