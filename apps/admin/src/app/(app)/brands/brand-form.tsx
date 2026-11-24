'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { saveBrandSettingsAction } from '@/app/super-admin-actions';
import { btn, input } from '@/components/ui';

export interface BrandRow {
  panel: 't2o' | 'mfr' | 'mho';
  displayName: string;
  origins: string[];
  languages: string[];
  currency: string;
  pointsPerCurrencyUnit: number;
  minRedemptionPoints: number;
  fourEyesPoints: number;
  profileReviewMonths: number;
  archiveAfterMonths: number;
  supportEmail: string | null;
  legalName: string | null;
  postalAddress: string | null;
  privacyUrl: string | null;
  updatedAt: string;
}

const list = (v: FormDataEntryValue | null) =>
  String(v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export function BrandSettingsForm({ brand, canMoney }: { brand: BrandRow; canMoney: boolean }) {
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <div className="border-t border-border px-5 py-3">
        <button className={btn.secondary} onClick={() => setOpen(true)}>
          Edit settings
        </button>
      </div>
    );
  const num = (f: FormData, k: string) => Number(f.get(k));
  return (
    <form
      className="grid gap-3 border-t border-border px-5 py-4 text-[13px]"
      action={(f) =>
        start(async () => {
          try {
            await saveBrandSettingsAction(brand.panel, {
              displayName: String(f.get('displayName')),
              origins: list(f.get('origins')),
              languages: list(f.get('languages')),
              ...(f.get('supportEmail') ? { supportEmail: String(f.get('supportEmail')) } : {}),
              ...(f.get('legalName') ? { legalName: String(f.get('legalName')) } : {}),
              ...(f.get('postalAddress') ? { postalAddress: String(f.get('postalAddress')) } : {}),
              ...(f.get('privacyUrl') ? { privacyUrl: String(f.get('privacyUrl')) } : {}),
              profileReviewMonths: num(f, 'profileReviewMonths'),
              archiveAfterMonths: num(f, 'archiveAfterMonths'),
              ...(canMoney
                ? {
                    currency: String(f.get('currency')),
                    pointsPerCurrencyUnit: num(f, 'pointsPerCurrencyUnit'),
                    minRedemptionPoints: num(f, 'minRedemptionPoints'),
                    fourEyesPoints: num(f, 'fourEyesPoints'),
                  }
                : {}),
              reason: String(f.get('reason')),
            });
            toast.success('Saved');
            setOpen(false);
          } catch (e) {
            toast.error((e as Error).message);
          }
        })
      }
    >
      <label>
        Name
        <input name="displayName" defaultValue={brand.displayName} className={input} />
      </label>
      <label>
        Origins (hostnames, comma-separated)
        <input name="origins" defaultValue={brand.origins.join(', ')} className={input} />
      </label>
      <label>
        Languages
        <input name="languages" defaultValue={brand.languages.join(', ')} className={input} />
      </label>
      <label>
        Support e-mail (sender and reply-to)
        <input name="supportEmail" type="email" defaultValue={brand.supportEmail ?? ''} className={input} />
      </label>
      <label>
        Legal company name
        <input name="legalName" defaultValue={brand.legalName ?? ''} className={input} />
      </label>
      <label>
        Postal address
        <input name="postalAddress" defaultValue={brand.postalAddress ?? ''} className={input} />
      </label>
      <label>
        Privacy policy link (https)
        <input name="privacyUrl" type="url" defaultValue={brand.privacyUrl ?? ''} className={input} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label>
          Re-check every (months)
          <input
            name="profileReviewMonths"
            type="number"
            min={1}
            max={36}
            defaultValue={brand.profileReviewMonths}
            className={input}
          />
        </label>
        <label>
          Archive after (months)
          <input
            name="archiveAfterMonths"
            type="number"
            min={1}
            max={60}
            defaultValue={brand.archiveAfterMonths}
            className={input}
          />
        </label>
      </div>
      <fieldset disabled={!canMoney} className="grid grid-cols-2 gap-3 disabled:opacity-60">
        <legend className="col-span-2 text-fg-3">
          Money settings{canMoney ? '' : ' (Super Admin only)'}
        </legend>
        <label>
          Currency
          <input name="currency" defaultValue={brand.currency} pattern="[A-Z]{3}" className={input} />
        </label>
        <label>
          Points per 1 {brand.currency}
          <input
            name="pointsPerCurrencyUnit"
            type="number"
            min={1}
            defaultValue={brand.pointsPerCurrencyUnit}
            className={input}
          />
        </label>
        <label>
          Minimum redemption (points)
          <input
            name="minRedemptionPoints"
            type="number"
            min={0}
            defaultValue={brand.minRedemptionPoints}
            className={input}
          />
        </label>
        <label>
          Four-eyes above (points)
          <input
            name="fourEyesPoints"
            type="number"
            min={0}
            defaultValue={brand.fourEyesPoints}
            className={input}
          />
        </label>
      </fieldset>
      <label>
        Reason (kept in the audit log)
        <input name="reason" required minLength={5} className={input} />
      </label>
      <div className="flex gap-2">
        <button className={btn.primary} disabled={pending}>
          Save
        </button>
        <button type="button" className={btn.ghost} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
