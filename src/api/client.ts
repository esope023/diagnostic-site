// ---------------------------------------------------------------------------
// Couche d'accès aux API, centralisée.
//   - cache (IndexedDB) transparent, clé stable
//   - retry avec backoff
//   - timeout
//   - normalisation des erreurs (ApiError)
// TOUT appel réseau des modules passe par ici.
// ---------------------------------------------------------------------------

import { cacheGet, cacheSet } from "./cache";
import { OVERPASS, OVERPASS_MIRRORS } from "./endpoints";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly url?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface FetchJsonOptions {
  /** Sous-clé pour rendre la clé de cache lisible/unique (ex. "open-meteo:normales"). */
  cacheKey: string;
  /** Durée de vie du cache. Défaut : 30 jours (données ~stables). */
  ttlMs?: number;
  /** Nombre de tentatives (défaut 3). */
  retries?: number;
  /** Timeout par tentative en ms (défaut 20 s). */
  timeoutMs?: number;
  /** Forcer le rechargement en ignorant le cache. */
  bypassCache?: boolean;
}

const DEFAULT_TTL = 30 * 24 * 60 * 60 * 1000; // 30 jours

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function once<T>(url: string, timeoutMs: number): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) {
      throw new ApiError(`HTTP ${res.status} sur ${url}`, res.status, url);
    }
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new ApiError(`Échec réseau : ${msg}`, undefined, url);
  } finally {
    clearTimeout(timer);
  }
}

/** GET JSON avec cache + retry. Le point d'entrée unique pour les modules. */
export async function fetchJson<T>(url: string, opts: FetchJsonOptions): Promise<T> {
  const key = `${opts.cacheKey}|${url}`;
  const ttl = opts.ttlMs ?? DEFAULT_TTL;

  if (!opts.bypassCache) {
    const cached = await cacheGet<T>(key);
    if (cached !== null) return cached;
  }

  const retries = opts.retries ?? 3;
  const timeoutMs = opts.timeoutMs ?? 20_000;

  // Overpass : une requête à la fois (le serveur public n'accorde que deux
  // créneaux par adresse IP et répond 429 au-delà), puis repli sur des miroirs.
  if (url.startsWith(OVERPASS)) {
    return overpassQueue(async () => {
      const candidates = [url, ...OVERPASS_MIRRORS.map((m) => m + url.slice(OVERPASS.length))];
      let lastErr: unknown;
      for (const candidate of candidates) {
        try {
          // 2 essais par serveur au plus : mieux vaut changer de serveur que d'insister.
          const data = await withRetries<T>(candidate, Math.min(retries, 2), timeoutMs);
          await cacheSet(key, data, ttl);
          return data;
        } catch (err) {
          lastErr = err;
        }
      }
      throw toApiError(lastErr, url);
    });
  }

  const data = await withRetries<T>(url, retries, timeoutMs);
  await cacheSet(key, data, ttl);
  return data;
}

async function withRetries<T>(url: string, retries: number, timeoutMs: number): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await once<T>(url, timeoutMs);
    } catch (err) {
      lastErr = err;
      // On ne retente pas les erreurs client 4xx (sauf 429).
      if (err instanceof ApiError && err.status && err.status < 500 && err.status !== 429) {
        break;
      }
      // 429 = serveur saturé : on patiente davantage avant de retenter.
      const is429 = err instanceof ApiError && err.status === 429;
      if (attempt < retries) await sleep((is429 ? 2000 : 500) * attempt);
    }
  }
  throw toApiError(lastErr, url);
}

function toApiError(err: unknown, url: string): ApiError {
  return err instanceof ApiError
    ? err
    : new ApiError("Échec après plusieurs tentatives", undefined, url);
}

/** File d'attente à un seul créneau pour les requêtes Overpass. */
let overpassTail: Promise<unknown> = Promise.resolve();
function overpassQueue<T>(task: () => Promise<T>): Promise<T> {
  const run = overpassTail.then(task, task);
  overpassTail = run.catch(() => undefined);
  return run;
}

/** Arrondit les coordonnées pour stabiliser les clés de cache (~110 m). */
export function roundCoord(v: number, decimals = 3): number {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}
