#!/usr/bin/env node
/**
 * AI Blog Post Generator for your-attraction-site.com
 *
 * Uses OpenRouter to generate multilingual blog posts and OG images.
 *   - Text:  anthropic/claude-sonnet-4-6
 *   - Image: google/gemini-3.1-flash-image-preview
 *
 * Usage:
 *   node scripts/generate-blog.js              # auto-select next topic
 *   node scripts/generate-blog.js --dry-run    # preview only, no files written
 *   node scripts/generate-blog.js --slug your-attraction-topic-guide
 *
 * Required env var: OPENROUTER_API_KEY
 */

const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');

// ── Paths ────────────────────────────────────────────────────────────────────
const ROOT        = path.join(__dirname, '..');
const SRC         = path.join(ROOT, 'src');
const I18N_DIR    = path.join(SRC, 'i18n');
const DATA_DIR    = path.join(SRC, 'data');
const CONTENT_DIR = path.join(SRC, 'content', 'blog');
const IMAGES_DIR  = path.join(ROOT, 'images');
const TOPICS_FILE = path.join(__dirname, 'topics.json');
const SITE        = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'site.json'), 'utf8'));

// ── Config ───────────────────────────────────────────────────────────────────
const TEXT_MODEL      = 'anthropic/claude-sonnet-4-6';
const TRANSLATE_MODEL = 'anthropic/claude-haiku-4-5';
const IMAGE_MODEL     = 'google/gemini-3.1-flash-image-preview';
const DRY_RUN     = process.argv.includes('--dry-run');
const slugArg     = (() => {
  const i = process.argv.indexOf('--slug');
  return i !== -1 ? process.argv[i + 1] : null;
})();

// Language name lookup for translation prompts
const LANG_NAMES = {
  'en': 'English', 'zh-CN': 'Simplified Chinese (Mandarin)', 'zh-TW': 'Traditional Chinese',
  'ja': 'Japanese', 'ko': 'Korean', 'ru': 'Russian', 'hi': 'Hindi',
  'ms': 'Malay', 'vi': 'Vietnamese', 'de': 'German', 'fr': 'French', 'lo': 'Lao',
};

// Derive LANGUAGES from site.json instead of hardcoding
const LANGUAGES = SITE.languages.map(l => ({
  code: l.code,
  name: LANG_NAMES[l.code] || l.label,
}));

// Add blog slugs here as you generate posts, so new posts can link to them
const EXISTING_BLOG_SLUGS = [];

// ── Token usage tracker ─────────────────────────────────────────────────────
const usageTracker = {
  calls: [],
  track(label, model, usage) {
    if (!usage) return;
    this.calls.push({
      label,
      model: model.replace('anthropic/', '').replace('google/', ''),
      prompt_tokens: usage.prompt_tokens || 0,
      completion_tokens: usage.completion_tokens || 0,
      total_tokens: usage.total_tokens || 0,
    });
  },
  summary() {
    if (!this.calls.length) return '  (no usage data captured)';
    const lines = [];
    let totalPrompt = 0, totalCompletion = 0, totalAll = 0;
    const byModel = {};
    for (const c of this.calls) {
      lines.push(`  ${c.label.padEnd(28)} ${c.model.padEnd(22)} ${String(c.prompt_tokens).padStart(8)} in  ${String(c.completion_tokens).padStart(8)} out  ${String(c.total_tokens).padStart(8)} total`);
      totalPrompt += c.prompt_tokens;
      totalCompletion += c.completion_tokens;
      totalAll += c.total_tokens;
      if (!byModel[c.model]) byModel[c.model] = { prompt: 0, completion: 0, total: 0, count: 0 };
      byModel[c.model].prompt += c.prompt_tokens;
      byModel[c.model].completion += c.completion_tokens;
      byModel[c.model].total += c.total_tokens;
      byModel[c.model].count++;
    }
    lines.push('  ' + '─'.repeat(90));
    for (const [model, m] of Object.entries(byModel)) {
      lines.push(`  ${(model + ' (' + m.count + ' calls)').padEnd(28)} ${''.padEnd(22)} ${String(m.prompt).padStart(8)} in  ${String(m.completion).padStart(8)} out  ${String(m.total).padStart(8)} total`);
    }
    lines.push('  ' + '─'.repeat(90));
    lines.push(`  ${'TOTAL (' + this.calls.length + ' calls)'.padEnd(28)} ${''.padEnd(22)} ${String(totalPrompt).padStart(8)} in  ${String(totalCompletion).padStart(8)} out  ${String(totalAll).padStart(8)} total`);
    return lines.join('\n');
  },
};

