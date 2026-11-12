// Fusionne les fichiers produits par les passages parallèles du calcul :
// pour chaque ville, on garde l'état le plus avancé.
// Usage : npx tsx scripts/climat-reference/fusion.ts <sortie.json> <entrée.json>...
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import type { FichierReference, VilleCalculee } from "./calcul";
import { VILLES } from "./villes";

const avancement = (v?: VilleCalculee) =>
  !v ? 0 : v.h2050 ? 100 : (v.actuel ? 10 : 0) + Object.keys(v.modeles ?? {}).length;

const [sortie, ...entrees] = process.argv.slice(2);
const fichiers = entrees
  .filter((f) => existsSync(f))
  .map((f) => JSON.parse(readFileSync(f, "utf8") || "{}") as Partial<FichierReference>);
const villes = VILLES.map((ref) => {
  let best: VilleCalculee | undefined;
  for (const f of fichiers) {
    const v = f.villes?.find((x) => x.nom === ref.nom);
    if (avancement(v) > avancement(best)) best = v;
  }
  return { ...best, ...ref };
});
const base = fichiers.find((f) => f.methode) ?? {};
writeFileSync(sortie, JSON.stringify({ ...base, version: 1, majLe: new Date().toISOString(), villes }, null, 1));
const faites = villes.filter((v) => v.actuel && (v.pays !== "FR" || v.h2050)).length;
console.log(`Fusion : ${faites}/${villes.length} villes complètes.`);
