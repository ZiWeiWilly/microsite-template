# Klook Attraction Landing Page — Template

This is a **template project** for generating multilingual static websites that serve as visitor guides and Klook affiliate landing pages for tourist attractions. Each site has 6 main pages + a blog system, supports 12 languages, and includes automated price scraping and AI blog generation.

## What This Template Does

- **6 Pages**: Homepage, Attractions, Tickets, Getting There, Tips, FAQ
- **Blog System**: AI-generated multilingual blog posts
- **12 Languages**: English, 简体中文, 繁體中文, 日本語, 한국어, Deutsch, Français, हिन्दी, Русский, Tiếng Việt, Bahasa Melayu, ລາວ
- **17 Currencies**: Real-time conversion with currency switcher
- **Daily Price Updates**: Automated Klook price scraping
- **SEO Optimized**: Schema.org, hreflang, Open Graph, sitemaps

---

## How to Set Up a New Site

When someone asks you to create a landing page for a specific attraction, follow these steps in order.

### Step 0: Pre-flight Setup

Before starting, collect these from the user (use `AskUserQuestion` to gather all at once):
1. **Attraction name** — full official name
2. **Klook activity URL** — if known (e.g. `https://www.klook.com/activity/12345-...`)
3. **Domain name** — for the site (e.g. `myattraction.guide`)
4. **Klook affiliate URL** — their affiliate redirect URL. This is injected into every booking button via `site.json` → `klook.affiliateUrl` → `data-booking-url` on `<body>` → read by `main.js`
5. **Brand colours** — primary, secondary, accent. Or "auto" to pick from the attraction's branding
6. **Languages** — all 12, or a specific subset?

### Step 1: Research the Attraction

Before writing any code, gather this information (use web search if needed):
- Full official name and common alternate names
- Physical address (street, city, region, postal code, country)
- GPS coordinates (latitude, longitude)
- Phone number
- Opening hours (days and times)
- Klook activity URL (search klook.com for the attraction)
- Official website URL
- Social media links (Facebook, Instagram, TikTok)
- Google Maps URL and embed URL
- Google rating and review count
- Key amenities (parking, lockers, food, etc.)
- Ticket types and approximate prices
- Main zones/areas/sections of the attraction
- What makes this attraction special (USPs)

### Step 2: Run the Setup Script

Run the interactive setup wizard. It pre-fills `site.json`, `data/prices.json`, `CNAME`, `robots.txt`, and `package.json` from your answers:

```bash
npm run setup
```

Answer each prompt with the information you researched in Step 1. Press Enter to skip optional fields — you can fill them in later. When the script finishes, the core config will be done.

### Step 3: Complete `src/data/site.json`

The setup script fills in the most critical fields. Open `src/data/site.json` and add the remaining details that the script doesn't collect interactively:

- `alternateNames` — add common name variants (e.g. `["Ramayana", "Ramayana Pattaya"]`)
- `rating` — aggregate rating from Google/Klook (`value`, `count`, `best`)
- `amenities` — list of amenity strings (e.g. `["Free Parking", "Lockers", "Food Court"]`)
- `mapsUrl` — Google Maps share URL (e.g. `https://maps.app.goo.gl/...`)
- `mapsEmbed` — Google Maps embed src URL (from Share → Embed a map → copy the `src="..."` value). **Required for the Getting There page iframe.**

For `schemaType`, the script lets you choose. Options are:
- `AmusementPark` — theme parks, water parks
- `TouristAttraction` — general attractions
- `Zoo` — zoos, aquariums
- `Museum` — museums, galleries
- `NaturalFeature` — natural landmarks

### Step 4: Set `baseCurrency` in `src/data/site.json`

Set `baseCurrency` to the local currency code of the attraction's country (e.g. `"HKD"` for Hong Kong, `"JPY"` for Japan, `"THB"` for Thailand). This value is used by the build script, templates, and frontend currency switcher.

### Step 5: Set Up Initial Prices (`data/prices.json`)

The setup script fills in `activityId`. Now add the actual ticket packages. The price field is `basePrice` (in whatever currency `site.json → baseCurrency` is). Set the base currency's exchange rate to `1`.

```json
{
  "activityId": "12345",
  "packages": [
    { "id": "standard-admission", "name": "Standard Ticket", "basePrice": 1000, "gatePrice": 1500, "priceUSD": 29 }
  ]
}
```

Also update `src/data/home.json` with the ticket prices for the homepage pricing cards.

