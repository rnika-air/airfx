import { presets, type Preset } from '../presets/store';
import { cloud } from './client';
import { account } from './account';

/**
 * Keeps the editor's presets in the signed-in account. On sign-in, presets
 * from the account and from this browser are merged both ways. After that,
 * every add, rename or removal is sent to the account. Signed out, presets
 * stay in this browser as before.
 */
let synced = new Map<string, string>();  // preset id → JSON last known in the cloud
let userId: string | null = null;
let pushing = false;
let again = false;
export let presetSyncError: string | null = null;

async function pullAndMerge(uid: string) {
  if (!cloud) return;
  const { data, error } = await cloud.from('presets').select('local_id,data');
  if (error) { presetSyncError = error.message; return; }
  synced = new Map((data ?? []).map((r) => [r.local_id as string, JSON.stringify(r.data)]));
  if (userId !== uid) return;
  presets.mergeKeepingIds((data ?? []).map((r) => r.data as Preset));
  await push();
}

async function push() {
  if (!cloud || !userId) return;
  if (pushing) { again = true; return; }
  pushing = true;
  try {
    do {
      again = false;
      const now = new Map(presets.all().map((p) => [p.id, JSON.stringify(p)]));
      const upserts = [...now].filter(([id, json]) => synced.get(id) !== json).map(([id, json]) => ({ local_id: id, data: JSON.parse(json) as Preset, updated_at: new Date().toISOString() }));
      const removed = [...synced.keys()].filter((id) => !now.has(id));
      if (upserts.length) {
        const { error } = await cloud.from('presets').upsert(upserts, { onConflict: 'owner,local_id' });
        if (error) { presetSyncError = error.message; break; }
        for (const u of upserts) synced.set(u.local_id, JSON.stringify(u.data));
      }
      if (removed.length) {
        const { error } = await cloud.from('presets').delete().in('local_id', removed);
        if (error) { presetSyncError = error.message; break; }
        for (const id of removed) synced.delete(id);
      }
      presetSyncError = null;
    } while (again);
  } finally { pushing = false; }
}

if (cloud) {
  account.subscribe(() => {
    const id = account.get().user?.id ?? null;
    if (id === userId) return;
    userId = id;
    synced = new Map();
    if (id) pullAndMerge(id);
  });
  let timer = 0;
  presets.subscribe(() => {
    if (!userId) return;
    clearTimeout(timer);
    timer = window.setTimeout(push, 800);
  });
}
