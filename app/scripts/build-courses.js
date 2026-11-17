// Writes the public course pages into site/ from the live course list. Run by the "Publish site" workflow (weekly and
// on every site change); the files are not committed. Needs only the public Supabase URL and anon key, the same values
// the app ships with, and the same course data the app already lets any visitor search.
//
//   node app/scripts/build-courses.js [outDir]
//
// Environment (all optional): SUPABASE_URL, SUPABASE_ANON_KEY (default: the production values in app/eas.json),
// SITE_URL (default https://bsav0016.github.io/Discores/), APP_STORE_URL, PLAY_STORE_URL.
//
// It refuses to write anything when the data looks wrong (too few courses), so a bad fetch can never replace a good
// published site with an empty one: the job fails and the previous deploy stays up.
const fs = require('node:fs');
const path = require('node:path');
const { buildCourseSite } = require('./courseSite');

const MIN_COURSES = 500;

function publicSettings() {
  let env = {};
  try {
    const eas = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'eas.json'), 'utf8'));
    env = eas.build.production.env;
  } catch {
    // eas.json is optional when the environment provides both values
  }
  const url = process.env.SUPABASE_URL || env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY || env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('No Supabase URL and anon key: set SUPABASE_URL and SUPABASE_ANON_KEY.');
  return { url: url.replace(/\/$/, ''), key };
}

async function fetchAll(settings, table, query) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const res = await fetch(`${settings.url}/rest/v1/${table}?${query}&limit=1000&offset=${offset}`, {
      headers: { apikey: settings.key, Authorization: `Bearer ${settings.key}` },
    });
    if (!res.ok) throw new Error(`${table}: HTTP ${res.status}`);
    const page = await res.json();
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

/** "(lon,lat)" from a Postgres point, or null. */
function parsePoint(value) {
  const m = typeof value === 'string' && value.match(/^\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)$/);
  return m ? { lon: Number(m[1]), lat: Number(m[2]) } : null;
}

async function loadCourses(settings) {
  const courses = await fetchAll(settings, 'courses', 'select=id,name,area,location_approx&order=id');
  const layouts = await fetchAll(settings, 'course_layouts', 'select=id,course_id,verified,hole_count&order=id');
  const verified = layouts.filter((l) => l.verified === true);
  const holes = new Map();
  for (let i = 0; i < verified.length; i += 100) {
    const ids = verified.slice(i, i + 100).map((l) => l.id).join(',');
    for (const h of await fetchAll(settings, 'holes', `select=layout_id,number,par&layout_id=in.(${ids})&order=layout_id,number`)) {
      if (!holes.has(h.layout_id)) holes.set(h.layout_id, []);
      holes.get(h.layout_id)[h.number - 1] = h.par;
    }
  }
  const parsByCourse = new Map();
  for (const l of verified) {
    const pars = holes.get(l.id);
    // Only a full, real set of pars (2 to 6) counts; anything else stays a plain list entry.
    if (pars && pars.length === l.hole_count && pars.every((p) => Number.isInteger(p) && p >= 2 && p <= 6)) {
      if (!parsByCourse.has(l.course_id)) parsByCourse.set(l.course_id, pars);
    }
  }
  return courses.map((c) => ({
    id: c.id, name: c.name, area: c.area, location: parsePoint(c.location_approx),
    verifiedPars: parsByCourse.get(c.id) || null,
  }));
}

async function main() {
  const out = path.resolve(process.argv[2] || path.join(__dirname, '..', '..', 'site'));
  const courses = await loadCourses(publicSettings());
  if (courses.length < MIN_COURSES) throw new Error(`Only ${courses.length} courses came back; refusing to publish.`);
  const site = buildCourseSite(courses, {
    siteUrl: process.env.SITE_URL || 'https://bsav0016.github.io/Discores/',
    appStoreUrl: process.env.APP_STORE_URL, playStoreUrl: process.env.PLAY_STORE_URL,
  });
  for (const f of site.files) {
    const target = path.join(out, f.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, f.content);
  }
  console.log(`Wrote ${site.files.length} files: ${site.regions} regions, ${site.courses} courses, ${site.coursePages} course pages.`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}

module.exports = { parsePoint };