// ── Helpers ──────────────────────────────────────────────────────────────────
function log(msg) { console.log(`[generate-blog] ${msg}`); }
function warn(msg) { console.warn(`[generate-blog] WARN: ${msg}`); }
function die(msg) { console.error(`[generate-blog] ERROR: ${msg}`); process.exit(1); }

function today() { return new Date().toISOString().slice(0, 10); }

function formatDate(isoDate) {
  return new Date(isoDate).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
}

function estimateReadTime(html) {
  const words = html.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
  return `${Math.max(4, Math.round(words / 230))} min read`;
}

/** Strip markdown code fences and parse JSON */
function extractJSON(text) {
  const stripped = text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
  const start = stripped.search(/[{[]/);
  if (start === -1) throw new Error('No JSON found in model response');
  return JSON.parse(stripped.slice(start));
}

/** Extract base64 image data + extension from an OpenRouter image response */
function extractImageData(response) {
  const msg = response.choices[0]?.message;
  if (!msg) throw new Error('No message in response');

  // ── OpenRouter Gemini format: message.images[] ──────────────────────────────
  // When modalities:['image','text'] is set, OpenRouter returns image data
  // in a non-standard `images` array on the message object.
  const images = msg.images;
  if (Array.isArray(images) && images.length > 0) {
    const first = images[0];
    const rawUrl = first?.image_url?.url || first?.url || '';
    if (rawUrl.startsWith('data:')) {
      const [meta, b64] = rawUrl.split(',');
      const ext = meta.includes('png') ? 'png' : 'jpg';
      return { buffer: Buffer.from(b64, 'base64'), ext };
    }
  }

  // ── Fallback: scan content parts ───────────────────────────────────────────
  const content = msg.content;
  if (!content) throw new Error('No image data found in response');

  const parts = Array.isArray(content) ? content : [{ type: 'text', text: content }];
  for (const part of parts) {
    if (part.type === 'image_url') {
      const url = part.image_url?.url || '';
      if (url.startsWith('data:')) {
        const [meta, b64] = url.split(',');
        const ext = meta.includes('png') ? 'png' : 'jpg';
        return { buffer: Buffer.from(b64, 'base64'), ext };
      }
    }
    if (part.type === 'inline_data') {
      const ext = (part.inline_data?.mime_type || '').includes('png') ? 'png' : 'jpg';
      return { buffer: Buffer.from(part.inline_data.data, 'base64'), ext };
    }
    if (part.type === 'text' && typeof part.text === 'string' && part.text.startsWith('data:')) {
      const [meta, b64] = part.text.split(',');
      const ext = meta.includes('png') ? 'png' : 'jpg';
      return { buffer: Buffer.from(b64, 'base64'), ext };
    }
  }
  throw new Error('No image data found in response content');
}

// ── Image pipeline helpers ────────────────────────────────────────────────────

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

  // Bing HTML-encodes the JSON blobs — decode &quot; → " before matching
  const decoded = html.replace(/&quot;/g, '"').replace(/&amp;/g, '&');

  // Full-size image URLs appear as "murl":"https://..."
  const urls = [...decoded.matchAll(/"murl":"([^"]+)"/g)]
    .map(m => {
      // Also decode unicode escapes like \u0026 → &
      return m[1].replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
    })
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

/** Call Gemini to modify a source image. Returns { buffer, ext } */
async function modifyImageWithGemini(sourceBuffer, sourceMime, topic, client) {
  const base64 = sourceBuffer.toString('base64');
  const editPrompt =
    `This is a photo of ${SITE.attractionName}.\n` +
    `Transform it into a vibrant, polished travel blog header image for an article about: "${topic.titleHint}".\n` +
    `Enhance colours to be bright and inviting.\n` +
    `Improve lighting and contrast. Keep the attraction atmosphere.\n` +
    `Output as a clean 1200×630 horizontal banner. No text, no logos, no watermarks.`;

  const response = await client.chat.completions.create({
    model: IMAGE_MODEL,
    modalities: ['image', 'text'],   // Required for Gemini to output image data
    messages: [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: `data:${sourceMime};base64,${base64}` } },
        { type: 'text', text: editPrompt },
      ],
    }],
  });
  usageTracker.track('og-image', IMAGE_MODEL, response.usage);
  return extractImageData(response);
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

