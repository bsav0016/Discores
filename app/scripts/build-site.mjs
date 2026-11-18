// Builds the public web pages into site/ (plain HTML, no dependencies): the home page, the legal pages (from
// docs/legal), and the FAQ, support and press pages (from docs/site). The course pages are built separately by
// build-courses.js. App stores ask for public URLs for the privacy policy, support and deleting an account: upload
// site/ to any static host (GitHub Pages, Netlify, Cloudflare Pages, ...). Run: node app/scripts/build-site.mjs
//
// SITE_URL (default the GitHub Pages address) sets the canonical and preview-image addresses. The Publish site
// workflow builds with the repository variable of the same name, so a custom domain needs no code change.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import growthLinks from './growthLinks.js';

const root = (p) => fileURLToPath(new URL(`../../${p}`, import.meta.url));
const SITE = (process.env.SITE_URL || 'https://bsav0016.github.io/Discores/').replace(/\/?$/, '/');
const APP_STORE = 'https://apps.apple.com/us/app/discores-disc-golf-scorecard/id6820334635';
const PLAY_STORE = 'https://play.google.com/store/apps/details?id=com.discores.app';
const APP_STORE_ID = '6820334635';

const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const inline = (t) =>
  esc(t)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');

function toHtml(md) {
  const out = [];
  let list = false;
  const closeList = () => list && (out.push('</ul>'), (list = false));
  for (const raw of md.replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/)) {
    const t = raw.trim();
    if (!t) { closeList(); continue; }
    if (t.startsWith('- ')) { if (!list) out.push('<ul>'); list = true; out.push(`<li>${inline(t.slice(2))}</li>`); continue; }
    closeList();
    const num = t.match(/^\d+\.\s+(.*)/);
    if (num) { out.push(`<p class="step">${inline(t)}</p>`); continue; }
    if (t.startsWith('## ')) out.push(`<h2>${inline(t.slice(3))}</h2>`);
    else if (t.startsWith('# ')) out.push(`<h1>${inline(t.slice(2))}</h1>`);
    else out.push(`<p>${inline(t)}</p>`);
  }
  closeList();
  return out.join('\n');
}

const DEFAULT_DESCRIPTION =
  'Discores is a free disc golf scorecard that works with no signal. Keep score, play with friends and see your stats. No ads, no tracking.';

const CSS = `
  :root { --bg:#f3f5ef; --card:#fff; --ink:#14201a; --muted:#667064; --brand:#125c36; --brand-ink:#fff; --soft:#e3efe7; --line:#dfe4da; }
  @media (prefers-color-scheme: dark) { :root { --bg:#0f1712; --card:#16211a; --ink:#e8efe9; --muted:#9fb0a3; --brand:#6fcf97; --brand-ink:#0f1712; --soft:#1d2e23; --line:#26352b; } }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font:16px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif; }
  main { max-width:720px; margin:0 auto; padding:24px 16px 64px; } main.wide { max-width:960px; }
  article { background:var(--card); border:1px solid var(--line); border-radius:16px; padding:8px 24px 24px; }
  h1 { font-size:28px; margin:24px 0 8px; } h2 { font-size:20px; margin:28px 0 4px; }
  a { color:var(--brand); } ul { padding-left:22px; } .step { margin:6px 0; }
  nav { display:flex; gap:6px 18px; flex-wrap:wrap; margin-bottom:16px; font-weight:600; } nav a { text-decoration:none; }
  footer { color:var(--muted); font-size:14px; margin-top:24px; } footer a { color:var(--muted); }
  .hero { text-align:center; padding:24px 8px 8px; } .hero img { width:96px; height:96px; border-radius:22px; }
  .hero h1 { font-size:clamp(30px,6vw,44px); line-height:1.15; margin:16px 0 8px; letter-spacing:-.5px; }
  .lead { font-size:18px; color:var(--muted); max-width:560px; margin:0 auto 20px; }
  .buttons { display:flex; gap:12px; justify-content:center; flex-wrap:wrap; }
  .btn { display:inline-block; background:var(--brand); color:var(--brand-ink); text-decoration:none; font-weight:700; padding:12px 22px; border-radius:12px; }
  .btn.soft { background:var(--soft); color:var(--brand); }
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(210px,1fr)); gap:14px; margin:28px 0; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:16px; padding:16px 18px; }
  .card h2 { margin:0 0 4px; font-size:18px; } .card p { margin:0; color:var(--muted); }
  .shots { display:flex; gap:14px; overflow-x:auto; padding:6px 2px 14px; scroll-snap-type:x proximity; }
  .shots figure { margin:0; flex:0 0 auto; scroll-snap-align:start; text-align:center; font-size:14px; color:var(--muted); }
  .shots img { display:block; width:200px; height:auto; border-radius:18px; border:1px solid var(--line); margin-bottom:6px; }
  .band { background:var(--soft); border-radius:16px; padding:20px 22px; text-align:center; margin:12px 0; }
  .band h2 { margin:0 0 4px; }
`;

const NAV = [
  ['index.html', 'Discores'], ['courses/index.html', 'Courses'], ['faq.html', 'FAQ'], ['support.html', 'Support'],
  ['press.html', 'Press'], ['privacy.html', 'Privacy'],
];

