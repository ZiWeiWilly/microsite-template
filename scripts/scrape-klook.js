#!/usr/bin/env node

/**
 * Klook Price Scraper
 *
 * Uses Firecrawl API to scrape the Klook activity page, extract package names + prices.
 * Reads the activity URL from src/data/site.json (site.klook.activityUrl).
 * Saves results to data/prices.json and appends to data/prices-history.json.
 */

const fs = require('fs');
const path = require('path');

const SITE = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'data', 'site.json'), 'utf8'));
const ACTIVITY_URL = SITE.klook.activityUrl;
const FIRECRAWL_API = 'https://api.firecrawl.dev/v1/scrape';
const DATA_DIR = path.join(__dirname, '..', 'data');
const PRICES_FILE = path.join(DATA_DIR, 'prices.json');
const HISTORY_FILE = path.join(DATA_DIR, 'prices-history.json');
const MAX_RETRIES = parseInt(process.env.SCRAPE_RETRIES || '3', 10);
const MAX_HISTORY_DAYS = 365;

// Firecrawl API key from environment (stored as GitHub Secret)
const FIRECRAWL_KEY = process.env.FIRECRAWL_API_KEY;

// Package matchers: map Klook package names to our internal IDs
// ORDER MATTERS: more specific patterns first (group/promo before generic)
//
// TODO: Update these patterns to match the Klook packages for YOUR attraction.
//       Run `npm run scrape` and check data/debug-klook.md to see the package names
//       that Klook uses, then write regex patterns to match them.
const PACKAGE_MATCHERS = [
  {
    // Must be LAST — so group/promo variants don't accidentally match
    id: 'standard-admission',
    patterns: [/^standard/i, /^general\s*admission/i, /^ticket$/i],
  }
];

function matchPackage(name) {
  const normalized = name.trim();
  for (const matcher of PACKAGE_MATCHERS) {
    for (const pattern of matcher.patterns) {
      if (pattern.test(normalized)) {
        return matcher.id;
      }
    }
  }
  return null;
}

/**
 * Parse the Firecrawl markdown output to extract package names and USD prices.
 */
function parseMarkdownForPackages(markdown) {
  const results = [];
  const lines = markdown.split('\n');

  // State machine: look for package name then price
  let currentPackageName = null;
  let inPackageSection = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Detect package options section
    if (line === '## Package options') {
      inPackageSection = true;
      continue;
    }

    // Stop at next major section
    if (inPackageSection && line.startsWith('## ') && line !== '## Package options') {
      break;
    }

    if (!inPackageSection) continue;

    // Skip navigation/tab labels
    if (/^(Klook Exclusive Promotion|Water park ticket|Add-ons package|Other packages)$/.test(line)) {
      // These are tab labels - only set as package name if it's within a card context
      continue;
    }

    // Detect package names - lines that look like package titles
    // Package names are usually standalone lines that aren't prices, dates, or UI elements
    if (line && !line.startsWith('US$') && !line.startsWith('![') &&
        !line.startsWith('http') && !line.startsWith('Select') &&
        !line.startsWith('See ') && !line.startsWith('Package details') &&
        !line.startsWith('No cancellation') && !line.startsWith('Free cancellation') &&
        !line.startsWith('Open date') && !line.startsWith('Instant confirmation') &&
        !line.startsWith('Freebies') && !line.startsWith('Valid until') &&
        !line.startsWith('See less') && !line.startsWith('Klook recommended') &&
        !line.startsWith('This is a') && !line.startsWith('\\[') &&
        line.length > 3 && line.length < 100) {

      // Check if this line could be a package name (contains meaningful words)
      if (/water\s*park|ticket|group|add.?on|food|go\s*kart|surf|cabana|locker|onsen|admission/i.test(line)) {
        currentPackageName = line;
      }
    }

    // Also handle escaped bracket format: \[Group of 3\] Water Park Ticket
    if (/^\\\[/.test(line)) {
      currentPackageName = line.replace(/\\\[/g, '[').replace(/\\\]/g, ']');
    }

    // Detect price lines: US$ XX.XX
    const priceMatch = line.match(/^US\$\s*([\d,.]+)$/);
    if (priceMatch && currentPackageName) {
      const priceUSD = parseFloat(priceMatch[1].replace(/,/g, ''));
      if (priceUSD > 0 && priceUSD < 10000) {
        // Take the first (discounted) price for this package
        const existing = results.find(r => r.name === currentPackageName);
        if (!existing) {
          results.push({
            name: currentPackageName,
            priceUSD: priceUSD
          });
        }
        currentPackageName = null; // Reset for next package
      }
    }
  }

  return results;
}

/**
 * Call Firecrawl API to scrape the Klook page.
 */
async function scrapeWithFirecrawl() {
  if (!FIRECRAWL_KEY) {
    throw new Error('FIRECRAWL_API_KEY environment variable not set');
  }

  console.log('Calling Firecrawl API to scrape Klook...');

  const response = await fetch(FIRECRAWL_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${FIRECRAWL_KEY}`
    },
    body: JSON.stringify({
      url: ACTIVITY_URL + '?currency=USD',
      formats: ['markdown'],
      waitFor: 5000,
      onlyMainContent: false
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Firecrawl API error ${response.status}: ${errText}`);
  }

  const data = await response.json();

  if (!data.success) {
    throw new Error(`Firecrawl scrape failed: ${JSON.stringify(data)}`);
  }

  const markdown = data.data?.markdown || '';
  console.log(`Received ${markdown.length} chars of markdown`);

  if (markdown.length < 500) {
    throw new Error('Markdown too short - page may not have loaded properly');
  }

  return markdown;
}

