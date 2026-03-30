#!/usr/bin/env node

/**
 * Exchange Rate Fetcher
 *
 * Fetches THB-based exchange rates from a free API and updates data/prices.json.
 * Uses open.er-api.com (free, no API key) with a fallback.
 */

const fs = require('fs');
const path = require('path');

const PRICES_FILE = path.join(__dirname, '..', 'data', 'prices.json');

const CURRENCIES = [
  'THB', 'USD', 'EUR', 'GBP', 'JPY', 'CNY', 'KRW', 'TWD',
  'HKD', 'SGD', 'MYR', 'PHP', 'IDR', 'VND', 'INR', 'RUB', 'AUD'
];

const SYMBOLS = {
  THB: '฿', USD: '$', EUR: '€', GBP: '£', JPY: '¥', CNY: '¥',
  KRW: '₩', TWD: '$', HKD: '$', SGD: '$', MYR: 'RM', PHP: '₱',
  IDR: 'Rp', VND: '₫', INR: '₹', RUB: '₽', AUD: '$'
};

async function fetchFromPrimary() {
  console.log('Fetching rates from open.er-api.com...');
  const resp = await fetch('https://open.er-api.com/v6/latest/THB');
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();
  if (data.result !== 'success') throw new Error('API returned error');
  return data.rates;
}

async function fetchFromFallback() {
  console.log('Fetching rates from fallback API...');
  const resp = await fetch('https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/thb.json');
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();
  // This API returns lowercase codes under data.thb
  const rates = {};
  for (const [code, rate] of Object.entries(data.thb || {})) {
    rates[code.toUpperCase()] = rate;
  }
  return rates;
}

function buildExchangeRates(apiRates) {
  const result = {};

  for (const code of CURRENCIES) {
    if (code === 'THB') {
      result[code] = { rate: 1, symbol: SYMBOLS[code], code, decimals: 0 };
      continue;
    }

    const rate = apiRates[code];
    if (rate === undefined || rate === null || rate <= 0) {
      console.log(`  Warning: No rate for ${code}, skipping`);
      continue;
    }

    // Round to 4 significant digits for readability
    let rounded;
    if (rate >= 100) {
      rounded = Math.round(rate);
    } else if (rate >= 1) {
      rounded = parseFloat(rate.toFixed(2));
    } else {
      rounded = parseFloat(rate.toPrecision(3));
    }

    result[code] = {
      rate: rounded,
      symbol: SYMBOLS[code],
      code,
      decimals: 0
    };
  }

  return result;
}

async function main() {
  console.log('=== Exchange Rate Fetcher ===\n');

  // Load existing data
  let priceData;
  try {
    priceData = JSON.parse(fs.readFileSync(PRICES_FILE, 'utf8'));
  } catch {
    console.error('Could not read prices.json. Exiting.');
    process.exit(1);
  }

  // Try primary, then fallback
  let apiRates = null;
  try {
    apiRates = await fetchFromPrimary();
    console.log('Primary API succeeded');
  } catch (err) {
    console.log(`Primary API failed: ${err.message}`);
    try {
      apiRates = await fetchFromFallback();
      console.log('Fallback API succeeded');
    } catch (err2) {
      console.log(`Fallback API also failed: ${err2.message}`);
    }
  }

  if (!apiRates) {
    console.log('\nAll rate APIs failed. Keeping existing exchange rates.');
    process.exit(0);
  }

  // Build and validate rates
  const exchangeRates = buildExchangeRates(apiRates);
  const rateCount = Object.keys(exchangeRates).length;
  console.log(`\nBuilt rates for ${rateCount} currencies:`);
  for (const [code, info] of Object.entries(exchangeRates)) {
    if (code !== 'THB') {
      console.log(`  1 THB = ${info.rate} ${code}`);
    }
  }

  if (rateCount < 10) {
    console.log('\nToo few currencies resolved. Keeping existing rates.');
    process.exit(0);
  }

  // Update prices.json
  priceData.exchangeRates = exchangeRates;
  fs.writeFileSync(PRICES_FILE, JSON.stringify(priceData, null, 2) + '\n');
  console.log('\nUpdated data/prices.json with new exchange rates');

  console.log('\n=== Rate fetch complete ===');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
