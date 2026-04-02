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

For `schemaType`, the script lets you choose. Options are:
- `AmusementPark` — theme parks, water parks
- `TouristAttraction` — general attractions
- `Zoo` — zoos, aquariums
- `Museum` — museums, galleries
- `NaturalFeature` — natural landmarks

### Step 4: Set Up Initial Prices (`data/prices.json`)

The setup script fills in `activityId`. Now add the actual ticket packages:
```json
{
  "activityId": "12345",
  "packages": [
    { "id": "standard-admission", "name": "Standard Ticket", "priceTHB": 1000, "gatePrice": 1500, "priceUSD": 29 }
  ]
}
```

Also update `src/data/home.json` with the ticket prices for the homepage pricing cards.

### Step 5: Update Klook Scraper (`scripts/scrape-klook.js`)

Update `PACKAGE_MATCHERS` to match the Klook package names for this attraction. Tips:
1. Visit the Klook activity URL in a browser
2. Note the exact package/ticket names shown
3. Write regex patterns to match those names
4. Map each to an internal ID that matches your `data/prices.json` packages

### Step 6: Generate English i18n Content (`src/i18n/en.json`) — Parallelized with Sonnet

This is the largest task. Use **Sonnet subagents** to write sections in parallel.

**Step 6a:** Main conversation writes small sections directly: `skipLink`, `nav`, `announcement`, `stickyBar`, `footer`

**Step 6b:** Launch 5 Sonnet subagents in parallel, each writing assigned sections:

| Subagent | Sections |
|----------|----------|
| Sonnet A | `home` — hero, stats, TL;DR, GBP card, Why Visit cards, zones, tickets, transport, testimonials, FAQs, CTA |
| Sonnet B | `faq` — 30-40 FAQs in 7 categories |
| Sonnet C | `attractions` + `tickets` — full page content |
| Sonnet D | `gettingThere` — transport options, directions, parking |
| Sonnet E | `tips` — visitor tips by category |

Each subagent also generates SEO metadata (`title`, `metaDescription`, `metaKeywords`, `ogTitle`, `ogDescription`, `twitterTitle`, `twitterDescription`) for its pages.

**Step 6c:** Merge all subagent results into a single `src/i18n/en.json`.

Content guidelines for all subagents:
- **SEO titles**: 55-65 characters, include attraction name and primary keyword
- **Meta descriptions**: 148-158 characters, include call-to-action
- **FAQ answers**: Use HTML (`<p>`, `<strong>`, `<a>` with internal links like `/tickets.html`)
- **Tone**: Conversational, helpful, authoritative travel guide
- **Prices**: Use current Klook prices with THB as base currency
- Research the attraction thoroughly — include real details, not generic filler

### Step 7–10: Run in Parallel After English Content

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

**Track C — Blog topics (Haiku subagent):**
Launch a single `Agent(model: "haiku")` to generate `scripts/topics.json` with 10-20 blog topics.

**Track D — Image sourcing (Sonnet subagent):**
Launch a Sonnet subagent to search Bing Images, download, and save images for the site:
- `hero-desktop.jpg` — wide landscape hero shot (1920×800)
- `hero-mobile.jpg` — mobile hero shot (portrait or square crop)
- `og-home.jpg`, `og-attractions.jpg`, `og-tickets.jpg`, `og-tips.jpg`, `og-getting-there.jpg`, `og-faq.jpg`, `og-blog.jpg` — OG images (1200×630)
- `zone-{id}.jpg` — one per zone/area
- Update `css/style.css` zone CSS classes to match the attraction's actual zones

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

After build succeeds, present an **image review checklist** — list all auto-downloaded images with file sizes, flag any missing or suspiciously small (<10KB), and remind the user to create logo files manually:

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
