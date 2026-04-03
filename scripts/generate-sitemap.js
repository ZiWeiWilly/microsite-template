#!/usr/bin/env node
/**
 * Sitemap generator for the Klook attraction landing page.
 *
 * Reads src/data/site.json (baseUrl, languages, pages) and
 * src/data/blog/index.json (blog slugs) to produce sitemap.xml
 * with hreflang alternates for all pages × languages.
 *
 * Usage:
 *   node scripts/generate-sitemap.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SITE = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'data', 'site.json'), 'utf8'));
const BLOG_INDEX = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'data', 'blog', 'index.json'), 'utf8'));

const baseUrl = SITE.baseUrl.replace(/\/$/, '');
const languages = SITE.languages;

// Collect all page slugs
const pageSlugs = SITE.pages.map(p => p.slug); // '', 'attractions.html', etc.

// Add blog post slugs
const blogSlugs = (BLOG_INDEX.cards || []).map(c => `blog/${c.slug}.html`);

const allSlugs = [...pageSlugs, ...blogSlugs];

function buildUrl(lang, slug) {
  const prefix = lang.prefix || ''; // '' for en, 'zh-CN/' for zh-CN, etc.
  // Home page: slug is '' → just prefix
  if (slug === '') return `${baseUrl}/${prefix}`.replace(/\/$/, '') || baseUrl;
  // Blog index: slug is 'blog/' → prefix + 'blog/'
  return `${baseUrl}/${prefix}${slug}`;
}

// Build XML
const urls = allSlugs.map(slug => {
  const links = languages.map(lang => {
    const href = buildUrl(lang, slug);
    return `    <xhtml:link rel="alternate" hreflang="${lang.hreflang}" href="${href}" />`;
  }).join('\n');

  // x-default points to English
  const enLang = languages.find(l => l.code === 'en') || languages[0];
  const defaultLink = `    <xhtml:link rel="alternate" hreflang="x-default" href="${buildUrl(enLang, slug)}" />`;

  const loc = buildUrl(enLang, slug);

  return `  <url>
    <loc>${loc}</loc>
${links}
${defaultLink}
    <changefreq>${slug.startsWith('blog/') ? 'monthly' : 'weekly'}</changefreq>
    <priority>${slug === '' ? '1.0' : slug.startsWith('blog/') ? '0.6' : '0.8'}</priority>
  </url>`;
}).join('\n');

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls}
</urlset>
`;

fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), xml);
console.log(`[generate-sitemap] Written sitemap.xml (${allSlugs.length} pages × ${languages.length} languages)`);
