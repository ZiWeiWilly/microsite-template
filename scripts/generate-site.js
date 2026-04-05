#!/usr/bin/env node
/**
 * Automated site generation pipeline for Klook attraction landing pages.
 *
 * Takes a JSON config file and orchestrates the full pipeline:
 *   1. Research attraction via Claude API
 *   2. Fill site.json, prices.json, CNAME, robots.txt
 *   3. Generate English i18n content (5 parallel Sonnet calls)
 *   4. Translate to 11 languages (batched Haiku calls)
 *   5. Generate data files (attractions.json, tips.json, home.json)
 *   6. Download images (hero, OG)
 *   7. Apply CSS theme colours
 *   8. Generate blog topics + first post
 *   9. Build + generate sitemap
 *
 * Usage:
 *   node scripts/generate-site.js site-config.json
 *
 * Required env var: OPENROUTER_API_KEY
 *
 * Config file format:
 *   {
 *     "attractionName": "Ramayana Water Park",
 *     "klookUrl": "https://www.klook.com/activity/12345-...",
 *     "domain": "ramayana-waterpark.guide",
 *     "affiliateUrl": "https://affiliate.klook.com/redirect?aid=...",
 *     "baseCurrency": "THB",
 *     "colors": { "primary": "#0ea5e9", "secondary": "#06b6d4", "accent": "#f59e0b" },
 *     "languages": ["en","zh-CN","zh-TW","ja","ko","ru","hi","ms","vi","de","fr","lo"]
 *   }
 */

const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ── Paths ────────────────────────────────────────────────────────────────────
const ROOT        = path.join(__dirname, '..');
const SRC         = path.join(ROOT, 'src');
const I18N_DIR    = path.join(SRC, 'i18n');
const DATA_DIR    = path.join(SRC, 'data');
const TEMPLATES   = path.join(SRC, 'templates', 'pages');
const IMAGES_DIR  = path.join(ROOT, 'images');
const TMP_DIR     = path.join(I18N_DIR, '.tmp');

// ── Config ───────────────────────────────────────────────────────────────────
const TEXT_MODEL      = 'anthropic/claude-sonnet-4-6';
const TRANSLATE_MODEL = 'anthropic/claude-haiku-3-5';

const ALL_LANGUAGES = [
  { code: 'en',    name: 'English' },
  { code: 'zh-CN', name: 'Simplified Chinese (Mandarin)' },
  { code: 'zh-TW', name: 'Traditional Chinese' },
  { code: 'ja',    name: 'Japanese' },
  { code: 'ko',    name: 'Korean' },
  { code: 'ru',    name: 'Russian' },
  { code: 'hi',    name: 'Hindi' },
  { code: 'ms',    name: 'Malay' },
  { code: 'vi',    name: 'Vietnamese' },
  { code: 'de',    name: 'German' },
  { code: 'fr',    name: 'French' },
  { code: 'lo',    name: 'Lao' },
];

// ── Helpers ──────────────────────────────────────────────────────────────────
function log(msg) { console.log(`[generate-site] ${msg}`); }
function warn(msg) { console.warn(`[generate-site] WARN: ${msg}`); }
function die(msg) { console.error(`[generate-site] ERROR: ${msg}`); process.exit(1); }

/** Strip markdown code fences and parse JSON, with repair for truncated responses */
function extractJSON(text) {
  const stripped = text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
  const start = stripped.search(/[{[]/);
  if (start === -1) throw new Error('No JSON found in model response');
  let jsonStr = stripped.slice(start);
  try {
    return JSON.parse(jsonStr);
  } catch (firstErr) {
    // Attempt to repair truncated JSON by closing open strings and brackets
    warn(`JSON parse failed (${firstErr.message}), attempting repair...`);
    let repaired = jsonStr;
    // Close any unterminated string
    const quotes = (repaired.match(/(?<!\\)"/g) || []).length;
    if (quotes % 2 !== 0) repaired += '"';
    // Close open brackets/braces from innermost out
    const stack = [];
    let inStr = false;
    for (let i = 0; i < repaired.length; i++) {
      const ch = repaired[i];
      if (ch === '"' && (i === 0 || repaired[i - 1] !== '\\')) { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === '{') stack.push('}');
      else if (ch === '[') stack.push(']');
      else if (ch === '}' || ch === ']') stack.pop();
    }
    // Remove trailing comma before closing
    repaired = repaired.replace(/,\s*$/, '');
    while (stack.length) repaired += stack.pop();
    try {
      const result = JSON.parse(repaired);
      warn('JSON repair succeeded (response was likely truncated — some content may be incomplete)');
      return result;
    } catch (secondErr) {
      throw new Error(`JSON parse failed and repair unsuccessful: ${firstErr.message}`);
    }
  }
}

/** Retry an async fn up to maxAttempts times with exponential back-off */
async function withRetry(fn, maxAttempts, label) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      warn(`${label} attempt ${attempt}/${maxAttempts} failed: ${e.message}`);
      if (attempt < maxAttempts) await new Promise(r => setTimeout(r, 2000 * attempt));
    }
  }
  throw lastErr;
}

/** Make an OpenRouter chat completion call */
async function chat(client, model, systemPrompt, userPrompt, options = {}) {
  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: userPrompt });

  const response = await client.chat.completions.create({
    model,
    messages,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.max_tokens ?? 16000,
  });

  const choice = response.choices[0];
  if (choice.finish_reason === 'length') {
    warn(`Response truncated (hit max_tokens). Output may be incomplete.`);
  }
  return choice.message.content;
}

