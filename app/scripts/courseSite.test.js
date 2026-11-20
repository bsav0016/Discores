const { slug, splitArea, regionFor, groupCourses, buildCourseSite } = require('./courseSite');
const { parsePoint } = require('./build-courses');

const config = { siteUrl: 'https://example.test/Discores/', appStoreUrl: '', playStoreUrl: '' };
const c = (id, name, area, extra = {}) => ({ id, name, area, location: null, verifiedPars: null, ...extra });

describe('slug', () => {
  it('makes a safe lowercase name and never an empty one', () => {
    expect(slug('Sam Benn Disc Golf Course')).toBe('sam-benn-disc-golf-course');
    expect(slug('Mølndal Frisbeegolf & Pub')).toBe('molndal-frisbeegolf-and-pub');
    expect(slug('  ../..  ')).toBe('x');
    expect(slug('North Carolina')).toBe('north-carolina');
  });
});

describe('splitArea and regionFor', () => {
  it('splits a city and a code, and handles a bare code', () => {
    expect(splitArea('Aberdeen, NC')).toEqual({ city: 'Aberdeen', code: 'NC' });
    expect(splitArea('FI')).toEqual({ city: '', code: 'FI' });
    expect(splitArea('Washington, D.C., DC')).toEqual({ city: 'Washington, D.C.', code: 'DC' });
  });

  it('maps US states, Canadian provinces, Australian states and countries', () => {
    expect(regionFor('Aberdeen, NC', null)).toMatchObject({ name: 'North Carolina', kind: 'US state', city: 'Aberdeen' });
    expect(regionFor('Calgary, AB', null)).toMatchObject({ name: 'Alberta', kind: 'province' });
    expect(regionFor('Brisbane, QLD', null)).toMatchObject({ name: 'Queensland', kind: 'state' });
    expect(regionFor('Aal, NO', null)).toMatchObject({ name: 'Norway', kind: 'country' });
    expect(regionFor('Somewhere, ZZ', null)).toMatchObject({ name: 'Other places', kind: 'other' });
  });

  it('uses the position to tell shared codes apart', () => {
    const us = { lon: -75.5, lat: 39.1 };
    const eu = { lon: 10.0, lat: 51.0 };
    expect(regionFor('Dover, DE', us).name).toBe('Delaware');
    expect(regionFor('Bonn, DE', eu).name).toBe('Germany');
    expect(regionFor('Dover, DE', null).name).toBe('Delaware'); // no position: the American reading
    expect(regionFor('Fort Wayne, IN', { lon: -85, lat: 41 }).name).toBe('Indiana');
    expect(regionFor('Pune, IN', { lon: 73, lat: 18 }).name).toBe('India');
    expect(regionFor('Reno, CA', { lon: -119, lat: 39 }).name).toBe('California');
    expect(regionFor('Edmonton, CA', { lon: -113, lat: 53.5 }).name).toBe('Canada');
    expect(regionFor('Perth, WA', { lon: 115.8, lat: -31.9 }).name).toBe('Western Australia');
    expect(regionFor('Seattle, WA', { lon: -122, lat: 47 }).name).toBe('Washington');
    expect(regionFor('Bratislava, SK', { lon: 17, lat: 48 }).name).toBe('Slovakia');
    expect(regionFor('Regina, SK', { lon: -104, lat: 50 }).name).toBe('Saskatchewan');
  });
});

describe('groupCourses', () => {
  it('groups by region then city, sorted, and drops duplicates and nameless rows', () => {
    const regions = groupCourses([
      c('1', 'Zed Park', 'Raleigh, NC'), c('2', 'Alpha Park', 'Raleigh, NC'), c('3', 'Beta Park', 'Apex, NC'),
      c('4', 'Alpha Park', 'raleigh, nc'), c('5', '', 'Raleigh, NC'), c('6', 'Fin', 'Espoo, FI'),
    ]);
    expect(regions.map((r) => [r.name, r.count])).toEqual([['North Carolina', 3], ['Finland', 1]]);
    expect([...regions[0].cities.keys()]).toEqual(['Apex', 'Raleigh']);
    expect(regions[0].cities.get('Raleigh').map((x) => x.name)).toEqual(['Alpha Park', 'Zed Park']);
  });
});

describe('buildCourseSite', () => {
  const courses = [
    c('11111111-aaaa', 'Maple Hill', 'Raleigh, NC', { verifiedPars: [3, 4, 3] }),
    c('22222222-bbbb', 'Oak Run <script>', 'Raleigh, NC'),
    c('33333333-cccc', 'Kuusi', 'Espoo, FI'),
  ];
  const site = buildCourseSite(courses, config);
  const file = (p) => site.files.find((f) => f.path === p)?.content;

  it('writes the index, a page per region, a page only for confirmed pars, a sitemap and robots.txt', () => {
    expect(site.files.map((f) => f.path).sort()).toEqual([
      'courses/c/maple-hill-11111111.html', 'courses/finland.html', 'courses/index.html',
      'courses/north-carolina.html', 'robots.txt', 'sitemap.xml',
    ]);
    expect(site).toMatchObject({ regions: 2, courses: 3, coursePages: 1 });
  });

  it('lists courses on the region page, linking only the ones with a page, and escapes names', () => {
    const page = file('courses/north-carolina.html');
    expect(page).toContain('<a href="c/maple-hill-11111111.html">Maple Hill</a>');
    expect(page).toContain('<li>Oak Run &lt;script&gt;</li>');
    expect(page).not.toContain('<script>Oak');
    expect(page).toContain('<link rel="canonical" href="https://example.test/Discores/courses/north-carolina.html">');
    expect(page).toContain('© OpenStreetMap contributors');
  });

  it('shows real pars on a confirmed course page and never invents them for others', () => {
    const page = file('courses/c/maple-hill-11111111.html');
    expect(page).toContain('3 holes');
    expect(page).toContain('par 10');
    expect(page).toContain('<td>3</td><td>4</td><td>3</td>');
    expect(file('courses/north-carolina.html')).not.toContain('par 3');
  });

  it('puts every page in the sitemap with absolute URLs, and robots.txt points at it', () => {
    const sitemap = file('sitemap.xml');
    expect(sitemap).toContain('<loc>https://example.test/Discores/courses/finland.html</loc>');
    expect(sitemap).toContain('<loc>https://example.test/Discores/courses/c/maple-hill-11111111.html</loc>');
    expect(file('robots.txt')).toContain('Sitemap: https://example.test/Discores/sitemap.xml');
  });

  it('adds store links only when they are configured', () => {
    expect(file('courses/index.html')).not.toContain('App Store');
    const withLinks = buildCourseSite(courses, { ...config, appStoreUrl: 'https://apps.apple.com/app/id1' });
    expect(withLinks.files.find((f) => f.path === 'courses/index.html').content).toContain('https://apps.apple.com/app/id1');
    expect(withLinks.files.find((f) => f.path === 'courses/index.html').content).toContain('ct=web-courses');
  });
});

describe('parsePoint', () => {
  it('reads a Postgres point as longitude and latitude', () => {
    expect(parsePoint('(-78.64,35.78)')).toEqual({ lon: -78.64, lat: 35.78 });
    expect(parsePoint(null)).toBeNull();
    expect(parsePoint('nope')).toBeNull();
  });
});
