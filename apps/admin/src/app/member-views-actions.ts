'use server';

import { revalidatePath } from 'next/cache';
import type { MemberViewParams } from '@madp/contracts';
import { api } from '@/lib/api';
import { attempt } from '@/lib/attempt';

export async function saveMemberViewAction(input: { name: string; params: MemberViewParams; shared: boolean }) {
  return attempt(async () => {
    const r = await api<{ id: string }>('/member-views', { method: 'POST', json: input });
    revalidatePath('/members');
    return r;
  });
}

export async function deleteMemberViewAction(id: string) {
  return attempt(async () => {
    await api(`/member-views/${encodeURIComponent(id)}`, { method: 'DELETE' });
    revalidatePath('/members');
    return null;
  });
}
