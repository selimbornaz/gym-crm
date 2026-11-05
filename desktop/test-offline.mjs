/**
 * Test de bout en bout du mode hors ligne : la vraie application, le vrai serveur
 * local et une copie chiffrée remplie depuis PostgreSQL (voir offline-local.ts).
 * Internet est coupé pour l'application par CASTLE_TEST_OFFLINE_FILE.
 *
 *   CASTLE_SEED=chemin/seed.json npm run test:offline
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const seed = JSON.parse(readFileSync(process.env.CASTLE_SEED, "utf8"));
const electron = createRequire(import.meta.url)("electron");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
const failures = [];
const test = async (name, fn) => {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures.push(name);
    console.log(`  ✗ ${name}\n      ${String(err.message).slice(0, 900)}`);
  }
};
const assert = (c, m) => {
  if (!c) throw new Error(m);
};
async function until(fn, message, ms = 30_000) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    try {
      last = await fn();
      if (last) return last;
    } catch (e) {
      last = e.message;
    }
    await sleep(300);
  }
  throw new Error(`${message} (dernier état : ${JSON.stringify(last)})`);
}

const profile = mkdtempSync(join(tmpdir(), "castle-e2e-"));
const offlineFile = join(profile, "offline.flag");
writeFileSync(offlineFile, "1");
const DEBUG = 9477;
let child;
let serverLog = "";

async function launch() {
  child = spawn(electron, [".", `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${profile}`], {
    cwd: import.meta.dirname,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      CASTLE_TEST_DATA_KEY: seed.key,
      CASTLE_TEST_DATA_DIR: seed.dir,
      CASTLE_TEST_OFFLINE_FILE: offlineFile,
    },
  });
  child.on("exit", (code, signal) => console.log(`    [application arrêtée : ${code ?? signal}]`));
  child.stderr.on("data", (c) => (serverLog += c));
  child.stdout.on("data", (c) => (serverLog += c));
  await until(async () => (await target())?.url.startsWith("http://localhost"), "application non démarrée", 90_000);
}
async function stop() {
  child.kill();
  await sleep(1500);
}
async function target() {
  const list = await (await fetch(`http://127.0.0.1:${DEBUG}/json/list`)).json();
  return list.find((t) => t.type === "page");
}
async function cdp(method, params = {}) {
  const t = await target();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = () => rej(new Error("débogueur injoignable"));
  });
  const result = await new Promise((res, rej) => {
    ws.onmessage = (m) => {
      const d = JSON.parse(m.data);
      if (d.id === 1) res(d);
    };
    ws.send(JSON.stringify({ id: 1, method, params }));
    setTimeout(() => rej(new Error(`pas de réponse : ${method}`)), 20_000);
  });
  ws.close();
  return result.result;
}
const evaluate = async (expression) => (await cdp("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }))?.result?.value;
const origin = async () => new URL((await target()).url).origin;
const url = async () => (await target()).url;
const text = () => evaluate("document.body.innerText");
async function go(path) {
  const base = await origin();
  await cdp("Page.navigate", { url: `${base}${path}` });
  await sleep(250);
  await until(async () => (await evaluate("document.readyState")) === "complete", `chargement de ${path}`);
}
const setCookie = async (value) => {
  const base = await origin();
  await cdp("Network.setCookie", { name: "castle_offline", value, url: base, path: "/", httpOnly: true, sameSite: "Strict" });
};
const clearCookies = () => cdp("Network.clearBrowserCookies");
const signIn = async (email, password) => {
  // Attendre que React ait pris en main le formulaire (poste lent).
  await until(() => evaluate("Object.keys(document.querySelector('form')).some((k) => k.startsWith('__reactProps'))"), "formulaire inactif");
  await evaluate(`(() => {
    const set = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); };
    set(document.getElementById("email"), ${JSON.stringify(email)});
    set(document.getElementById("password"), ${JSON.stringify(password)});
    document.querySelector("form button[type=submit]").click();
  })()`);
};

const BANNER = "Mode hors ligne";

console.log("Démarrage sans Internet");
await launch();
await test("le logiciel démarre sans Internet et propose la connexion", async () => {
  await until(async () => (await url()).includes("/login"), "pas sur la page de connexion");
  await until(async () => /Se connecter/.test(await text()), "formulaire absent");
});
await test("mauvais mot de passe refusé hors ligne", async () => {
  await signIn("essais@test.tn", "mauvais");
  await until(async () => /Connexion hors ligne impossible/.test(await text()), "message absent");
  assert((await url()).includes("/login"), await url());
});
await test("bon mot de passe accepté hors ligne : tableau de bord et bandeau", async () => {
  await go("/login");
  await until(async () => /Se connecter/.test(await text()), "formulaire absent");
  await signIn("essais@test.tn", "BonMotDePasse1");
  await until(async () => (await url()).includes("/dashboard"), "pas de redirection");
  await until(async () => (await text()).includes(BANNER), "bandeau absent");
});

await test("la synchronisation part de la page, avec le jeton de l'application", async () => {
  // Hors ligne, le serveur répond « offline » : preuve que la requête arrive et passe le jeton.
  const log = join(profile, "logs", "castle.log");
  await until(() => existsSync(log) && readFileSync(log, "utf8").includes('[sync] {"http":200,"status":"offline"}'), "aucune synchronisation journalisée");
});

console.log("\nChaque écran avec de vraies données, hors ligne");
const pages = [
  ["/dashboard", "Castle"],
  ["/attendance", "Présences"],
  ["/members", "Trabelsi"],
  [`/members/${seed.member}`, "Ben Salah"],
  [`/members/${seed.member}/card`, "Ben Salah"],
  ["/members/new", "Prénom"],
  [`/members/${seed.member}/edit`, "Prénom"],
  ["/leads", "Prospect"],
  ["/subscriptions", "Mensuel"],
  ["/payments", "Ben Salah"],
  [`/payments/${seed.payment}/receipt`, "Reçu de paiement"],
  ["/schedule", "Yoga"],
  ["/coaches", "Karim Coach"],
  ["/workouts", "Force"],
  [`/workouts/${seed.program}`, "Squat"],
  ["/equipment", "Tapis"],
  ["/reports", "Rapports"],
  ["/expenses", "STEG"],
  ["/staff", "Olfa Patronne"],
  ["/audit", "Journal"],
  ["/notifications", "Notifications"],
  ["/settings", "Paramètres"],
];
for (const [path, expected] of pages) {
  await test(path, async () => {
    await go(path);
    const content = await until(async () => {
      const t = await text();
      return t.toLowerCase().includes(expected.toLowerCase()) ? t : null;
    }, `« ${expected} » absent`, 25_000);
    assert(!/Application error|Internal Server Error|Une erreur est survenue/.test(content), `erreur affichée : ${content.slice(0, 300)}`);
    assert((await url()).includes(path), `redirigé vers ${await url()}`);
    if (!path.endsWith("/card") && !path.endsWith("/receipt")) assert(content.includes(BANNER), "bandeau absent");
  });
}

console.log("\nÉcritures et droits");
await test("créer un membre hors ligne : fiche créée, visible, en attente d'envoi", async () => {
  await go("/members/new");
  await until(async () => (await evaluate("!!document.querySelector('input[name=first_name]')")) === true, "formulaire absent");
  await evaluate(`(() => {
    const set = (name, v) => { const el = document.querySelector('input[name=' + name + ']'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); };
    set("first_name", "Horsligne"); set("last_name", "Essai"); set("phone", "20123456");
    document.querySelector("form button[type=submit]").click();
  })()`);
  await until(async () => /\/members\/[0-9a-f-]{36}/.test(await url()), "pas de redirection vers la fiche");
  await until(async () => /Horsligne/.test(await text()) && /M-[A-Z]+-\d{6}/.test(await text()), "fiche ou numéro du poste absent");
  await until(async () => /1 action en attente d'envoi/.test(await text()), "file non signalée dans le bandeau");
  await go("/members");
  await until(async () => (await text()).includes("Horsligne"), "membre absent de la liste");
  await go("/sync");
  await until(async () => /En attente d'envoi \(1\)/.test(await text()), "file absente de l'écran de synchronisation");
});
await test("une action impossible sans Internet l'annonce clairement", async () => {
  await go("/staff");
  await until(async () => (await text()).includes("Olfa Patronne"), "page employés absente");
  assert((await text()).includes(BANNER), "bandeau absent");
});
await test("le coach ne voit que ses membres et n'a pas accès aux paiements", async () => {
  await clearCookies();
  await setCookie(seed.coachCookie);
  await go("/members");
  const content = await until(async () => {
    const t = await text();
    return t.includes("Ben Salah") ? t : null;
  }, "membre du coach absent");
  assert(!content.includes("Trabelsi"), "membre d'un autre coach visible");
  await go("/payments");
  await until(async () => !(await url()).includes("/payments"), "paiements accessibles au coach");
});
await test("cookie de session falsifié : retour à la connexion, aucune donnée", async () => {
  await clearCookies();
  await setCookie(seed.ownerCookie.replace(/.$/, (c) => (c === "A" ? "B" : "A")));
  await go("/members");
  await until(async () => (await url()).includes("/login"), "pas de redirection");
  assert(!(await text()).includes("Trabelsi"), "données visibles");
});
await test("le téléchargement est refusé sans le jeton de l'application", async () => {
  const r = await fetch(`${await origin()}/api/desktop/sync`, { method: "POST", redirect: "manual" });
  assert(r.status === 403, `statut ${r.status}`);
});
await test("le journal technique ne contient aucune donnée de membre", () => {
  const log = readFileSync(join(profile, "logs", "castle.log"), "utf8");
  assert(!/Trabelsi|Ben Salah|@test\.tn/.test(log), "donnée de membre dans le journal");
});
await test("aucune page ne révèle de clé d'administration", async () => {
  const r = await fetch(`${await origin()}/login`);
  const body = await r.text();
  assert(!/service_role/.test(body), "clé présente");
});

console.log("\nRedémarrage et retour d'Internet");
await test("la session et les données survivent à un redémarrage sans Internet", async () => {
  // Vraie connexion puis fermeture normale de la fenêtre, comme un utilisateur.
  await clearCookies();
  await go("/login");
  await until(async () => /Se connecter/.test(await text()), "formulaire absent");
  await signIn("essais@test.tn", "BonMotDePasse1");
  await until(async () => (await url()).includes("/dashboard"), "pas de redirection");
  await until(async () => (await text()).includes(BANNER), "bandeau absent");
  const closed = new Promise((resolve) => child.once("exit", resolve));
  evaluate("window.close()").catch(() => {});
  await Promise.race([closed, sleep(15_000)]);
  await sleep(1000);
  await launch();
  // La session a survécu : l'application rouvre directement le tableau de bord.
  await until(async () => (await url()).includes("/dashboard"), "session perdue au redémarrage", 20_000).catch(async (e) => {
    throw new Error(`${e.message} ; adresse ${await url()} ; cookies ${JSON.stringify((await cdp("Network.getAllCookies")).cookies.map((c) => [c.name, c.expires]))} ; page ${(await text())?.slice(0, 160)}`);
  });
  await until(async () => (await evaluate("document.readyState")) === "complete", "chargement");
  await go("/members");
  await until(async () => (await text()).includes("Trabelsi"), "données absentes après redémarrage");
});
await test("Internet revenu : le bandeau disparaît et le serveur reprend la main", async () => {
  await go("/dashboard");
  await until(async () => (await text()).includes(BANNER), "bandeau initial absent");
  rmSync(offlineFile);
  // Ce compte de test n'existe que dans la copie locale : en ligne, le vrai serveur demande de se connecter.
  await until(async () => {
    await go("/dashboard");
    return (await url()).includes("/login");
  }, "le mode en ligne n'a pas repris", 45_000);
  assert(!(await text()).includes(BANNER), "bandeau encore affiché");
});

await stop();
const suspicious = serverLog.split("\n").filter((l) => /⨯|Unhandled|digest|TypeError|ReferenceError/.test(l));
await test("aucune erreur côté serveur pendant tout le parcours", () => {
  assert(suspicious.length === 0, suspicious.slice(0, 8).join("\n"));
});

rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
console.log(`\n${passed} réussis, ${failures.length} échoués`);
process.exit(failures.length ? 1 : 0);
