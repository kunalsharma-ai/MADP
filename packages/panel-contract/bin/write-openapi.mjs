#!/usr/bin/env node
// Writes docs/panel-contract/openapi.v1.json from the built contract. Run after `pnpm build`.
import { mkdirSync, writeFileSync } from 'node:fs';
import { panelContractOpenApi, panelContractRoutesMarkdown } from '../dist/index.js';

const out = new URL('../../../docs/panel-contract/openapi.v1.json', import.meta.url);
mkdirSync(new URL('.', out), { recursive: true });
writeFileSync(out, `${JSON.stringify(panelContractOpenApi(), null, 2)}\n`);
writeFileSync(new URL('ROUTES.md', out), panelContractRoutesMarkdown());
console.log(`Wrote ${out.pathname} and ROUTES.md`);
