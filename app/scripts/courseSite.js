// Builds the public "disc golf courses" pages from the course list. Pure functions (no network, no files) so every
// case is tested; build-courses.js fetches the data and writes the files.
//
// What it makes, and why it is not one page per course:
//  - A page per region (a US state, a country, a Canadian province, an Australian state) listing its courses by city.
//  - A page per course only once its pars have been confirmed by players (layout.verified). Until then a course
//    page would be a name and a placeholder hole count: thin, near-duplicate pages that search engines ignore, and
//    pars that are not real. As players confirm pars in the app, those courses get their page on the next build.
//  - sitemap.xml and robots.txt.

const { tagStoreLink } = require('./growthLinks');

const US_STATES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut',
  DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
  VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};
const CA_PROVINCES = {
  AB: 'Alberta', BC: 'British Columbia', MB: 'Manitoba', NB: 'New Brunswick', NL: 'Newfoundland and Labrador',
  NS: 'Nova Scotia', ON: 'Ontario', PE: 'Prince Edward Island', QC: 'Quebec', SK: 'Saskatchewan',
};
const AU_STATES = {
  NSW: 'New South Wales', QLD: 'Queensland', VIC: 'Victoria', WA: 'Western Australia', SA: 'South Australia',
  TAS: 'Tasmania', ACT: 'Australian Capital Territory', NT: 'Northern Territory',
};
const COUNTRIES = {
  FI: 'Finland', SE: 'Sweden', NO: 'Norway', DK: 'Denmark', EE: 'Estonia', CZ: 'Czechia', GB: 'United Kingdom',
  LV: 'Latvia', NZ: 'New Zealand', HR: 'Croatia', ES: 'Spain', DE: 'Germany', NL: 'Netherlands', IN: 'India',
  FR: 'France', IT: 'Italy', PL: 'Poland', LT: 'Lithuania', AT: 'Austria', CH: 'Switzerland', BE: 'Belgium',
  IE: 'Ireland', PT: 'Portugal', JP: 'Japan', AU: 'Australia', MX: 'Mexico', BR: 'Brazil', ZA: 'South Africa',
  HU: 'Hungary', SK: 'Slovakia', SI: 'Slovenia', RO: 'Romania', BG: 'Bulgaria', GR: 'Greece', IS: 'Iceland',
};

const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Lowercase ASCII with dashes, safe in a file name and a URL. */
function slug(text) {
  const letters = { ø: 'o', Ø: 'O', æ: 'ae', Æ: 'AE', ß: 'ss', đ: 'd', Đ: 'D', ł: 'l', Ł: 'L', þ: 'th', ð: 'd' };
  const s = String(text ?? '')
    .replace(/[øØæÆßđĐłŁþð]/g, (ch) => letters[ch])
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'x';
}

/** "City, ST" -> { city, code }. An area with no comma is only a code (or only a city). */
function splitArea(area) {
  const a = String(area ?? '').trim();
  const m = a.match(/^(.*),\s*([^,]+)$/);
  if (m) return { city: m[1].trim(), code: m[2].trim().toUpperCase() };
  return /^[A-Za-z]{2,3}$/.test(a) ? { city: '', code: a.toUpperCase() } : { city: a, code: '' };
}

/**
 * The region a course belongs to. Two-letter codes are shared between US states and countries (DE is Delaware and
 * Germany, CA is California and Canada, IN is Indiana and India), so the course's rounded position settles those:
 * west of the prime meridian it is the American state, east of it the country.
 */
function regionFor(area, location) {
  const { city, code } = splitArea(area);
  const lon = location && Number.isFinite(location.lon) ? location.lon : null;
  const lat = location && Number.isFinite(location.lat) ? location.lat : null;
  const make = (name, kind) => ({ city, name, kind, slug: slug(name) });

  if (code === 'DE') return lon !== null && lon > 0 ? make('Germany', 'country') : make('Delaware', 'US state');
  if (code === 'IN') return lon !== null && lon > 0 ? make('India', 'country') : make('Indiana', 'US state');
  if (code === 'NL') return lon !== null && lon > 0 ? make('Netherlands', 'country') : make(CA_PROVINCES.NL, 'province');
  if (code === 'CA') {
    // Canada's own provinces use their own codes, so a plain CA is California unless it is clearly north of the border.
    return lat !== null && lat > 49.2 ? make('Canada', 'country') : make('California', 'US state');
  }
  if (code === 'SK' && lon !== null && lon > 0) return make('Slovakia', 'country');
  if (code === 'WA' && lon !== null && lon > 100) return make(AU_STATES.WA, 'state');
  if (US_STATES[code]) return make(US_STATES[code], 'US state');
  if (CA_PROVINCES[code]) return make(CA_PROVINCES[code], 'province');
  if (AU_STATES[code]) return make(AU_STATES[code], 'state');
  if (COUNTRIES[code]) return make(COUNTRIES[code], 'country');
  return make('Other places', 'other');
}