// Every page's store buttons carry a campaign named after the page (web-home, web-faq, ...), so installs that came from
// the site can be told apart in the store consoles. See docs/GROWTH_LINKS.md.
function page(options) {
  const campaign = `web-${options.file.replace(/\.html$/, '')}`;
  return pageHtml(options)
    .split(`"${APP_STORE}"`).join(`"${growthLinks.tagStoreLink(APP_STORE, campaign).replace(/&/g, '&amp;')}"`)
    .split(`"${PLAY_STORE}"`).join(`"${growthLinks.tagStoreLink(PLAY_STORE, campaign).replace(/&/g, '&amp;')}"`);
}

function pageHtml({ file, title, body, description = DEFAULT_DESCRIPTION, wide = false, jsonLd = null, fullTitle = null }) {
  const heading = fullTitle || `${title} | Discores`;
  const url = `${SITE}${file === 'index.html' ? '' : file}`;
  const nav = NAV.map(([href, label]) => `<a href="${href}">${label}</a>`).join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(heading)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(url)}">
<link rel="icon" href="img/icon.png">
<meta name="apple-itunes-app" content="app-id=${APP_STORE_ID}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Discores">
<meta property="og:title" content="${esc(heading)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(`${SITE}img/og.png`)}">
<meta name="twitter:card" content="summary_large_image">
${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>\n` : ''}<style>${CSS}</style>
</head>
<body>
<main${wide ? ' class="wide"' : ''}>
<nav>${nav}</nav>
${wide ? body : `<article>\n${body}\n</article>`}
<footer>Discores is a free disc golf score tracker by Savidge Apps. <a href="terms.html">Terms</a> · <a href="delete-account.html">Delete your account</a> · <a href="mailto:savidgeapps@gmail.com">savidgeapps@gmail.com</a></footer>
</main>
</body>
</html>
`;
}

mkdirSync(root('site'), { recursive: true });

const docs = [
  ['privacy.html', 'Privacy Policy', 'legal/privacy-policy.md', 'How Discores handles your data: what we collect, who can see it, and how to delete it.'],
  ['terms.html', 'Terms of Service', 'legal/terms-of-service.md', 'The terms for using Discores.'],
  ['delete-account.html', 'Delete your account', 'legal/delete-account.md', 'How to delete your Discores account and data.'],
  ['faq.html', 'FAQ', 'site/faq.md', 'Answers about Discores: it is free, works offline, and how friends, courses and your data work.'],
  ['support.html', 'Support', 'site/support.md', 'Get help with Discores, or tell us about a bug or an idea.'],
  ['press.html', 'Press kit', 'site/press.md', 'Facts, images and contact for anyone writing about Discores.'],
];
for (const [file, title, src, description] of docs) {
  writeFileSync(root(`site/${file}`), page({ file, title, description, body: toHtml(readFileSync(root(`docs/${src}`), 'utf8')) }));
}

const features = [
  ['Works with no signal', 'Every score is saved on your phone first. Score the whole round in the woods and it syncs when you are back online.'],
  ['Play with friends', 'Add friends by code, QR code or link. Each friend confirms their own scores, so nobody ends up with a score they did not play.'],
  ['Know your game', 'Your best score at every course, how you do on each hole, and a birdie, par and bogey breakdown.'],
  ['Private by design', 'No ads and no tracking. We never sell your data, and you can score as a guest with no account.'],
];
const shots = [
  ['scoring.png', 'Scoring a round: tap to set each player\'s strokes on the hole', 'Score a hole in a tap'],
  ['courses.png', 'Searching for a course by name', 'Find your course'],
  ['stats.png', 'Stats: birdies, pars and bogeys, and the average on every hole', 'See how you play'],
  ['history.png', 'Round history with scores against par', 'Every round, saved'],
];
const home = `<section class="hero">
<img src="img/icon.png" alt="Discores icon" width="96" height="96">
<h1>Disc golf scoring that works anywhere</h1>
<p class="lead">A free scorecard for you and your group. Keep score with no signal, play with friends and see how you play every hole. No ads.</p>
<div class="buttons"><a class="btn" href="${APP_STORE}">Get it on the App Store</a><a class="btn" href="${PLAY_STORE}">Get it on Google Play</a></div>
</section>
<section class="grid">
${features.map(([h, p]) => `<div class="card"><h2>${esc(h)}</h2><p>${esc(p)}</p></div>`).join('\n')}
</section>
<section class="shots" aria-label="Screenshots">
${shots.map(([f, alt, cap]) => `<figure><img src="img/${f}" alt="${esc(alt)}" width="200" height="444" loading="lazy">${esc(cap)}</figure>`).join('\n')}
</section>
<section class="band">
<h2>Find a course near you</h2>
<p>More than 3,000 disc golf courses worldwide, by state and country.</p>
<a class="btn" href="courses/index.html">Browse courses</a>
</section>`;
writeFileSync(root('site/index.html'), page({
  file: 'index.html', title: 'Discores', fullTitle: 'Discores: free disc golf scorecard that works offline', body: home, wide: true,
  jsonLd: {
    '@context': 'https://schema.org', '@type': 'MobileApplication', name: 'Discores',
    description: DEFAULT_DESCRIPTION, applicationCategory: 'SportsApplication', operatingSystem: 'iOS, Android',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' }, url: SITE,
    author: { '@type': 'Organization', name: 'Savidge Apps' },
  },
}));
console.log('site/ written:', ['index.html', ...docs.map((d) => d[0])].join(', '));
