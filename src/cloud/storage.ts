import { cloud, explain, APP_VERSION } from './client';
import { account, limits } from './account';

/**
 * Cloud projects and the media library. A project is the same .airfx file the
 * editor saves locally (edit stack, settings and media), kept in a private
 * bucket under the user's own folder; a database row holds its name and size.
 */

export interface CloudProject { id: string; name: string; size_bytes: number; updated_at: string; created_at: string; thumb_path: string | null; file_path: string }
export interface MediaItem { id: string; name: string; mime: string; size_bytes: number; created_at: string; file_path: string }

const need = () => { if (!cloud) throw new Error('Accounts are not set up on this AirFx server.'); return cloud; };
const uid = () => { const id = account.get().user?.id; if (!id) throw new Error('Log in to use your cloud projects.'); return id; };
const check = <T>(r: { data: T; error: unknown }) => { if (r.error) throw new Error(explain(r.error)); return r.data; };

/** Refuses files over the plan's per-file limit or remaining storage, before uploading. */
function checkSize(bytes: number, replacing = 0) {
  const plan = limits(), used = account.get().usage?.storage_bytes ?? 0;
  if (bytes > plan.max_upload_mb * 1048576) throw new Error(`This file is ${(bytes / 1048576).toFixed(0)} MB. Your ${plan.name} plan allows files up to ${plan.max_upload_mb} MB.`);
  if (used - replacing + bytes > plan.storage_mb * 1048576) throw new Error(`Not enough cloud storage: ${(used / 1048576).toFixed(0)} of ${plan.storage_mb} MB used.`);
}

export const cloudProjects = {
  async list(): Promise<CloudProject[]> {
    return check(await need().from('projects').select('*').order('updated_at', { ascending: false })) as CloudProject[];
  },

  /** Saves a new project, or replaces `id` if given. Returns its id. */
  async save(file: Blob, name: string, thumb: Blob | null, id?: string): Promise<string> {
    const c = need(), owner = uid();
    let existing: CloudProject | null = null;
    if (id) existing = check(await c.from('projects').select('*').eq('id', id).maybeSingle()) as CloudProject | null;
    checkSize(file.size, existing?.size_bytes ?? 0);
    const pid = existing?.id ?? crypto.randomUUID();
    const filePath = `${owner}/${pid}.airfx`, thumbPath = thumb ? `${owner}/${pid}.jpg` : null;
    check(await c.storage.from('projects').upload(filePath, file, { upsert: true, contentType: 'application/x-airfx' }));
    if (thumb && thumbPath) await c.storage.from('thumbnails').upload(thumbPath, thumb, { upsert: true, contentType: 'image/jpeg' });
    const row = { name: name.trim().slice(0, 120) || 'Untitled', file_path: filePath, thumb_path: thumbPath, size_bytes: file.size, app_version: APP_VERSION };
    if (existing) check(await c.from('projects').update(row).eq('id', pid));
    else {
      const r = await c.from('projects').insert({ id: pid, ...row });
      if (r.error) { await c.storage.from('projects').remove([filePath]); throw new Error(explain(r.error)); }
    }
    account.refresh();
    return pid;
  },

  async open(p: CloudProject): Promise<Blob> {
    return check(await need().storage.from('projects').download(p.file_path)) as Blob;
  },

  async rename(id: string, name: string) {
    check(await need().from('projects').update({ name: name.trim().slice(0, 120) || 'Untitled' }).eq('id', id));
  },

  async remove(p: CloudProject) {
    const c = need();
    check(await c.from('projects').delete().eq('id', p.id));
    await c.storage.from('projects').remove([p.file_path]);
    if (p.thumb_path) await c.storage.from('thumbnails').remove([p.thumb_path]);
    account.refresh();
  },

  /** Short-lived private links for the thumbnails in a list. */
  async thumbs(list: CloudProject[]): Promise<Record<string, string>> {
    const paths = list.map((p) => p.thumb_path).filter(Boolean) as string[];
    if (!paths.length) return {};
    const r = await need().storage.from('thumbnails').createSignedUrls(paths, 3600);
    const out: Record<string, string> = {};
    for (const s of r.data ?? []) if (s.signedUrl && s.path) out[s.path] = s.signedUrl;
    return out;
  },
};

export const mediaLibrary = {
  async list(): Promise<MediaItem[]> {
    return check(await need().from('media').select('*').order('created_at', { ascending: false })) as MediaItem[];
  },
  async upload(file: File): Promise<MediaItem> {
    const c = need(), owner = uid();
    checkSize(file.size);
    const id = crypto.randomUUID(), ext = (file.name.match(/\.[\w]+$/)?.[0] ?? '').toLowerCase(), path = `${owner}/${id}${ext}`;
    check(await c.storage.from('media').upload(path, file, { contentType: file.type || 'application/octet-stream' }));
    const r = await c.from('media').insert({ id, name: file.name.slice(0, 200), mime: file.type || 'application/octet-stream', file_path: path, size_bytes: file.size }).select().single();
    if (r.error) { await c.storage.from('media').remove([path]); throw new Error(explain(r.error)); }
    account.refresh();
    return r.data as MediaItem;
  },
  async download(m: MediaItem): Promise<File> {
    const b = check(await need().storage.from('media').download(m.file_path)) as Blob;
    return new File([b], m.name, { type: m.mime || b.type });
  },
  async remove(m: MediaItem) {
    const c = need();
    check(await c.from('media').delete().eq('id', m.id));
    await c.storage.from('media').remove([m.file_path]);
    account.refresh();
  },
};
