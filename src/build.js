#!/usr/bin/env node

/**
 * Build script: renders Nunjucks templates × i18n translations → static HTML
 *
 * Usage:
 *   node src/build.js              # build all pages for all languages
 *   node src/build.js --page faq   # build only FAQ page
 */

const nunjucks = require('nunjucks');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TEMPLATES_DIR = path.join(__dirname, 'templates');
const I18N_DIR = path.join(__dirname, 'i18n');
const SITE = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'site.json'), 'utf8'));

// Parse CLI args
const args = process.argv.slice(2);
const pageFilter = args.indexOf('--page') !== -1 ? args[args.indexOf('--page') + 1] : null;

// Configure Nunjucks
const env = new nunjucks.Environment(
  new nunjucks.FileSystemLoader(TEMPLATES_DIR, { noCache: true }),
  { autoescape: false, trimBlocks: false, lstripBlocks: false }
);

// Custom filter: dump JSON with indentation
env.addFilter('dump', function (obj) {
  return JSON.stringify(obj, null, 4);
});

// Available page templates
const PAGE_CONFIGS = {
  home: {
    template: 'pages/index.njk',
    slug: 'index.html',
  },
  faq: {
    template: 'pages/faq.njk',
    slug: 'faq.html',
  },
  attractions: {
    template: 'pages/attractions.njk',
    slug: 'attractions.html',
  },
  tickets: {
    template: 'pages/tickets.njk',
    slug: 'tickets.html',
  },
  'getting-there': {
    template: 'pages/getting-there.njk',
    slug: 'getting-there.html',
  },
  tips: {
    template: 'pages/tips.njk',
    slug: 'tips.html',
  },
  'blog-index': {
    template: 'blog/index.njk',
    slug: 'blog/index.html',
  },
};

// Load blog index data (non-translatable card metadata)
// BLOG_POST_SLUGS is derived from this so new AI-generated posts are picked up automatically
const BLOG_INDEX_DATA = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'blog', 'index.json'), 'utf8'));

const BLOG_POST_SLUGS = BLOG_INDEX_DATA.cards.map(c => c.slug);

// Load home page data (non-translatable)
const HOME_DATA = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'home.json'), 'utf8'));

// Load attractions page data (non-translatable)
const ATTRACTIONS_DATA = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'attractions.json'), 'utf8'));

// Load tips page data (non-translatable)
const TIPS_DATA = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'tips.json'), 'utf8'));

// Footer guide blog post slugs — driven by home.json footerGuideSlugs
// (same order as footer.guideLabels in i18n files)
const FOOTER_GUIDES_SLUGS = HOME_DATA.footerGuideSlugs || [];

// Deep-merge source into target (target wins for existing keys)
function deepMerge(target, source) {
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])
        && target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])) {
      deepMerge(target[key], source[key]);
    } else if (!(key in target)) {
      target[key] = source[key];
    }
  }
  return target;
}

// Load all i18n files; partial translations fall back to English for missing keys
function loadI18n() {
  const translations = {};
  const enPath = path.join(I18N_DIR, 'en.json');
  const enData = fs.existsSync(enPath) ? JSON.parse(fs.readFileSync(enPath, 'utf8')) : {};
  for (const lang of SITE.languages) {
    const filePath = path.join(I18N_DIR, `${lang.code}.json`);
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      translations[lang.code] = lang.code === 'en' ? data : deepMerge(data, enData);
    } else if (lang.code === 'en') {
      translations[lang.code] = enData;
    } else {
      console.warn(`  Warning: Missing i18n file for ${lang.code}, skipping`);
    }
  }
  return translations;
}

// Strip HTML tags for Schema.org plain text
function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&amp;/g, '&')
    .replace(/&rarr;/g, '→')
    .replace(/&bull;/g, '•')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Build FAQPage schema from FAQ data
function buildFaqSchema(categories) {
  const mainEntity = [];
  for (const cat of categories) {
    for (const q of (cat.questions || [])) {
      if (!q.question || !q.answer) continue;
      mainEntity.push({
        '@type': 'Question',
        name: q.question,
        acceptedAnswer: {
          '@type': 'Answer',
          text: stripHtml(q.answer),
        },
      });
    }
  }
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity,
  };
}

// Build FAQPage schema from home page FAQ items (flat array)
function buildHomeFaqSchema(items) {
  const mainEntity = items.filter(q => q.question && q.answer).map(q => ({
    '@type': 'Question',
    name: q.question,
    acceptedAnswer: {
      '@type': 'Answer',
      text: stripHtml(q.answer),
    },
  }));
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity,
  };
}

// Format number with commas
function formatNumber(n) {
  return n.toLocaleString('en-US');
}

// Load current prices from data/prices.json
function loadPrices() {
  const pricesPath = path.join(ROOT, 'data', 'prices.json');
  if (fs.existsSync(pricesPath)) {
    return JSON.parse(fs.readFileSync(pricesPath, 'utf8'));
  }
  // Fallback defaults
  return {
    packages: [
      { id: 'standard-admission', basePrice: 1176, gatePrice: 1595 },
    ],
  };
}

