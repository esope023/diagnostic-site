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

async function once<T>(url: string, timeoutMs: number, outer?: AbortSignal): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const onOuterAbort = () => ctrl.abort();
  outer?.addEventListener("abort", onOuterAbort);
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
    outer?.removeEventListener("abort", onOuterAbort);
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

  // Overpass : serveurs publics lents et saturés (36 s pour une petite requête
  // sur overpass-api.de le 11/11/2026). On interroge en parallèle le serveur
  // principal et le miroir, on garde la première réponse valide et on annule
  // l'autre. Deux requêtes Overpass au plus en même temps.
  if (url.startsWith(OVERPASS)) {
    const query = url.slice(OVERPASS.length);
    const data = await overpassLimit(() => raceOverpass<T>(query));
    await cacheSet(key, data, ttl);
    return data;
  }

  const data = /^https:\/\/[a-z-]+\.open-meteo\.com\//.test(url)
    ? await openMeteoLimit(() => withRetries<T>(url, Math.max(retries, 3), timeoutMs, 10_000))
    : await withRetries<T>(url, retries, timeoutMs);
  await cacheSet(key, data, ttl);
  return data;
}

/** `backoff429Ms` : attente de base après un refus « trop de requêtes ». */
async function withRetries<T>(
  url: string,
  retries: number,
  timeoutMs: number,
  backoff429Ms = 3000,
): Promise<T> {
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
      if (attempt < retries) await sleep((is429 ? backoff429Ms : 500) * attempt);
    }
  }
  throw toApiError(lastErr, url);
}

function toApiError(err: unknown, url: string): ApiError {
  return err instanceof ApiError
    ? err
    : new ApiError("Échec après plusieurs tentatives", undefined, url);
}

// --- Overpass -----------------------------------------------------------------
const OVERPASS_TIMEOUT_MS = 60_000;
/** Un serveur qui vient d'échouer est mis de côté quelques minutes. */
const OVERPASS_COOLDOWN_MS = 2 * 60_000;
const OVERPASS_SECOND_ROUND_DELAY_MS = 5_000;
const overpassDownUntil = new Map<string, number>();

async function raceOverpass<T>(query: string): Promise<T> {
  // Deux tours : une saturation passagère (429/504) se résorbe souvent en
  // quelques secondes. Au second tour, tous les serveurs sont retentés.
  try {
    return await raceOverpassOnce<T>(query, false);
  } catch {
    await sleep(OVERPASS_SECOND_ROUND_DELAY_MS);
    return raceOverpassOnce<T>(query, true);
  }
}

async function raceOverpassOnce<T>(query: string, ignoreCooldown: boolean): Promise<T> {
  const all = [OVERPASS, ...OVERPASS_MIRRORS];
  const now = Date.now();
  let servers = ignoreCooldown ? all : all.filter((s) => (overpassDownUntil.get(s) ?? 0) <= now);
  if (servers.length === 0) servers = all;

  const ctrl = new AbortController();
  try {
    return await Promise.any(
      servers.map(async (server) => {
        try {
          return await once<T>(server + query, OVERPASS_TIMEOUT_MS, ctrl.signal);
        } catch (err) {
          // 429 = simplement occupé : on ne met pas le serveur de côté.
          const busy = err instanceof ApiError && err.status === 429;
          if (!ctrl.signal.aborted && !busy) {
            overpassDownUntil.set(server, Date.now() + OVERPASS_COOLDOWN_MS);
          }
          throw err;
        }
      }),
    );
  } catch (err) {
    const first = err instanceof AggregateError ? err.errors[0] : err;
    throw toApiError(first, OVERPASS + query);
  } finally {
    ctrl.abort(); // annule la requête perdante
  }
}

/** Limiteur de requêtes simultanées (le créneau est transmis à la suivante). */
function createLimiter(max: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async function limit<T>(task: () => Promise<T>): Promise<T> {
    if (active >= max) await new Promise<void>((resolve) => waiting.push(resolve));
    else active++;
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
}

/** Deux requêtes Overpass au plus en même temps (limite du serveur public). */
const overpassLimit = createLimiter(2);
/** Open-Meteo pondère les requêtes longues (10 à 30 ans de données) et répond
 * 429 quand Climat, Vent et Eau l'appellent ensemble : une requête à la fois. */
const openMeteoLimit = createLimiter(1);

/** Arrondit les coordonnées pour stabiliser les clés de cache (~110 m). */
export function roundCoord(v: number, decimals = 3): number {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}
