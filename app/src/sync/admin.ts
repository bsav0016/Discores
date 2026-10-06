import { supabase } from '@/lib/supabase';

export type CourseReport = {
  id: string;
  course_id: string;
  course_name: string;
  area: string | null;
  kind: string;
  note: string;
  created_at: string;
  layout_id: string | null;
  hole_count: number | null;
  pars: number[] | null;
};

/** True only when the server says so. Offline or any error counts as "not an admin" (hides the entry point). */
export async function isAdmin(): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_admin');
  return !error && data === true;
}

export async function listReports(): Promise<CourseReport[] | string> {
  const { data, error } = await supabase.rpc('list_course_reports');
  if (error) return error.message;
  return data as CourseReport[];
}

export type UserReport = {
  id: string;
  reported: string;
  display_name: string;
  username: string | null;
  reason: string;
  note: string;
  created_at: string;
  other_pending: number;
};

export async function listUserReports(): Promise<UserReport[] | string> {
  const { data, error } = await supabase.rpc('list_user_reports');
  if (error) return error.message;
  return data as UserReport[];
}

/** 'actioned' can also clear the person's username and/or reset their display name; it closes all their reports. */
export async function resolveUserReport(
  id: string,
  status: 'actioned' | 'dismissed',
  opts: { clearUsername?: boolean; resetName?: boolean } = {},
): Promise<string | null> {
  const { error } = await supabase.rpc('resolve_user_report', {
    p_id: id, p_status: status, p_clear_username: !!opts.clearUsername, p_reset_name: !!opts.resetName,
  });
  return error?.message ?? null;
}

/** Only fields that changed should be passed; an empty edit just closes the report. */
export async function resolveReport(
  id: string,
  status: 'applied' | 'rejected',
  edits: { name?: string; area?: string; pars?: number[] } = {},
): Promise<string | null> {
  const { error } = await supabase.rpc('resolve_course_report', {
    p_id: id,
    p_status: status,
    p_name: edits.name ?? null,
    p_area: edits.area ?? null,
    p_pars: edits.pars ?? null,
  });
  return error?.message ?? null;
}