### Step 6: Update Klook Scraper (`scripts/scrape-klook.js`)

Update `PACKAGE_MATCHERS` to match the Klook package names for this attraction. Tips:
1. Visit the Klook activity URL in a browser
2. Note the exact package/ticket names shown
3. Write regex patterns to match those names
4. Map each to an internal ID that matches your `data/prices.json` packages

### Step 7: Generate English i18n Content (`src/i18n/en.json`) — Parallelized with Sonnet

This is the largest task. Use **Sonnet subagents** to write sections in parallel.

**Step 6a:** Main conversation writes small sections directly: `skipLink`, `nav`, `announcement`, `stickyBar`, `footer`

**Step 6b:** Launch 5 Sonnet subagents in parallel. **CRITICAL:** Each subagent MUST read its corresponding Nunjucks template (`src/templates/pages/*.njk`) BEFORE generating content — the template defines the exact JSON key structure. Nunjucks silently outputs empty strings for undefined keys, so mismatched keys produce blank pages without build errors.

| Subagent | Sections |
|----------|----------|
| Sonnet A | `home` — read `index.njk` first. Hero, stats, TL;DR, GBP card, Why Visit cards, zones, tickets, transport, testimonials, FAQs, CTA. **Blog cards must include a `slug` field** (e.g. `{ slug: "blog/best-time-to-visit.html", title: "...", ... }`). **CRITICAL — zone items:** Each zone in `home.zones.items` must include an `id` field (e.g. `{ "id": "adventure-zone", "name": "...", "tag": "...", ... }`) that exactly matches the zone `id` values in `src/data/attractions.json`. The template uses this `id` to look up the zone's `cssClass` for the background image — if `id` doesn't match, all zone cards will show the wrong image. Use the zone ids established during the research/setup phase. |
| Sonnet B | `faq` — read `faq.njk` first. 30-40 FAQs in 7 categories. **CRITICAL:** Use `questions` (NOT `items`) as the array key — `buildFaqSchema()` calls `cat.questions`. |
| Sonnet C | `attractions` + `tickets` — read `attractions.njk` AND `tickets.njk` first. Match the exact key structures below. |
| Sonnet D | `gettingThere` — read `getting-there.njk` first. Transport options, directions, parking |
| Sonnet E | `tips` — read `tips.njk` first. Visitor tips by category. **Each card must include an `emoji` field** (e.g. `{ emoji: "🎫", h3: "...", p: "..." }`). TOC items must use `{ id, label }` format (e.g. `{ "id": "before-you-go", "label": "Before You Go" }`). |

**Sonnet C required key structures:**

`t.attractions` keys: `title`, `metaDescription`, `metaKeywords`, `ogTitle`, `ogDescription`, `twitterTitle`, `twitterDescription`, `breadcrumbCurrent`, `schema { name, alternateName[], description, touristType[], containsPlace[] }`, `pageHeader { h1, description }`, `tldr [{ bold, text }]`, `zoneNav { heading, sectionLabel, description, zones [{ tag, name, subtitle }] }`, `zones [{ h2, tag, subtitle, intro, keyAttractionsLabel, attractions [{ name, desc }], highlights [], tipContent }]`, `extras { heading, sectionLabel, description, items [{ id, emoji, h3, content, highlights [] }] }` ← **`id` is the HTML anchor (e.g. `"dining"`), `emoji` is the icon; both live here, not in attractions.json**, `faq { heading, sectionLabel, description, items [{ question, answer }], viewAll }`, `cta { heading, text, button, link }`

`t.tickets` keys: `title`, `metaDescription`, `metaKeywords`, `ogTitle`, `ogDescription`, `twitterTitle`, `twitterDescription`, `breadcrumbCurrent`, `schema { breadcrumbCurrent }`, `hero { badge, h1, h1Sub, sub, cta1, cta2, stats [4 items with number/label] }`, `tldr [{ bold?, text }]`, `ticketOptions { sectionLabel, heading, description, tableHeaders [4], tableRows [{ name, included }], tableFootnote, cta }`, `pricingCards { sectionLabel, heading, description, cards [3 items: { h3, period, features [], cta }] }`, `addons { sectionLabel, heading, description, items [4 items: { h3, text }] }`, `howToBook { sectionLabel, heading, description, items [4 items: { h3, text }], cta }`, `cancellation { sectionLabel, heading, items [{ bold?, text }], footerNote }`, `savingsTips { sectionLabel, heading, description, tips [5 items: { h3, text }], cta }`, `cta1 { heading, text, button, subtextPrefix }`, `faq { sectionLabel, heading, description, items [{ question, answer }], viewAll }`, `priceGuide { heading, description, blogSlug, button }`, `cta2 { heading, text, button }`

