/**
 * Copie le CRM autonome dans le logiciel. electron-builder écarte tout dossier
 * node_modules de ses ressources, sans erreur : le serveur ne démarrerait pas.
 */
const { cpSync, existsSync, rmSync } = require("node:fs");
const path = require("node:path");

exports.default = async function afterPack({ appOutDir }) {
  const source = path.join(__dirname, "server");
  const target = path.join(appOutDir, "resources", "server");
  rmSync(target, { recursive: true, force: true });
  cpSync(source, target, { recursive: true });
  for (const required of ["server.js", path.join("node_modules", "next", "package.json"), path.join(".next-desktop", "BUILD_ID")]) {
    if (!existsSync(path.join(target, required))) throw new Error(`Serveur incomplet : ${required} manquant`);
  }
};