function mapScrapedToPackages(scraped, existingPackages) {
  const mapped = {};

  for (const item of scraped) {
    const id = matchPackage(item.name);
    if (id) {
      mapped[id] = item.priceUSD;
      console.log(`  Matched: "${item.name}" -> ${id} = $${item.priceUSD}`);
    } else {
      console.log(`  Unmatched: "${item.name}" = $${item.priceUSD}`);
    }
  }

  // Update existing packages with new USD prices
  // We convert USD to THB using existing exchange rate
  return existingPackages.map(pkg => {
    if (mapped[pkg.id] !== undefined) {
      return { ...pkg, priceUSD: mapped[pkg.id] };
    }
    console.log(`  No new data for ${pkg.id}, keeping existing`);
    return pkg;
  });
}

function updateHistory(history, packages, rates) {
  const today = new Date().toISOString().split('T')[0];

  const priceMap = {};
  for (const pkg of packages) {
    priceMap[pkg.id] = pkg.basePrice;
  }

  const rateMap = {};
  if (rates) {
    for (const [code, info] of Object.entries(rates)) {
      if (code !== SITE.baseCurrency) rateMap[code] = info.rate;
    }
  }

  const entry = {
    date: today,
    packages: priceMap,
    exchangeRates: rateMap
  };

  const filtered = history.filter(h => h.date !== today);
  filtered.push(entry);

  if (filtered.length > MAX_HISTORY_DAYS) {
    filtered.splice(0, filtered.length - MAX_HISTORY_DAYS);
  }

  return filtered;
}

async function main() {
  console.log('=== Klook Price Scraper (Firecrawl) ===');
  console.log(`Target: ${ACTIVITY_URL}`);
  console.log(`Retries: ${MAX_RETRIES}`);
  console.log('');

  // Load existing data
  let existingData;
  try {
    existingData = JSON.parse(fs.readFileSync(PRICES_FILE, 'utf8'));
  } catch {
    console.error('Could not read existing prices.json. Exiting.');
    process.exit(1);
  }

  let history;
  try {
    history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
  } catch {
    history = [];
  }

  // Scrape with retries
  let scraped = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`\nAttempt ${attempt}/${MAX_RETRIES}...`);
      const markdown = await scrapeWithFirecrawl();

      // Save markdown for debugging (overwrite each attempt)
      fs.writeFileSync(path.join(DATA_DIR, 'debug-klook.md'), markdown);

      scraped = parseMarkdownForPackages(markdown);
      console.log(`Found ${scraped.length} packages:`);
      scraped.forEach(p => console.log(`  - ${p.name}: $${p.priceUSD}`));

      if (scraped.length >= 2) break;

      console.log('Too few packages found, retrying...');
      scraped = null;
    } catch (err) {
      console.error(`Attempt ${attempt} failed: ${err.message}`);
    }

    if (attempt < MAX_RETRIES) {
      const delay = attempt * 5000;
      console.log(`Waiting ${delay / 1000}s before retry...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }

  if (!scraped || scraped.length < 2) {
    console.log('\nAll retries exhausted or insufficient packages found.');
    console.log('Keeping existing prices unchanged.');

    history = updateHistory(history, existingData.packages, existingData.exchangeRates);
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2) + '\n');

    process.exit(0);
  }

  // Convert USD prices to base currency using exchange rate
  const usdRate = existingData.exchangeRates?.USD?.rate;
  if (usdRate && usdRate > 0) {
    console.log(`\nConverting USD -> ${SITE.baseCurrency} (rate: 1 ${SITE.baseCurrency} = ${usdRate} USD)`);
    for (const item of scraped) {
      const basePrice = Math.round(item.priceUSD / usdRate);
      console.log(`  ${item.name}: $${item.priceUSD} -> ${SITE.baseCurrency} ${basePrice}`);
      item.basePrice = basePrice;
    }
  } else {
    console.log('\nWARNING: No USD exchange rate available. Using USD prices directly.');
  }

  // Map and update packages
  console.log('\nMapping scraped packages...');
  const updatedPackages = mapScrapedToPackages(scraped, existingData.packages);

  // Update base prices from converted values
  for (const pkg of updatedPackages) {
    const scrapedItem = scraped.find(s => matchPackage(s.name) === pkg.id);
    if (scrapedItem?.basePrice) {
      const oldPrice = pkg.basePrice;
      pkg.basePrice = scrapedItem.basePrice;

      const changePercent = oldPrice ? Math.abs((pkg.basePrice - oldPrice) / oldPrice * 100) : 0;
      if (changePercent > 50) {
        console.log(`  WARNING: ${pkg.id} price changed by ${changePercent.toFixed(1)}% (${SITE.baseCurrency} ${oldPrice} -> ${SITE.baseCurrency} ${pkg.basePrice})`);
      }
    }
  }

  existingData.lastUpdated = new Date().toISOString();
  existingData.packages = updatedPackages;
  fs.writeFileSync(PRICES_FILE, JSON.stringify(existingData, null, 2) + '\n');
  console.log('\nUpdated data/prices.json');

  history = updateHistory(history, updatedPackages, existingData.exchangeRates);
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2) + '\n');
  console.log('Updated data/prices-history.json');

  console.log('\n=== Scraping complete ===');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