Each subagent also generates SEO metadata (`title`, `metaDescription`, `metaKeywords`, `ogTitle`, `ogDescription`, `twitterTitle`, `twitterDescription`) for its pages.

**Step 6c:** Merge all subagent results into a single `src/i18n/en.json`.

**Step 6d — Verify content completeness:** After merging, run a quick check on the generated `en.json` to confirm key pages have real content (not empty or placeholder values):
- `en.json` → `attractions.pageHeader.h1` exists and is not empty
- `en.json` → `attractions.zones` array has entries
- `en.json` → `tickets.hero.h1` exists and is not empty
- `en.json` → `tickets.pricingCards.cards` array has 3 entries
- `en.json` → `faq.categories` array has entries with `questions` arrays
- `en.json` → `home.hero.title` exists and is not empty
If any are missing, re-run the corresponding subagent before proceeding.

Content guidelines for all subagents:
- **Headings (h1, h2, h3, heading keys): max 10 words.** Keep them punchy and scannable — e.g. "Top Rides & Attractions" not "Discover All the Amazing Rides and Attractions You Can Enjoy"
- **SEO titles**: 55-65 characters, include attraction name and primary keyword
- **Meta descriptions**: 148-158 characters, include call-to-action
- **FAQ answers**: Use HTML (`<p>`, `<strong>`, `<a>` with internal links like `/tickets.html`)
- **Tone**: Conversational, helpful, authoritative travel guide
- **Prices**: Use current Klook prices with THB as base currency
- Research the attraction thoroughly — include real details, not generic filler

### Step 8–11: Run in Parallel After English Content

Once `en.json` is complete, run these three tracks concurrently:

**Track A — Translations (Haiku subagents):**
**Always split every language into 5 section-level Haiku subagents** to prevent any language from getting stuck:

| Agent | Sections |
|-------|----------|
| A | `skipLink`, `nav`, `announcement`, `stickyBar`, `footer`, `home` |
| B | `faq` |
| C | `attractions`, `tickets` |
| D | `gettingThere` |
| E | `tips` |

Each agent reads `en.json` + `site.json`, translates only its assigned keys, writes a temp fragment to `src/i18n/.tmp/{lang}_{section}.json`. Main conversation merges all 5 fragments into `src/i18n/{lang}.json`.

Batch order (5 agents × 3 languages = 15 agents per batch):
- Batch 1: `zh-CN`, `zh-TW`, `ja`
- Batch 2: `ko`, `ru`, `hi`
- Batch 3: `ms`, `vi`, `de`
- Batch 4: `fr`, `lo`

**Resume after interruption:** Check which `{lang}.json` files exist and are valid. Check `.tmp/` for leftover fragments to merge. Only re-run missing languages.

**Track B — Data files + Scraper (main conversation):**
- `src/data/attractions.json` — zone definitions
- `src/data/tips.json` — emoji arrays
- `src/data/home.json` — icons, prices, blog slugs
- `scripts/scrape-klook.js` — update `PACKAGE_MATCHERS`

**Track C — Blog topics + first post:**
1. Launch a Haiku subagent to generate `scripts/topics.json` with 10-20 blog topics.
2. After topics are ready, generate the first blog post using subagents (do NOT run `npm run generate-blog`):
   - **Sonnet subagent A** writes English HTML → `src/content/blog/{slug}/en.html`
   - **Sonnet subagent B** (parallel) generates SEO metadata for all 12 languages → temp JSON
   - **Haiku subagents** (after English done) translate the HTML to 11 languages in batches of 3
   - **Main conversation** writes `src/data/blog/{slug}.json`, prepends to `src/data/blog/index.json`, merges metadata into each `src/i18n/{lang}.json`
   See SKILL.md Track C for full details and exact file structures.

**Track D — Image sourcing (Sonnet subagent):**
Launch a Sonnet subagent to search Bing Images, download, and save images for the site:
- `hero-desktop.jpg` — wide landscape hero shot (1920×800)
- `hero-mobile.jpg` — mobile hero shot (portrait or square crop)
- `og-home.jpg`, `og-attractions.jpg`, `og-tickets.jpg`, `og-tips.jpg`, `og-getting-there.jpg`, `og-faq.jpg`, `og-blog.jpg` — OG images (1200×630)
- `zone-{id}.jpg` — one per zone/area (where `{id}` matches the zone `id` in `src/data/attractions.json`)