/** Search Bing Images and return a list of full-size image URLs */
async function searchWebImages(query) {
  const url = `https://www.bing.com/images/search?q=${encodeURIComponent(query)}&form=HDRSC2&first=1`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Bing search returned HTTP ${res.status}`);
  const html = await res.text();
  const decoded = html.replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  const urls = [...decoded.matchAll(/"murl":"([^"]+)"/g)]
    .map(m => m[1].replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16))))
    .filter(u => /^https?:\/\/.+\.(jpe?g|png|webp)/i.test(u));
  return [...new Set(urls)].slice(0, 8);
}

/** Download an image URL → { buffer, mime } */
async function downloadImage(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; AttractionSiteBot/1.0)',
      'Referer': 'https://www.bing.com/',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const mime = (res.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
  if (!mime.startsWith('image/')) throw new Error(`Not an image: ${mime}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length < 8000) throw new Error(`Too small: ${buffer.length} bytes`);
  return { buffer, mime };
}

/** Download first successful image from a search query */
async function downloadFirstImage(query, filename) {
  try {
    const urls = await searchWebImages(query);
    for (const url of urls) {
      try {
        const { buffer, mime } = await downloadImage(url);
        const ext = mime.includes('png') ? 'png' : 'jpg';
        const outPath = path.join(IMAGES_DIR, `${filename}.${ext}`);
        fs.writeFileSync(outPath, buffer);
        log(`Downloaded ${filename}.${ext} (${(buffer.length / 1024).toFixed(0)} KB)`);
        return outPath;
      } catch (e) { /* try next */ }
    }
    warn(`No usable image found for: ${query}`);
  } catch (e) {
    warn(`Image search failed for "${query}": ${e.message}`);
  }
  return null;
}

function readTemplate(name) {
  return fs.readFileSync(path.join(TEMPLATES, name), 'utf8');
}

