import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { MERGE_FIELDS, type MailerPack, type MailerTemplate, type PanelCode, type StudioTemplateSource } from '@madp/contracts';
import { ensureFooterLinks, flattenLiquid, liquidToStudio, summarise, type StudioBlock } from './to-studio.js';

/** apps/api/mailers, from both src/mailers (tests) and dist/mailers (build). */
const DIR = fileURLToPath(new URL('../../mailers/', import.meta.url));

interface Catalogue {
  importedAt: string;
  packs: MailerPack[];
}

/**
 * Mailers whose Liquid logic tests only values that their audience fixes. The pack's trigger says who gets them, so
 * the logic can be worked out once and the result becomes a plain studio template. T2O's "no profiles" reminder goes
 * only to members with no completed profile, so the completed count is 0. The partial-profiles reminder depends on
 * the member's own count and stays refused.
 */
const FIXED_BY_AUDIENCE: Record<string, { who: string; values: Record<string, number> }> = {
  't2o/case3-noprofiles': { who: 'members with no completed profile', values: { 'profile.completed_count': 0 } },
};

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
      studio: this.studioBlocks(pack, template),
    };
  }

  /** Why this mailer cannot become a studio template; empty when it can. */
  private studioBlocks(pack: MailerPack, template: MailerTemplate): StudioBlock[] {
    if (template.internal) return [{ code: 'internal', message: 'Sent to the team, not to members.' }];
    if (!template.campaignKind) return [{ code: 'not_a_campaign', message: 'The panel sends it when the event happens; MADP campaigns cannot.' }];
    return this.convert(pack, template, 0).blocks;
  }

  private convert(pack: MailerPack, template: MailerTemplate, subjectIndex: number) {
    const read = (ext: string) => readFileSync(join(DIR, pack.id, `${template.id}.${ext}`), 'utf8');
    const audience = FIXED_BY_AUDIENCE[`${pack.id}/${template.id}`];
    const part = (liquid: string) => liquidToStudio((audience && flattenLiquid(liquid, audience.values)) ?? liquid);
    const subject = part(template.subjects[subjectIndex] ?? template.subjects[0] ?? template.name);
    const html = part(read('liquid'));
    const text = part(read('txt'));
    const blocks = summarise([...subject.blocks, ...html.blocks, ...text.blocks]);
    return { blocks, subject: subject.out, html: html.out, text: text.out, audience: audience?.who ?? null };
  }

  /**
   * The studio template a mailer becomes: subject, HTML and text with the library merge fields turned into studio
   * placeholders, the footer links added where the pack has none, and where it came from. Refused, with the reasons,
   * when the mailer needs Liquid logic or values only the panel has at send time.
   */
  toStudio(panels: PanelCode[], packId: string, id: string, subjectIndex = 0) {
    const { pack, template } = this.find(panels, packId, id);
    const blocks = this.studioBlocks(pack, template);
    if (blocks.length) throw new BadRequestException({ message: 'This mailer cannot become a studio template', blocks });
    const c = this.convert(pack, template, subjectIndex);
    const footer = ensureFooterLinks(c.html, c.text);
    const source: StudioTemplateSource = { pack: pack.id, template: template.id, importedAt: this.catalogue.importedAt, assetHost: pack.assetHost };
    return {
      panel: pack.panel,
      kind: template.campaignKind!,
      key: `${pack.id}-${template.id}`.slice(0, 63),
      name: `${template.name} · ${pack.title}${c.audience ? ` · only ${c.audience}` : ''}`.slice(0, 120),
      source,
      version: { language: 'en', subject: c.subject, bodyHtml: footer.html, bodyText: footer.text },
      added: [
        ...(c.audience
          ? [`The pack's Liquid logic was worked out for its audience (${c.audience}). Send it only to them.`]
          : []),
        ...footer.added,
      ],
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
