// Prints the CHANGELOG.md section for a version, for the GitHub Release body.
// Usage: node scripts/release-notes.mjs v5.0.0
import { readFileSync } from 'node:fs';

const tag = process.argv[2];
if (!tag) { console.error('usage: release-notes.mjs vX.Y.Z'); process.exit(1); }
const log = readFileSync('CHANGELOG.md', 'utf8');
const esc = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const m = log.match(new RegExp(`## ${esc}[^\\n]*\\n([\\s\\S]*?)(?=\\n## |$)`));
console.log(m ? m[1].trim() : `AirFx ${tag}.`);
