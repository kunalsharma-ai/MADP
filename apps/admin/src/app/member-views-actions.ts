'use server';

import { revalidatePath } from 'next/cache';
import type { MemberBulkAction, MemberBulkResult, MemberTypeRule, MemberViewParams } from '@madp/contracts';
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

export async function saveTypeColumnsAction(rules: MemberTypeRule[]) {
  return attempt(async () => {
    const r = await api<{ rules: MemberTypeRule[] }>('/panel/members/type-columns', { method: 'PUT', json: { rules } });
    revalidatePath('/members');
    return r;
  });
}

export async function setMemberTagsAction(member: string, tags: string[]) {
  return attempt(async () => {
    const r = await api<{ tags: string[] }>(`/panel/members/${encodeURIComponent(member)}/tags`, { method: 'PUT', json: { tags } });
    revalidatePath(`/members/${member}`);
    revalidatePath('/members');
    return r;
  });
}

export async function addMemberNoteAction(member: string, body: string, pinned: boolean) {
  return attempt(async () => {
    const r = await api<{ id: string }>(`/panel/members/${encodeURIComponent(member)}/notes`, { method: 'POST', json: { body, pinned } });
    revalidatePath(`/members/${member}`);
    return r;
  });
}

export async function deleteMemberNoteAction(member: string, note: string) {
  return attempt(async () => {
    await api(`/panel/members/${encodeURIComponent(member)}/notes/${encodeURIComponent(note)}`, { method: 'DELETE' });
    revalidatePath(`/members/${member}`);
    return null;
  });
}

export async function memberBulkAction(input: MemberBulkAction) {
  return attempt(async () => {
    const r = await api<MemberBulkResult>('/member-bulk', { method: 'POST', json: input });
    revalidatePath('/members');
    return r;
  });
}
