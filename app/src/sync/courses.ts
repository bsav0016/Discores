import { upsertLayout, type LayoutRow } from '@/db/local';
import { supabase } from '@/lib/supabase';

export type CourseKind = 'name' | 'holes' | 'location' | 'duplicate' | 'other';

export const CORRECTION_KINDS: { value: CourseKind; label: string }[] = [
  { value: 'name', label: 'Wrong name' },
  { value: 'holes', label: 'Wrong holes or pars' },
  { value: 'location', label: 'Wrong location' },
  { value: 'duplicate', label: 'Duplicate' },
  { value: 'other', label: 'Something else' },
];

function toLayout(r: any): LayoutRow {
  return {
    layout_id: r.layout_id,
    course_id: r.course_id,
    course_name: r.course_name,
    area: r.area,
    hole_count: r.hole_count,
    pars: r.pars ?? [],
    verified: r.verified === true,
  };
}

export type SearchResult = { layouts: LayoutRow[] } | { error: string };

/** Online course search. Needs 2+ characters; the server returns at most 25 layouts. */
export async function searchCourses(q: string): Promise<SearchResult> {
  const { data, error } = await supabase.rpc('search_courses', { q });
  if (error) return { error: error.message };
  return { layouts: (data as any[]).map(toLayout) };
}

/** Creates a course with one par per hole. Returns the cached layout, or an error message to show. */
export async function addCourse(name: string, area: string, pars: number[]): Promise<LayoutRow | string> {
  const { data, error } = await supabase.rpc('add_course', { p_name: name, p_area: area, p_pars: pars });
  if (error) return error.message;
  const row = Array.isArray(data) ? data[0] : data;
  const layout: LayoutRow = {
    layout_id: row.layout_id,
    course_id: row.course_id,
    course_name: name.trim(),
    area: area.trim() || null,
    hole_count: pars.length,
    pars,
    verified: false,
  };
  await upsertLayout(layout);
  return layout;
}

export async function reportCourseIssue(courseId: string, kind: CourseKind, note: string): Promise<string | null> {
  const { error } = await supabase.rpc('report_course_issue', { p_course_id: courseId, p_kind: kind, p_note: note });
  return error?.message ?? null;
}
