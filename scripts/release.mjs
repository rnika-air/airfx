// Publishes a new AirFx version.
//   npm run release -- patch|minor|major|current [--push]
//   (current: release the version already in package.json, e.g. the first release)
// 1. Checks the working tree is clean and on main.
// 2. Bumps the version in package.json (and package-lock.json).
// 3. Turns "## Unreleased" in CHANGELOG.md into "## vX.Y.Z (date)".
// 4. Commits "Release vX.Y.Z" and tags vX.Y.Z.
// 5. With --push: pushes main and the tag. GitHub Actions then migrates the
//    database, builds, creates the GitHub Release and deploys the public site.
//    Without --push it stops and prints the command, so you can look first.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const [kind = 'patch', ...flags] = process.argv.slice(2);
const push = flags.includes('--push');
const sh = (c) => execSync(c, { stdio: ['ignore', 'pipe', 'inherit'] }).toString().trim();
const fail = (m) => { console.error(`release: ${m}`); process.exit(1); };

if (!['patch', 'minor', 'major', 'current'].includes(kind)) fail('say patch, minor, major or current');
if (sh('git status --porcelain')) fail('commit or stash your changes first');
const branch = sh('git rev-parse --abbrev-ref HEAD');
if (branch !== 'main') fail(`releases are made from main (you are on ${branch})`);

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const [ma, mi, pa] = pkg.version.split('.').map(Number);
const next = kind === 'current' ? pkg.version : kind === 'major' ? `${ma + 1}.0.0` : kind === 'minor' ? `${ma}.${mi + 1}.0` : `${ma}.${mi}.${pa + 1}`;

const log = readFileSync('CHANGELOG.md', 'utf8');
const m = log.match(/## Unreleased\s*\n([\s\S]*?)(?=\n## |$)/);
if (sh(`git tag -l v${next}`)) fail(`v${next} is already tagged`);
if (!m || !m[1].trim()) fail('CHANGELOG.md has nothing under "## Unreleased": describe the release first');
const date = new Date().toISOString().slice(0, 10);
writeFileSync('CHANGELOG.md', log.replace(/## Unreleased\s*\n/, `## Unreleased\n\n## v${next} (${date})\n`));

pkg.version = next;
writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
try {
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
  lock.version = next;
  if (lock.packages?.['']) lock.packages[''].version = next;
  writeFileSync('package-lock.json', JSON.stringify(lock, null, 2) + '\n');
} catch { /* no lockfile */ }

sh('git add package.json package-lock.json CHANGELOG.md');
sh(`git commit -m "Release v${next}"`);
sh(`git tag -a v${next} -m "AirFx v${next}"`);
console.log(`Tagged v${next}.`);
if (push) {
  sh('git push origin main');
  sh(`git push origin v${next}`);
  console.log(`Pushed. Follow the release at your repository's Actions tab.`);
} else console.log(`To publish:  git push origin main && git push origin v${next}`);