function deepMerge(target, source) {
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      if (!target[key]) target[key] = {};
      deepMerge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN PIPELINE
// ══════════════════════════════════════════════════════════════════════════════

async function main() {
  // ── Parse config ────────────────────────────────────────────────────────────
  const configPath = process.argv[2];
  if (!configPath) die('Usage: node scripts/generate-site.js <config.json>');
  if (!fs.existsSync(configPath)) die(`Config file not found: ${configPath}`);

  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const required = ['attractionName', 'klookUrl', 'domain', 'affiliateUrl'];
  for (const key of required) {
    if (!config[key]) die(`Missing required config field: ${key}`);
  }

  const baseCurrency = config.baseCurrency || 'THB';
  const colors = config.colors || { primary: '#0ea5e9', secondary: '#06b6d4', accent: '#f59e0b' };
  const selectedLangs = config.languages || ALL_LANGUAGES.map(l => l.code);
  const languages = ALL_LANGUAGES.filter(l => selectedLangs.includes(l.code));
  const nonEnLangs = languages.filter(l => l.code !== 'en');

  // Extract activity ID from Klook URL
  const activityIdMatch = config.klookUrl.match(/activity\/(\d+)/);
  const activityId = activityIdMatch ? activityIdMatch[1] : '00000';

  // ── Init OpenRouter client ──────────────────────────────────────────────────
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) die('OPENROUTER_API_KEY environment variable is required');

  const client = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey,
  });

  log(`Starting pipeline for: ${config.attractionName}`);
  log(`Domain: ${config.domain}`);
  log(`Klook ID: ${activityId}`);
  log(`Languages: ${languages.map(l => l.code).join(', ')}`);

  // ══════════════════════════════════════════════════════════════════════════════
  // STEP 1: Research Attraction
  // ══════════════════════════════════════════════════════════════════════════════
  log('Step 1: Researching attraction...');

  const researchPrompt = `Research the tourist attraction "${config.attractionName}" and return a JSON object with these fields:

{
  "officialName": "full official name",
  "alternateNames": ["common alternate names"],
  "address": { "street": "", "locality": "city", "region": "province/state", "postalCode": "", "country": "2-letter ISO code" },
  "latitude": "decimal",
  "longitude": "decimal",
  "phone": "display format with country code",
  "phoneTel": "digits only for tel: link",
  "openingHours": { "opens": "HH:MM", "closes": "HH:MM" },
  "officialUrl": "https://...",
  "schemaType": "AmusementPark|TouristAttraction|Zoo|Museum|NaturalFeature",
  "rating": { "value": "4.5", "count": "1000", "best": "5" },
  "amenities": ["Free Parking", "Lockers", "Food Court", ...],
  "zones": [{ "id": "zone-slug", "name": "Zone Name", "description": "brief description" }],
  "ticketTypes": [{ "name": "Standard Admission", "priceLocal": 0, "priceUSD": 0, "gatePrice": 0 }],
  "social": { "facebook": "", "instagram": "", "tiktok": "" },
  "mapsUrl": "Google Maps share URL",
  "nearestCity": "name of nearest major city",
  "country": "full country name",
  "highlights": ["top 3-5 things that make this attraction special"]
}

Be as accurate as possible. Use real data. If you don't know a field, leave it as empty string or 0.
The Klook activity URL is: ${config.klookUrl}`;

  const researchRaw = await withRetry(
    () => chat(client, TEXT_MODEL, null, researchPrompt, { max_tokens: 4000 }),
    3, 'research'
  );
  const research = extractJSON(researchRaw);
  log(`Research complete: ${research.officialName || config.attractionName}`);

  // ══════════════════════════════════════════════════════════════════════════════
  // STEP 2: Fill site.json
  // ══════════════════════════════════════════════════════════════════════════════
  log('Step 2: Filling site.json...');

  const sitePath = path.join(DATA_DIR, 'site.json');
  const site = JSON.parse(fs.readFileSync(sitePath, 'utf8'));

  const addr = research.address || {};
  const lat = research.latitude || '0';
  const lng = research.longitude || '0';
  const locality = addr.locality || '';
  const country = addr.country || '';

  site.baseUrl = `https://${config.domain}`;
  site.siteName = `${config.attractionName} Guide`;
  site.attractionName = config.attractionName;
  site.initials = config.attractionName.split(/\s+/).map(w => w[0]).join('').slice(0, 3).toUpperCase();
  site.alternateNames = research.alternateNames || [config.attractionName];
  site.schemaType = research.schemaType || 'TouristAttraction';
  site.officialUrl = research.officialUrl || `https://${config.domain}`;
  site.contactEmail = '';
  site.gtagId = '';
  site.baseCurrency = baseCurrency;
  site.address = {
    street: addr.street || '',
    locality,
    region: addr.region || '',
    postalCode: addr.postalCode || '',
    country,
  };
  site.openingHours = [{
    dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
    opens: research.openingHours?.opens || '09:00',
    closes: research.openingHours?.closes || '18:00',
  }];
  site.openingHoursText = `Mo-Su ${site.openingHours[0].opens}-${site.openingHours[0].closes}`;
  site.rating = research.rating || { value: '4.0', count: '100', best: '5' };
  site.amenities = research.amenities || [];
  site.klook = {
    activityUrl: config.klookUrl,
    affiliateUrl: config.affiliateUrl,
  };
  site.blog = {
    authorName: 'Editorial Team',
    authorUrl: `https://${config.domain}/about.html`,
    imageSearchQuery: `${config.attractionName} ${locality} ${research.country || country}`.trim(),
    doNotTranslate: [config.attractionName, ...(research.alternateNames || [])],
  };
  site.mapsEmbed = '';
  site.mapsUrl = research.mapsUrl || '';
  site.social = research.social || { facebook: '', instagram: '', tiktok: '' };
  site.phone = research.phone || '';
  site.phoneTel = research.phoneTel || '';
  site.geo = {
    placename: locality || config.attractionName,
    region: country ? `${country}-` : '',
    position: `${lat};${lng}`,
    ICBM: `${lat}, ${lng}`,
    latitude: lat,
    longitude: lng,
  };

  // Filter languages if user selected a subset
  if (config.languages && config.languages.length < 12) {
    site.languages = site.languages.filter(l => config.languages.includes(l.code));
  }

  fs.writeFileSync(sitePath, JSON.stringify(site, null, 2) + '\n');
  log('site.json updated');

  // ══════════════════════════════════════════════════════════════════════════════
  // STEP 3: Fill prices.json + CNAME + robots.txt + package.json
  // ══════════════════════════════════════════════════════════════════════════════
  log('Step 3: Filling prices.json and deployment files...');

  const pricesPath = path.join(ROOT, 'data', 'prices.json');
  const prices = JSON.parse(fs.readFileSync(pricesPath, 'utf8'));
  prices.activityId = activityId;

  // Add ticket types from research
  if (research.ticketTypes && research.ticketTypes.length > 0) {
    prices.packages = research.ticketTypes.map((t, i) => ({
      id: t.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
      name: t.name,
      basePrice: t.priceLocal || 0,
      gatePrice: t.gatePrice || 0,
      priceUSD: t.priceUSD || 0,
    }));
  }
  fs.writeFileSync(pricesPath, JSON.stringify(prices, null, 2) + '\n');
  log('prices.json updated');

  // CNAME
  fs.writeFileSync(path.join(ROOT, 'CNAME'), config.domain + '\n');

  // robots.txt
  const robotsPath = path.join(ROOT, 'robots.txt');
  const robots = fs.readFileSync(robotsPath, 'utf8')
    .replace(/Sitemap:.*/, `Sitemap: https://${config.domain}/sitemap.xml`);
  fs.writeFileSync(robotsPath, robots);

  // package.json
  const pkgPath = path.join(ROOT, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  pkg.name = config.domain.replace(/\./g, '-');
  pkg.description = `Klook affiliate landing page for ${config.attractionName}`;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  log('CNAME, robots.txt, package.json updated');

  // ══════════════════════════════════════════════════════════════════════════════
  // STEP 4: Generate English i18n content (5 parallel Sonnet calls)
  // ══════════════════════════════════════════════════════════════════════════════
  log('Step 4: Generating English content (5 parallel API calls)...');

  // Read all page templates
  const indexNjk = readTemplate('index.njk');
  const faqNjk = readTemplate('faq.njk');
  const attractionsNjk = readTemplate('attractions.njk');
  const ticketsNjk = readTemplate('tickets.njk');
  const gettingThereNjk = readTemplate('getting-there.njk');
  const tipsNjk = readTemplate('tips.njk');

  // Read the en.json template to understand exact structure
  const enTemplate = JSON.parse(fs.readFileSync(path.join(I18N_DIR, 'en.json'), 'utf8'));

  // Context shared across all prompts
  const siteContext = `
ATTRACTION: ${config.attractionName}
LOCATION: ${locality}, ${addr.region || ''}, ${research.country || country}
ADDRESS: ${addr.street || ''}, ${locality}, ${addr.region || ''} ${addr.postalCode || ''}, ${country}
OPENING HOURS: ${site.openingHoursText}
PHONE: ${site.phone || 'N/A'}
RATING: ${site.rating.value}/5 (${site.rating.count} reviews)
ZONES: ${JSON.stringify(research.zones || [])}
TICKET TYPES: ${JSON.stringify(research.ticketTypes || [])}
AMENITIES: ${(site.amenities || []).join(', ')}
HIGHLIGHTS: ${(research.highlights || []).join('; ')}
NEAREST CITY: ${research.nearestCity || locality}
KLOOK URL: ${config.klookUrl}
BASE CURRENCY: ${baseCurrency}
DOMAIN: ${config.domain}
SCHEMA TYPE: ${site.schemaType}`;

  const systemPromptBase = `You are a senior travel content writer creating content for ${config.domain}, a visitor guide for ${config.attractionName}.

RULES:
- All headings (h1, h2, h3, heading keys): MAX 10 words. Keep them punchy and scannable.
- SEO titles: 55-65 characters, include attraction name and primary keyword.
- Meta descriptions: 148-158 characters, include call-to-action.
- FAQ answers: Use HTML (<p>, <strong>, <a> with internal links like /tickets.html).
- Tone: Conversational, helpful, authoritative travel guide.
- Include REAL details about this specific attraction, not generic filler.
- Output valid JSON only. No explanatory text outside the JSON.

${siteContext}`;

  // ── Call A: skipLink, nav, announcement, stickyBar, footer, home ──────────
  const promptA = `Generate the following i18n JSON sections for the homepage and global elements.

Here is the Nunjucks template for the homepage (index.njk):
\`\`\`njk
${indexNjk}
\`\`\`

Here is the EXACT JSON structure you must match. Replace all "CHANGE ME" values with real content for ${config.attractionName}:
${JSON.stringify({
  skipLink: enTemplate.skipLink,
  nav: enTemplate.nav,
  announcement: enTemplate.announcement,
  stickyBar: enTemplate.stickyBar,
  footer: enTemplate.footer,
  home: enTemplate.home,
}, null, 2)}

Return ONLY the JSON object with these 6 top-level keys. Every key in the template must exist in your output.`;

  // ── Call B: faq ────────────────────────────────────────────────────────────
  const promptB = `Generate the FAQ section with 30-40 real questions about ${config.attractionName}.

Here is the Nunjucks template for the FAQ page (faq.njk):
\`\`\`njk
${faqNjk}
\`\`\`

CRITICAL: The array key inside each category MUST be "questions" (NOT "items") — the template calls cat.questions.

Here is the EXACT JSON structure you must match:
${JSON.stringify({ faq: enTemplate.faq }, null, 2)}

Populate "categories" with 7 category objects, each having:
- "tag": category code (e.g. "general", "tickets", "transport", "facilities", "safety", "food", "accessibility")
- "heading": category name
- "questions": array of { "question": "...", "answer": "<p>...</p>" }
Each category should have 4-6 questions with HTML-formatted answers.

Also fill in jumpLabels as { "tag": "Category Name" } for each category.

Return ONLY the JSON object with key "faq".`;

  // ── Call C1: attractions ────────────────────────────────────────────────────
  const promptC1 = `Generate the attractions page content for ${config.attractionName}.

Here is the Nunjucks template for attractions (attractions.njk):
\`\`\`njk
${attractionsNjk}
\`\`\`

Here is the EXACT JSON structure. Replace all "CHANGE ME" values:
${JSON.stringify({ attractions: enTemplate.attractions }, null, 2)}

Add a "pageHeader" with h1 and description, "tldr" array, "zoneNav" object, "zones" array with real zones/areas, "extras" object, "faq" object, and "cta" object.

Return ONLY the JSON object with key "attractions".`;

  // ── Call C2: tickets ──────────────────────────────────────────────────────
  const promptC2 = `Generate the tickets page content for ${config.attractionName}.

Here is the Nunjucks template for tickets (tickets.njk):
\`\`\`njk
${ticketsNjk}
\`\`\`

Here is the EXACT JSON structure. Replace all "CHANGE ME" values:
${JSON.stringify({ tickets: enTemplate.tickets }, null, 2)}

Fill hero, pricingCards (3 cards), ticketOptions, addons, howToBook, cancellation, savingsTips, and cta sections.

Return ONLY the JSON object with key "tickets".`;

  // ── Call D: gettingThere ───────────────────────────────────────────────────
  const promptD = `Generate the "Getting There" page content for ${config.attractionName}.

Here is the Nunjucks template (getting-there.njk):
\`\`\`njk
${gettingThereNjk}
\`\`\`

Here is the EXACT JSON structure:
${JSON.stringify({ gettingThere: enTemplate.gettingThere }, null, 2)}

Fill in ALL transport options with real information:
- fromBangkok section should be renamed/adapted to "From ${research.nearestCity || 'the nearest major city'}"
- fromAirports with real nearby airports
- fromPattaya section adapted to local area transport
- comparison table with real routes/times/costs
- parking information
- transport tips

Return ONLY the JSON object with key "gettingThere".`;

  // ── Call E: tips ───────────────────────────────────────────────────────────
  const promptE = `Generate the "Visitor Tips" page content for ${config.attractionName}.

Here is the Nunjucks template (tips.njk):
\`\`\`njk
${tipsNjk}
\`\`\`

Here is the EXACT JSON structure:
${JSON.stringify({ tips: enTemplate.tips }, null, 2)}

Fill in ALL 15 tip sections (tip1 through tip15) plus toc, internalLinks, and cta with real, specific advice for this attraction.

Return ONLY the JSON object with key "tips".`;

  // ── Run all 6 calls in parallel ────────────────────────────────────────────
  const [resultA, resultB, resultC1, resultC2, resultD, resultE] = await Promise.all([
    withRetry(() => chat(client, TEXT_MODEL, systemPromptBase, promptA, { max_tokens: 12000 }), 2, 'en-A'),
    withRetry(() => chat(client, TEXT_MODEL, systemPromptBase, promptB, { max_tokens: 12000 }), 2, 'en-B'),
    withRetry(() => chat(client, TEXT_MODEL, systemPromptBase, promptC1, { max_tokens: 12000 }), 2, 'en-C1'),
    withRetry(() => chat(client, TEXT_MODEL, systemPromptBase, promptC2, { max_tokens: 12000 }), 2, 'en-C2'),
    withRetry(() => chat(client, TEXT_MODEL, systemPromptBase, promptD, { max_tokens: 12000 }), 2, 'en-D'),
    withRetry(() => chat(client, TEXT_MODEL, systemPromptBase, promptE, { max_tokens: 12000 }), 2, 'en-E'),
  ]);

  log('All 6 English content calls complete. Merging...');

  // Parse and merge
  const partA = extractJSON(resultA);
  const partB = extractJSON(resultB);
  const partC1 = extractJSON(resultC1);
  const partC2 = extractJSON(resultC2);
  const partD = extractJSON(resultD);
  const partE = extractJSON(resultE);

  const enJson = {};
  deepMerge(enJson, partA);   // skipLink, nav, announcement, stickyBar, footer, home
  deepMerge(enJson, partB);   // faq
  deepMerge(enJson, partC1);  // attractions
  deepMerge(enJson, partC2);  // tickets
  deepMerge(enJson, partD);   // gettingThere
  deepMerge(enJson, partE);   // tips

  // Add empty blog section
  enJson.blog = enTemplate.blog;

  // ── Validate completeness ──────────────────────────────────────────────────
  const checks = [
    ['home.heroTitle', enJson.home?.heroTitle || enJson.home?.hero?.title],
    ['attractions (has keys)', Object.keys(enJson.attractions || {}).length > 3],
    ['tickets.hero.h1', enJson.tickets?.hero?.h1],
    ['faq.categories', (enJson.faq?.categories || []).length > 0],
    ['gettingThere.hero.h1', enJson.gettingThere?.hero?.h1],
    ['tips.h1', enJson.tips?.h1],
  ];

  for (const [name, value] of checks) {
    if (!value) warn(`Validation: ${name} is empty or missing`);
    else log(`✓ ${name}`);
  }

  fs.writeFileSync(path.join(I18N_DIR, 'en.json'), JSON.stringify(enJson, null, 2) + '\n');
  log('en.json written');

  // ══════════════════════════════════════════════════════════════════════════════
  // STEP 5: Translate to other languages
  // ══════════════════════════════════════════════════════════════════════════════
  if (nonEnLangs.length === 0) {
    log('Step 5: Skipping translations (English only)');
  } else {
    log(`Step 5: Translating to ${nonEnLangs.length} languages...`);
    fs.mkdirSync(TMP_DIR, { recursive: true });

    // Split en.json into 5 sections for translation
    const sections = {
      A: { keys: ['skipLink', 'nav', 'announcement', 'stickyBar', 'footer', 'home'], data: {} },
      B: { keys: ['faq'], data: {} },
      C: { keys: ['attractions', 'tickets'], data: {} },
      D: { keys: ['gettingThere'], data: {} },
      E: { keys: ['tips'], data: {} },
    };

    for (const [, section] of Object.entries(sections)) {
      for (const key of section.keys) {
        if (enJson[key]) section.data[key] = enJson[key];
      }
    }

    // Include blog.index static UI fields in section A for translation
    // (SEO "CHANGE ME" placeholders are excluded — they'll be filled by generate-blog.js)
    const blogIndexStatic = {
      heroTitle: enJson.blog?.index?.heroTitle || 'Blog & Travel Guides',
      breadcrumbHome: enJson.blog?.index?.breadcrumbHome || 'Home',
      breadcrumbCurrent: enJson.blog?.index?.breadcrumbCurrent || 'Blog',
    };
    sections.A.data.blogIndexStatic = blogIndexStatic;

    const doNotTranslate = site.blog.doNotTranslate.join(', ');

    // Batch: 3 languages per batch, 5 sections per language = 15 concurrent calls
    const batches = [];
    for (let i = 0; i < nonEnLangs.length; i += 3) {
      batches.push(nonEnLangs.slice(i, i + 3));
    }

    for (let bi = 0; bi < batches.length; bi++) {
      const batch = batches[bi];
      log(`Translation batch ${bi + 1}/${batches.length}: ${batch.map(l => l.code).join(', ')}`);

      const calls = [];
      for (const lang of batch) {
        // Check if this language already has a complete file (resume support)
        const langFile = path.join(I18N_DIR, `${lang.code}.json`);
        if (fs.existsSync(langFile)) {
          const existing = JSON.parse(fs.readFileSync(langFile, 'utf8'));
          if (existing.home && existing.faq && existing.tips) {
            log(`  ${lang.code}: already exists, skipping`);
            continue;
          }
        }

        for (const [sectionId, section] of Object.entries(sections)) {
          // Check if fragment already exists (resume support)
          const fragPath = path.join(TMP_DIR, `${lang.code}_${sectionId}.json`);
          if (fs.existsSync(fragPath)) {
            log(`  ${lang.code}_${sectionId}: fragment exists, skipping`);
            continue;
          }

          const translatePrompt = `Translate the following JSON content from English to ${lang.name} (language code: ${lang.code}).

RULES:
- Translate ALL text values to ${lang.name}
- Keep ALL JSON keys in English (do not translate keys)
- Keep HTML tags and attributes unchanged
- Keep href paths unchanged
- Keep proper nouns untranslated: ${doNotTranslate}
- Keep currency symbols and numbers as-is
- Ensure the translation sounds natural in ${lang.name}

JSON to translate:
${JSON.stringify(section.data, null, 2)}

Return ONLY the translated JSON. No explanatory text.`;

          calls.push(
            withRetry(
              () => chat(client, TRANSLATE_MODEL, null, translatePrompt, { max_tokens: 16000 }),
              2, `translate-${lang.code}-${sectionId}`
            ).then(result => {
              const parsed = extractJSON(result);
              fs.writeFileSync(fragPath, JSON.stringify(parsed, null, 2));
              log(`  ✓ ${lang.code}_${sectionId}`);
            }).catch(e => {
              warn(`Failed to translate ${lang.code}_${sectionId}: ${e.message}`);
            })
          );
        }
      }

      await Promise.all(calls);
    }

    // Merge fragments into language files
    log('Merging translation fragments...');
    for (const lang of nonEnLangs) {
      const langData = {};
      for (const sectionId of Object.keys(sections)) {
        const fragPath = path.join(TMP_DIR, `${lang.code}_${sectionId}.json`);
        if (fs.existsSync(fragPath)) {
          const frag = JSON.parse(fs.readFileSync(fragPath, 'utf8'));
          deepMerge(langData, frag);
        }
      }

      // Add blog section: reuse already-translated nav values for UI strings,
      // keep SEO "CHANGE ME" placeholders for generate-blog.js to fill later.
      // nav.home and nav.blog are translated in section A — guaranteed to be present.
      const translatedBlogHeroTitle = langData.blogIndexStatic?.heroTitle;
      delete langData.blogIndexStatic;
      langData.blog = {
        index: {
          ...enJson.blog?.index,
          heroTitle: translatedBlogHeroTitle || enJson.blog?.index?.heroTitle,
          breadcrumbHome: langData.nav?.home || enJson.blog?.index?.breadcrumbHome,
          breadcrumbCurrent: langData.nav?.blog || enJson.blog?.index?.breadcrumbCurrent,
          cards: [],
        },
        posts: {},
      };

      // Validate: ensure core sections are present before writing.
      // If all API calls failed, langData will be empty — skip writing so a re-run can retry.
      const requiredKeys = ['home', 'faq', 'tips', 'attractions', 'gettingThere'];
      const missingKeys = requiredKeys.filter(k => !langData[k]);
      if (missingKeys.length > 0) {
        warn(`  ${lang.code}: translation incomplete (missing: ${missingKeys.join(', ')}) — skipping file write so next run can retry`);
        continue;
      }

      const langFile = path.join(I18N_DIR, `${lang.code}.json`);
      fs.writeFileSync(langFile, JSON.stringify(langData, null, 2) + '\n');
      log(`  ✓ ${lang.code}.json`);
    }

    // Clean up tmp
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
    log('Translations complete');
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // STEP 6: Generate data files
  // ══════════════════════════════════════════════════════════════════════════════
  log('Step 6: Generating data files...');

  // attractions.json — zone definitions
  const zones = (research.zones || []).map(z => ({
    id: z.id || z.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    cssClass: `zone-${z.id || z.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    imageAlt: z.name,
  }));
  fs.writeFileSync(
    path.join(DATA_DIR, 'attractions.json'),
    JSON.stringify({ zones }, null, 2) + '\n'
  );

  // tips.json — emoji arrays for each tip section
  const tipsEmojis = {
    tip1: ['📋', '🎟️', '⏰'],
    tip2: ['👙', '🧴', '💰'],
    tip3: ['🚫', '📸', '🍕'],
    tip4: ['👕'],
    tip5: ['🌅', '☀️', '🌧️'],
    tip6: ['💡', '🎫', '📱'],
    tip7: ['🍔', '🍦', '💧'],
    tip8: ['1️⃣'],
    tip9: ['👶', '🎢', '🏊'],
    tip10: ['☔', '🌂', '🎮'],
    tip11: ['📷'],
    tip12: ['⭐'],
    tip13: ['🔒', '🩹', '👀'],
    tip14: ['🛍️', '📝', '🌟'],
    tip15: ['⚡'],
  };
  fs.writeFileSync(
    path.join(DATA_DIR, 'tips.json'),
    JSON.stringify(tipsEmojis, null, 2) + '\n'
  );

  // home.json — icons, prices, blog slugs
  const homeData = {
    whyVisitIcons: ['🎢', '🎭', '🌊', '⭐'],
    zoneItems: zones.map(z => ({ id: z.id, image: `zone-${z.id}.jpg` })),
    ticketCards: [
      { highlight: false },
      { highlight: true },
      { highlight: false },
    ],
    transportCards: [
      { icon: 'car-icon.svg' },
      { icon: 'bus-icon.svg' },
      { icon: 'taxi-icon.svg' },
    ],
    footerGuidesSlugs: [],
  };
  fs.writeFileSync(
    path.join(DATA_DIR, 'home.json'),
    JSON.stringify(homeData, null, 2) + '\n'
  );
  log('Data files written');

  // ══════════════════════════════════════════════════════════════════════════════
  // STEP 7: Download images
  // ══════════════════════════════════════════════════════════════════════════════
  log('Step 7: Downloading images...');

  fs.mkdirSync(IMAGES_DIR, { recursive: true });

  const imageQueries = [
    { query: `${config.attractionName} aerial view wide landscape`, filename: 'hero-desktop' },
    { query: `${config.attractionName} entrance`, filename: 'hero-mobile' },
    { query: `${config.attractionName} overview`, filename: 'og-home' },
    { query: `${config.attractionName} attractions rides`, filename: 'og-attractions' },
    { query: `${config.attractionName} tickets entrance`, filename: 'og-tickets' },
    { query: `${config.attractionName} visitor tips guide`, filename: 'og-tips' },
    { query: `${config.attractionName} location map directions`, filename: 'og-getting-there' },
    { query: `${config.attractionName} FAQ help guide`, filename: 'og-faq' },
    { query: `${config.attractionName} blog travel guide`, filename: 'og-blog' },
  ];

  // Add zone images
  for (const zone of (research.zones || []).slice(0, 8)) {
    const zoneId = zone.id || zone.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    imageQueries.push({
      query: `${config.attractionName} ${zone.name}`,
      filename: `zone-${zoneId}`,
    });
  }

  // Download 3 at a time to avoid rate limits
  for (let i = 0; i < imageQueries.length; i += 3) {
    const batch = imageQueries.slice(i, i + 3);
    await Promise.all(batch.map(q => downloadFirstImage(q.query, q.filename)));
  }
  log('Image download complete');

  // ══════════════════════════════════════════════════════════════════════════════
  // STEP 8: Apply CSS theme colours
  // ══════════════════════════════════════════════════════════════════════════════
  log('Step 8: Applying CSS theme...');

  const cssPath = path.join(ROOT, 'css', 'style.css');
  if (fs.existsSync(cssPath)) {
    let css = fs.readFileSync(cssPath, 'utf8');

    // Compute dark variant of primary colour
    function darkenHex(hex, amount = 20) {
      const r = Math.max(0, parseInt(hex.slice(1, 3), 16) - amount);
      const g = Math.max(0, parseInt(hex.slice(3, 5), 16) - amount);
      const b = Math.max(0, parseInt(hex.slice(5, 7), 16) - amount);
      return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    }

    // Compute surface colour (very light tint of primary)
    function surfaceHex(hex) {
      const r = Math.min(255, parseInt(hex.slice(1, 3), 16) + 200);
      const g = Math.min(255, parseInt(hex.slice(3, 5), 16) + 200);
      const b = Math.min(255, parseInt(hex.slice(5, 7), 16) + 200);
      return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    }

    css = css.replace(/--primary:\s*[^;]+;/, `--primary: ${colors.primary};`);
    css = css.replace(/--primary-dark:\s*[^;]+;/, `--primary-dark: ${darkenHex(colors.primary)};`);
    css = css.replace(/--secondary:\s*[^;]+;/, `--secondary: ${colors.secondary};`);
    css = css.replace(/--accent:\s*[^;]+;/, `--accent: ${colors.accent};`);
    css = css.replace(/--surface:\s*[^;]+;/, `--surface: ${surfaceHex(colors.primary)};`);

    fs.writeFileSync(cssPath, css);
    log('CSS theme applied');
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // STEP 9: Generate blog topics
  // ══════════════════════════════════════════════════════════════════════════════
  log('Step 9: Generating blog topics...');

  const topicsPrompt = `Generate 15 blog post topics for ${config.attractionName} (${locality}, ${research.country || country}).

Each topic should be a JSON object with:
- "slug": URL-friendly slug (e.g. "ultimate-guide-to-attraction-name")
- "titleHint": suggested article title (60-70 chars)
- "keyword": primary SEO keyword

Topics should cover: ticket pricing guides, best time to visit, family tips, food guides, nearby attractions, transport guides, seasonal events, photography tips, comparison guides, history/culture.

Return a JSON array of 15 topic objects. No explanatory text.`;

  const topicsRaw = await withRetry(
    () => chat(client, TEXT_MODEL, null, topicsPrompt, { max_tokens: 4000 }),
    2, 'topics'
  );
  const topics = extractJSON(topicsRaw);
  fs.writeFileSync(path.join(__dirname, 'topics.json'), JSON.stringify(topics, null, 2) + '\n');
  log(`Generated ${topics.length} blog topics`);

  // ══════════════════════════════════════════════════════════════════════════════
  // STEP 10: Build + sitemap
  // ══════════════════════════════════════════════════════════════════════════════
  log('Step 10: Building site...');

  try {
    execSync('node src/build.js', { cwd: ROOT, stdio: 'pipe' });
    log('Build complete');
  } catch (e) {
    warn(`Build failed: ${e.stderr?.toString() || e.message}`);
    warn('Attempting to continue anyway...');
  }

  // Generate sitemap
  try {
    execSync('node scripts/generate-sitemap.js', { cwd: ROOT, stdio: 'pipe' });
    log('Sitemap generated');
  } catch (e) {
    warn(`Sitemap generation failed: ${e.message}`);
  }

  // ── Summary ─────────────────────────────────────────────────────────────────
  const langFiles = languages.map(l => path.join(I18N_DIR, `${l.code}.json`)).filter(f => fs.existsSync(f));

  log('\n═══════════════════════════════════════');
  log('SITE GENERATION COMPLETE');
  log('═══════════════════════════════════════');
  log(`Attraction: ${config.attractionName}`);
  log(`Domain:     ${config.domain}`);
  log(`Languages:  ${langFiles.length} i18n files`);
  log(`Topics:     ${topics.length} blog topics queued`);
  log('');
  log('Missing (create manually):');
  log('  - images/logo.png (220x19px, navbar)');
  log('  - images/logo-light.png (footer, light version)');
  log('  - images/logo-icon.svg (favicon)');
  log('');
  log('Next: npm run build && npx serve -p 3001');
}

main().catch(err => {
  console.error('\n[generate-site] FATAL:', err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
