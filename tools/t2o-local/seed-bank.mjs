// Loads the T2O question bank (as extracted into MADP's fixture from the T2O repo) into the local copy.
// Uses the MongoDB driver installed with the T2O backend copy: MONGODB_DRIVER=<copy>/node_modules/mongodb/lib/index.js
const { MongoClient } = await import(process.env.MONGODB_DRIVER ?? 'mongodb');
import fs from 'node:fs';
const [, , fixture, uri, origin] = process.argv;
const f = JSON.parse(fs.readFileSync(fixture, 'utf8'));
const c = await MongoClient.connect(uri);
const db = c.db();
for (const n of ['Question', 'Option', 'Profile']) await db.collection(n).deleteMany({ origin });
const base = {
  origin,
  isActive: true,
  isDeleted: false,
  sortOrder: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
};
// Question types as the panel's admin creates them (select, multiselect, text, phone, date), using the same rule as
// frontend-1's own demo bank (src/member/data/demoQuestions.js). The member area only asks these types.
const MULTI = /all that apply|select all|check all|choose all|multiple/i;
const PHONE = /^(phone|alternate-phone|phone1|add-whatsapp|add-phone\d*)$/;
const typeOf = (q, hasOpts) =>
  /^verify-/.test(q.name)
    ? 'verify'
    : hasOpts
      ? MULTI.test(q.label ?? '')
        ? 'multiselect'
        : 'select'
      : PHONE.test(q.name)
        ? 'phone'
        : q.name === 'dob'
          ? 'date'
          : 'text';
const optCount = new Map();
for (const o of f.options) optCount.set(o.question, (optCount.get(o.question) ?? 0) + 1);
await db.collection('Question').insertMany(
  f.questions.map((q) => ({
    ...base,
    name: q.name,
    label: q.label,
    parent: q.parent ?? undefined,
    category: [].concat(q.category),
    type: typeOf(q, optCount.get(q.name) > 0),
    isRequired: false,
  })),
);
// The panel's unique index is (question, value, origin, label): one option row carries every parent value.
const merged = new Map();
for (const o of f.options) {
  const k = `${o.question}\u0000${o.value}\u0000${o.label}`;
  const m = merged.get(k) ?? {
    ...base,
    question: o.question,
    label: o.label,
    value: o.value,
    parentValue: [],
  };
  for (const v of o.parentValue) if (!m.parentValue.includes(v)) m.parentValue.push(v);
  merged.set(k, m);
}
await db.collection('Option').insertMany([...merged.values()], { ordered: false });
console.log('option rows after merging parent values', merged.size);
// The panel backend allows one questionnaire per name and category (unique index name+category+origin). The MHO
// exports repeat two HCP questionnaire names (the CareGiver export is labelled "healthcare professional"), so only
// the first of each is loaded and the rest are reported.
const seenProfile = new Set();
const profiles = f.profiles.filter((p) => {
  const k = `${p.name}\u0000${p.sourceCategory}`;
  if (seenProfile.has(k)) {
    console.log(`skipped duplicate questionnaire "${p.name}" (${p.sourceCategory}), slug ${p.slug}`);
    return false;
  }
  seenProfile.add(k);
  return true;
});
await db.collection('Profile').insertMany(
  profiles.map((p) => ({
    ...base,
    name: p.name,
    slug: p.slug,
    category: p.sourceCategory,
    pages: p.pages,
    points: 50,
  })),
);
console.log({ questions: f.questions.length, options: f.options.length, profiles: profiles.length });
await c.close();
