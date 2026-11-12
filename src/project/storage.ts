import type { ProjectDoc } from './format';

/**
 * Autosave store in IndexedDB (stays on this computer, in this browser).
 *   meta  : 'current' → ProjectDoc
 *   blobs : ref → Blob   (media bytes, written once per ref)
 */
// Database name predates the AirFx rename; kept so existing autosaves are found.
const DB = 'airffect';
const VERSION = 1;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB unavailable'));
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Could not open storage'));
  });
}

let dbp: Promise<IDBDatabase> | null = null;
const db = () => (dbp ??= open());

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Storage write failed'));
    tx.onabort = () => reject(tx.error ?? new Error('Storage write aborted (storage may be full)'));
  });
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export async function loadAutosave(): Promise<ProjectDoc | null> {
  try {
    const d = await db();
    return ((await req(d.transaction('meta').objectStore('meta').get('current'))) as ProjectDoc | undefined) ?? null;
  } catch {
    return null;
  }
}

export async function getBlob(ref: string): Promise<Blob | null> {
  const d = await db();
  return ((await req(d.transaction('blobs').objectStore('blobs').get(ref))) as Blob | undefined) ?? null;
}

export async function storedBlobRefs(): Promise<Set<string>> {
  const d = await db();
  return new Set((await req(d.transaction('blobs').objectStore('blobs').getAllKeys())) as string[]);
}

/**
 * Write the document plus any blobs not stored yet, then drop blobs the
 * document no longer references.
 */
export async function writeAutosave(doc: ProjectDoc, getBlobFor: (ref: string) => Promise<Blob | null>, refs: string[]) {
  const d = await db();
  const have = await storedBlobRefs();
  const missing = refs.filter((r) => !have.has(r));
  // Fetch blobs before opening the write transaction (transactions can't span awaits).
  const fresh: [string, Blob][] = [];
  for (const r of missing) {
    const b = await getBlobFor(r);
    if (b) fresh.push([r, b]);
  }
  const tx = d.transaction(['meta', 'blobs'], 'readwrite');
  const blobs = tx.objectStore('blobs');
  for (const [r, b] of fresh) blobs.put(b, r);
  const keep = new Set(refs);
  for (const r of have) if (!keep.has(r)) blobs.delete(r);
  tx.objectStore('meta').put(doc, 'current');
  await done(tx);
}

export async function clearAutosave() {
  try {
    const d = await db();
    const tx = d.transaction(['meta', 'blobs'], 'readwrite');
    tx.objectStore('meta').clear();
    tx.objectStore('blobs').clear();
    await done(tx);
  } catch {
    /* nothing to clear */
  }
}
