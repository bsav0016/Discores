// Fetch disc golf courses from OpenStreetMap (Overpass) and write SQL that loads them.
//
//   node supabase/osm/import-osm.mjs --region US-KY [out.sql]          (a state or country by ISO 3166-2 code)
//   node supabase/osm/import-osm.mjs <south> <west> <north> <east> [out.sql]   (a bounding box)
//   e.g. node supabase/osm/import-osm.mjs 30.0 -98.2 30.6 -97.4 austin.sql
//
// Then run the file in the Supabase SQL editor. It calls import_osm_courses(), which skips osm_ids that are
// already loaded, so re-running is safe. Prefer --region over a box: a box also grabs neighbouring states.
//
// Data (c) OpenStreetMap contributors, ODbL. The app shows this attribution on the course search screen.
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
let selector;
let regionLabel = '';
let out;
if (args[0] === '--region') {
  const code = args[1];
  if (!/^[A-Z]{2}(-[A-Z0-9]{1,3})?$/.test(code ?? '')) {
    console.error('usage: node import-osm.mjs --region US-KY [out.sql]');
    process.exit(1);
  }
  selector = `area["ISO3166-2"="${code}"]->.r;nwr["leisure"="disc_golf_course"]["name"](area.r);`;
  regionLabel = code.includes('-') ? code.split('-')[1] : code; // "KY": used when OSM has no city for a course
  out = args[2] ?? 'osm-courses.sql';
} else {
  const [s, w, n, e] = args;
  if ([s, w, n, e].some((v) => v === undefined || Number.isNaN(Number(v)))) {
    console.error('usage: node import-osm.mjs --region US-KY [out.sql]\n   or: node import-osm.mjs <south> <west> <north> <east> [out.sql]');
    process.exit(1);
  }
  selector = `nwr["leisure"="disc_golf_course"]["name"](${s},${w},${n},${e});`;
  out = args[4] ?? 'osm-courses.sql';
}

const query = `[out:json][timeout:90];${selector}out center tags;`;
const res = await fetch('https://overpass-api.de/api/interpreter', {
  method: 'POST',
  headers: { 'User-Agent': 'Discores-import/1.0 (course data import)' },
  body: new URLSearchParams({ data: query }),
});
if (!res.ok) {
  console.error(`Overpass returned ${res.status}`);
  process.exit(1);
}
const { elements } = await res.json();

const items = elements
  .map((el) => {
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    const t = el.tags ?? {};
    const holes = Number.parseInt(t.holes ?? '', 10);
    // "Louisville, KY" when OSM has a city; otherwise just the state code so searching "KY" still finds it.
    const area = [t['addr:city'], t['addr:state'] || regionLabel].filter(Boolean).join(', ');
    return {
      osm_id: `${el.type}/${el.id}`,
      name: String(t.name).trim(),
      area,
      lat,
      lng,
      holes: Number.isFinite(holes) && holes >= 1 && holes <= 36 ? holes : 18, // OSM rarely records hole count
    };
  })
  .filter((i) => i.name && Number.isFinite(i.lat) && Number.isFinite(i.lng));

// Dollar-quote with a tag that cannot appear in the JSON.
const tag = `osm${Date.now()}`;
writeFileSync(out, `select public.import_osm_courses($${tag}$${JSON.stringify(items)}$${tag}$::jsonb);\n`);
console.log(`${items.length} courses written to ${out}`);
