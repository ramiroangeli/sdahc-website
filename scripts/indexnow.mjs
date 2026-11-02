// Tells Bing, Copilot, Yandex, Seznam and Naver (via IndexNow) that the site's pages have
// changed, so they recrawl within hours instead of weeks. Google does not use IndexNow.
//
// Run AFTER a production deploy has finished (the key file must be live):
//   npm run indexnow                       submit every URL in the live sitemap
//   npm run indexnow -- /sda-statistics/   submit only the paths given
//
// The key below is public by design: IndexNow verifies ownership by fetching
// https://sdahomechoices.com.au/<key>.txt, which lives in public/. It is not a secret.
const HOST = 'sdahomechoices.com.au';
const SITE = `https://${HOST}`;
const KEY = 'd1a85b2289a7e37e1bda147ec91d17a9';

async function sitemapUrls() {
  const index = await (await fetch(`${SITE}/sitemap-index.xml`)).text();
  const maps = [...index.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const urls = [];
  for (const map of maps) {
    const xml = await (await fetch(map)).text();
    urls.push(...[...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]));
  }
  return urls;
}

const args = process.argv.slice(2);
const urlList = args.length ? args.map((p) => new URL(p, SITE).href) : await sitemapUrls();
if (!urlList.length) {
  console.error('No URLs to submit.');
  process.exit(1);
}

const res = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ host: HOST, key: KEY, keyLocation: `${SITE}/${KEY}.txt`, urlList }),
});
console.log(`IndexNow: HTTP ${res.status} for ${urlList.length} URL(s)`);
// 200 and 202 both mean accepted. 403 means the key file is not reachable on the live site yet.
process.exit(res.ok ? 0 : 1);
