// Registre des modules + exécution uniforme (fetch -> compute -> render).
// Ajouter un module = l'enregistrer ici, rien d'autre à toucher.
import type { DiagnosticModule, ExportBlock, SiteContext } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyModule = DiagnosticModule<any, any>;

const modules: AnyModule[] = [];

/** Résultats calculés du dernier run, pour l'export. */
const lastResults = new Map<string, { result: unknown; module: AnyModule }>();

export function registerModule(mod: AnyModule): void {
  if (modules.some((m) => m.id === mod.id)) {
    throw new Error(`Module déjà enregistré : ${mod.id}`);
  }
  modules.push(mod);
}

export function getModules(): readonly AnyModule[] {
  return modules;
}

/**
 * Exécute un module : rend un état visuel via les callbacks, stocke le
 * résultat pour l'export. Les erreurs sont capturées, jamais propagées à l'UI
 * globale (un module qui échoue ne casse pas les autres).
 */
export async function runModule(
  mod: AnyModule,
  el: HTMLElement,
  ctx: SiteContext,
  hooks: {
    onLoading: () => void;
    onError: (message: string) => void;
  },
): Promise<void> {
  hooks.onLoading();
  try {
    const raw = await mod.fetchData(ctx);
    const result = mod.compute(raw, ctx);
    lastResults.set(mod.id, { result, module: mod });
    await mod.render(el, result, ctx);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    hooks.onError(msg);
  }
}

/** Assemble les blocs d'export de tous les modules ayant produit un résultat. */
export function collectExportBlocks(ctx: SiteContext): ExportBlock[] {
  const blocks: ExportBlock[] = [];
  for (const { result, module } of lastResults.values()) {
    try {
      blocks.push(module.toExport(result, ctx));
    } catch {
      /* un module d'export cassé ne bloque pas le rapport */
    }
  }
  return blocks;
}

/** Accès typé au résultat d'un module (pour la synthèse des enjeux, qui
 * consomme les résultats des autres modules sans refetcher). `undefined` si
 * le module n'a pas tourné ou a échoué — la synthèse doit le gérer. */
export function getResult<T = unknown>(id: string): T | undefined {
  return lastResults.get(id)?.result as T | undefined;
}

export function clearResults(): void {
  lastResults.clear();
}
