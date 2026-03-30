#!/usr/bin/env node
/**
 * Interactive setup script for a new Klook attraction landing page.
 *
 * Usage:
 *   node scripts/setup.js
 *
 * Fills in src/data/site.json, data/prices.json, CNAME, robots.txt,
 * and package.json based on answers to a short questionnaire.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ROOT = path.join(__dirname, '..');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(question, defaultValue = '') {
  return new Promise(resolve => {
    const hint = defaultValue ? ` [${defaultValue}]` : '';
    rl.question(`${question}${hint}: `, answer => {
      resolve(answer.trim() || defaultValue);
    });
  });
}

async function askMenu(question, options) {
  return new Promise(resolve => {
    console.log(`\n${question}`);
    options.forEach((opt, i) => console.log(`  ${i + 1}. ${opt.label}`));
    rl.question('Enter number [1]: ', answer => {
      const idx = parseInt(answer, 10) - 1;
      resolve(options[Math.max(0, Math.min(idx, options.length - 1))] || options[0]);
    });
  });
}

function header(text) {
  console.log(`\n── ${text} ──────────────────────────────────`);
}

async function main() {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║  Klook Landing Page — Setup Wizard     ║');
  console.log('╚════════════════════════════════════════╝');
  console.log('\nAnswer the questions below. Press Enter to accept the default.\n');

  // ── Identity ────────────────────────────────────────────────────────────────
  header('Attraction');
  const attractionName = await ask('Full official name (e.g. Ramayana Water Park)');
  if (!attractionName) {
    console.error('\nError: attraction name is required.');
    rl.close();
    process.exit(1);
  }

  const siteName = await ask('Site name for navbar/footer', `${attractionName} Guide`);
  const domain = await ask('Domain (without https://, e.g. ramayana-waterpark.com)');
  if (!domain) {
    console.error('\nError: domain is required.');
    rl.close();
    process.exit(1);
  }

  const schemaChoice = await askMenu('Schema.org type', [
    { label: 'AmusementPark — theme parks, water parks', value: 'AmusementPark' },
    { label: 'TouristAttraction — general sightseeing', value: 'TouristAttraction' },
    { label: 'Zoo — zoos, aquariums, wildlife parks', value: 'Zoo' },
    { label: 'Museum — museums, galleries', value: 'Museum' },
    { label: 'NaturalFeature — natural landmarks', value: 'NaturalFeature' },
  ]);
  const schemaType = schemaChoice.value;

  const officialUrl = await ask('Official website URL', `https://${domain}`);
  const contactEmail = await ask('Contact email (optional)');

  // ── Klook ───────────────────────────────────────────────────────────────────
  header('Klook');
  const klookActivityUrl = await ask('Klook activity page URL');
  const klookAffiliateUrl = await ask('Klook affiliate redirect URL', klookActivityUrl);

  // Extract numeric activity ID from URL
  const activityIdMatch = klookActivityUrl.match(/activity\/(\d+)/);
  const activityId = activityIdMatch ? activityIdMatch[1] : '00000';

  // ── Location ────────────────────────────────────────────────────────────────
  header('Location');
  const street = await ask('Street address');
  const locality = await ask('City / district (e.g. Pattaya)');
  const region = await ask('Region / province (e.g. Chon Buri)');
  const postalCode = await ask('Postal code');
  const country = await ask('Country code (ISO 3166-1 alpha-2, e.g. TH)');
  const latitude = await ask('Latitude (decimal, e.g. 12.8428)');
  const longitude = await ask('Longitude (decimal, e.g. 100.9142)');

  // ── Contact ─────────────────────────────────────────────────────────────────
  header('Contact (optional — press Enter to skip)');
  const phone = await ask('Phone number (display format, e.g. +66 33 004 999)');
  const defaultPhoneTel = phone.replace(/[\s\-\(\)]/g, '');
  const phoneTel = await ask('Phone for tel: link (digits only)', defaultPhoneTel);

  // ── Maps ────────────────────────────────────────────────────────────────────
  header('Google Maps (optional)');
  const mapsUrl = await ask('Google Maps share URL (maps.google.com/...)');
  const mapsEmbed = await ask('Google Maps embed URL (Share → Embed → src="...")');

  // ── Opening hours ───────────────────────────────────────────────────────────
  header('Opening Hours');
  const opensAt = await ask('Opens at (HH:MM)', '09:00');
  const closesAt = await ask('Closes at (HH:MM)', '18:00');

  // ── Social ──────────────────────────────────────────────────────────────────
  header('Social Media (optional)');
  const facebook = await ask('Facebook page URL');
  const instagram = await ask('Instagram profile URL');
  const tiktok = await ask('TikTok profile URL');

  // ── Blog author ─────────────────────────────────────────────────────────────
  header('Blog');
  const authorName = await ask('Blog author name', 'Editorial Team');

  // ── Analytics ───────────────────────────────────────────────────────────────
  header('Analytics (optional)');
  const gtagId = await ask('Google Analytics Measurement ID (G-XXXXXXXXXX)');

  rl.close();

  // ── Build geo strings ────────────────────────────────────────────────────────
  const lat = latitude || '0';
  const lng = longitude || '0';
  const geoRegion = country ? `${country}-` : '';

  // ── Update src/data/site.json ────────────────────────────────────────────────
  const sitePath = path.join(ROOT, 'src', 'data', 'site.json');
  const site = JSON.parse(fs.readFileSync(sitePath, 'utf8'));

  site.baseUrl = `https://${domain}`;
  site.siteName = siteName;
  site.attractionName = attractionName;
  site.alternateNames = [attractionName];
  site.schemaType = schemaType;
  site.officialUrl = officialUrl;
  site.contactEmail = contactEmail;
  site.gtagId = gtagId;
  site.address = { street, locality, region, postalCode, country };
  site.openingHours = [
    {
      dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
      opens: opensAt,
      closes: closesAt,
    },
  ];
  const dayAbbr = 'Mo-Su';
  site.openingHoursText = `${dayAbbr} ${opensAt}-${closesAt}`;
  site.klook = { activityUrl: klookActivityUrl, affiliateUrl: klookAffiliateUrl };
  site.blog.authorName = authorName;
  site.blog.authorUrl = `https://${domain}/about.html`;
  site.blog.imageSearchQuery = `${attractionName} ${locality} ${country}`.trim();
  site.blog.doNotTranslate = [attractionName];
  site.mapsEmbed = mapsEmbed;
  site.mapsUrl = mapsUrl;
  site.social = { facebook, instagram, tiktok };
  site.phone = phone;
  site.phoneTel = phoneTel;
  site.geo = {
    placename: locality || attractionName,
    region: geoRegion,
    position: `${lat};${lng}`,
    ICBM: `${lat}, ${lng}`,
    latitude: lat,
    longitude: lng,
  };

  fs.writeFileSync(sitePath, JSON.stringify(site, null, 2) + '\n');
  console.log('\n✓ src/data/site.json');

  // ── Update data/prices.json ──────────────────────────────────────────────────
  const pricesPath = path.join(ROOT, 'data', 'prices.json');
  const prices = JSON.parse(fs.readFileSync(pricesPath, 'utf8'));
  prices.activityId = activityId;
  fs.writeFileSync(pricesPath, JSON.stringify(prices, null, 2) + '\n');
  console.log('✓ data/prices.json (activityId)');

  // ── Update CNAME ─────────────────────────────────────────────────────────────
  fs.writeFileSync(path.join(ROOT, 'CNAME'), domain + '\n');
  console.log('✓ CNAME');

  // ── Update robots.txt ────────────────────────────────────────────────────────
  const robotsPath = path.join(ROOT, 'robots.txt');
  const robots = fs.readFileSync(robotsPath, 'utf8')
    .replace(/Sitemap:.*/, `Sitemap: https://${domain}/sitemap.xml`);
  fs.writeFileSync(robotsPath, robots);
  console.log('✓ robots.txt');

  // ── Update package.json ──────────────────────────────────────────────────────
  const pkgPath = path.join(ROOT, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  pkg.name = domain.replace(/\./g, '-');
  pkg.description = `Klook affiliate landing page for ${attractionName}`;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  console.log('✓ package.json');

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║  Setup complete!                        ║');
  console.log('╚════════════════════════════════════════╝');
  console.log(`
Attraction : ${attractionName}
Domain     : ${domain}
Klook ID   : ${activityId}
Schema     : ${schemaType}

Next steps:
  1.  npm install
  2.  Review src/data/site.json — add rating, amenities, alternate names
  3.  Fill src/i18n/en.json with page content (or ask Claude Code to do it)
  4.  Update scripts/scrape-klook.js PACKAGE_MATCHERS for this attraction's tickets
  5.  Add images (logo.png, hero-desktop.jpg, og-home.jpg) to images/
  6.  npm run build   →  should produce 276+ HTML files with no errors
  7.  Set GitHub Secrets: FIRECRAWL_API_KEY, OPENROUTER_API_KEY
`);
}

main().catch(err => {
  console.error('\nSetup failed:', err.message);
  rl.close();
  process.exit(1);
});