function buildPage(pageKey, pageConfig) {
  const translations = loadI18n();
  const prices = loadPrices();
  const standardPkg = prices.packages.find(p => p.id === 'standard-admission') || prices.packages[0];
  const stickyPrice = standardPkg.basePrice;
  const stickyOriginalPrice = standardPkg.gatePrice || 1595;
  const allInclusivePkg = prices.packages.find(p => p.id === 'admission-food-surf') || prices.packages[1];
  const allInclusivePrice = allInclusivePkg.basePrice;

  let built = 0;

  for (const lang of SITE.languages) {
    const t = translations[lang.code];
    if (!t) continue;

    const page = { slug: pageConfig.slug };

    // Build schema
    let schemaFaq = null;
    if (pageKey === 'faq' && t.faq && t.faq.categories) {
      schemaFaq = buildFaqSchema(t.faq.categories);
    }

    let schemaHomeFaq = null;
    if (pageKey === 'home' && t.home && t.home.faq && t.home.faq.items) {
      schemaHomeFaq = buildHomeFaqSchema(t.home.faq.items);
    }

    let schemaAttractionsFaq = null;
    if (pageKey === 'attractions' && t.attractions && t.attractions.faq && t.attractions.faq.items) {
      schemaAttractionsFaq = buildHomeFaqSchema(t.attractions.faq.items);
    }

    let schemaTicketsFaq = null;
    if (pageKey === 'tickets' && t.tickets && t.tickets.faq && t.tickets.faq.items) {
      schemaTicketsFaq = buildHomeFaqSchema(t.tickets.faq.items);
    }

    let schemaGettingThereFaq = null;
    if (pageKey === 'getting-there' && t.gettingThere && t.gettingThere.schema && t.gettingThere.schema.faqItems) {
      schemaGettingThereFaq = buildHomeFaqSchema(t.gettingThere.schema.faqItems);
    }

    const context = {
      site: SITE,
      lang,
      t,
      page,
      activePage: pageKey,
      schemaFaq,
      schemaHomeFaq,
      homeData: HOME_DATA,
      attractionsData: ATTRACTIONS_DATA,
      schemaAttractionsFaq,
      stickyPrice,
      stickyOriginalPrice,
      stickyPriceFormatted: formatNumber(stickyPrice),
      stickyOriginalPriceFormatted: formatNumber(stickyOriginalPrice),
      allInclusivePrice,
      allInclusivePriceFormatted: formatNumber(allInclusivePrice),
      savingsPercent: Math.round((1 - stickyPrice / stickyOriginalPrice) * 100),
      schemaTicketsFaq,
      schemaGettingThereFaq,
      tipsData: TIPS_DATA,
      blogIndexData: BLOG_INDEX_DATA,
      footerGuidesSlugs: FOOTER_GUIDES_SLUGS,
    };

    try {
      const html = env.render(pageConfig.template, context);

      // Determine output path (supports subdirectory slugs like blog/index.html)
      const outDir = lang.code === 'en'
        ? path.join(ROOT, path.dirname(pageConfig.slug))
        : path.join(ROOT, lang.code, path.dirname(pageConfig.slug));
      fs.mkdirSync(outDir, { recursive: true });
      const outPath = path.join(outDir, path.basename(pageConfig.slug));

      fs.writeFileSync(outPath, html);
      console.log(`  Built ${lang.code}/${pageConfig.slug}`);
      built++;
    } catch (err) {
      console.error(`  ERROR building ${lang.code}/${pageConfig.slug}:`, err.message);
    }
  }

  return built;
}

function buildBlogPost(slug) {
  const translations = loadI18n();
  const prices = loadPrices();
  const standardPkg = prices.packages.find(p => p.id === 'standard-admission') || prices.packages[0];
  const stickyPrice = standardPkg.basePrice;
  const stickyOriginalPrice = standardPkg.gatePrice || 1595;

  const blogPostDataPath = path.join(__dirname, 'data', 'blog', `${slug}.json`);
  const blogPostData = JSON.parse(fs.readFileSync(blogPostDataPath, 'utf8'));

  let built = 0;

  for (const lang of SITE.languages) {
    const t = translations[lang.code];
    if (!t) continue;

    // Read article body content file
    const contentPath = path.join(__dirname, 'content', 'blog', slug, `${lang.code}.html`);
    if (!fs.existsSync(contentPath)) {
      console.warn(`  Warning: Missing content file: ${contentPath}`);
      continue;
    }
    const articleBody = fs.readFileSync(contentPath, 'utf8');

    const page = { slug: `blog/${slug}.html` };

    const context = {
      site: SITE,
      lang,
      t,
      page,
      activePage: 'blog',
      postSlug: slug,
      blogPostData,
      articleBody,
      stickyPrice,
      stickyOriginalPrice,
      stickyPriceFormatted: formatNumber(stickyPrice),
      stickyOriginalPriceFormatted: formatNumber(stickyOriginalPrice),
      savingsPercent: Math.round((1 - stickyPrice / stickyOriginalPrice) * 100),
      footerGuidesSlugs: FOOTER_GUIDES_SLUGS,
    };

    try {
      const html = env.render('blog/post.njk', context);
      const outDir = lang.code === 'en'
        ? path.join(ROOT, 'blog')
        : path.join(ROOT, lang.code, 'blog');
      fs.mkdirSync(outDir, { recursive: true });
      const outPath = path.join(outDir, `${slug}.html`);
      fs.writeFileSync(outPath, html);
      console.log(`  Built ${lang.code}/blog/${slug}.html`);
      built++;
    } catch (err) {
      console.error(`  ERROR building ${lang.code}/blog/${slug}.html:`, err.message);
    }
  }
  return built;
}

// Main
function main() {
  console.log('=== Building site ===\n');

  let totalBuilt = 0;

  for (const [key, config] of Object.entries(PAGE_CONFIGS)) {
    if (pageFilter && key !== pageFilter) continue;
    console.log(`Building ${key}...`);
    totalBuilt += buildPage(key, config);
  }

  // Build blog posts
  for (const slug of BLOG_POST_SLUGS) {
    if (pageFilter && `blog/${slug}` !== pageFilter) continue;
    console.log(`Building blog/${slug}...`);
    totalBuilt += buildBlogPost(slug);
  }

  console.log(`\n=== Done: ${totalBuilt} files built ===`);
}

main();
