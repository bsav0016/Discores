import { holesScored, relativeToPar, totalStrokes, type ScoreMap } from './scoring';

/** A finished round, with the signed-in player's own scores. */
export type StatRound = {
  id: string;
  layoutId: string;
  courseName: string;
  pars: number[];
  startedAt: string;
  scores: ScoreMap;
};

export type Outcomes = { eagle: number; birdie: number; par: number; bogey: number; double: number };

export type CourseStats = {
  layoutId: string;
  courseName: string;
  holeCount: number;
  /** Rounds where every hole was scored, oldest first. Best and average use only these. */
  rounds: { id: string; startedAt: string; total: number; relative: number }[];
  bestRelative: number | null;
  bestTotal: number | null;
  averageRelative: number | null;
  /** Average strokes minus par for each hole (index 0 = hole 1), across every round that scored it. */
  holeAverages: (number | null)[];
};

export type Stats = {
  rounds: number;
  holes: number;
  best: { courseName: string; relative: number; total: number } | null;
  outcomes: Outcomes;
  courses: CourseStats[];
};

const emptyOutcomes = (): Outcomes => ({ eagle: 0, birdie: 0, par: 0, bogey: 0, double: 0 });

/** eagle = 2 or more under par, double = 2 or more over. */
export function addOutcome(o: Outcomes, strokes: number, par: number) {
  const d = strokes - par;
  if (d <= -2) o.eagle++;
  else if (d === -1) o.birdie++;
  else if (d === 0) o.par++;
  else if (d === 1) o.bogey++;
  else o.double++;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function computeStats(input: StatRound[]): Stats {
  const sorted = [...input].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const outcomes = emptyOutcomes();
  const byLayout = new Map<string, StatRound[]>();
  let holes = 0;
  let rounds = 0;
  for (const r of sorted) {
    const scored = holesScored(r.scores);
    if (scored === 0) continue;
    rounds++;
    holes += scored;
    for (const [hole, strokes] of Object.entries(r.scores)) {
      const par = r.pars[Number(hole) - 1];
      if (par !== undefined) addOutcome(outcomes, strokes, par);
    }
    byLayout.set(r.layoutId, [...(byLayout.get(r.layoutId) ?? []), r]);
  }

  const courses: CourseStats[] = [...byLayout.entries()].map(([layoutId, rs]) => {
    const latest = rs[rs.length - 1];
    const complete = rs
      .filter((r) => holesScored(r.scores) >= r.pars.length)
      .map((r) => ({
        id: r.id, startedAt: r.startedAt, total: totalStrokes(r.scores), relative: relativeToPar(r.pars, r.scores),
      }));
    const best = complete.reduce<(typeof complete)[number] | null>((b, r) => (!b || r.relative < b.relative ? r : b), null);
    const holeAverages = latest.pars.map((par, i) => {
      const diffs = rs
        .filter((r) => r.pars.length === latest.pars.length && r.scores[i + 1] !== undefined)
        .map((r) => r.scores[i + 1] - r.pars[i]);
      return diffs.length ? round1(diffs.reduce((a, b) => a + b, 0) / diffs.length) : null;
    });
    return {
      layoutId,
      courseName: latest.courseName,
      holeCount: latest.pars.length,
      rounds: complete,
      bestRelative: best?.relative ?? null,
      bestTotal: best?.total ?? null,
      averageRelative: complete.length ? round1(complete.reduce((a, r) => a + r.relative, 0) / complete.length) : null,
      holeAverages,
    };
  });
  // Most played first, then by name.
  courses.sort((a, b) => (byLayout.get(b.layoutId)!.length - byLayout.get(a.layoutId)!.length) || a.courseName.localeCompare(b.courseName));

  let best: Stats['best'] = null;
  for (const c of courses) {
    if (c.bestRelative !== null && (!best || c.bestRelative < best.relative)) {
      best = { courseName: c.courseName, relative: c.bestRelative, total: c.bestTotal! };
    }
  }
  return { rounds, holes, best, outcomes, courses };
}
