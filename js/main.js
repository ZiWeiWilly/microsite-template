/* ============================================
   Attraction Site - Main JavaScript
   ============================================ */

(function() {
  'use strict';

  // ===== Navbar scroll effect =====
  const navbar = document.querySelector('.navbar');
  const stickyBar = document.querySelector('.sticky-bar');
  let lastScroll = 0;

  function handleScroll() {
    const scrollY = window.scrollY;

    // Navbar shadow on scroll
    if (navbar) {
      navbar.classList.toggle('scrolled', scrollY > 20);
    }

    // Sticky booking bar visibility
    if (stickyBar) {
      stickyBar.classList.toggle('visible', scrollY > 600);
    }

    // Mobile: hide top-bar and announcement-bar on scroll
    if (window.innerWidth <= 768) {
      const topBar = document.querySelector('.top-bar');
      const annBar = document.querySelector('.announcement-bar');
      const shouldHide = scrollY > 60;
      if (topBar) topBar.classList.toggle('scroll-hidden', shouldHide);
      if (annBar) annBar.classList.toggle('scroll-hidden', shouldHide);
      stackHeaderBars();
    }

    lastScroll = scrollY;
  }

  window.addEventListener('scroll', handleScroll, { passive: true });

  // ===== Mobile nav toggle =====
  const navToggle = document.querySelector('.nav-toggle');
  const navLinks = document.querySelector('.nav-links');

  // Create menu settings container for language/currency (mobile)
  let menuSettings = null;
  if (navLinks) {
    menuSettings = document.createElement('div');
    menuSettings.className = 'menu-settings';
    navLinks.appendChild(menuSettings);
  }

  function openMobileMenu() {
    navLinks.classList.add('open');
    navToggle.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';

    // Move selectors into menu on mobile
    if (window.innerWidth <= 768 && menuSettings) {
      const topBarInner = document.querySelector('.top-bar-inner');
      if (topBarInner) {
        const selectors = topBarInner.querySelectorAll('.selector');
        selectors.forEach(function(s) { menuSettings.appendChild(s); });
      }
    }
  }

  function closeMobileMenu() {
    navLinks.classList.remove('open');
    navToggle.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';

    // Move selectors back to top-bar
    if (menuSettings) {
      const topBarInner = document.querySelector('.top-bar-inner');
      if (topBarInner) {
        var selectors = menuSettings.querySelectorAll('.selector');
        selectors.forEach(function(s) { topBarInner.appendChild(s); });
      }
    }
  }

  if (navToggle && navLinks) {
    navToggle.addEventListener('click', function() {
      if (navLinks.classList.contains('open')) {
        closeMobileMenu();
      } else {
        openMobileMenu();
      }
    });

    // Close menu on link click
    navLinks.querySelectorAll('a').forEach(function(link) {
      link.addEventListener('click', function() {
        closeMobileMenu();
      });
    });
  }

  // ===== FAQ Accordion =====
  document.querySelectorAll('.faq-question').forEach(button => {
    button.addEventListener('click', () => {
      const item = button.closest('.faq-item');
      const answer = item.querySelector('.faq-answer');
      const isActive = item.classList.contains('active');

      // Close all others
      document.querySelectorAll('.faq-item.active').forEach(activeItem => {
        if (activeItem !== item) {
          activeItem.classList.remove('active');
          activeItem.querySelector('.faq-answer').style.maxHeight = '0';
        }
      });

      // Toggle current
      item.classList.toggle('active');
      if (!isActive) {
        answer.style.maxHeight = answer.scrollHeight + 'px';
      } else {
        answer.style.maxHeight = '0';
      }
    });
  });

  // ===== Accordion (translated FAQ pages) =====
  document.querySelectorAll('.accordion-btn').forEach(button => {
    button.addEventListener('click', () => {
      const item = button.closest('.accordion-item');
      const content = item.querySelector('.accordion-content');
      const isActive = item.classList.contains('active');

      // Close all others
      document.querySelectorAll('.accordion-item.active').forEach(activeItem => {
        if (activeItem !== item) {
          activeItem.classList.remove('active');
          activeItem.querySelector('.accordion-content').style.maxHeight = '0';
        }
      });

      // Toggle current
      item.classList.toggle('active');
      if (!isActive) {
        content.style.maxHeight = content.scrollHeight + 'px';
      } else {
        content.style.maxHeight = '0';
      }
    });
  });

  // ===== Fade-in on scroll =====
  const fadeEls = document.querySelectorAll('.fade-in');

  if (fadeEls.length > 0) {
    const fadeObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          fadeObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });

    fadeEls.forEach(el => fadeObserver.observe(el));
  }

  // ===== Smooth scroll for anchor links =====
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function(e) {
      const target = document.querySelector(this.getAttribute('href'));
      if (target) {
        e.preventDefault();
        const offset = 80;
        const y = target.getBoundingClientRect().top + window.scrollY - offset;
        window.scrollTo({ top: y, behavior: 'smooth' });
      }
    });
  });

  // ===== Active nav link highlight =====
  const currentPath = window.location.pathname;
  document.querySelectorAll('.nav-links a').forEach(link => {
    const href = link.getAttribute('href');
    if (href === currentPath || (currentPath === '/' && href === '/') ||
        (currentPath.includes(href) && href !== '/' && href.length > 1)) {
      link.classList.add('active');
    }
  });

  // ===== Opening hours status =====
  function updateParkStatus() {
    const statusEls = document.querySelectorAll('[data-park-status]');
    if (!statusEls.length) return;

    const now = new Date();
    const bangkokTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
    const day = bangkokTime.getDay();
    const hour = bangkokTime.getHours();
    const minute = bangkokTime.getMinutes();
    const timeNum = hour * 100 + minute;

    let isOpen = false;
    let statusText = '';

    if (day === 3) {
      // Wednesday - closed
      statusText = 'Closed Today (Wednesday)';
    } else if (timeNum >= 1000 && timeNum < 1800) {
      isOpen = true;
      statusText = 'Open Now';
    } else if (timeNum < 1000) {
      statusText = 'Opens at 10:00 AM';
    } else {
      statusText = 'Closed - Opens Tomorrow 10 AM';
    }

    statusEls.forEach(el => {
      el.className = `gbp-status ${isOpen ? 'open' : 'closed'}`;
      el.innerHTML = `<span class="gbp-status-dot"></span>${statusText}`;
    });
  }

  updateParkStatus();
  setInterval(updateParkStatus, 60000);

  // ===== Site config from data attributes =====
  const BOOKING_URL = document.body.dataset.bookingUrl || '#';
  const BASE_CURRENCY = document.body.dataset.baseCurrency || 'THB';

  document.querySelectorAll('[data-booking]').forEach(btn => {
    btn.href = BOOKING_URL;
    btn.setAttribute('rel', 'noopener sponsored');
    btn.setAttribute('target', '_blank');
  });

  // ===== Copy coupon code =====
  document.querySelectorAll('[data-copy]').forEach(btn => {
    btn.addEventListener('click', () => {
      const text = btn.getAttribute('data-copy');
      navigator.clipboard.writeText(text).then(() => {
        const original = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = original; }, 2000);
      });
    });
  });

  // ===== Language & Currency Selectors =====
  const CURRENCY_RATES = {
    THB: { rate: 1, symbol: '฿', code: 'THB', decimals: 0 },
    USD: { rate: 0.0304, symbol: '$', code: 'USD', decimals: 0 },
    EUR: { rate: 0.0263, symbol: '€', code: 'EUR', decimals: 0 },
    GBP: { rate: 0.0228, symbol: '£', code: 'GBP', decimals: 0 },
    JPY: { rate: 4.84, symbol: '¥', code: 'JPY', decimals: 0 },
    CNY: { rate: 0.211, symbol: '¥', code: 'CNY', decimals: 0 },
    KRW: { rate: 45.71, symbol: '₩', code: 'KRW', decimals: 0 },
    TWD: { rate: 0.973, symbol: '$', code: 'TWD', decimals: 0 },
    HKD: { rate: 0.238, symbol: '$', code: 'HKD', decimals: 0 },
    SGD: { rate: 0.039, symbol: '$', code: 'SGD', decimals: 0 },
    MYR: { rate: 0.12, symbol: 'RM', code: 'MYR', decimals: 0 },
    PHP: { rate: 1.82, symbol: '₱', code: 'PHP', decimals: 0 },
    IDR: { rate: 516, symbol: 'Rp', code: 'IDR', decimals: 0 },
    VND: { rate: 800, symbol: '₫', code: 'VND', decimals: 0 },
    INR: { rate: 2.85, symbol: '₹', code: 'INR', decimals: 0 },
    RUB: { rate: 2.53,   symbol: '₽',   code: 'RUB', decimals: 0 },
    AUD: { rate: 0.0433, symbol: '$',   code: 'AUD', decimals: 0 },
    AED: { rate: 0.1116, symbol: 'د.إ', code: 'AED', decimals: 0 },
    TRY: { rate: 0.973,  symbol: '₺',   code: 'TRY', decimals: 0 }
  };

  const LANG_MAP = {
    'en':    '/',
    'zh-CN': '/zh-CN/',
    'zh-TW': '/zh-TW/',
    'ja':    '/ja/',
    'ko':    '/ko/',
    'ru':    '/ru/',
    'hi':    '/hi/',
    'ms':    '/ms/',
    'vi':    '/vi/',
    'de':    '/de/',
    'fr':    '/fr/',
    'lo':    '/lo/',
    'es':    '/es/',
    'pt':    '/pt/',
    'ar':    '/ar/',
    'th':    '/th/',
    'id':    '/id/',
    'it':    '/it/',
    'nl':    '/nl/',
    'tr':    '/tr/',
  };

  // Format number with commas
  function formatNum(n, decimals) {
    return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  }

  // Convert price from base currency to target currency
  function convertPrice(thbAmount, currency) {
    const c = CURRENCY_RATES[currency];
    if (!c) return thbAmount;
    const converted = Math.round(thbAmount * c.rate);
    return formatNum(converted, c.decimals);
  }

  // Update all prices on page
  function updateAllPrices(currency) {
    const c = CURRENCY_RATES[currency];
    if (!c) return;

    // Pricing cards
    document.querySelectorAll('[data-base-price]').forEach(el => {
      const thb = parseFloat(el.getAttribute('data-base-price'));
      const converted = convertPrice(thb, currency);
      const currencyEl = el.querySelector('.pricing-currency');

      if (currencyEl) {
        currencyEl.textContent = c.code;
        currencyEl.nextSibling.textContent = ' ' + converted;
      } else if (el.classList.contains('sticky-bar-price')) {
        const origThb = parseFloat(el.getAttribute('data-base-price-original'));
        const origConverted = origThb ? convertPrice(origThb, currency) : '';
        el.innerHTML = `${c.code} ${converted}` + (origConverted ? ` <small>${c.code} ${origConverted}</small>` : '');
      }
    });

    // Price note lines under cards
    document.querySelectorAll('[data-price-note]').forEach(el => {
      const type = el.getAttribute('data-price-note');
      if (currency === BASE_CURRENCY) {
        // Show USD equivalent when viewing in base currency
        if (type === 'gate') el.textContent = 'per person';
        if (type === 'online') el.innerHTML = 'per person &mdash; Best online price!';
        if (type === 'vip') el.innerHTML = 'Starting price';
      } else {
        if (type === 'gate') el.textContent = 'per person';
        if (type === 'online') el.innerHTML = 'per person &mdash; Save ~27%!';
        if (type === 'vip') el.innerHTML = 'Starting price';
      }
    });

    // Update selector button label
    const label = document.querySelector('.current-currency-label');
    if (label) label.textContent = `${c.code} ${c.symbol}`;

    // Update active state in dropdown
    document.querySelectorAll('#currencyMenu [data-currency]').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-currency') === currency);
    });

    localStorage.setItem('aq_currency', currency);
  }

  // Dropdown toggle behavior
  function initDropdowns() {
    document.querySelectorAll('.selector-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const dropdown = btn.nextElementSibling;
        const isOpen = dropdown.classList.contains('open');

        // Close all dropdowns first
        document.querySelectorAll('.selector-dropdown.open').forEach(d => d.classList.remove('open'));
        document.querySelectorAll('.selector-btn').forEach(b => b.setAttribute('aria-expanded', 'false'));

        if (!isOpen) {
          dropdown.classList.add('open');
          btn.setAttribute('aria-expanded', 'true');
        }
      });
    });

    // Close on outside click
    document.addEventListener('click', () => {
      document.querySelectorAll('.selector-dropdown.open').forEach(d => d.classList.remove('open'));
      document.querySelectorAll('.selector-btn').forEach(b => b.setAttribute('aria-expanded', 'false'));
    });

    // Prevent dropdown close when clicking inside
    document.querySelectorAll('.selector-dropdown').forEach(d => {
      d.addEventListener('click', (e) => e.stopPropagation());
    });
  }

  // Currency selector
  function initCurrencySelector() {
    document.querySelectorAll('#currencyMenu [data-currency]').forEach(btn => {
      btn.addEventListener('click', () => {
        const currency = btn.getAttribute('data-currency');
        updateAllPrices(currency);
        // Close dropdown
        btn.closest('.selector-dropdown').classList.remove('open');
        btn.closest('.selector').querySelector('.selector-btn').setAttribute('aria-expanded', 'false');
      });
    });

    // Restore saved currency
    const saved = localStorage.getItem('aq_currency');
    if (saved && CURRENCY_RATES[saved]) {
      updateAllPrices(saved);
    }
  }

  // Language auto-detect & redirect (only on first visit)
  function initLanguageDetection() {
    if (localStorage.getItem('aq_lang_set')) return;

    const browserLang = (navigator.language || navigator.userLanguage || 'en').toLowerCase();
    let targetLang = 'en';

    // Match browser language to available translations
    if (browserLang.startsWith('zh-tw') || browserLang.startsWith('zh-hant')) {
      targetLang = 'zh-TW';
    } else if (browserLang.startsWith('zh')) {
      targetLang = 'zh-CN';
    } else if (browserLang.startsWith('ja')) {
      targetLang = 'ja';
    } else if (browserLang.startsWith('ko')) {
      targetLang = 'ko';
    } else if (browserLang.startsWith('ru')) {
      targetLang = 'ru';
    } else if (browserLang.startsWith('hi')) {
      targetLang = 'hi';
    } else if (browserLang.startsWith('ms')) {
      targetLang = 'ms';
    } else if (browserLang.startsWith('vi')) {
      targetLang = 'vi';
    } else if (browserLang.startsWith('de')) {
      targetLang = 'de';
    } else if (browserLang.startsWith('fr')) {
      targetLang = 'fr';
    } else if (browserLang.startsWith('lo')) {
      targetLang = 'lo';
    } else if (browserLang.startsWith('es')) {
      targetLang = 'es';
    } else if (browserLang.startsWith('pt')) {
      targetLang = 'pt';
    } else if (browserLang.startsWith('ar')) {
      targetLang = 'ar';
    } else if (browserLang.startsWith('th')) {
      targetLang = 'th';
    } else if (browserLang.startsWith('id')) {
      targetLang = 'id';
    } else if (browserLang.startsWith('it')) {
      targetLang = 'it';
    } else if (browserLang.startsWith('nl')) {
      targetLang = 'nl';
    } else if (browserLang.startsWith('tr')) {
      targetLang = 'tr';
    }

    localStorage.setItem('aq_lang_set', '1');

    // Only redirect if not already on the correct language page
    const path = window.location.pathname;
    const targetPath = LANG_MAP[targetLang];
    if (targetLang !== 'en' && path === '/' && targetPath) {
      window.location.href = targetPath;
    }
  }

  // Language selector - mark active based on current page and rewrite links to stay on same page
  function initLanguageSelector() {
    const path = window.location.pathname;

    // Extract the page portion by stripping the language prefix
    // e.g. "/zh-CN/faq.html" → "faq.html", "/blog/foo.html" → "blog/foo.html", "/" → ""
    let page = path.replace(/^\//, ''); // remove leading slash
    const langPrefixes = Object.values(LANG_MAP).filter(p => p !== '/').map(p => p.replace(/^\/|\/$/g, ''));
    for (const prefix of langPrefixes) {
      if (page.startsWith(prefix + '/')) {
        page = page.slice(prefix.length + 1);
        break;
      }
    }
    // Treat index.html as homepage
    if (page === 'index.html') page = '';

    const langLinks = document.querySelectorAll('#langMenu a');
    langLinks.forEach(link => {
      const lang = link.getAttribute('lang');
      const langBase = LANG_MAP[lang];
      if (langBase) {
        link.setAttribute('href', langBase + page);
      }

      const href = link.getAttribute('href');
      const isActive = (href === '/' && (path === '/' || path === '/index.html')) ||
                       (href !== '/' && path.startsWith(href));
      link.classList.toggle('active', isActive);
      if (isActive) {
        const label = document.querySelector('.current-lang-label');
        if (label) label.textContent = link.textContent;
      }
    });

    // On click, remember that user manually chose a language
    langLinks.forEach(link => {
      link.addEventListener('click', () => {
        localStorage.setItem('aq_lang_set', '1');
      });
    });
  }

  // Fix internal links on non-English pages to include the language prefix
  function fixInternalLinks() {
    const path = window.location.pathname;

    // Determine current language prefix (e.g. '/zh-CN/', '/ja/'). Empty = English.
    let langPrefix = '';
    for (const [lang, base] of Object.entries(LANG_MAP)) {
      if (lang === 'en') continue;
      if (path.startsWith(base)) {
        langPrefix = base;
        break;
      }
    }

    // English pages need no fix
    if (!langPrefix) return;

    // Prefixes for non-navigable resources — skip these
    const resourcePrefixes = ['/images/', '/css/', '/js/', '/data/', '/fonts/'];

    // All known language base paths
    const langBases = Object.values(LANG_MAP).filter(b => b !== '/');

    document.querySelectorAll('a[href]').forEach(link => {
      // Skip language selector links (they have a lang attribute and are already handled)
      if (link.hasAttribute('lang')) return;

      const href = link.getAttribute('href');

      // Skip non-internal links
      if (!href.startsWith('/')) return;

      // Skip resource links
      if (resourcePrefixes.some(p => href.startsWith(p))) return;

      // Skip links that already have a language prefix
      if (langBases.some(b => href.startsWith(b))) return;

      // Rewrite: prepend language prefix (strip trailing slash from prefix for non-root hrefs)
      if (href === '/') {
        link.setAttribute('href', langPrefix);
      } else {
        link.setAttribute('href', langPrefix.slice(0, -1) + href);
      }
    });
  }

  // Auto-detect currency based on browser language
  function autoDetectCurrency() {
    if (localStorage.getItem('aq_currency')) return;

    // Only consider currencies rendered in the site's currency dropdown
    const availableCurrencies = new Set(
      Array.from(document.querySelectorAll('#currencyMenu [data-currency]'))
        .map(btn => btn.getAttribute('data-currency'))
    );

    const browserLang = (navigator.language || 'en').toLowerCase();
    let currency = BASE_CURRENCY;

    if (browserLang.startsWith('zh-tw') || browserLang.startsWith('zh-hant')) currency = 'TWD';
    else if (browserLang.startsWith('zh')) currency = 'CNY';
    else if (browserLang.startsWith('ja')) currency = 'JPY';
    else if (browserLang.startsWith('ko')) currency = 'KRW';
    else if (browserLang.startsWith('ru')) currency = 'RUB';
    else if (browserLang.startsWith('hi')) currency = 'INR';
    else if (browserLang.startsWith('ms')) currency = 'MYR';
    else if (browserLang.startsWith('vi')) currency = 'VND';
    else if (browserLang.startsWith('de') || browserLang.startsWith('fr')) currency = 'EUR';
    else if (browserLang.startsWith('es') || browserLang.startsWith('it') || browserLang.startsWith('nl') || browserLang.startsWith('pt')) currency = 'EUR';
    else if (browserLang.startsWith('ar')) currency = 'AED';
    else if (browserLang.startsWith('th')) currency = 'THB';
    else if (browserLang.startsWith('id')) currency = 'IDR';
    else if (browserLang.startsWith('tr')) currency = 'TRY';
    else if (browserLang.startsWith('en-us')) currency = 'USD';
    else if (browserLang.startsWith('en-gb')) currency = 'GBP';
    else if (browserLang.startsWith('en-au')) currency = 'AUD';

    // Fall back to base currency if detected currency is not available on this site
    if (!availableCurrencies.has(currency)) currency = BASE_CURRENCY;

    if (currency !== BASE_CURRENCY) {
      updateAllPrices(currency);
    }
  }

  // Stack fixed header bars (top-bar → announcement-bar → navbar)
  function stackHeaderBars() {
    const topBar = document.querySelector('.top-bar');
    const annBar = document.querySelector('.announcement-bar');
    const nav = document.querySelector('.navbar');
    if (!nav) return;

    const isMobile = window.innerWidth <= 768;

    let offset = 0;
    if (topBar) {
      topBar.style.top = '0px';
      // On mobile, skip hidden bars from offset calculation
      if (!isMobile || !topBar.classList.contains('scroll-hidden')) {
        offset += topBar.offsetHeight;
      }
    }
    if (annBar) {
      annBar.style.top = offset + 'px';
      if (!isMobile || !annBar.classList.contains('scroll-hidden')) {
        offset += annBar.offsetHeight;
      }
    }
    nav.style.top = offset + 'px';

    // Push page content below all fixed bars
    const totalHeight = offset + nav.offsetHeight;
    const hero = document.querySelector('.hero');
    if (hero) {
      hero.style.paddingTop = totalHeight + 'px';
    } else {
      document.body.style.paddingTop = totalHeight + 'px';
    }

    // Mobile nav menu: full-screen overlay (top:0, full height via CSS)
    // No need to set top/height here — CSS handles full-screen on mobile
  }

  stackHeaderBars();
  window.addEventListener('resize', stackHeaderBars);

  // Recalculate after fonts/images load (heights may change)
  window.addEventListener('load', stackHeaderBars);

  // Init all selectors
  if (document.querySelector('.top-bar')) {
    initDropdowns();
    initCurrencySelector();
    initLanguageSelector();
    initLanguageDetection();
    autoDetectCurrency();
    fixInternalLinks();
  }

  // ===== Countdown timer for urgency =====
  function updateCountdown() {
    const el = document.getElementById('countdown');
    if (!el) return;

    const now = new Date();
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);
    const diff = endOfDay - now;

    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);

    el.textContent = `${hours}h ${minutes}m ${seconds}s`;
  }

  if (document.getElementById('countdown')) {
    updateCountdown();
    setInterval(updateCountdown, 1000);
  }

})();
