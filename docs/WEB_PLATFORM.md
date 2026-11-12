# AirFx Web Platform: Architecture

## What was there

AirFx is a React + TypeScript single-page app built with Vite. Everything heavy runs in the visitor's browser:

- **Effects:** about 130 Canvas 2D effects.
- **Video:** decoding and encoding with WebCodecs.
- **AI:** depth, keying and inpainting with ONNX Runtime Web (WASM / WebGPU) in a web worker; tracking with MediaPipe.
- **Audio analysis:** in the browser.
- **Saving:** projects already saved as one `.airfx` file (edit stack, settings and embedded media), with autosave in IndexedDB.

There was no server.

## What was added

| Need | How |
| --- | --- |
| **Accounts** | Supabase Auth. Email and password, email confirmation, password reset by email, change email, change password, delete account (`src/cloud/account.ts`). |
| **Profiles and settings** | `profiles` table. A row is created with each account. Users can edit their name and settings, never their plan. |
| **Private projects** | The same `.airfx` file, stored in the private `projects` bucket at `<user id>/<project id>.airfx`, plus a `projects` row (name, size, thumbnail). Save, Save As New, open, rename, delete (`src/cloud/storage.ts`, Project menu › My Projects). |
| **Saved presets** | Synced both ways between the browser and the `presets` table (`src/cloud/presetSync.ts`). |
| **User media storage** | `media` bucket and table: upload, list, use in the editor, delete. |
| **Isolation** | Postgres row-level security on every table (`owner = auth.uid()`). Storage policies allow only the user's own folder. Tested: `npm run db:test`. |
| **Upload limits** | Checked by the app before uploading, and by the storage policy (the total quota) on the server. The bucket size cap is the largest plan's. |
| **Plans** | `plans` table: Free, Pro and Studio with storage, file size, projects, presets and export limits. Every account is Free; payments are not active. |
| **Error monitoring** | Unexpected errors go to `client_errors`: write-only, flood-limited, no content. |
| **PWA** | Manifest, icons, generated service worker (offline shell, runtime caching of AI files), install button, update notice. |
| **Guests** | Without an account, the full editor works with local saving. `VITE_REQUIRE_ACCOUNT=true` requires an account instead. |
| **Releases and deploys** | GitHub Actions: CI, preview deploys, tagged releases with notes and assets, database migrations, encrypted nightly backups. |

## Why it scales cheaply

- **No server-side processing:** effects, AI and exports run on each visitor's device. A thousand users editing at once costs the servers nothing beyond serving static files and storing results.
- **Static hosting:** Cloudflare's free tier has no bandwidth charges.
- **AI runtime files:** the large WebAssembly files load from jsDelivr, and the service worker caches them after first use.
- **Model weights:** they download from Hugging Face or Google's model storage into each browser's cache, once.
- **Server load:** sign-in, a few small queries per project action, and file uploads and downloads (direct to Supabase Storage, which a CDN serves).

**Processing queues and AI workers:** today each browser tab runs one AI worker and runs its jobs one at a time. That is the queue, and it costs nothing. If AirFx later adds server-side jobs (cloud rendering of long 4K videos, or larger AI models than a browser can hold), the design is:

1. A `jobs` table, owned by each user under row-level security, with a status column.
2. Supabase Queues (pgmq) or a Postgres `FOR UPDATE SKIP LOCKED` worker loop.
3. GPU workers on a separate service (for example Modal, Replicate or a GPU VM) that claim jobs, read inputs from Storage with signed URLs, and write results back.
4. Per-plan job quotas enforced in the insert policy, like the project limit.

None of this is needed for the current feature set.

## API security

- **Browser key:** the browser only has the public anon key. Every request is checked against row-level security as the signed-in user, and the service-role key is never in the app or the repository.
- **Privileged functions:** they are `security definer` with an empty `search_path`, and check `auth.uid()`. The account-deletion function is executable only by signed-in users, and only deletes themselves.
- **No owner forging:** inserts take the owner from `auth.uid()` (the default), and the policies reject any other value.
- **Size and abuse caps:** text and JSON columns have size limits, and error reports are flood-limited per user.
- **Auth protection:** Supabase Auth adds rate limits, email confirmation and leaked-password checks (turn those on in the dashboard).
- **Site headers:** set in `public/_headers`: HSTS, nosniff, frame denial, and a permissions policy that allows only camera and microphone (used by Live, Gesture Studio and the audio features).

## Plans: adding payments later

1. Add a payment provider (for example Stripe) with a webhook as a Supabase Edge Function. Using the service role, the webhook sets `profiles.plan` to `pro` or `studio` and back.
2. Limits already follow `profiles.plan` through `my_plan()`. Storage, project and preset limits are enforced today.
3. Export limits are recorded per plan (`max_export_edge`) but not enforced, so nobody loses 4K export before paid plans exist. To enforce them, cap the export size in `ExportDialog` with `limits().max_export_edge`.
4. Users cannot change their own plan: they have no update right on that column, and the RLS test checks it.

## Files

- `src/cloud/`: the Supabase client, account store, projects and media, preset sync, error monitor, and the account interface.
- `src/pwa/`: install, updates and the service worker template.
- `public/manifest.webmanifest`, `public/icons/`, `public/_headers`.
- `supabase/migrations/`, `supabase/tests/`.
- `.github/workflows/`: ci, preview, release, backup.
- `scripts/release.mjs`, `scripts/release-notes.mjs`, `CHANGELOG.md`.
