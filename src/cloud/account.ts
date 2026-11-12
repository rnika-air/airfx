import { useSyncExternalStore } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { cloud, explain } from './client';

/**
 * The signed-in account: session, profile and plan usage, as a small store
 * the interface subscribes to. All calls go through row-level security, so
 * this code can only ever read or change the signed-in user's own data.
 */

export interface Plan { id: string; name: string; storage_mb: number; max_upload_mb: number; max_projects: number; max_export_edge: number; cloud_presets: number }
export interface Profile { id: string; display_name: string; plan: string; settings: Record<string, unknown>; created_at: string }
export interface Usage { plan: Plan; storage_bytes: number; projects: number; presets: number; media: number }

interface State {
  ready: boolean;
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  usage: Usage | null;
  /** Set after following a password reset link: the app asks for a new password. */
  recovering: boolean;
}

let state: State = { ready: !cloud, session: null, user: null, profile: null, usage: null, recovering: false };
let version = 0;
const listeners = new Set<() => void>();
const set = (patch: Partial<State>) => { state = { ...state, ...patch }; version++; listeners.forEach((f) => f()); };

async function loadProfile() {
  if (!cloud || !state.user) return set({ profile: null, usage: null });
  const [p, u] = await Promise.all([
    cloud.from('profiles').select('*').eq('id', state.user.id).maybeSingle(),
    cloud.rpc('my_usage'),
  ]);
  set({ profile: (p.data as Profile) ?? null, usage: (u.data as Usage) ?? null });
}

if (cloud) {
  cloud.auth.getSession().then(({ data }) => {
    set({ ready: true, session: data.session, user: data.session?.user ?? null });
    if (data.session) loadProfile();
  });
  cloud.auth.onAuthStateChange((event, session) => {
    set({ session, user: session?.user ?? null, ...(event === 'PASSWORD_RECOVERY' ? { recovering: true } : {}) });
    if (event === 'SIGNED_IN' || event === 'USER_UPDATED' || event === 'TOKEN_REFRESHED') loadProfile();
    if (event === 'SIGNED_OUT') set({ profile: null, usage: null, recovering: false });
  });
}

const need = () => { if (!cloud) throw new Error('Accounts are not set up on this AirFx server.'); return cloud; };
// Supabase answers { data, error }: throw the error in plain words, or return the data.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = async <R extends { error: unknown }>(p: PromiseLike<R>): Promise<any> => { const r = await p; if (r.error) throw new Error(explain(r.error)); return (r as unknown as { data: unknown }).data; };
/** Where links in account emails return to: this site. */
const here = () => `${location.origin}${location.pathname}`;

export const account = {
  subscribe: (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; },
  get: () => state,
  refresh: loadProfile,

  async signUp(email: string, password: string, displayName: string) {
    if (password.length < 8) throw new Error('Use a password of at least 8 characters.');
    const data = await run(need().auth.signUp({ email, password, options: { data: { display_name: displayName.trim().slice(0, 80) }, emailRedirectTo: here() } }));
    // With email confirmation on, there is no session until the link is opened.
    return { needsConfirmation: !data.session };
  },
  async signIn(email: string, password: string) { await run(need().auth.signInWithPassword({ email, password })); },
  async signOut() { await need().auth.signOut(); },
  async sendReset(email: string) { await run(need().auth.resetPasswordForEmail(email, { redirectTo: here() })); },
  async setPassword(password: string) {
    if (password.length < 8) throw new Error('Use a password of at least 8 characters.');
    await run(need().auth.updateUser({ password }));
    set({ recovering: false });
  },
  async changeEmail(email: string) { await run(need().auth.updateUser({ email }, { emailRedirectTo: here() })); },
  async updateProfile(patch: { display_name?: string; settings?: Record<string, unknown> }) {
    if (!state.user) throw new Error('Log in first.');
    await run(need().from('profiles').update(patch).eq('id', state.user.id));
    await loadProfile();
  },
  /** Deletes every file, then the account (which removes all rows with it). */
  async deleteAccount() {
    const c = need(), uid = state.user?.id;
    if (!uid) throw new Error('Log in first.');
    for (const bucket of ['projects', 'media', 'thumbnails']) {
      for (;;) {
        const list = (await run(c.storage.from(bucket).list(uid, { limit: 100 }))) as { name: string }[] | null;
        if (!list?.length) break;
        await run(c.storage.from(bucket).remove(list.map((f) => `${uid}/${f.name}`)));
        if (list.length < 100) break;
      }
    }
    await run(c.rpc('delete_my_account'));
    await c.auth.signOut();
  },
  endRecovery() { set({ recovering: false }); },
};

export function useAccount() {
  useSyncExternalStore(account.subscribe, () => version);
  return state;
}

/** The current plan's limits, or Free's when signed out. */
export function limits(): Plan {
  return state.usage?.plan ?? { id: 'free', name: 'Free', storage_mb: 1024, max_upload_mb: 50, max_projects: 20, max_export_edge: 3840, cloud_presets: 100 };
}
