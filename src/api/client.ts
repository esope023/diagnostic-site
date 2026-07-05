// ---------------------------------------------------------------------------
// Couche d'accès aux API, centralisée.
//   - cache (IndexedDB) transparent, clé stable
//   - retry avec backoff
//   - timeout
//   - normalisation des erreurs (ApiError)
// TOUT appel réseau des modules passe par ici.
// ---------------------------------------------------------------------------

import { cacheGet, cacheSet } from "./cache";

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
  let lastErr: unknown;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const data = await once<T>(url, timeoutMs);
      await cacheSet(key, data, ttl);
      return data;
    } catch (err) {
      lastErr = err;
      // On ne retente pas les erreurs client 4xx (sauf 429).
      if (err instanceof ApiError && err.status && err.status < 500 && err.status !== 429) {
        break;
      }
      if (attempt < retries) await sleep(500 * attempt);
    }
  }
  throw lastErr instanceof ApiError
    ? lastErr
    : new ApiError("Échec après plusieurs tentatives", undefined, url);
}

/** Arrondit les coordonnées pour stabiliser les clés de cache (~110 m). */
export function roundCoord(v: number, decimals = 3): number {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}