**CRITICAL — image format:** All images must be saved with `.jpg` extension. If a downloaded file is `.png` or `.webp`, rename it or convert it: `sips -s format jpeg input.png --out output.jpg`. The CSS references `.jpg` filenames — extension mismatches cause images to silently not appear.

**Zone images — no CSS needed:** Zone background images are set automatically via inline style in the templates. The image path is derived directly from each zone's `cssClass` field: `url('/images/{cssClass}.jpg')`. You only need to ensure the downloaded image filename matches `{cssClass}.jpg` exactly — no CSS edits required.

Note: Logo files (`logo.png`, `logo-light.png`, `logo-icon.svg`) must be created manually by the user.

### Step 11: Remaining Images

Logo files cannot be auto-sourced. Remind the user to create:
- `images/logo.png` — navbar logo (~220×19px)
- `images/logo-light.png` — footer logo (light version)
- `images/logo-icon.svg` — favicon

### Step 12: Theme the CSS

Edit `css/style.css` CSS custom properties to match the attraction's brand:
```css
:root {
  --primary: #0ea5e9;      /* Main brand colour */
  --primary-dark: #0284c7;  /* Darker variant */
  --secondary: #06b6d4;     /* Secondary colour */
  --accent: #f59e0b;        /* Accent colour */
  --surface: #f0f9ff;       /* Light background tint */
}
```

### Step 13: Build, Image Review & Deploy

```bash
npm install
npm run build          # Should build 276+ HTML files with no errors
```

After build succeeds, **verify page content is not empty** by spot-checking the built HTML:
```bash
# Check attractions page has real content (not just nav/footer)
node -e "const h=require('fs').readFileSync('attractions.html','utf8'); const m=h.match(/<article/g); console.log('attractions.html articles:', m?m.length:0)"
# Check tickets page
node -e "const h=require('fs').readFileSync('tickets.html','utf8'); const m=h.match(/<section/g); console.log('tickets.html sections:', m?m.length:0)"
# Check blog post exists
node -e "const d=JSON.parse(require('fs').readFileSync('src/data/blog/index.json','utf8')); console.log('blog posts:', d.cards.length)"
```
If any page has 0 sections/articles, the i18n keys are mismatched — go back and fix before continuing.

Then present an **image review checklist** — list all auto-downloaded images with file sizes, flag any missing or suspiciously small (<10KB), and remind the user to create logo files manually:

```
📸 Image Review — check and replace any you don't like:

Auto-downloaded:
  ✅ images/hero-desktop.jpg          (size)
  ✅ images/og-home.jpg               (size)
  ✅ images/og-*.jpg                  (per page)
  ✅ images/zone-*.jpg                (per zone)

Manual — create these yourself:
  ⬜ images/logo.png             (220×19px, navbar)
  ⬜ images/logo-light.png       (footer, light version)
  ⬜ images/logo-icon.svg        (favicon)
```

Preview locally: `npx serve -p 3001`

Update these files for deployment (setup script handles CNAME and robots.txt automatically):
- `sitemap.xml` — regenerate with correct URLs

Set up GitHub Secrets:
- `FIRECRAWL_API_KEY` — for daily Klook price scraping
- `OPENROUTER_API_KEY` — for weekly AI blog generation

---

## Quick Reference

```bash
npm run setup                  # Interactive setup wizard (run first!)
npm run build                  # Build all pages (12 langs × 7 pages + blogs)
npm run scrape                 # Scrape Klook prices (needs FIRECRAWL_API_KEY)
npm run rates                  # Fetch exchange rates
npm run update                 # Rebuild site with latest prices
npm run all                    # scrape + rates + update
npm run generate-blog          # Generate AI blog post (needs OPENROUTER_API_KEY)
npm run generate-blog:dry      # Preview blog generation
npx serve -p 3001             # Dev server
```

## Architecture

