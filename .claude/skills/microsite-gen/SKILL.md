---
name: microsite-gen
description: |
  Step-by-step generator for multilingual Klook affiliate landing pages using the microsite-template repo (https://github.com/ZiWeiWilly/microsite-template). Use this skill whenever the user wants to: create a microsite for a tourist attraction, build a Klook affiliate landing page, generate a visitor guide website, set up the microsite-template for a specific attraction, or says anything like "create a microsite for [X]", "landing page for [attraction]", "Klook affiliate site for [X]", "build a visitor guide for [X]", "generate a site for [attraction]". This skill runs all phases end-to-end without pausing — only stop if there's an error or missing information that requires user input. It uses Sonnet subagents for English content generation and Haiku subagents for translations to maximize speed.
---

# Microsite Generator

You're building a multilingual Klook affiliate site using the [microsite-template](https://github.com/ZiWeiWilly/microsite-template). The full setup has 8 phases — run them all continuously without pausing for confirmation. Only stop to ask the user if you hit an error or need information you can't find.

**Maximize parallelism:** use subagents wherever possible to speed up the process.

---

## Step 0 — Pre-flight Setup

Before starting, collect essential information from the user. Use `AskUserQuestion` to gather all of these in one go:

1. **Attraction name** — the full official name
2. **Klook activity URL** — if they already have it (e.g. `https://www.klook.com/activity/12345-...`), otherwise we'll search for it in Phase 1
3. **Domain name** — what domain will the site use? (e.g. `myattraction.guide`)
4. **Klook affiliate URL** — their Klook affiliate redirect URL (e.g. `https://affiliate.klook.com/redirect?aid=XXXXX&aff_adid=YYYYY&k_site=...`). This is used for ALL booking buttons on the site.
5. **Brand colours** — primary, secondary, accent colours. Or "auto" to pick based on the attraction's branding.
6. **Languages** — use all 12, or a specific subset? (en, zh-CN, zh-TW, ja, ko, ru, hi, ms, vi, de, fr, lo)

Then confirm working directory — check that `src/data/site.json` and `src/templates/` exist. If not, ask the user to clone the template first:
```bash
git clone https://github.com/ZiWeiWilly/microsite-template my-site
cd my-site
```

Proceed directly to Phase 1.

---

## Phase 1 — Research

**Goal:** Gather everything before touching any files.

Use WebSearch to find:
- Full official name + common alternate names
- Physical address (street, city, region, postal code, country)
- GPS coordinates (latitude, longitude)
- Phone number + official website URL
- Opening hours (all days)
- Klook activity URL and activity ID (from the URL — e.g. `/activity/12345-...`)
- Google Maps embed URL
- Google rating and review count
- Ticket types and prices (use local currency as base)
- Main zones/areas (4–6 sections of the attraction with names and descriptions)
- Key amenities (parking, lockers, food, wheelchair access, etc.)
- Social media links (Facebook, Instagram, TikTok)
- 3–5 unique selling points (what makes this attraction special)

Present findings as a structured summary. Proceed to Phase 2 immediately.

---

## Phase 2 — Core Config Files

**Goal:** Populate the config files with real data. Edit them one at a time.

### 1. `src/data/site.json`
Fill in all fields using Phase 1 research:
- `name`, `shortName`, `alternateNames`, `tagline`
- `url`, `domain`
- `address` (all sub-fields)
- `coordinates` (`lat`, `lng`)
- `contact` (phone, email)
- `hours` (by day)
- `klook.activityUrl`, `klook.activityId`
- `rating` (`value`, `count`, `best`)
- `amenities` (array of strings)
- `schemaType` — choose one: `AmusementPark`, `TouristAttraction`, `Zoo`, `Museum`, `NaturalFeature`
- `socialLinks` (facebook, instagram, tiktok)

**Critical:** Set `klook.affiliateUrl` to the user's Klook affiliate redirect URL from Step 0. This URL is injected into every booking button on the site via `data-booking-url` on `<body>`. If not set correctly, all "Book Now" buttons will be broken.

### 2. `CNAME`
Set to the site's domain (e.g. `myattraction.guide`).

### 3. `robots.txt`
Update the `Sitemap:` URL to match the domain.

### 4. `package.json`
Update `name` and `description`.

### 5. `src/data/site.json` — Set `baseCurrency`

Set `baseCurrency` to the local currency code of the attraction's country (e.g. `"HKD"` for Hong Kong, `"JPY"` for Japan, `"THB"` for Thailand). This value is used by the build script, templates, and frontend currency switcher.

### 6. `data/prices.json`
Add ticket packages. The price field is always `basePrice` (in whatever currency `site.json → baseCurrency` is). Set the base currency's exchange rate to `1`, and compute all other currencies relative to it.

```json
{
  "activityId": "12345",
  "packages": [
    { "id": "adult", "name": "Adult Ticket", "basePrice": 1000, "gatePrice": 1500, "priceUSD": 29 }
  ],
  "exchangeRates": {
    "HKD": { "rate": 1, "symbol": "HK$", "code": "HKD", "decimals": 0 },
    "USD": { "rate": 0.128, "symbol": "$", "code": "USD", "decimals": 2 }
  }
}
```

For example, if the attraction is in Hong Kong: set `baseCurrency: "HKD"` in site.json, put HKD values in `basePrice`, and set HKD rate to `1`.

Proceed to Phase 3 immediately.

---

## Phase 3 — English Content (`src/i18n/en.json`) — Parallelized with Sonnet

**Goal:** Replace every `CHANGE ME` value with real, researched content. Use Sonnet subagents to write sections in parallel.

### Step 3a: Main conversation handles small sections

Write these directly (they're small and fast):
- **`skipLink`**, **`nav`**, **`announcement`**, **`stickyBar`**, **`footer`** — navigation labels, footer text, shared UI strings

### Step 3b: Launch 5 Sonnet subagents in parallel

**CRITICAL:** Each subagent MUST read the corresponding Nunjucks template (`src/templates/pages/*.njk`) BEFORE generating content. The template defines the exact JSON key structure — agents must match it exactly. Nunjucks silently outputs empty strings for undefined keys, so mismatched keys won't cause build errors but will produce blank pages.

Each subagent also reads `src/i18n/en.json` for the existing key structure, then returns the completed JSON fragment.

| Subagent | Sections | Details |
|----------|----------|---------|
| **Sonnet A** | `home` | Read `src/templates/pages/index.njk` first. Hero text, stats, TL;DR, GBP card, 4 "Why Visit" cards, 4–6 zones with highlights, 3 ticket cards, 3 transport options, 3 testimonials, 3–5 homepage FAQs, CTA |
| **Sonnet B** | `faq` | Read `src/templates/pages/faq.njk` first. 30–40 FAQs in 7 categories. **CRITICAL:** Each category's FAQ array key MUST be `questions` (NOT `items`). The build script calls `cat.questions` in `buildFaqSchema()` — using `items` will crash. |
| **Sonnet C** | `attractions` + `tickets` | Read `src/templates/pages/attractions.njk` AND `src/templates/pages/tickets.njk` first. Must match the EXACT key structure from templates. See required key structures below. |
| **Sonnet D** | `gettingThere` | Read `src/templates/pages/getting-there.njk` first. Transport options, directions, parking info |
| **Sonnet E** | `tips` | Read `src/templates/pages/tips.njk` first. Visitor tips organized by category |

#### Sonnet C required key structures

**`t.attractions`** — the template reads these exact keys:
- `title`, `metaDescription`, `metaKeywords`, `ogTitle`, `ogDescription`, `twitterTitle`, `twitterDescription`
- `breadcrumbCurrent`
- `schema`: `{ name, alternateName[], description, touristType[], containsPlace[] }`
- `pageHeader`: `{ h1, description }`
- `tldr`: `[{ bold, text }]` (text uses `| safe`)
- `zoneNav`: `{ heading, sectionLabel, description, zones: [{ tag, name, subtitle }] }`
- `zones`: `[{ h2, tag, subtitle, intro, keyAttractionsLabel, attractions: [{ name, desc }], highlights: [], tipContent }]` (intro/desc/tipContent use `| safe`)
- `extras`: `{ heading, sectionLabel, description, items: [{ h3, content, highlights: [] }] }` (content uses `| safe`)
- `faq`: `{ heading, sectionLabel, description, items: [{ question, answer }], viewAll }` (answer uses `| safe`)
- `cta`: `{ heading, text, button, link }`

**`t.tickets`** — the template reads these exact keys:
- `title`, `metaDescription`, `metaKeywords`, `ogTitle`, `ogDescription`, `twitterTitle`, `twitterDescription`
- `schema`: `{ breadcrumbCurrent }`
- `breadcrumbCurrent`
- `hero`: `{ badge, h1, h1Sub, sub, cta1, cta2, stats: [{ number?, label }, { number?, label }, { number, label }, { number, label }] }`
- `tldr`: `[{ bold?, text }]` (text uses `| safe`)
- `ticketOptions`: `{ sectionLabel, heading, description, tableHeaders: [4 strings], tableRows: [{ name, included }, { name, included }], tableFootnote, cta }`
- `pricingCards`: `{ sectionLabel, heading, description, cards: [{ h3, period, features: [], cta }, { h3, period, features: [], cta }, { h3, period, features: [], cta }] }` (features use `| safe`)
- `addons`: `{ sectionLabel, heading, description, items: [{ h3, text }, ...4 items] }` (text uses `| safe`)
- `howToBook`: `{ sectionLabel, heading, description, items: [{ h3, text }, ...4 items], cta }` (description/text use `| safe`)
- `cancellation`: `{ sectionLabel, heading, items: [{ bold?, text }], footerNote }` (text/footerNote use `| safe`)
- `savingsTips`: `{ sectionLabel, heading, description, tips: [{ h3, text }, ...5 items], cta }` (text uses `| safe`)
- `cta1`: `{ heading, text, button, subtextPrefix }`
- `faq`: `{ sectionLabel, heading, description, items: [{ question, answer }], viewAll }` (answer uses `| safe`)
- `priceGuide`: `{ heading, description, blogSlug, button }`
- `cta2`: `{ heading, text, button }`

Each subagent should also generate SEO metadata for its pages:
- `title` (55–65 chars), `metaDescription` (148–158 chars), `metaKeywords`, `ogTitle`, `ogDescription`, `twitterTitle`, `twitterDescription`

**Content rules for all subagents:**
- Tone: conversational, helpful, authoritative travel guide
- **Headings (h1, h2, h3, heading keys): max 10 words.** Keep them punchy and scannable — e.g. "Top Rides & Attractions" not "Discover All the Amazing Rides and Attractions You Can Enjoy"
- FAQ answers: use HTML (`<p>`, `<strong>`, `<a href="/tickets.html">`)
- Reference real attraction details — no generic filler
- Use real Klook prices, not placeholders

### Step 3c: Merge results

After all subagents complete, merge their JSON fragments into a single `src/i18n/en.json` and write the file.

### Step 3d: Verify content completeness

**Do NOT skip this step.** After merging, verify that key pages have real content:
- `attractions.pageHeader.h1` exists and is not empty
- `attractions.zones` array has entries matching the number of zones researched
- `tickets.hero.h1` exists and is not empty
- `tickets.pricingCards.cards` array has exactly 3 entries
- `faq.categories` array has entries, each with a `questions` array
- `home.hero.title` exists and is not empty

If any are missing or empty, the subagent output was wrong — re-run that specific subagent before proceeding to translations.

Proceed to Phase 4+5+6+7 immediately (run in parallel).

---

## Phase 4–7 — Run in Parallel

After English content is complete, run these concurrently:

### Track A: Translations (Phase 4) — Section-level Haiku subagents

**IMPORTANT:** Do NOT translate in the main conversation. Use `Agent` tool with `model: "haiku"`.

**Always split every language into 5 section-level subagents.** This prevents any language from getting stuck or hitting output limits, regardless of token efficiency.

#### Section split (same for every language)

| Agent | Sections |
|-------|----------|
| A | `skipLink`, `nav`, `announcement`, `stickyBar`, `footer`, `home` |
| B | `faq` |
| C | `attractions`, `tickets` |
| D | `gettingThere` |
| E | `tips` |

Each agent reads `src/i18n/en.json` + `src/data/site.json`, translates only its assigned top-level keys, and writes a temporary fragment file (e.g. `src/i18n/.tmp/zh-TW_home.json`). The main conversation then merges all 5 fragments into `src/i18n/{lang}.json` and deletes the temp files.

#### Batch order (5 agents per language, 3 languages per batch = 15 agents)

Wait for each batch to complete before starting the next:
- **Batch 1:** `zh-CN`, `zh-TW`, `ja` (15 agents)
- **Batch 2:** `ko`, `ru`, `hi` (15 agents)
- **Batch 3:** `ms`, `vi`, `de` (15 agents)
- **Batch 4:** `fr`, `lo` (10 agents)

#### Example: one section agent

```
Agent(
  model: "haiku",
  description: "Translate home section to zh-TW",
  prompt: "You are translating part of a JSON i18n file for a travel website about [attraction name].

Read src/i18n/en.json and src/data/site.json.

Translate ONLY the following top-level keys from en.json into Traditional Chinese (zh-TW):
skipLink, nav, announcement, stickyBar, footer, home

Rules:
- Output a valid JSON object containing ONLY these keys
- Keep ALL JSON keys exactly unchanged
- Keep HTML tags, attributes, href paths, CSS classes unchanged
- Do NOT translate proper nouns: [list from site.json blog.doNotTranslate]
- Keep currency values and numbers unchanged
- Native-speaker fluency, travel-writer tone
- If blog.posts exists inside any section, translate it too
- CRITICAL: Output must be valid JSON. No literal newlines inside strings (use spaces instead). No broken HTML like <p\"<strong> — always use proper <p><strong>. Double-check all quote marks are properly escaped.

Write the JSON fragment to src/i18n/.tmp/zh-TW_home.json"
)
```

#### Merge step

After all 5 agents for a language complete, merge in the main conversation:
1. Read all 5 fragment files from `src/i18n/.tmp/`
2. **Validate each fragment is valid JSON** before merging. If any fragment has invalid JSON:
   - Try to auto-fix common issues: literal newlines inside strings (replace with spaces), broken HTML tags like `<p"<strong>` → `<p><strong>`, strings prematurely closed by unescaped quotes
   - If auto-fix fails, re-run that specific section agent
3. Combine into one JSON object (use the Read tool to read each fragment, then write the merged result)
4. Write to `src/i18n/{lang}.json` (path: `src/i18n/{lang}.json` relative to project root)
5. Delete the `.tmp/` fragments

**Path note:** Fragment files are at `src/i18n/.tmp/{lang}_{section}.json`. Output files go to `src/i18n/{lang}.json`. Do NOT use `__dirname`-relative paths in merge scripts — use project-root-relative paths.

#### Resume after interruption

If the process is interrupted mid-translation:
1. Check which `src/i18n/{lang}.json` files exist and are complete (valid JSON, no `CHANGE ME` values)
2. Check for leftover `.tmp/` fragments — merge any complete sets
3. Only re-run translations for missing or incomplete languages

### Track B: Data Files + Scraper (Phase 5+6) — Main conversation

While translations run, the main conversation handles these in sequence:

1. **`src/data/attractions.json`** — define each zone with `id`, CSS class, image path
2. **`src/data/tips.json`** — set emoji arrays for each tip section
3. **`src/data/home.json`** — update icon names, ticket prices for homepage cards, initial blog slugs
4. **`scripts/scrape-klook.js`** — update `PACKAGE_MATCHERS` with regex patterns matching Klook ticket names

### Track C: Blog Topics + First Post (Phase 7)

**Step C1:** Launch a Haiku subagent to generate `scripts/topics.json` with 10–20 blog topics:

```
Agent(
  model: "haiku",
  description: "Generate blog topics",
  prompt: "Create scripts/topics.json for [attraction name] with 10-20 blog topics.

Each entry: { slug, keyword, category, titleHint }

Categories: Travel Guide, Tips & Tricks, Comparison, Itinerary, Hidden Gems, Family Travel, Budget Travel.

Write the JSON array to scripts/topics.json."
)
```

**Step C2:** After the topics subagent completes, generate the first blog post using subagents (do NOT run `npm run generate-blog`). Pick the first topic from `scripts/topics.json` and do the following:

#### C2a — English article (Sonnet subagent)

```
Agent(
  model: "sonnet",
  description: "Write English blog article",
  prompt: "Write a full HTML blog post for [attraction name].

Topic: [topic.titleHint]
Primary keyword: [topic.keyword]
Slug: [topic.slug]
Published: [today's date, e.g. 2026-04-02]

Read src/data/site.json for attraction details.

REQUIREMENTS:
- 1,200–1,600 words (excluding HTML tags)
- Conversational but authoritative travel guide tone
- Primary keyword used 4–6 times naturally
- FAQ section (3–5 Q&A) at the end
- 2–4 internal links to: /tickets.html, /attractions.html, /faq.html, /tips.html, /getting-there.html

EXACT HTML STRUCTURE:
<article class='article-content'>
  <div class='container'>
    <header class='article-header'>
      <h1>[title]</h1>
      <div class='article-meta'>
        <time datetime='[date]'>Updated [formatted date]</time> &bull; [X] min read
      </div>
    </header>
    <div class='info-card' style='border-left: 4px solid var(--primary); background: var(--surface);'>
      <strong>TL;DR:</strong> [2–3 sentence summary]
    </div>
    <nav class='toc' aria-label='Table of Contents'>
      <h2>Table of Contents</h2>
      <ol>[list items with #anchor links]</ol>
    </nav>
    [<section id='...'> blocks with <h2>/<h3> headings]
    <section id='faq'>
      <h2>Frequently Asked Questions</h2>
      [questions and answers]
    </section>
    <div class='info-card' style='text-align:center; background: var(--surface);'>
      <strong>Ready to visit [attraction name]?</strong><br>
      <a href='/tickets.html' style='color: var(--primary);'>Book online and save off the gate price &rarr;</a>
    </div>
  </div>
</article>

Return ONLY raw HTML. No explanation, no markdown fences.

Write the result to src/content/blog/[slug]/en.html (create directories as needed)."
)
```

#### C2b — SEO metadata for all 12 languages (Sonnet subagent, run in parallel with C2a)

```
Agent(
  model: "sonnet",
  description: "Generate blog SEO metadata",
  prompt: "Generate SEO metadata for a blog post about [attraction name].

Topic: [topic.titleHint]
Primary keyword: [topic.keyword]

Generate for all 12 language codes: en, zh-CN, zh-TW, ja, ko, ru, hi, ms, vi, de, fr, lo

For each language provide:
- title (55–65 chars)
- metaDescription (148–158 chars)
- metaKeywords (6–8 comma-separated)
- ogTitle (50–60 chars)
- ogDescription (100–150 chars)
- twitterTitle (50–60 chars)
- twitterDescription (100–140 chars)
- breadcrumbName (3–5 words)
- cardCategory: one of [Practical Guide, Planning, Tickets & Prices, Family Guide, Travel Guide, Food & Dining, Comparison, Getting There, Itinerary, Budget Guide]
- cardTitle (60–70 chars)
- cardDescription (110–130 chars)

Return ONLY a JSON object: { \"en\": {...}, \"zh-CN\": {...}, ... }

Write the result to src/data/blog/.tmp/[slug]-meta.json"
)
```

#### C2c — Translate article to 11 languages (Haiku subagents, after C2a completes)

Launch in batches of 3 (same pattern as Track A translations). Each agent:
- Reads `src/content/blog/[slug]/en.html`
- Also reads `src/data/site.json` for `blog.doNotTranslate`
- Translates the HTML (keep all tags, attributes, href values unchanged; don't translate proper nouns from `doNotTranslate`)
- Writes to `src/content/blog/[slug]/[lang].html`

Batch order:
- Batch 1: `zh-CN`, `zh-TW`, `ja`
- Batch 2: `ko`, `ru`, `hi`
- Batch 3: `ms`, `vi`, `de`
- Batch 4: `fr`, `lo`

#### C2d — Write data files (main conversation, after C2a + C2b complete)

Once English HTML and metadata JSON are ready:

1. **`src/data/blog/[slug].json`** — create with:
   ```json
   {
     "slug": "[slug]",
     "ogImage": "og-home.jpg",
     "schemaType": "Article",
     "schemaHeadline": "[en meta title]",
     "schemaDescription": "[en meta metaDescription]",
     "schemaImage": "og-home.jpg",
     "datePublished": "[today]",
     "dateModified": "[today]",
     "authorName": "[site.blog.authorName]",
     "authorUrl": "[site.blog.authorUrl]"
   }
   ```

2. **`src/data/blog/index.json`** — prepend to `cards` array:
   ```json
   { "slug": "[slug]", "date": "[today]", "readTime": "[X] min read" }
   ```
   (estimate read time: word count of HTML ÷ 230, minimum 4)

3. **Each `src/i18n/{lang}.json`** — for all 12 languages, merge in:
   ```json
   {
     "blog": {
       "posts": {
         "[slug]": {
           "title": "...",
           "metaDescription": "...",
           "metaKeywords": "...",
           "ogTitle": "...",
           "ogDescription": "...",
           "twitterTitle": "...",
           "twitterDescription": "...",
           "breadcrumbName": "..."
         }
       },
       "index": {
         "cards": [{ "slug": "...", "category": "...", "title": "...", "description": "..." }, ...existing...]
       }
     }
   }
   ```

4. Delete `src/data/blog/.tmp/[slug]-meta.json`

Report the generated slug when done.

### Track D: Image Sourcing — Sonnet subagent

Launch a Sonnet subagent to find and download images for the site. The subagent should:

1. **Search Bing Images** for the attraction and each zone/area name
2. **Download** the best matching images (landscape, high quality, no watermarks)
3. **Save** to the `images/` directory with correct filenames:
   - `hero-desktop.jpg` — wide landscape hero shot (1920×800)
   - `hero-mobile.jpg` — mobile hero shot (portrait or square crop)
   - `og-home.jpg` — homepage OG image (1200×630)
   - `og-attractions.jpg`, `og-tickets.jpg`, `og-tips.jpg`, `og-getting-there.jpg`, `og-faq.jpg`, `og-blog.jpg` — per-page OG images (1200×630)
   - `zone-{id}.jpg` — one image per zone/area (filenames must match CSS classes in `css/style.css`)
4. **Update `css/style.css`** — replace the old zone CSS classes (e.g. `.zone-ghostbusters`) with new ones matching the attraction's actual zones, using the downloaded images

Use the same `searchWebImages()` and `downloadImage()` approach from `scripts/generate-blog.js` (Bing HTML scraping).

**Note:** Logo files (`logo.png`, `logo-light.png`, `logo-icon.svg`) cannot be auto-sourced — remind the user to create these manually.

Wait for all four tracks to complete, then proceed to Phase 8.

---

## Phase 8 — Build, Image Review & Verify

### Step 8a: Build

```bash
npm install
npm run build
```

Report the result:
- **Success**: count the generated `.html` files (should be 276+) and confirm
- **Error**: show the error output and fix before marking done

### Step 8a.1: Verify page content (DO NOT SKIP)

Build success does NOT mean content is correct — Nunjucks silently renders empty strings for missing keys. Run these checks:

```bash
# Attractions page has real content
node -e "const h=require('fs').readFileSync('attractions.html','utf8'); const m=h.match(/<section/g); console.log('attractions sections:', m?m.length:0)"
# Tickets page has real content
node -e "const h=require('fs').readFileSync('tickets.html','utf8'); const m=h.match(/<section/g); console.log('tickets sections:', m?m.length:0)"
# Blog post was generated
node -e "const d=JSON.parse(require('fs').readFileSync('src/data/blog/index.json','utf8')); console.log('blog posts:', d.cards.length)"
```

Expected: attractions 5+ sections, tickets 8+ sections, blog 1+ posts. If any is 0, the i18n keys are wrong — go back and fix the content before continuing.

### Step 8b: Image Review

After build succeeds, list all images in `images/` with file sizes. Flag any that are missing or suspiciously small (<10KB). Present a checklist:

```
📸 Image Review — please check and replace any you don't like:

Auto-downloaded:
  ✅ images/hero-desktop.jpg          (size) — hero banner
  ✅ images/hero-mobile.jpg           (size) — mobile hero
  ✅ images/og-home.jpg               (size) — homepage OG
  ✅ images/og-attractions.jpg        (size)
  ✅ images/og-tickets.jpg            (size)
  ✅ images/og-tips.jpg               (size)
  ✅ images/og-getting-there.jpg      (size)
  ✅ images/og-faq.jpg                (size)
  ✅ images/og-blog.jpg               (size) — blog index OG
  ✅ images/zone-{id}.jpg             (per zone)
  ...

Manual — create these yourself:
  ⬜ images/logo.png             (220×19px, navbar)
  ⬜ images/logo-light.png       (footer, light version)
  ⬜ images/logo-icon.svg        (favicon)
```

### Step 8c: Closing message

> **Your microsite is ready!**
>
> **Preview locally:** `npx serve -p 3001`
>
> **Next steps:**
> - Review and replace any auto-downloaded images you don't like
> - Create logo files (logo.png, logo-light.png, logo-icon.svg)
> - Set brand colours in `css/style.css` (CSS variables at the top)
> - Add GitHub Secrets: `FIRECRAWL_API_KEY` + `OPENROUTER_API_KEY`
> - Run `npm run generate-blog` for your first AI blog post

---

## Resuming Mid-Way

If the user says **"continue from phase X"** or **"resume at phase X"**:
1. Verify what's actually in the files (check for `CHANGE ME` placeholders) rather than blindly trusting their claim
2. For translations: check which `src/i18n/{lang}.json` files exist and are valid, and which `.tmp/` fragments remain — only re-run what's missing
3. Skip to the correct phase based on actual file state
4. Show checklist with all completed phases marked before proceeding

---

## Troubleshooting

**A subagent seems stuck or takes too long:**
- This is usually a token output limit issue. The section-level split should prevent this, but if it still happens, split the offending section further (e.g. split `home` into `home.zones` + `home` rest).
- For low-resource languages (lo, hi), check if the output was truncated (incomplete JSON). If so, re-run just that section agent.

**Build fails after translations:**
- Most common cause: invalid JSON in a translation file. Run `node -e "JSON.parse(require('fs').readFileSync('src/i18n/{lang}.json'))"` to find the broken file.
- Second most common: a subagent translated a JSON key or an href path. Diff against `en.json` to find mismatches in key structure.

**Merge conflicts in fragments:**
- If `.tmp/` fragments overlap in keys, the later `Object.assign()` wins. The section split is designed to be non-overlapping, so this shouldn't happen. If it does, check which agent wrote extra keys and re-run it with stricter instructions.

**Image download fails:**
- Bing image search can be unreliable (blocked requests, expired URLs, low quality results). If the subagent fails to download some images, it will report which ones are missing.
- The user can manually download and place images in `images/` with the correct filenames.
- Re-run `npm run build` after replacing images.