// ── Topic selection ───────────────────────────────────────────────────────────
async function selectTopic(client) {
  const topics   = JSON.parse(fs.readFileSync(TOPICS_FILE, 'utf8'));
  const indexData = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'blog', 'index.json'), 'utf8'));
  const used = new Set([...indexData.cards.map(c => c.slug), ...EXISTING_BLOG_SLUGS]);

  if (slugArg) {
    const t = topics.find(t => t.slug === slugArg);
    if (!t) die(`Topic "${slugArg}" not found in topics.json`);
    return t;
  }

  let next = topics.find(t => !used.has(t.slug));
  if (!next) {
    log('All topics used — generating 15 more...');
    const usedTitles = topics.map(t => t.titleHint).join('\n');
    const prompt = `Generate 15 NEW blog post topics for ${SITE.attractionName}.

Each topic must be a JSON object with:
- "slug": URL-friendly slug
- "titleHint": suggested article title (60-70 chars)
- "keyword": primary SEO keyword

Topics should cover: ticket pricing guides, best time to visit, family tips, food guides, nearby attractions, transport guides, seasonal events, photography tips, comparison guides, history/culture.

Do NOT repeat any of these already-used titles:
${usedTitles}

Return a JSON array of 15 topic objects. No explanatory text.`;

    const raw = await client.chat.completions.create({
      model: TEXT_MODEL,
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    });
    usageTracker.track('refill-topics', TEXT_MODEL, raw.usage);
    const newTopics = extractJSON(raw.choices[0].message.content);
    const merged = [...topics, ...newTopics];
    fs.writeFileSync(TOPICS_FILE, JSON.stringify(merged, null, 2) + '\n');
    log(`Added ${newTopics.length} new topics (total: ${merged.length})`);
    next = newTopics.find(t => !used.has(t.slug));
    if (!next) die('Failed to generate unused topics.');
  }

  return next;
}

// ── Prompts ───────────────────────────────────────────────────────────────────
function promptEnglishArticle(topic, dateStr) {
  const relatedLinks = EXISTING_BLOG_SLUGS.slice(0, 6).map(s => `  - /blog/${s}.html`).join('\n');
  const domain = SITE.baseUrl.replace('https://', '');
  return `You are a senior travel writer for ${domain}, the official guide to ${SITE.attractionName}.

Write a thorough, SEO-optimised blog article in HTML for:

Title hint: ${topic.titleHint}
Primary keyword: "${topic.keyword}"
Published: ${dateStr} (display as: ${formatDate(dateStr)})

REQUIREMENTS
- 1,200–1,600 words (excluding HTML tags)
- Conversational but authoritative; helpful and specific
- Primary keyword used 4–6 times naturally
- FAQ section (3–5 questions) at the end
- 2–4 internal links to: /tickets.html, /attractions.html, /faq.html, /tips.html, /getting-there.html
- 1–2 links to related blog posts (most relevant from):
${relatedLinks}

EXACT HTML STRUCTURE:

<article class="article-content">
  <div class="container">

    <header class="article-header">
      <h1>[title]</h1>
      <div class="article-meta">
        <time datetime="${dateStr}">Updated ${formatDate(dateStr)}</time> &bull; [X] min read
      </div>
    </header>

    <div class="info-card" style="border-left: 4px solid var(--primary); background: var(--surface);">
      <strong>TL;DR:</strong> [2–3 sentence summary]
    </div>

    <nav class="toc" aria-label="Table of Contents">
      <h2>Table of Contents</h2>
      <ol>[list items with #anchor links]</ol>
    </nav>

    [<section id="..."> blocks with <h2>/<h3> headings]

    <section id="faq">
      <h2>Frequently Asked Questions</h2>
      [questions and answers]
    </section>

    <div class="info-card" style="text-align:center; background: var(--surface);">
      <strong>Ready to visit ${SITE.attractionName}?</strong><br>
      <a href="/tickets.html" style="color: var(--primary);">Book online and save off the gate price &rarr;</a>
    </div>

  </div>
</article>

Return ONLY the raw HTML. No explanation, no markdown fences.`;
}

