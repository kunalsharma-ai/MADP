import { ForbiddenException, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { asc } from 'drizzle-orm';
import { BUILT_IN_PANEL_CODES, PANELS, setKnownPanels, type PanelCode, type PanelInfo } from '@madp/contracts';
import { Database } from '../db/database.js';
import { panels } from '../db/schema.js';

const BUILT_IN: PanelInfo[] = BUILT_IN_PANEL_CODES.map((code, i) => ({
  code,
  name: PANELS[code].name,
  shortName: PANELS[code].shortName,
  siteUrl: PANELS[code].siteUrl,
  description: '',
  sensitive: PANELS[code].sensitive,
  builtIn: true,
  status: 'active',
  sort: i + 1,
}));

/**
 * The panels MADP serves, read from the `panel` table: T2O, MFR and MHO (built in, mandatory) plus any a Super
 * Admin added. Starts with the built-in three so code that runs before the first read still works, and is
 * re-read on start, after every change on the Panels screen and on each scheduler round.
 */
@Injectable()
export class PanelDirectory implements OnModuleInit {
  private readonly log = new Logger(PanelDirectory.name);
  private list: PanelInfo[] = BUILT_IN;

  constructor(private readonly database: Database) {
    setKnownPanels(this.list.map((p) => p.code));
  }

  async onModuleInit() {
    await this.reload();
  }

  async reload() {
    try {
      const rows = await this.database.db.select().from(panels).orderBy(asc(panels.sort), asc(panels.code));
      if (rows.length)
        this.list = rows.map((r) => ({
          code: r.code,
          name: r.name,
          shortName: r.shortName,
          siteUrl: r.siteUrl,
          description: r.description,
          sensitive: r.sensitive,
          builtIn: r.builtIn,
          status: r.status === 'archived' ? 'archived' : 'active',
          sort: r.sort,
        }));
      // Archived panels stay known, so their old rows can still be read; writes check isActive().
      setKnownPanels(this.list.map((p) => p.code));
    } catch (e) {
      this.log.warn(`Panels not read (${(e as Error).message}); using the built-in three`);
    }
  }

  /** Every panel, archived ones included. */
  all(): PanelInfo[] {
    return this.list;
  }

  /** Codes of the active panels, in screen order. */
  codes(): PanelCode[] {
    return this.list.filter((p) => p.status === 'active').map((p) => p.code);
  }

  /** Codes of every panel, archived ones included (for reading old rows). */
  allCodes(): PanelCode[] {
    return this.list.map((p) => p.code);
  }

  /** Panels a request covers: the brand picked in the switcher, or every active panel when it is on "all". */
  forBrand(brand: string, panel?: PanelCode): PanelCode[] {
    if (brand !== 'all') {
      if (panel && panel !== brand) throw new ForbiddenException('That panel is outside the selected brand');
      return [brand];
    }
    return panel ? [panel] : this.codes();
  }

  get(code: PanelCode): PanelInfo | undefined {
    return this.list.find((p) => p.code === code);
  }

  isActive(code: PanelCode): boolean {
    return this.get(code)?.status === 'active';
  }

  /** Special-category (health) panel: enhanced controls apply. Unknown panels are treated as sensitive. */
  sensitive(code: PanelCode): boolean {
    return this.get(code)?.sensitive ?? true;
  }

  name(code: PanelCode): string {
    return this.get(code)?.name ?? code.toUpperCase();
  }

  shortName(code: PanelCode): string {
    return this.get(code)?.shortName ?? code.toUpperCase();
  }
}
