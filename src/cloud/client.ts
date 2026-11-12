import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * The AirFx backend (Supabase: accounts, database, private file storage).
 *
 * Configured at build time with two public values:
 *   VITE_SUPABASE_URL       the project's API URL
 *   VITE_SUPABASE_ANON_KEY  the project's public "anon" key
 * Both are safe in the browser: every table and file is protected by
 * row-level security on the server. The service-role key is never used here.
 *
 * Without them, AirFx runs in local mode: the full editor, with projects
 * saved in this browser and as files, and no accounts.
 */
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const cloud: SupabaseClient | null = url && key
  ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' } })
  : null;

export const cloudEnabled = !!cloud;

/** When set, the editor needs an account (otherwise guests may use it locally). */
export const requireAccount = import.meta.env.VITE_REQUIRE_ACCOUNT === 'true' && cloudEnabled;

export const APP_VERSION = __APP_VERSION__;

declare global { const __APP_VERSION__: string }

/** Supabase's errors, in plain words where the raw message would confuse. */
export function explain(e: unknown): string {
  const m = (e as { message?: string })?.message ?? String(e);
  if (/Invalid login credentials/i.test(m)) return 'That email and password do not match an account.';
  if (/Email not confirmed/i.test(m)) return 'Confirm your email first: open the link we sent you.';
  if (/User already registered/i.test(m)) return 'An account with this email already exists. Log in, or reset your password.';
  if (/Password should be at least/i.test(m)) return 'Use a password of at least 8 characters.';
  if (/row-level security|violates row-level/i.test(m)) return 'Your plan limit is reached (projects, presets or storage).';
  if (/Payload too large|exceeded the maximum allowed size/i.test(m)) return 'That file is larger than your plan allows.';
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'No connection to the AirFx server. Check your internet connection.';
  if (/rate limit/i.test(m)) return 'Too many attempts. Wait a minute and try again.';
  return m;
}