function promptAllMetadata(topic, enBodySnippet) {
  const domain = SITE.baseUrl.replace('https://', '');
  return `You are an SEO copywriter for ${domain} (${SITE.siteName}).

Article topic: "${topic.titleHint}" — primary keyword: "${topic.keyword}"

Generate SEO metadata for all ${LANGUAGES.length} languages. For each language provide:
- title (55–65 chars)
- metaDescription (148–158 chars)
- metaKeywords (6–8 comma-separated)
- ogTitle (50–60 chars)
- ogDescription (100–150 chars)
- twitterTitle (50–60 chars)
- twitterDescription (100–140 chars)
- breadcrumbName (3–5 words)
- cardCategory: one of [Practical Guide, Planning, Tickets & Prices, Family Guide, Travel Guide, Food & Dining, Comparison, Events & Festivals, Getting There, Itinerary, Budget Guide, Group Guide, Special Occasions, Solo Travel]
- cardTitle (60–70 chars)
- cardDescription (110–130 chars)

Languages (JSON key = language code):
${LANGUAGES.map(l => l.code).join(', ')}

Context (English article opening):
${enBodySnippet}

Return ONLY a JSON object: { "en": {...}, "zh-CN": {...}, ... }`;
}

function promptTranslateBody(enBody, langCode, langName) {
  return `Translate the following HTML blog article into ${langName} (${langCode}).

Rules:
1. Translate ALL visible text (headings, paragraphs, lists, TL;DR, FAQ, CTA, table of contents).
2. Keep ALL HTML tags, attributes, IDs, classes, href values, and inline styles EXACTLY unchanged.
3. Do NOT translate href paths (/tickets.html, /blog/...).
4. Do NOT translate proper nouns: ${SITE.blog.doNotTranslate.join(', ')}.
5. Keep currency and numbers unchanged (THB 1,176 etc.).
6. Native-speaker fluency and travel-writer tone.

Return ONLY the translated HTML. No explanation, no markdown fences.

ARTICLE:
${enBody}`;
}

// ── OpenRouter client factory ─────────────────────────────────────────────────
function createClient() {
  return new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: 'https://openrouter.ai/api/v1',
    defaultHeaders: {
      'HTTP-Referer': SITE.baseUrl,
      'X-Title': SITE.siteName,
    },
  });
}

// ── File writers ──────────────────────────────────────────────────────────────
function writeFile(filePath, content) {
  if (DRY_RUN) { log(`[DRY RUN] Would write: ${path.relative(ROOT, filePath)}`); return; }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  log(`Wrote: ${path.relative(ROOT, filePath)}`);
}

function writeBlogDataJson(slug, dateStr, ogImage) {
  const hasCustomImage = ogImage !== 'og-home.jpg';
  const data = {
    slug,
    ogImage,
    ...(hasCustomImage && { heroImage: true }),  // show hero on page only when AI image was generated
    schemaType: 'Article',
    schemaHeadline: '',
    schemaDescription: '',
    schemaImage: ogImage,
    datePublished: dateStr,
    dateModified: dateStr,
    authorName: SITE.blog.authorName,
    authorUrl: SITE.blog.authorUrl,
  };
  writeFile(path.join(DATA_DIR, 'blog', `${slug}.json`), JSON.stringify(data, null, 2) + '\n');
}

function patchBlogDataJson(slug, enMeta) {
  if (DRY_RUN) return;
  const filePath = path.join(DATA_DIR, 'blog', `${slug}.json`);
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  data.schemaHeadline    = enMeta.title;
  data.schemaDescription = enMeta.metaDescription;
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
  log(`Patched schema fields: src/data/blog/${slug}.json`);
}

function updateBlogIndexJson(slug, dateStr, readTime) {
  if (DRY_RUN) { log(`[DRY RUN] Would prepend "${slug}" to data/blog/index.json`); return; }
  const filePath = path.join(DATA_DIR, 'blog', 'index.json');
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  data.cards.unshift({ slug, date: dateStr, readTime });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
  log(`Updated: src/data/blog/index.json`);
}

function updateHomeJson(slug, ogImage, colors) {
  if (DRY_RUN) { log(`[DRY RUN] Would update src/data/home.json`); return; }
  const filePath = path.join(DATA_DIR, 'home.json');
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  if (!Array.isArray(data.blogSlugs))    data.blogSlugs    = [];
  if (!Array.isArray(data.blogGradients)) data.blogGradients = [];

  const blogUrl = `blog/${slug}.html`;
  if (!data.blogSlugs.includes(blogUrl)) {
    // Derive a gradient from the og image and a rotation based on position
    const idx = data.blogSlugs.length;
    const primary   = (colors && colors.primary)   || '#0ea5e9';
    const secondary = (colors && colors.secondary) || '#06b6d4';
    const gradient = `background: linear-gradient(135deg, ${primary}66, ${secondary}66), url('/images/${ogImage}') center/cover no-repeat;`;
    data.blogSlugs.unshift(blogUrl);
    data.blogGradients.unshift(gradient);
    // Cap at 3 most-recent for homepage preview
    if (data.blogSlugs.length > 3)    data.blogSlugs    = data.blogSlugs.slice(0, 3);
    if (data.blogGradients.length > 3) data.blogGradients = data.blogGradients.slice(0, 3);
  }

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
  log(`Updated: src/data/home.json`);
}

