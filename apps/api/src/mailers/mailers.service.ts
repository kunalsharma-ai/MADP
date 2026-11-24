import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Injectable, NotFoundException } from '@nestjs/common';
import { MERGE_FIELDS, type MailerPack, type MailerTemplate, type PanelCode } from '@madp/contracts';

/** apps/api/mailers, from both src/mailers (tests) and dist/mailers (build). */
const DIR = fileURLToPath(new URL('../../mailers/', import.meta.url));

interface Catalogue {
  importedAt: string;
  packs: MailerPack[];
}

/** Read-only library of the panels' mailer packs (see ops/mailers/import-mailers.mjs). It never sends anything. */
@Injectable()
export class MailersService {
  private readonly catalogue: Catalogue = JSON.parse(readFileSync(join(DIR, 'catalogue.json'), 'utf8')) as Catalogue;

  list(panels: PanelCode[], packId?: string) {
    const packs = this.catalogue.packs
      .filter((p) => panels.includes(p.panel) && (!packId || p.id === packId))
      .map((p) => ({
        ...p,
        templates: p.templates.map((t) => ({ ...t, unmappedFields: t.fields.filter((f) => !MERGE_FIELDS[f]) })),
      }));
    return { importedAt: this.catalogue.importedAt, packs, mergeFields: MERGE_FIELDS };
  }

  detail(panels: PanelCode[], packId: string, id: string) {
    const { pack, template } = this.find(panels, packId, id);
    const read = (ext: string) => readFileSync(join(DIR, pack.id, `${template.id}.${ext}`), 'utf8');
    return {
      pack: { id: pack.id, title: pack.title, panel: pack.panel, category: pack.category },
      template,
      fields: template.fields.map((f) => ({ field: f, ...(MERGE_FIELDS[f] ?? { source: null, label: 'Not mapped yet', madpField: null, personal: false }) })),
      liquid: read('liquid'),
      text: read('txt'),
    };
  }

  /**
   * The designers' own render with their sample values (no member data). Image links point at the panels' mail asset
   * host; for the preview they are pointed at the copies the admin app serves, so it works before the host is live.
   */
  preview(panels: PanelCode[], packId: string, id: string) {
    const { pack, template } = this.find(panels, packId, id);
    const html = readFileSync(join(DIR, pack.id, `${template.id}.html`), 'utf8').split(pack.assetHost).join(`/mailers/${pack.id}/`);
    return { subject: template.subjectsSample[0] ?? template.name, preheader: template.preheader, html };
  }

  private find(panels: PanelCode[], packId: string, id: string): { pack: MailerPack; template: MailerTemplate } {
    const pack = this.catalogue.packs.find((p) => p.id === packId && panels.includes(p.panel));
    const template = pack?.templates.find((t) => t.id === id);
    if (!pack || !template) throw new NotFoundException('No such mailer');
    return { pack, template };
  }
}
