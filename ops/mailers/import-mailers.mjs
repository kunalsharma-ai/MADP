#!/usr/bin/env node
// Imports the panel mailer packs (Liquid templates, plain text, sample renders, manifests and referenced images)
// into the repository's mailer library. Run it again when a pack is updated:
//
//   node ops/mailers/import-mailers.mjs <folder-with-the-unzipped-packs>
//
// It writes apps/api/mailers/<pack>/<id>.{liquid,txt,html}, apps/api/mailers/catalogue.json and, for previews only,
// the images the templates reference under apps/admin/public/mailers/. Nothing is sent and no panel is changed.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const src = process.argv[2];
if (!src) {
  console.error('Usage: node ops/mailers/import-mailers.mjs <folder-with-the-unzipped-packs>');
  process.exit(1);
}

/** Each pack: where it is in the upload, which panel and audience it is for, and where its images are hosted. */
const PACKS = [
  { id: 't2o', dir: 't2o-mailers/react/dist', assets: 't2o-mailers/assets', panel: 't2o', category: null, title: 'Turn2Opinion mailers v1', host: 'https://www.frequentresearch.com/mailer/t2o-v1/' },
  { id: 'mfr-lifecycle', dir: 'mfr-v6/react/dist', assets: 'mfr-v6/assets', panel: 'mfr', category: null, title: 'MyFrequentRewards lifecycle reminders v6', host: 'https://www.frequentresearch.com/mailer/v6/' },
  { id: 'mfr-system', dir: 'mfr-templates-v6/react/dist', assets: 'mfr-templates-v6/assets', panel: 'mfr', category: null, title: 'MyFrequentRewards system templates v6', host: 'https://www.frequentresearch.com/mailer/v7/' },
  { id: 'mho-hcp', dir: 'mho-hcp-mailers/dist', assets: 'mho-hcp-mailers/assets', panel: 'mho', category: 'healthcare_professional', title: 'MyHealthOpinions healthcare professional mailers v1', host: 'https://www.myhealthopinions.com/mailer/v1/hcp/' },
  { id: 'mho-caregiver', dir: 'mho-caregiver-mailers/dist', assets: 'mho-caregiver-mailers/assets', panel: 'mho', category: 'caregiver', title: 'MyHealthOpinions caregiver mailers v1', host: 'https://www.myhealthopinions.com/mailer/v1/caregiver/' },
  { id: 'mho-patient', dir: 'mho-patient-mailers/dist', assets: 'mho-patient-mailers/assets', panel: 'mho', category: 'patient', title: 'MyHealthOpinions patient mailers v1', host: 'https://www.myhealthopinions.com/mailer/v1/patient/' },
];

/** Templates MADP may send itself, as a campaign of this kind. Everything else is sent by the panel at the event. */
const CAMPAIGN_KIND = { 'case3-noprofiles': 'profile_recovery', 'case4-partial': 'profile_recovery', newsurvey: 'survey_reminder', birthday: 'birthday' };

function find(base, rel) {
  // The packs unzip into a folder named after the upload; look one or two levels down for the pack's own folder.
  for (const top of readdirSync(base)) {
    const p = join(base, top, rel);
    if (existsSync(p)) return p;
    if (existsSync(join(base, rel))) return join(base, rel);
  }
  return null;
}

/** Variables a Liquid template reads: output tags and the paths used in if/elsif/unless/assign/case/for. */
function fields(liquid) {
  const assigned = new Set([...liquid.matchAll(/\{%-?\s*(?:assign|capture)\s+([A-Za-z_][\w]*)/g)].map((m) => m[1]));
  const found = new Set();
  for (const m of liquid.matchAll(/\{\{-?\s*([A-Za-z_][\w.]*)/g)) found.add(m[1]);
  for (const m of liquid.matchAll(/\{%-?\s*(?:if|elsif|unless|assign\s+\w+\s*=|case|for\s+\w+\s+in)\s+([^%]*)%\}/g))
    for (const p of m[1].matchAll(/(?<![\w."'])([A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)+|[A-Za-z_][\w]*)(?![\w"'])/g)) found.add(p[1]);
  const words = new Set(['and', 'or', 'not', 'contains', 'true', 'false', 'nil', 'null', 'empty', 'blank', 'default', 'minus', 'plus', 'times', 'divided_by', 'size', 'first', 'last']);
  return [...found].filter((f) => !assigned.has(f.split('.')[0]) && !words.has(f)).sort();
}

const apiOut = join(root, 'apps/api/mailers');
const assetOut = join(root, 'apps/admin/public/mailers');
rmSync(apiOut, { recursive: true, force: true });
rmSync(assetOut, { recursive: true, force: true });
const catalogue = { importedAt: new Date().toISOString().slice(0, 10), packs: [] };

for (const pack of PACKS) {
  const dist = find(src, pack.dir);
  const assets = find(src, pack.assets);
  if (!dist || !assets) throw new Error(`Pack ${pack.id} not found under ${src}`);
  const raw = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'));
  const list = Array.isArray(raw) ? raw : raw.templates;
  const out = join(apiOut, pack.id);
  mkdirSync(out, { recursive: true });
  const used = new Set();
  const templates = [];
  for (const t of list) {
    const liquid = readFileSync(join(dist, 'liquid', `${t.id}.liquid`), 'utf8');
    const html = readFileSync(join(dist, 'html', `${t.id}.html`), 'utf8');
    const text = readFileSync(join(dist, 'text', `${t.id}.txt`), 'utf8');
    for (const m of (liquid + html).matchAll(/https:\/\/www\.(?:frequentresearch|myhealthopinions)\.com\/mailer\/[^"')\s]+/g))
      if (m[0].startsWith(pack.host)) used.add(m[0].slice(pack.host.length));
    writeFileSync(join(out, `${t.id}.liquid`), liquid);
    writeFileSync(join(out, `${t.id}.html`), html);
    writeFileSync(join(out, `${t.id}.txt`), text);
    const subjectFields = fields((t.subjects ?? []).join(' '));
    templates.push({
      id: t.id,
      code: t.code ?? null,
      name: t.name,
      group: t.group ?? t.kind,
      transactional: t.transactional === true,
      internal: t.internal === true || ['newuser', 'ticket-created-team', 'ticket-updated-team'].includes(t.id),
      trigger: t.trigger ?? null,
      subjects: t.subjects ?? [],
      subjectsSample: t.subjectsSample ?? [],
      preheader: t.preheaderSample ?? t.preheader ?? null,
      cta: t.cta?.label ?? null,
      reason: t.reason ?? null,
      campaignKind: CAMPAIGN_KIND[t.id] ?? null,
      fields: [...new Set([...fields(liquid), ...subjectFields])].sort(),
    });
  }
  // Copy only the images the templates use, so previews work without the public asset host.
  let bytes = 0;
  for (const rel of used) {
    const from = join(assets, rel);
    if (!existsSync(from) || !statSync(from).isFile()) continue;
    const to = join(assetOut, pack.id, rel);
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
    bytes += statSync(from).size;
  }
  catalogue.packs.push({ id: pack.id, title: pack.title, panel: pack.panel, category: pack.category, assetHost: pack.host, templates });
  console.log(`${pack.id}: ${templates.length} templates, ${used.size} images (${Math.round(bytes / 1024)} KB) -> ${relative(root, out)}`);
}
writeFileSync(join(apiOut, 'catalogue.json'), `${JSON.stringify(catalogue, null, 1)}\n`);
