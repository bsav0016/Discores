// Builds the public web pages from docs/legal/*.md into site/ (plain HTML, no dependencies).
// App stores ask for public URLs for the privacy policy and for deleting an account: upload site/ to any static
// host (GitHub Pages, Netlify, Cloudflare Pages, ...). Run: node app/scripts/build-site.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = (p) => fileURLToPath(new URL(`../../${p}`, import.meta.url));
const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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

const page = (title, body) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} | Discores</title>
<style>
  :root { --bg:#f3f5ef; --card:#fff; --ink:#14201a; --muted:#667064; --brand:#125c36; --line:#dfe4da; }
  @media (prefers-color-scheme: dark) { :root { --bg:#0f1712; --card:#16211a; --ink:#e8efe9; --muted:#9fb0a3; --brand:#6fcf97; --line:#26352b; } }
  body { margin:0; background:var(--bg); color:var(--ink); font:16px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif; }
  main { max-width:720px; margin:0 auto; padding:24px 16px 64px; }
  article { background:var(--card); border:1px solid var(--line); border-radius:16px; padding:8px 24px 24px; }
  h1 { font-size:28px; margin:24px 0 8px; } h2 { font-size:20px; margin:28px 0 4px; }
  a { color:var(--brand); } ul { padding-left:22px; } .step { margin:6px 0; }
  nav { display:flex; gap:16px; flex-wrap:wrap; margin-bottom:16px; font-weight:600; } footer { color:var(--muted); font-size:14px; margin-top:24px; }
</style>
</head>
<body>
<main>
<nav><a href="index.html">Discores</a><a href="privacy.html">Privacy Policy</a><a href="terms.html">Terms of Service</a><a href="delete-account.html">Delete your account</a></nav>
<article>
${body}
</article>
<footer>Discores is a free disc golf score tracker.</footer>
</main>
</body>
</html>
`;

const docs = [
  ['privacy.html', 'Privacy Policy', 'privacy-policy.md'],
  ['terms.html', 'Terms of Service', 'terms-of-service.md'],
  ['delete-account.html', 'Delete your account', 'delete-account.md'],
];
mkdirSync(root('site'), { recursive: true });
for (const [file, title, src] of docs) {
  writeFileSync(root(`site/${file}`), page(title, toHtml(readFileSync(root(`docs/legal/${src}`), 'utf8'))));
}
writeFileSync(root('site/index.html'), page('Discores', `<h1>Discores</h1>
<p>A free disc golf score tracker: keep score offline, play with friends, and see your stats.</p>
<ul>
<li><a href="privacy.html">Privacy Policy</a></li>
<li><a href="terms.html">Terms of Service</a></li>
<li><a href="delete-account.html">How to delete your account and data</a></li>
</ul>`));
console.log('site/ written:', ['index.html', ...docs.map((d) => d[0])].join(', '));
