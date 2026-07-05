// ---------------------------------------------------------------------------
// Cache persistant (IndexedDB) pour éviter de re-télécharger les mêmes données.
// Clé = dataset + coordonnées arrondies + params (voir client.ts).
// Les entrées expirent après `ttlMs`.
// ---------------------------------------------------------------------------

const DB_NAME = "diagnostic-site-cache";
const STORE = "responses";
const DB_VERSION = 1;

interface CacheEntry<T = unknown> {
  key: string;
  value: T;
  expiresAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const db = await openDb();
    return await new Promise<T | null>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => {
        const entry = req.result as CacheEntry<T> | undefined;
        if (!entry) return resolve(null);
        if (entry.expiresAt < Date.now()) return resolve(null);
        resolve(entry.value);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    // IndexedDB indisponible (mode privé, etc.) : on dégrade sans cache.
    return null;
  }
}

export async function cacheSet<T>(key: string, value: T, ttlMs: number): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const entry: CacheEntry<T> = { key, value, expiresAt: Date.now() + ttlMs };
      tx.objectStore(STORE).put(entry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* pas de cache, tant pis */
  }
}
