#!/usr/bin/env node
// Builds the small, committed questionnaire samples used by the DEMO/snapshot connectors and tests.
//
// Input: read-only checkouts of the source panel repositories. Only *question definitions* are read
// (question names, labels, option lists, questionnaire page layouts). These exports contain no
// respondent records or personal data. Nothing is written to the source repositories.
//
//   node packages/testing/scripts/extract-source-samples.mjs \
//     --t2o ../turn2opinion --mho ../MHO --out packages/testing/src/fixtures
//
// MFR is intentionally absent: the MFR repository has no questionnaire export; its questions live only
// in the MFR database. See docs/REPOSITORY_AUDIT_MFR.md.
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .reduce((acc, cur, i, all) => (cur.startsWith('--') ? [...acc, [cur.slice(2), all[i + 1]]] : acc), []),
);
if (!args.t2o || !args.mho || !args.out) {
  console.error('usage: --t2o <path> --mho <path> --out <dir>');
  process.exit(2);
}
const MAX_OPTIONS = 25;
const SKIP = new Set([
  'city',
  'state',
  'zipcode',
  'jobrole',
  'employment-jobrole',
  'patient-jobrole',
  'state_of_practice',
]);
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

// ---------- T2O: frontend-1/src/member/data/demo-bank/bank.json (README: matches the admin export) ----------
{
  const bankPath = path.join(args.t2o, 'Project/frontend-1/src/member/data/demo-bank/bank.json');
  const bank = readJson(bankPath);
  // The full bank: every questionnaire for every member type (b2c and minor). Confirmed identical to the bank
  // embedded in the new member dashboard build shared on 2026-11-23.
  const profiles = bank.profiles.map((p) => ({
    slug: p.s,
    name: p.n,
    sourceCategory: p.c,
    // Two bank profiles (shopping, food-beverages) have a blank slot in their page list; it names no question.
    pages: p.p.map(([title, names]) => [title, ...names.filter((n) => String(n).trim())]),
  }));
  const qNames = [...new Set(profiles.flatMap((p) => p.pages.flatMap((pg) => pg.slice(1))))];
  const questions = qNames
    .filter((n) => bank.Q[n])
    .map((n) => ({
      name: n,
      label: bank.Q[n][0],
      parent: bank.Q[n][1] || null,
      category: [
        ...new Set(profiles.filter((p) => p.pages.some((pg) => pg.includes(n))).map((p) => p.sourceCategory)),
      ],
    }));
  const options = [];
  for (const q of questions) {
    if (SKIP.has(q.name)) continue;
    const listKey = bank.A?.[q.name] ?? q.name;
    const byParent = bank.O[listKey];
    if (!byParent) continue;
    for (const [parentValue, labels] of Object.entries(byParent)) {
      for (const entry of [].concat(labels)) {
        // Bank entries are either "Label" or [label, value].
        const [label, value] = Array.isArray(entry) ? entry : [entry, entry];
        options.push({
          question: q.name,
          label: String(label),
          value: String(value),
          parentValue: parentValue ? [parentValue] : [],
        });
      }
    }
  }
  write('t2o', {
    source: 'turn2opinion:Project/frontend-1/src/member/data/demo-bank/bank.json',
    profiles,
    questions,
    options,
  });
}

// ---------- MHO: Project/sections/hcp/data-source/myhealthopinions.*.json (Mongo exports) ----------
{
  const dir = path.join(args.mho, 'Project/sections/hcp/data-source');
  const sets = [
    ['HealthcareProfessional', 'healthcare professional'],
    ['Patient', 'patient'],
    ['CareGiver', 'care giver'],
  ];
  const profiles = [];
  const qByName = new Map();
  for (const [file, category] of sets) {
    const ps = readJson(path.join(dir, `myhealthopinions.${file}.Profile.json`));
    const qs = readJson(path.join(dir, `myhealthopinions.${file}.Question.json`));
    // basic profile + the first two category-specific profiles
    const chosen = ps.filter((p) => p.slug !== 'basic' && p.name !== 'basic profile').slice(0, 2);
    for (const p of chosen) {
      profiles.push({
        slug: p.slug ?? p.name.replace(/\s+/g, '-'),
        name: p.name,
        sourceCategory: p.category ?? category,
        exportFile: file,
        pages: p.pages,
      });
      for (const n of p.pages.flatMap((pg) => pg.slice(1))) {
        const q = qs.find((x) => x.name === n);
        if (q)
          qByName.set(n, { name: q.name, label: q.label, parent: q.parent || null, category: q.category });
      }
    }
  }
  const questions = [...qByName.values()];
  const names = new Set(questions.map((q) => q.name).filter((n) => !SKIP.has(n)));
  const counts = new Map();
  const options = [];
  for (const o of readJson(path.join(dir, 'myhealthopinions.Option.json'))) {
    if (!names.has(o.question)) continue;
    const c = counts.get(o.question) ?? 0;
    if (c >= MAX_OPTIONS) continue;
    counts.set(o.question, c + 1);
    options.push({ question: o.question, label: o.label, value: o.value, parentValue: o.parentValue ?? [] });
  }
  write('mho', {
    source: 'MHO:Project/sections/hcp/data-source/myhealthopinions.*.json',
    profiles,
    questions,
    options,
  });
}

function write(panel, data) {
  const file = path.join(args.out, `${panel}.source-sample.json`);
  fs.writeFileSync(
    file,
    // The full T2O bank is large, so it is written compactly; the small samples stay readable.
    JSON.stringify(
      { panel, extractedAt: new Date().toISOString().slice(0, 10), ...data },
      null,
      data.options.length > 5000 ? 0 : 1,
    ) + '\n',
  );
  console.log(
    `${panel}: ${data.profiles.length} questionnaires, ${data.questions.length} questions, ${data.options.length} options -> ${file}`,
  );
}
