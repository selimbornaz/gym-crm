/**
 * Démarre le CRM local en réutilisant le code déjà compilé lors des lancements
 * précédents. Le cache est enregistré peu après le démarrage : le serveur est
 * arrêté brutalement à la fermeture du logiciel, sans étape de sortie.
 */
const module_ = require("node:module");
const path = require("node:path");

const cache = process.env.CASTLE_COMPILE_CACHE;
if (cache) {
  module_.enableCompileCache(cache);
  setTimeout(() => module_.flushCompileCache(), 12_000).unref();
}
require(path.join(process.env.CASTLE_SERVER_DIR, "server.js"));
