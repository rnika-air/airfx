# Deploying AirFx

AirFx runs as a static web app on **Cloudflare Pages**, with **Supabase** for accounts, the database and private file storage. GitHub Actions builds and deploys it. All effects, AI and video export run in each visitor's browser, so the servers only store accounts, projects and presets.

```
Visitor's browser ──HTTPS──▶ Cloudflare Pages   (the app: HTML, JS, WASM, service worker)
       │                     your-domain.com
       └──HTTPS──▶ Supabase  (Auth, Postgres with row-level security, private Storage)
GitHub ── push tag vX.Y.Z ──▶ Actions: migrate database → build → GitHub Release → deploy
```

You need three free accounts: **GitHub**, **Cloudflare** and **Supabase**. Each step below is done once.

## 1. GitHub repository

From the AirFx folder (Git and GitHub CLI are installed):

```bash
gh auth login
```
```bash
gh repo create airfx --public --source . --remote origin
```
```bash
git push -u origin main
```

The repository holds only the web app. The After Effects plugin folder, test footage, build output, `.env` files and local tools are excluded by `.gitignore`.

## 2. Supabase (accounts, database, storage)

1. On supabase.com, create a project. Choose a region near your users, and save the **database password** in a password manager.
2. **Project Settings › API:** note the **Project URL**, the **anon public** key and the **project ref** (the id in the URL). Never put the `service_role` key in the app or in GitHub variables.
3. **Database:** the release workflow applies `supabase/migrations` automatically (step 4). To set it up by hand instead, paste the migration into **SQL Editor** and run it. Then run `supabase/tests/rls_isolation.sql` there: it should end with "RLS isolation: all checks passed".
4. **Authentication › URL Configuration:**
   - **Site URL:** `https://your-domain.com`, or the `*.pages.dev` address until you have a domain.
   - **Redirect URLs:** add `https://your-domain.com/**`, `https://*.your-pages-project.pages.dev/**` and `http://localhost:5173/**`.
5. **Authentication › Providers › Email:** keep **Confirm email** on.
6. **Authentication › SMTP:** Supabase's built-in email is rate-limited and meant for testing. Before launch, connect an email provider (Resend, Postmark, SES and similar) so sign-up and password-reset emails arrive reliably. Customise the email templates with the AirFx name.
7. **Storage:** the migration creates three private buckets (`projects`, `media`, `thumbnails`) and their rules. Supabase's free plan caps uploads at 50 MB per file, which matches AirFx's Free plan. Larger plan limits need a paid Supabase plan.

## 3. Cloudflare Pages (the website)

1. Cloudflare dashboard › **Workers & Pages › Create › Pages › Direct Upload**. Name the project (for example `airfx`). GitHub Actions does the uploads, so skip the Git connection.
2. **My Profile › API Tokens › Create Token:** use the "Edit Cloudflare Workers" template, or a custom token with **Account › Cloudflare Pages › Edit**. Note the **Account ID** shown on the dashboard.
3. **Custom domain:** in the Pages project, open **Custom domains › Set up a domain**. HTTPS certificates are issued and renewed automatically. If the domain's DNS is elsewhere, add the CNAME it shows.

## 4. Connect GitHub to both

In the repository: **Settings › Secrets and variables › Actions**.

**Variables** (not secret; they end up in the public app anyway):

| Name | Value |
| --- | --- |
| `VITE_SUPABASE_URL` | Supabase Project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon public key |
| `VITE_REQUIRE_ACCOUNT` | `false` lets guests use the editor with local saving; `true` requires an account |
| `CLOUDFLARE_PAGES_PROJECT` | the Pages project name, e.g. `airfx` |
| `SUPABASE_PROJECT_REF` | the project ref |

**Secrets** (never shown again after saving):

| Name | Value |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | the Pages token |
| `CLOUDFLARE_ACCOUNT_ID` | your Cloudflare account id |
| `SUPABASE_ACCESS_TOKEN` | supabase.com › Account › Access Tokens |
| `SUPABASE_DB_PASSWORD` | the database password |
| `BACKUP_PASSPHRASE` | a long random passphrase for encrypted backups (keep a copy) |

Workflows skip their deploy, migrate and backup steps until these are set, so nothing fails before you are ready.

## 5. Publishing updates

1. Work on `main`. Every push runs **CI** (types and both builds) and deploys a **preview** to `preview.<project>.pages.dev`, not the public site.
2. Write what changed under `## Unreleased` in `CHANGELOG.md`.
3. Release:
   ```bash
   npm run release -- minor --push
   ```
   Use `patch` for fixes, `minor` for features, `major` for big changes, or `current` to release the version already in `package.json` (the first release, 5.0.0). Without `--push` it only commits and tags locally.
4. The **Release** workflow applies database migrations, builds, creates the GitHub Release (notes from the changelog, the built site attached) and deploys to the public site.
5. Open apps notice the new version and offer **Reload**. Installed apps update the same way.

**Rolling back:** Cloudflare Pages › Deployments › pick an earlier deployment › **Rollback**. Database migrations only move forward. To undo one, write a new migration.

## Backups

- **Database:** the **Database backup** workflow runs nightly. It dumps schema, data and roles with the Supabase CLI and encrypts the dump with `BACKUP_PASSPHRASE` (AES-256). It keeps the encrypted file as a workflow artifact for 30 days. The encryption matters because artifacts of a public repository can be downloaded by others. To restore, decrypt the file:
  ```bash
  gpg -d airfx-db-<date>.tar.gz.gpg | tar -xz
  ```
  Then load `roles.sql`, `schema.sql` and `data.sql` with `psql`. Supabase's paid plans add daily backups and point-in-time recovery; turn them on when you have paying users.
- **Files** (projects, media): they live in Supabase Storage, which is not in the database dump. Back them up with `rclone` against Supabase's S3-compatible endpoint (Storage › S3 Connection) on a schedule, or rely on Supabase's storage durability until there is real usage.

## Monitoring

- **App errors:** they arrive in the `client_errors` table (Supabase › Table Editor). Each report has the message, stack, page, app version and browser; no media and no project content.
- **Auth, API and storage logs:** Supabase › Logs.
- **Traffic and Web Vitals:** Cloudflare Pages › Analytics.
- **Builds and deploys:** GitHub › Actions. Failed workflows email the repository owner.

## Local development

```bash
npm install
```
```bash
npm run dev
```

Without a `.env.local`, AirFx runs in local mode: no accounts, projects saved in the browser and as files. To use your Supabase project locally, copy `.env.example` to `.env.local` and fill in the URL and anon key.

```bash
npm run db:test
```

That runs the migration and security tests on a local Postgres (PGlite). Install it once with `cd .tools && npm install @electric-sql/pglite`.