```
├── src/
│   ├── build.js                 # Nunjucks → HTML build script
│   ├── templates/               # Page templates (config-driven, no hardcoded values)
│   ├── i18n/{lang}.json         # Translation files (12 languages)
│   ├── data/
│   │   ├── site.json            # ★ Central config — all attraction-specific values
│   │   ├── home.json            # Homepage data (icons, prices, blog slugs)
│   │   ├── attractions.json     # Zone/area definitions
│   │   ├── tips.json            # Tip section emojis
│   │   └── blog/index.json     # Blog post index
│   └── content/blog/{slug}/    # Blog post HTML by language
├── scripts/
│   ├── scrape-klook.js         # Klook price scraper (reads site.json)
│   ├── generate-blog.js        # AI blog generator (reads site.json)
│   ├── fetch-rates.js          # Exchange rate fetcher
│   ├── update-site.js          # Price sync to HTML/JS (reads site.json)
│   └── topics.json             # Blog topic queue
├── data/prices.json            # Current prices + exchange rates
├── css/style.css               # Styles (CSS variables for theming)
├── js/main.js                  # Frontend (currency switcher, booking links)
├── images/                     # All image assets
└── .github/workflows/          # Daily price scrape + weekly blog generation
```

## Key Design Principles

- **`site.json` is the single source of truth** — templates and scripts read attraction name, address, phone, Klook URLs, schema type, etc. from this file. No hardcoded attraction-specific values exist in templates.
- **i18n files contain ALL page content** — templates only have structure, never text. Content changes go in i18n files.
- **Non-translatable data goes in `src/data/*.json`** — things like emoji arrays, CSS classes, image paths.
- **Blog posts are stored as per-language HTML** in `src/content/blog/{slug}/{lang}.html`, with metadata in `src/data/blog/{slug}.json` and SEO data in the i18n files.

---

## Design & Tone Guidelines

These guidelines apply to all microsites and were established based on BD/merchant relations feedback. Follow them when generating initial content and when making any edits.

### Hero Area — Blog-like, Not Transactional

- **Do not** place a large CTA button in the Hero section. It signals aggressive advertising and can undermine trust.
- Instead, place a **trust badge** below the hero heading:
  ```
  "Official e-tickets via Klook — Authorized partner"
  ```
  Use `home.heroTrustBadge` as the i18n key. The template class is `hero-trust-badge` (small, semi-transparent white text).
- The top half of the homepage should feel like a travel guide, not an ad. The first booking CTA should appear no earlier than the GBP card or tickets section (below the fold).

### Tone & Promotional Language

Avoid aggressive promotional copy. Use the following substitutions:

| Avoid | Use instead |
|-------|-------------|
| "Book Discounted Tickets →" | "Book Tickets Online →" |
| "Get Discounted Tickets →" | "Book Tickets Online →" |
| "Save ~27% Online" | "Online Exclusive Pricing" |
| "Save big on your visit" | "Book ahead for the best experience" |
| "Limited Time: Save X%..." | "Plan Your Visit — Online tickets from [PRICE] with instant confirmation" |
| "Don't pay full price" | (remove entirely) |
| "Save X% booking online" | "Online Exclusive Pricing" |

- Prices can be shown (e.g. "from THB 1,176"), but **do not use strikethrough gate price comparisons**.
- Sticky bar `subText`: use `"per person • Online Price"` not `"per person • Save X%"`.

### Phone Numbers — Do Not Expose

- **Do not** include the venue's phone number in the Footer or FAQ pages.
- Anywhere that previously linked to a phone number (contact sections, FAQ contact buttons), link to the **official website** instead: `href="[site.officialWebsiteUrl]"`.
- Schema.org structured data may retain `telephone` (it's not user-visible and helps SEO).

### Photo Gallery Section

Add a **Photo Gallery** section between the Themed Zones and Tickets Preview sections on the homepage.

**Layout (CSS Grid):**
```css
.gallery-grid {
  display: grid;
  grid-template-columns: 2fr 1fr 1fr;
  grid-template-rows: 260px 220px;
  gap: 0.625rem;
}
.gallery-item-hero { grid-column: span 2; }  /* first image = hero */
```

Mobile breakpoint: `grid-template-columns: 1fr 1fr` (hero item still spans 2).

**Image sourcing:** Look in the attraction's official website theme directory (e.g. `/wp-content/themes/*/images/main/`) for promotional images. Target: 1 park overview (hero), plus 4–5 zone/activity shots. Download and save as `images/gallery-*.jpg` or `images/gallery-*.webp`.

**i18n key:** `home.gallery` with `sectionLabel`, `heading`, `description`, and `items[]` (each with `alt` and `caption`).