function updateI18nFile(langCode, slug, meta) {
  const filePath = path.join(I18N_DIR, `${langCode}.json`);
  if (!fs.existsSync(filePath)) { warn(`i18n/${langCode}.json not found, skipping`); return; }
  if (DRY_RUN) { log(`[DRY RUN] Would update i18n/${langCode}.json`); return; }

  const i18n = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  if (!i18n.blog)        i18n.blog        = {};
  if (!i18n.blog.posts)  i18n.blog.posts  = {};
  if (!i18n.blog.index)  i18n.blog.index  = {};
  if (!Array.isArray(i18n.blog.index.cards)) i18n.blog.index.cards = [];

  i18n.blog.posts[slug] = {
    title:               meta.title,
    metaDescription:     meta.metaDescription,
    metaKeywords:        meta.metaKeywords,
    ogTitle:             meta.ogTitle,
    ogDescription:       meta.ogDescription,
    twitterTitle:        meta.twitterTitle,
    twitterDescription:  meta.twitterDescription,
    breadcrumbName:      meta.breadcrumbName,
  };

  i18n.blog.index.cards.unshift({
    slug,
    category:    meta.cardCategory,
    title:       meta.cardTitle,
    description: meta.cardDescription,
  });

  // Add card to homepage blog preview section (home.blog.cards)
  if (!i18n.home)                              i18n.home              = {};
  if (!i18n.home.blog)                         i18n.home.blog         = {};
  if (!Array.isArray(i18n.home.blog.cards))    i18n.home.blog.cards   = [];
  // Keep homepage preview capped at 3 most-recent posts
  i18n.home.blog.cards.unshift({
    tag:         meta.cardCategory,
    readTime:    meta.readTime || '5 min read',
    title:       meta.cardTitle,
    description: meta.cardDescription,
  });
  if (i18n.home.blog.cards.length > 3) i18n.home.blog.cards = i18n.home.blog.cards.slice(0, 3);

  fs.writeFileSync(filePath, JSON.stringify(i18n, null, 2) + '\n', 'utf8');
  log(`Updated: src/i18n/${langCode}.json`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  if (!DRY_RUN && !process.env.OPENROUTER_API_KEY) {
    die('OPENROUTER_API_KEY environment variable is not set.');
  }

  const dateStr = today();
  const client  = DRY_RUN ? null : createClient();
  const topic   = await selectTopic(client);

  log(`Topic:    ${topic.slug}`);
  log(`Title:    ${topic.titleHint}`);
  log(`Text:     ${TEXT_MODEL}`);
  log(`Translate:${TRANSLATE_MODEL}`);
  log(`Image:    ${IMAGE_MODEL}`);
  if (DRY_RUN) log('Mode:     DRY RUN — no files will be written');
  log('');

  if (DRY_RUN) {
    log('Would run 5 steps:');
    log('  1. Generate English article body');
    log(`  2. Generate SEO metadata (all ${LANGUAGES.length} languages)`);
    log(`  3. Translate article to ${LANGUAGES.length - 1} languages (batches of 3)`);
    log('  4. Search Bing Images → download source → modify with Gemini (retry ×3)');
    log(`  5. Write files (${LANGUAGES.length * 2} content files + ${LANGUAGES.length} i18n updates + 2 data JSONs + 1 image)`);
    log('');
    log('Done (dry run). No files written.');
    return;
  }

  // ── Step 1: English article body ────────────────────────────────────────────
  log('Step 1/5  Generating English article…');
  const enRes  = await client.chat.completions.create({
    model:      TEXT_MODEL,
    max_tokens: 4096,
    messages:   [{ role: 'user', content: promptEnglishArticle(topic, dateStr) }],
  });
  usageTracker.track('blog-en-article', TEXT_MODEL, enRes.usage);
  const enBody   = enRes.choices[0].message.content.trim();
  const readTime = estimateReadTime(enBody);
  log(`          ${enBody.length} chars · ${readTime}`);

  // ── Step 2: SEO metadata (all languages) ────────────────────────────────────
  log('Step 2/5  Generating SEO metadata for all 12 languages…');
  const metaRes = await client.chat.completions.create({
    model:      TEXT_MODEL,
    max_tokens: 8192,
    messages:   [{ role: 'user', content: promptAllMetadata(topic, enBody.slice(0, 1200)) }],
  });
  usageTracker.track('blog-seo-metadata', TEXT_MODEL, metaRes.usage);
  const allMeta = extractJSON(metaRes.choices[0].message.content);
  log(`          Got metadata for: ${Object.keys(allMeta).join(', ')}`);

  // ── Step 3: Translate to 11 languages ───────────────────────────────────────
  log('Step 3/5  Translating to 11 languages (batches of 3)…');
  const bodies = { en: enBody };
  const nonEn  = LANGUAGES.filter(l => l.code !== 'en');

  for (let i = 0; i < nonEn.length; i += 3) {
    const batch = nonEn.slice(i, i + 3);
    log(`          Batch: ${batch.map(l => l.code).join(', ')}…`);
    const results = await Promise.all(
      batch.map(lang =>
        client.chat.completions.create({
          model:      TRANSLATE_MODEL,
          max_tokens: 4096,
          messages:   [{ role: 'user', content: promptTranslateBody(enBody, lang.code, lang.name) }],
        }).then(r => {
          usageTracker.track(`blog-translate-${lang.code}`, TRANSLATE_MODEL, r.usage);
          return { code: lang.code, body: r.choices[0].message.content.trim() };
        })
      )
    );
    for (const { code, body } of results) {
      bodies[code] = body;
      log(`          ✓ ${code}`);
    }
    if (i + 3 < nonEn.length) await new Promise(r => setTimeout(r, 1000));
  }

  // ── Step 4: Search web image → modify with Gemini ───────────────────────────
  log('Step 4/5  Searching web for attraction images…');
  let ogImage = 'og-home.jpg';
  try {
    const imageUrls = await searchWebImages(SITE.blog.imageSearchQuery);
    log(`          Found ${imageUrls.length} candidate URLs`);
    if (imageUrls.length === 0) throw new Error('No image URLs found');

    // Download the first image that succeeds
    let source = null;
    for (const url of imageUrls) {
      try {
        source = await downloadImage(url);
        log(`          Downloaded source image (${(source.buffer.length / 1024).toFixed(0)} KB, ${source.mime})`);
        break;
      } catch (e) {
        warn(`Download failed for ${url}: ${e.message}`);
      }
    }
    if (!source) throw new Error('Could not download any source image');

    // Modify with Gemini — retry up to 3 times
    log('          Sending to Gemini for image modification…');
    const { buffer: modified, ext } = await withRetry(
      () => modifyImageWithGemini(source.buffer, source.mime, topic, client),
      3,
      'Gemini image modification',
    );

    const imgFilename = `og-${topic.slug}.${ext}`;
    fs.mkdirSync(IMAGES_DIR, { recursive: true });
    fs.writeFileSync(path.join(IMAGES_DIR, imgFilename), modified);
    ogImage = imgFilename;
    log(`          Saved: images/${imgFilename} (${(modified.length / 1024).toFixed(0)} KB)`);
  } catch (e) {
    warn(`Image pipeline failed: ${e.message}`);
    warn('Continuing without a custom OG image.');
  }

  // ── Step 5: Write all files ──────────────────────────────────────────────────
  log('Step 5/5  Writing files…');

  writeBlogDataJson(topic.slug, dateStr, ogImage);
  patchBlogDataJson(topic.slug, allMeta.en || Object.values(allMeta)[0]);

  for (const lang of LANGUAGES) {
    const body = bodies[lang.code];
    if (!body) { warn(`No body for ${lang.code}, skipping`); continue; }
    writeFile(path.join(CONTENT_DIR, topic.slug, `${lang.code}.html`), body + '\n');
  }

  for (const lang of LANGUAGES) {
    const meta = allMeta[lang.code];
    if (!meta) { warn(`No metadata for ${lang.code}, skipping`); continue; }
    updateI18nFile(lang.code, topic.slug, { ...meta, readTime });
  }

  updateBlogIndexJson(topic.slug, dateStr, readTime);
  updateHomeJson(topic.slug, ogImage, SITE.colors);

  log('');
  log(`✓ Done!  New post: ${topic.slug}`);
  log(`  OG image: images/${ogImage}`);
  log('');
  log('API Token Usage:');
  log(usageTracker.summary());
  log('');
  log(`  Next: npm run build`);
}

main().catch(e => { die(e.message); });