/** Groups courses by region, then by city, each list sorted. Duplicate name+area rows are dropped. */
function groupCourses(courses) {
  const seen = new Set();
  const regions = new Map();
  for (const c of courses) {
    const name = String(c.name ?? '').trim();
    if (!name) continue;
    const key = `${name.toLowerCase()}|${String(c.area ?? '').toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const r = regionFor(c.area, c.location);
    if (!regions.has(r.slug)) regions.set(r.slug, { name: r.name, kind: r.kind, slug: r.slug, cities: new Map(), count: 0 });
    const region = regions.get(r.slug);
    const city = r.city || 'Other';
    if (!region.cities.has(city)) region.cities.set(city, []);
    region.cities.get(city).push({ ...c, name, pageSlug: c.verifiedPars ? `${slug(name)}-${String(c.id).slice(0, 8)}` : null });
    region.count++;
  }
  for (const region of regions.values()) {
    region.cities = new Map([...region.cities.entries()].sort((a, b) => a[0].localeCompare(b[0])));
    for (const list of region.cities.values()) list.sort((a, b) => a.name.localeCompare(b.name));
  }
  return [...regions.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

const CREDIT =
  'Some course data © OpenStreetMap contributors (ODbL), Overture Maps Foundation (CDLA Permissive 2.0) and ' +
  'Foursquare Labs, Inc. (Apache 2.0). Copyright 2024 Foursquare Labs, Inc. All rights reserved.';

function shell({ title, description, canonical, body, depth, jsonLd }) {
  const up = '../'.repeat(depth);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:type" content="website">
${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>\n` : ''}<style>
  :root { --bg:#f3f5ef; --card:#fff; --ink:#14201a; --muted:#667064; --brand:#125c36; --line:#dfe4da; }
  @media (prefers-color-scheme: dark) { :root { --bg:#0f1712; --card:#16211a; --ink:#e8efe9; --muted:#9fb0a3; --brand:#6fcf97; --line:#26352b; } }
  body { margin:0; background:var(--bg); color:var(--ink); font:16px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif; }
  main { max-width:720px; margin:0 auto; padding:24px 16px 64px; }
  article { background:var(--card); border:1px solid var(--line); border-radius:16px; padding:8px 24px 24px; }
  h1 { font-size:28px; margin:24px 0 8px; } h2 { font-size:20px; margin:28px 0 4px; }
  a { color:var(--brand); } ul { padding-left:22px; margin:4px 0; }
  nav { display:flex; gap:16px; flex-wrap:wrap; margin-bottom:16px; font-weight:600; }
  .cta { background:var(--bg); border:1px solid var(--line); border-radius:12px; padding:12px 16px; margin:16px 0; }
  table { border-collapse:collapse; } th, td { border:1px solid var(--line); padding:4px 10px; text-align:center; }
  footer { color:var(--muted); font-size:13px; margin-top:24px; }
</style>
</head>
<body>
<main>
<nav><a href="${up}index.html">Discores</a><a href="${up}courses/index.html">Courses</a><a href="${up}privacy.html">Privacy Policy</a></nav>
<article>
${body}
</article>
<footer>Discores is a free disc golf score tracker. ${esc(CREDIT)}</footer>
</main>
</body>
</html>
`;
}

function cta(config) {
  const links = [];
  // One campaign for every course page: a page per region would be hundreds of campaigns, and the console only needs to
  // know that the installs came from the course pages.
  if (config.appStoreUrl) links.push(`<a href="${esc(tagStoreLink(config.appStoreUrl, 'web-courses'))}">App Store</a>`);
  if (config.playStoreUrl) links.push(`<a href="${esc(tagStoreLink(config.playStoreUrl, 'web-courses'))}">Google Play</a>`);
  const where = links.length ? ` Get it on ${links.join(' or ')}.` : '';
  return `<div class="cta"><strong>Keep score with Discores.</strong> Free, no ads, works offline, and friends can score the round together.${where}</div>`;
}

function regionPage(region, config) {
  const title = `Disc golf courses in ${region.name} | Discores`;
  const description = `${region.count} disc golf course${region.count === 1 ? '' : 's'} in ${region.name}. Find a course and keep score with Discores, free with no ads.`;
  const canonical = `${config.siteUrl}courses/${region.slug}.html`;
  const cities = [...region.cities.entries()].map(([city, list]) => {
    const items = list.map((c) => (c.pageSlug
      ? `<li><a href="c/${c.pageSlug}.html">${esc(c.name)}</a></li>`
      : `<li>${esc(c.name)}</li>`)).join('\n');
    return `<h2>${esc(city)}</h2>\n<ul>\n${items}\n</ul>`;
  }).join('\n');
  const jsonLd = {
    '@context': 'https://schema.org', '@type': 'ItemList', name: title,
    itemListElement: [...region.cities.values()].flat().slice(0, 100).map((c, i) => ({
      '@type': 'ListItem', position: i + 1, name: c.name,
    })),
  };
  const body = `<h1>Disc golf courses in ${esc(region.name)}</h1>
<p>${region.count} course${region.count === 1 ? '' : 's'} listed in ${esc(region.name)}. Pars and hole details are filled in as players confirm them in the app.</p>
${cta(config)}
${cities}`;
  return { path: `courses/${region.slug}.html`, html: shell({ title, description, canonical, body, depth: 1, jsonLd }), url: canonical };
}

function indexPage(regions, config) {
  const title = 'Disc golf courses | Discores';
  const total = regions.reduce((n, r) => n + r.count, 0);
  const description = `Browse ${total} disc golf courses by state and country, and keep score with Discores.`;
  const canonical = `${config.siteUrl}courses/index.html`;
  const group = (label, kinds) => {
    const list = regions.filter((r) => kinds.includes(r.kind));
    if (!list.length) return '';
    return `<h2>${label}</h2>\n<ul>\n${list.sort((a, b) => a.name.localeCompare(b.name)).map((r) =>
      `<li><a href="${r.slug}.html">${esc(r.name)}</a> (${r.count})</li>`).join('\n')}\n</ul>`;
  };
  const body = `<h1>Disc golf courses</h1>
<p>${total} courses, by place. Pick one to see what is listed there.</p>
${cta(config)}
${group('United States', ['US state'])}
${group('Canada', ['province'])}
${group('Australia', ['state'])}
${group('Countries', ['country'])}
${group('Elsewhere', ['other'])}`;
  return { path: 'courses/index.html', html: shell({ title, description, canonical, body, depth: 1 }), url: canonical };
}

function coursePage(course, region, config) {
  const pars = course.verifiedPars;
  const total = pars.reduce((a, b) => a + b, 0);
  const place = course.area || region.name;
  const title = `${course.name}, ${place} | Disc golf course pars | Discores`;
  const description = `${course.name} in ${place}: ${pars.length} holes, par ${total}. Hole-by-hole pars, confirmed by players. Keep score with Discores.`;
  const canonical = `${config.siteUrl}courses/c/${course.pageSlug}.html`;
  const header = pars.map((_, i) => `<th>${i + 1}</th>`).join('');
  const row = pars.map((p) => `<td>${p}</td>`).join('');
  const body = `<h1>${esc(course.name)}</h1>
<p>${esc(place)} · ${pars.length} holes · par ${total}</p>
<p>Pars confirmed by players in the Discores app.</p>
<div style="overflow-x:auto"><table><tr><th>Hole</th>${header}</tr><tr><th>Par</th>${row}</tr></table></div>
${cta(config)}
<p><a href="../${region.slug}.html">More disc golf courses in ${esc(region.name)}</a></p>`;
  return { path: `courses/c/${course.pageSlug}.html`, html: shell({ title, description, canonical, body, depth: 2 }), url: canonical };
}

/** Everything to write: the region pages, the index, a page per course with confirmed pars, the sitemap and robots.txt. */
function buildCourseSite(courses, config) {
  const cfg = { siteUrl: config.siteUrl.endsWith('/') ? config.siteUrl : `${config.siteUrl}/`,
    appStoreUrl: config.appStoreUrl || '', playStoreUrl: config.playStoreUrl || '' };
  const regions = groupCourses(courses);
  const files = [indexPage(regions, cfg)];
  for (const region of regions) {
    files.push(regionPage(region, cfg));
    for (const list of region.cities.values()) {
      for (const c of list) if (c.pageSlug) files.push(coursePage(c, region, cfg));
    }
  }
  const urls = [cfg.siteUrl, ...files.map((f) => f.url)];
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map((u) => `<url><loc>${esc(u)}</loc></url>`).join('\n')}\n</urlset>\n`;
  const robots = `User-agent: *\nAllow: /\n\nSitemap: ${cfg.siteUrl}sitemap.xml\n`;
  return {
    files: [...files.map(({ path, html }) => ({ path, content: html })),
      { path: 'sitemap.xml', content: sitemap }, { path: 'robots.txt', content: robots }],
    regions: regions.length, courses: regions.reduce((n, r) => n + r.count, 0),
    coursePages: files.filter((f) => f.path.startsWith('courses/c/')).length,
  };
}

module.exports = { slug, splitArea, regionFor, groupCourses, buildCourseSite };
