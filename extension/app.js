/* ================================================================
   TabDash — Dashboard App (Pure Extension Edition)

   This file is the brain of the dashboard. Now that the dashboard
   IS the extension page (not inside an iframe), it can call
   chrome.tabs and chrome.storage directly — no postMessage bridge needed.

   What this file does:
   1. Reads open browser tabs directly via chrome.tabs.query()
   2. Groups tabs by domain with a landing pages category
   3. Renders domain cards, banners, and stats
   4. Handles all user actions (close tabs, save for later, focus tab)
   5. Stores "Saved for Later" tabs in chrome.storage.local (no server)
   ================================================================ */

'use strict';


/* ----------------------------------------------------------------
   CHROME TABS — Direct API Access

   Since this page IS the extension's new tab page, it has full
   access to chrome.tabs and chrome.storage. No middleman needed.
   ---------------------------------------------------------------- */

// All open tabs — populated by fetchOpenTabs()
let openTabs = [];

/**
 * fetchOpenTabs()
 *
 * Reads all currently open browser tabs directly from Chrome.
 * Sets the extensionId flag so we can identify TabDash's own pages.
 */
async function fetchOpenTabs() {
  try {
    const extensionId = chrome.runtime.id;
    // The new URL for this page is now index.html (not newtab.html)
    const newtabUrl = `chrome-extension://${extensionId}/index.html`;

    const tabs = await chrome.tabs.query({});
    openTabs = tabs.map(t => ({
      id:           t.id,
      url:          t.url,
      title:        t.title,
      windowId:     t.windowId,
      active:       t.active,
      pinned:       t.pinned,
      audible:      t.audible,
      lastAccessed: t.lastAccessed || 0,
      // Flag TabDash's own pages so we can detect duplicate new tabs
      isTabOut: t.url === newtabUrl || t.url === 'chrome://newtab/',
    }));
  } catch {
    // chrome.tabs API unavailable (shouldn't happen in an extension page)
    openTabs = [];
  }
}

/**
 * closeTabsByUrls(urls)
 *
 * Closes all open tabs whose hostname matches any of the given URLs.
 * After closing, re-fetches the tab list to keep our state accurate.
 *
 * Special case: file:// URLs are matched exactly (they have no hostname).
 */
async function closeTabsByUrls(urls) {
  if (!urls || urls.length === 0) return;

  // Separate file:// URLs (exact match) from regular URLs (hostname match)
  const targetHostnames = [];
  const exactUrls = new Set();

  for (const u of urls) {
    if (u.startsWith('file://')) {
      exactUrls.add(u);
    } else {
      try { targetHostnames.push(new URL(u).hostname); }
      catch { /* skip unparseable */ }
    }
  }

  const allTabs = await chrome.tabs.query({});
  const toClose = allTabs
    .filter(tab => {
      const tabUrl = tab.url || '';
      if (tabUrl.startsWith('file://') && exactUrls.has(tabUrl)) return true;
      try {
        const tabHostname = new URL(tabUrl).hostname;
        return tabHostname && targetHostnames.includes(tabHostname);
      } catch { return false; }
    })
    .map(tab => tab.id);

  if (toClose.length > 0) await chrome.tabs.remove(toClose);
  await fetchOpenTabs();
}

/**
 * closeTabsExact(urls)
 *
 * Closes tabs by exact URL match (not hostname). Used for landing pages
 * so closing "Gmail inbox" doesn't also close individual email threads.
 */
async function closeTabsExact(urls) {
  if (!urls || urls.length === 0) return;
  const urlSet = new Set(urls);
  const allTabs = await chrome.tabs.query({});
  const toClose = allTabs.filter(t => urlSet.has(t.url)).map(t => t.id);
  if (toClose.length > 0) await chrome.tabs.remove(toClose);
  await fetchOpenTabs();
}

/**
 * focusTab(url)
 *
 * Switches Chrome to the tab with the given URL (exact match first,
 * then hostname fallback). Also brings the window to the front.
 */
async function focusTab(url) {
  if (!url) return;
  const allTabs = await chrome.tabs.query({});
  const currentWindow = await chrome.windows.getCurrent();

  // Try exact URL match first
  let matches = allTabs.filter(t => t.url === url);

  // Fall back to hostname match
  if (matches.length === 0) {
    try {
      const targetHost = new URL(url).hostname;
      matches = allTabs.filter(t => {
        try { return new URL(t.url).hostname === targetHost; }
        catch { return false; }
      });
    } catch {}
  }

  if (matches.length === 0) return;

  // Prefer a match in a different window so it actually switches windows
  const match = matches.find(t => t.windowId !== currentWindow.id) || matches[0];
  await chrome.tabs.update(match.id, { active: true });
  await chrome.windows.update(match.windowId, { focused: true });
}

/**
 * closeDuplicateTabs(urls, keepOne)
 *
 * Closes duplicate tabs for the given list of URLs.
 * keepOne=true → keep one copy of each, close the rest.
 * keepOne=false → close all copies.
 */
async function closeDuplicateTabs(urls, keepOne = true) {
  const allTabs = await chrome.tabs.query({});
  const toClose = [];

  for (const url of urls) {
    const matching = allTabs.filter(t => t.url === url);
    if (keepOne) {
      const keep = matching.find(t => t.active) || matching[0];
      for (const tab of matching) {
        if (tab.id !== keep.id) toClose.push(tab.id);
      }
    } else {
      for (const tab of matching) toClose.push(tab.id);
    }
  }

  if (toClose.length > 0) await chrome.tabs.remove(toClose);
  await fetchOpenTabs();
}

/**
 * closeTabOutDupes()
 *
 * Closes all duplicate TabDash new-tab pages except the current one.
 */
async function closeTabOutDupes() {
  const extensionId = chrome.runtime.id;
  const newtabUrl = `chrome-extension://${extensionId}/index.html`;

  const allTabs = await chrome.tabs.query({});
  const currentWindow = await chrome.windows.getCurrent();
  const tabOutTabs = allTabs.filter(t =>
    t.url === newtabUrl || t.url === 'chrome://newtab/'
  );

  if (tabOutTabs.length <= 1) return;

  // Keep the active TabDash tab in the CURRENT window — that's the one the
  // user is looking at right now. Falls back to any active one, then the first.
  const keep =
    tabOutTabs.find(t => t.active && t.windowId === currentWindow.id) ||
    tabOutTabs.find(t => t.active) ||
    tabOutTabs[0];
  const toClose = tabOutTabs.filter(t => t.id !== keep.id).map(t => t.id);
  if (toClose.length > 0) await chrome.tabs.remove(toClose);
  await fetchOpenTabs();
}

/**
 * getStaleThresholdMs(tabCount)
 *
 * Returns the staleness threshold in milliseconds based on how many
 * real tabs are open.  More tabs → shorter threshold, but never
 * unreasonably short — the minimum is 2 hours.
 *
 *   ≤10 tabs → skip (no cleanup needed)
 *   11–20    → 24 hours
 *   21–35    → 12 hours
 *   36–50    → 4 hours
 *   51+      → 2 hours
 */
function getStaleThresholdMs(tabCount) {
  if (tabCount <= 10) return Infinity; // don't bother
  if (tabCount <= 20) return 24 * 60 * 60 * 1000;
  if (tabCount <= 35) return 12 * 60 * 60 * 1000;
  if (tabCount <= 50) return 4 * 60 * 60 * 1000;
  return 2 * 60 * 60 * 1000;
}

/**
 * findStaleTabs()
 *
 * Returns an array of stale tab objects sorted oldest-first.
 * Protects: active tab, pinned tabs, audible tabs, TabDash pages,
 * and chrome:// / extension pages.
 */
function findStaleTabs() {
  const now = Date.now();
  const realTabs = openTabs.filter(t => {
    const url = t.url || '';
    return !url.startsWith('chrome://') &&
           !url.startsWith('chrome-extension://') &&
           !url.startsWith('about:') &&
           !url.startsWith('edge://') &&
           !url.startsWith('brave://');
  });

  const threshold = getStaleThresholdMs(realTabs.length);

  return realTabs
    .filter(t => {
      if (t.active)   return false; // current tab
      if (t.pinned)   return false; // pinned
      if (t.audible)  return false; // playing audio/video
      if (t.isTabOut)  return false; // TabDash itself
      if (!t.lastAccessed) return false; // no data
      return (now - t.lastAccessed) > threshold;
    })
    .sort((a, b) => a.lastAccessed - b.lastAccessed); // oldest first
}

/**
 * closeStaleTabs()
 *
 * Saves stale tabs to "Saved for Later", then closes them.
 * Returns { closed, thresholdMin }.
 */
async function closeStaleTabs() {
  const stale = findStaleTabs();
  if (stale.length === 0) return { closed: 0, thresholdMin: 0 };

  const realTabs = openTabs.filter(t => {
    const url = t.url || '';
    return !url.startsWith('chrome://') &&
           !url.startsWith('chrome-extension://') &&
           !url.startsWith('about:');
  });
  const thresholdMs = getStaleThresholdMs(realTabs.length);
  const thresholdMin = Math.round(thresholdMs / 60000);

  // Save each stale tab to "Saved for Later" before closing
  for (const tab of stale) {
    await saveTabForLater({ url: tab.url, title: tab.title });
  }

  // Close all stale tabs
  const ids = stale.map(t => t.id);
  await chrome.tabs.remove(ids);
  await fetchOpenTabs();

  return { closed: stale.length, thresholdMin };
}

/**
 * formatStaleAge(lastAccessed)
 *
 * Returns a human-readable string like "2h ago" or "45m ago".
 */
function formatStaleAge(lastAccessed) {
  const mins = Math.round((Date.now() - lastAccessed) / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hrs}h${rem}m ago` : `${hrs}h ago`;
}


/* ----------------------------------------------------------------
   SAVED FOR LATER — chrome.storage.local

   Replaces the old server-side SQLite + REST API with Chrome's
   built-in key-value storage. Data persists across browser sessions
   and doesn't require a running server.

   Data shape stored under the "deferred" key:
   [
     {
       id: "1712345678901",          // timestamp-based unique ID
       url: "https://example.com",
       title: "Example Page",
       savedAt: "2026-04-04T10:00:00.000Z",  // ISO date string
       completed: false,             // true = checked off (archived)
       dismissed: false              // true = dismissed without reading
     },
     ...
   ]
   ---------------------------------------------------------------- */

/**
 * saveTabForLater(tab)
 *
 * Saves a single tab to the "Saved for Later" list in chrome.storage.local.
 * @param {{ url: string, title: string }} tab
 */
async function saveTabForLater(tab) {
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  deferred.push({
    id:        Date.now().toString(),
    url:       tab.url,
    title:     tab.title,
    savedAt:   new Date().toISOString(),
    completed: false,
    dismissed: false,
  });
  await chrome.storage.local.set({ deferred });
}

/**
 * getSavedTabs()
 *
 * Returns all saved tabs from chrome.storage.local.
 * - Purges items older than 24 hours automatically
 * - Filters out dismissed items
 * - Splits into active (not completed) and archived (completed)
 */
async function getSavedTabs() {
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  const now = Date.now();
  const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

  // Auto-purge items older than 24h
  const kept = deferred.filter(t => {
    if (t.dismissed) return false;
    const savedTime = new Date(t.savedAt).getTime();
    return (now - savedTime) < TWENTY_FOUR_HOURS;
  });

  // Persist if anything was purged
  if (kept.length !== deferred.filter(t => !t.dismissed).length) {
    await chrome.storage.local.set({ deferred: kept });
  }

  return {
    active:   kept.filter(t => !t.completed),
    archived: kept.filter(t => t.completed),
  };
}

/**
 * checkOffSavedTab(id)
 *
 * Marks a saved tab as completed (checked off). It moves to the archive.
 */
async function checkOffSavedTab(id) {
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  const tab = deferred.find(t => t.id === id);
  if (tab) {
    tab.completed = true;
    tab.completedAt = new Date().toISOString();
    await chrome.storage.local.set({ deferred });
  }
}

/**
 * dismissSavedTab(id)
 *
 * Marks a saved tab as dismissed (removed from all lists).
 */
async function dismissSavedTab(id) {
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  const tab = deferred.find(t => t.id === id);
  if (tab) {
    tab.dismissed = true;
    await chrome.storage.local.set({ deferred });
  }
}


/* ----------------------------------------------------------------
   UI HELPERS
   ---------------------------------------------------------------- */

/**
 * playCloseSound()
 *
 * Plays a clean "swoosh" sound when tabs are closed.
 * Built entirely with the Web Audio API — no sound files needed.
 * A filtered noise sweep that descends in pitch, like air moving.
 */
function playCloseSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const t = ctx.currentTime;

    // Swoosh: shaped white noise through a sweeping bandpass filter
    const duration = 0.25;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
    const data = buffer.getChannelData(0);

    // Generate noise with a natural envelope (quick attack, smooth decay)
    for (let i = 0; i < data.length; i++) {
      const pos = i / data.length;
      // Envelope: ramps up fast in first 10%, then fades out smoothly
      const env = pos < 0.1 ? pos / 0.1 : Math.pow(1 - (pos - 0.1) / 0.9, 1.5);
      data[i] = (Math.random() * 2 - 1) * env;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    // Bandpass filter sweeps from high to low — creates the "swoosh" character
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 2.0;
    filter.frequency.setValueAtTime(4000, t);
    filter.frequency.exponentialRampToValueAtTime(400, t + duration);

    // Volume
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);

    source.connect(filter).connect(gain).connect(ctx.destination);
    source.start(t);

    setTimeout(() => ctx.close(), 500);
  } catch {
    // Audio not supported — fail silently
  }
}

/**
 * shootConfetti(x, y)
 *
 * Shoots a burst of colorful confetti particles from the given screen
 * coordinates (typically the center of a card being closed).
 * Pure CSS + JS, no libraries.
 */
function shootConfetti(x, y) {
  const colors = [
    '#c5c5c5', // silver
    '#e8e8e8', // silver light
    '#8a8a8a', // silver dark
    '#ffffff', // white
    '#a0a0a0', // muted silver
    '#d4d4d4', // mid silver
    '#707070', // charcoal
    '#f0f0f0', // near white
  ];

  const particleCount = 17;

  for (let i = 0; i < particleCount; i++) {
    const el = document.createElement('div');

    const isCircle = Math.random() > 0.5;
    const size = 5 + Math.random() * 6; // 5–11px
    const color = colors[Math.floor(Math.random() * colors.length)];

    el.style.cssText = `
      position: fixed;
      left: ${x}px;
      top: ${y}px;
      width: ${size}px;
      height: ${size}px;
      background: ${color};
      border-radius: ${isCircle ? '50%' : '2px'};
      pointer-events: none;
      z-index: 9999;
      transform: translate(-50%, -50%);
      opacity: 1;
    `;
    document.body.appendChild(el);

    // Physics: random angle and speed for the outward burst
    const angle   = Math.random() * Math.PI * 2;
    const speed   = 60 + Math.random() * 120;
    const vx      = Math.cos(angle) * speed;
    const vy      = Math.sin(angle) * speed - 80; // bias upward
    const gravity = 200;

    const startTime = performance.now();
    const duration  = 700 + Math.random() * 200; // 700–900ms

    function frame(now) {
      const elapsed  = (now - startTime) / 1000;
      const progress = elapsed / (duration / 1000);

      if (progress >= 1) { el.remove(); return; }

      const px = vx * elapsed;
      const py = vy * elapsed + 0.5 * gravity * elapsed * elapsed;
      const opacity = progress < 0.5 ? 1 : 1 - (progress - 0.5) * 2;
      const rotate  = elapsed * 200 * (isCircle ? 0 : 1);

      el.style.transform = `translate(calc(-50% + ${px}px), calc(-50% + ${py}px)) rotate(${rotate}deg)`;
      el.style.opacity = opacity;

      requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
  }
}

/**
 * animateCardOut(card)
 *
 * Smoothly removes a mission card: fade + scale down, then confetti.
 * After the animation, checks if the grid is now empty.
 */
function animateCardOut(card) {
  if (!card) return;

  const rect = card.getBoundingClientRect();
  shootConfetti(rect.left + rect.width / 2, rect.top + rect.height / 2);

  card.classList.add('closing');
  setTimeout(() => {
    card.remove();
    checkAndShowEmptyState();
  }, 300);
}

/**
 * showToast(message)
 *
 * Brief pop-up notification at the bottom of the screen.
 */
function showToast(message) {
  const toast = document.getElementById('toast');
  document.getElementById('toastText').textContent = message;
  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), 2500);
}

/**
 * checkAndShowEmptyState()
 *
 * Shows a cheerful "Inbox zero" message when all domain cards are gone.
 */
function checkAndShowEmptyState() {
  const missionsEl = document.getElementById('openTabsMissions');
  if (!missionsEl) return;

  const remaining = missionsEl.querySelectorAll('.mission-card:not(.closing)').length;
  if (remaining > 0) return;

  missionsEl.innerHTML = `
    <div class="missions-empty-state">
      <div class="empty-checkmark">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" />
        </svg>
      </div>
      <div class="empty-title">Inbox zero, but for tabs.</div>
      <div class="empty-subtitle">You're free.</div>
    </div>
  `;

  const countEl = document.getElementById('openTabsSectionCount');
  if (countEl) countEl.textContent = '0 domains';
}

/**
 * timeAgo(dateStr)
 *
 * Converts an ISO date string into a human-friendly relative time.
 * "2026-04-04T10:00:00Z" → "2 hrs ago" or "yesterday"
 */
function timeAgo(dateStr) {
  if (!dateStr) return '';
  const then = new Date(dateStr);
  const now  = new Date();
  const diffMins  = Math.floor((now - then) / 60000);
  const diffHours = Math.floor((now - then) / 3600000);
  const diffDays  = Math.floor((now - then) / 86400000);

  if (diffMins < 1)   return 'just now';
  if (diffMins < 60)  return diffMins + ' min ago';
  if (diffHours < 24) return diffHours + ' hr' + (diffHours !== 1 ? 's' : '') + ' ago';
  if (diffDays === 1) return 'yesterday';
  return diffDays + ' days ago';
}

/**
 * getGreeting() — "Good morning / afternoon / evening"
 */
function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/**
 * getDateDisplay() — "Friday, April 4, 2026"
 */
function getDateDisplay() {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year:    'numeric',
    month:   'long',
    day:     'numeric',
  });
}


/* ----------------------------------------------------------------
   DOMAIN & TITLE CLEANUP HELPERS
   ---------------------------------------------------------------- */

// Map of known hostnames → friendly display names.
const FRIENDLY_DOMAINS = {
  'github.com':           'GitHub',
  'www.github.com':       'GitHub',
  'gist.github.com':      'GitHub Gist',
  'youtube.com':          'YouTube',
  'www.youtube.com':      'YouTube',
  'music.youtube.com':    'YouTube Music',
  'x.com':                'X',
  'www.x.com':            'X',
  'twitter.com':          'X',
  'www.twitter.com':      'X',
  'reddit.com':           'Reddit',
  'www.reddit.com':       'Reddit',
  'old.reddit.com':       'Reddit',
  'substack.com':         'Substack',
  'www.substack.com':     'Substack',
  'medium.com':           'Medium',
  'www.medium.com':       'Medium',
  'linkedin.com':         'LinkedIn',
  'www.linkedin.com':     'LinkedIn',
  'stackoverflow.com':    'Stack Overflow',
  'www.stackoverflow.com':'Stack Overflow',
  'news.ycombinator.com': 'Hacker News',
  'google.com':           'Google',
  'www.google.com':       'Google',
  'mail.google.com':      'Gmail',
  'docs.google.com':      'Google Docs',
  'drive.google.com':     'Google Drive',
  'calendar.google.com':  'Google Calendar',
  'meet.google.com':      'Google Meet',
  'gemini.google.com':    'Gemini',
  'chatgpt.com':          'ChatGPT',
  'www.chatgpt.com':      'ChatGPT',
  'chat.openai.com':      'ChatGPT',
  'claude.ai':            'Claude',
  'www.claude.ai':        'Claude',
  'code.claude.com':      'Claude Code',
  'notion.so':            'Notion',
  'www.notion.so':        'Notion',
  'figma.com':            'Figma',
  'www.figma.com':        'Figma',
  'slack.com':            'Slack',
  'app.slack.com':        'Slack',
  'discord.com':          'Discord',
  'www.discord.com':      'Discord',
  'wikipedia.org':        'Wikipedia',
  'en.wikipedia.org':     'Wikipedia',
  'amazon.com':           'Amazon',
  'www.amazon.com':       'Amazon',
  'netflix.com':          'Netflix',
  'www.netflix.com':      'Netflix',
  'spotify.com':          'Spotify',
  'open.spotify.com':     'Spotify',
  'vercel.com':           'Vercel',
  'www.vercel.com':       'Vercel',
  'npmjs.com':            'npm',
  'www.npmjs.com':        'npm',
  'developer.mozilla.org':'MDN',
  'arxiv.org':            'arXiv',
  'www.arxiv.org':        'arXiv',
  'huggingface.co':       'Hugging Face',
  'www.huggingface.co':   'Hugging Face',
  'producthunt.com':      'Product Hunt',
  'www.producthunt.com':  'Product Hunt',
  'xiaohongshu.com':      'RedNote',
  'www.xiaohongshu.com':  'RedNote',
  'local-files':          'Local Files',
};

function friendlyDomain(hostname) {
  if (!hostname) return '';
  if (FRIENDLY_DOMAINS[hostname]) return FRIENDLY_DOMAINS[hostname];

  if (hostname.endsWith('.substack.com') && hostname !== 'substack.com') {
    return capitalize(hostname.replace('.substack.com', '')) + "'s Substack";
  }
  if (hostname.endsWith('.github.io')) {
    return capitalize(hostname.replace('.github.io', '')) + ' (GitHub Pages)';
  }

  let clean = hostname
    .replace(/^www\./, '')
    .replace(/\.(com|org|net|io|co|ai|dev|app|so|me|xyz|info|us|uk|co\.uk|co\.jp)$/, '');

  return clean.split('.').map(part => capitalize(part)).join(' ');
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function stripTitleNoise(title) {
  if (!title) return '';
  // Strip leading notification count: "(2) Title"
  title = title.replace(/^\(\d+\+?\)\s*/, '');
  // Strip inline counts like "Inbox (16,359)"
  title = title.replace(/\s*\([\d,]+\+?\)\s*/g, ' ');
  // Strip email addresses (privacy + cleaner display)
  title = title.replace(/\s*[\-\u2010-\u2015]\s*[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, '');
  title = title.replace(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, '');
  // Clean X/Twitter format
  title = title.replace(/\s+on X:\s*/, ': ');
  title = title.replace(/\s*\/\s*X\s*$/, '');
  return title.trim();
}

function cleanTitle(title, hostname) {
  if (!title || !hostname) return title || '';

  const friendly = friendlyDomain(hostname);
  const domain   = hostname.replace(/^www\./, '');
  const seps     = [' - ', ' | ', ' — ', ' · ', ' – '];

  for (const sep of seps) {
    const idx = title.lastIndexOf(sep);
    if (idx === -1) continue;
    const suffix     = title.slice(idx + sep.length).trim();
    const suffixLow  = suffix.toLowerCase();
    if (
      suffixLow === domain.toLowerCase() ||
      suffixLow === friendly.toLowerCase() ||
      suffixLow === domain.replace(/\.\w+$/, '').toLowerCase() ||
      domain.toLowerCase().includes(suffixLow) ||
      friendly.toLowerCase().includes(suffixLow)
    ) {
      const cleaned = title.slice(0, idx).trim();
      if (cleaned.length >= 5) return cleaned;
    }
  }
  return title;
}

function smartTitle(title, url) {
  if (!url) return title || '';
  let pathname = '', hostname = '';
  try { const u = new URL(url); pathname = u.pathname; hostname = u.hostname; }
  catch { return title || ''; }

  const titleIsUrl = !title || title === url || title.startsWith(hostname) || title.startsWith('http');

  if ((hostname === 'x.com' || hostname === 'twitter.com' || hostname === 'www.x.com') && pathname.includes('/status/')) {
    const username = pathname.split('/')[1];
    if (username) return titleIsUrl ? `Post by @${username}` : title;
  }

  if (hostname === 'github.com' || hostname === 'www.github.com') {
    const parts = pathname.split('/').filter(Boolean);
    if (parts.length >= 2) {
      const [owner, repo, ...rest] = parts;
      if (rest[0] === 'issues' && rest[1]) return `${owner}/${repo} Issue #${rest[1]}`;
      if (rest[0] === 'pull'   && rest[1]) return `${owner}/${repo} PR #${rest[1]}`;
      if (rest[0] === 'blob' || rest[0] === 'tree') return `${owner}/${repo} — ${rest.slice(2).join('/')}`;
      if (titleIsUrl) return `${owner}/${repo}`;
    }
  }

  if ((hostname === 'www.youtube.com' || hostname === 'youtube.com') && pathname === '/watch') {
    if (titleIsUrl) return 'YouTube Video';
  }

  if ((hostname === 'www.reddit.com' || hostname === 'reddit.com' || hostname === 'old.reddit.com') && pathname.includes('/comments/')) {
    const parts  = pathname.split('/').filter(Boolean);
    const subIdx = parts.indexOf('r');
    if (subIdx !== -1 && parts[subIdx + 1]) {
      if (titleIsUrl) return `r/${parts[subIdx + 1]} post`;
    }
  }

  return title || url;
}


/* ----------------------------------------------------------------
   SVG ICON STRINGS
   ---------------------------------------------------------------- */
const ICONS = {
  tabs:    `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M3 8.25V18a2.25 2.25 0 0 0 2.25 2.25h13.5A2.25 2.25 0 0 0 21 18V8.25m-18 0V6a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 6v2.25m-18 0h18" /></svg>`,
  close:   `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>`,
  archive: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5m6 4.125l2.25 2.25m0 0l2.25 2.25M12 13.875l2.25-2.25M12 13.875l-2.25 2.25M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z" /></svg>`,
  focus:   `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 19.5 15-15m0 0H8.25m11.25 0v11.25" /></svg>`,
};


/* ----------------------------------------------------------------
   IN-MEMORY STORE FOR OPEN-TAB GROUPS
   ---------------------------------------------------------------- */
let domainGroups = [];


/* ----------------------------------------------------------------
   HELPER: filter out browser-internal pages
   ---------------------------------------------------------------- */

/**
 * getRealTabs()
 *
 * Returns tabs that are real web pages — no chrome://, extension
 * pages, about:blank, etc.
 */
function getRealTabs() {
  return openTabs.filter(t => {
    const url = t.url || '';
    return (
      !url.startsWith('chrome://') &&
      !url.startsWith('chrome-extension://') &&
      !url.startsWith('about:') &&
      !url.startsWith('edge://') &&
      !url.startsWith('brave://')
    );
  });
}

/**
 * checkTabOutDupes()
 *
 * Counts how many TabDash pages are open. If more than 1,
 * shows a banner offering to close the extras.
 */
function checkTabOutDupes() {
  const tabOutTabs = openTabs.filter(t => t.isTabOut);
  const banner  = document.getElementById('tabOutDupeBanner');
  const countEl = document.getElementById('tabOutDupeCount');
  if (!banner) return;

  if (tabOutTabs.length > 1) {
    if (countEl) countEl.textContent = tabOutTabs.length;
    banner.style.display = 'flex';
  } else {
    banner.style.display = 'none';
  }
}

/**
 * checkStaleTabs()
 *
 * Counts stale (long-untouched) tabs. If any exist, shows a banner
 * with the count and threshold.
 */
function checkStaleTabs() {
  const banner     = document.getElementById('staleTabBanner');
  const countEl    = document.getElementById('staleTabCount');
  const threshEl   = document.getElementById('staleThreshold');
  if (!banner) return;

  const stale = findStaleTabs();
  if (stale.length === 0) {
    banner.style.display = 'none';
    return;
  }

  const realTabs = openTabs.filter(t => {
    const url = t.url || '';
    return !url.startsWith('chrome://') &&
           !url.startsWith('chrome-extension://') &&
           !url.startsWith('about:');
  });
  const thresholdMs  = getStaleThresholdMs(realTabs.length);
  const thresholdMin = Math.round(thresholdMs / 60000);
  const label = thresholdMin >= 60
    ? `${Math.round(thresholdMin / 60)}h`
    : `${thresholdMin}m`;

  if (countEl)   countEl.textContent = stale.length;
  if (threshEl)  threshEl.textContent = label;
  banner.style.display = 'flex';
}


/* ----------------------------------------------------------------
   OVERFLOW CHIPS ("+N more" expand button in domain cards)
   ---------------------------------------------------------------- */

function buildOverflowChips(hiddenTabs, urlCounts = {}) {
  const hiddenChips = hiddenTabs.map(tab => {
    const label    = cleanTitle(smartTitle(stripTitleNoise(tab.title || ''), tab.url), '');
    const count    = urlCounts[tab.url] || 1;
    const dupeTag  = count > 1 ? ` <span class="chip-dupe-badge">(${count}x)</span>` : '';
    const chipClass = count > 1 ? ' chip-has-dupes' : '';
    const safeUrl   = (tab.url || '').replace(/"/g, '&quot;');
    const safeTitle = label.replace(/"/g, '&quot;');
    let domain = '';
    try { domain = new URL(tab.url).hostname; } catch {}
    const faviconUrl = domain ? `chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(tab.url)}&size=16` : '';
    return `<div class="page-chip clickable${chipClass}" data-action="focus-tab" data-tab-url="${safeUrl}" title="${safeTitle}">
      ${faviconUrl ? `<img class="chip-favicon" src="${faviconUrl}" alt="" onerror="this.style.display='none'">` : ''}
      <span class="chip-text">${label}</span>${dupeTag}
      <div class="chip-actions">
        <button class="chip-action chip-save" data-action="defer-single-tab" data-tab-url="${safeUrl}" data-tab-title="${safeTitle}" title="Save for later">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" /></svg>
        </button>
        <button class="chip-action chip-close" data-action="close-single-tab" data-tab-url="${safeUrl}" title="Close this tab">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
        </button>
      </div>
    </div>`;
  }).join('');

  return `
    <div class="page-chips-overflow" style="display:none">${hiddenChips}</div>
    <div class="page-chip page-chip-overflow clickable" data-action="expand-chips">
      <span class="chip-text">+${hiddenTabs.length} more</span>
    </div>`;
}


/* ----------------------------------------------------------------
   DOMAIN CARD RENDERER
   ---------------------------------------------------------------- */

/**
 * renderDomainCard(group, groupIndex)
 *
 * Builds the HTML for one domain group card.
 * group = { domain: string, tabs: [{ url, title, id, windowId, active }] }
 */
function renderDomainCard(group) {
  const tabs      = group.tabs || [];
  const tabCount  = tabs.length;
  const isLanding = group.domain === '__landing-pages__';
  const stableId  = 'domain-' + group.domain.replace(/[^a-z0-9]/g, '-');

  // Count duplicates (exact URL match)
  const urlCounts = {};
  for (const tab of tabs) urlCounts[tab.url] = (urlCounts[tab.url] || 0) + 1;
  const dupeUrls   = Object.entries(urlCounts).filter(([, c]) => c > 1);
  const hasDupes   = dupeUrls.length > 0;
  const totalExtras = dupeUrls.reduce((s, [, c]) => s + c - 1, 0);

  const tabBadge = `<span class="open-tabs-badge">
    ${ICONS.tabs}
    ${tabCount} tab${tabCount !== 1 ? 's' : ''} open
  </span>`;

  const dupeBadge = hasDupes
    ? `<span class="open-tabs-badge" style="color:var(--accent-amber);background:rgba(200,113,58,0.08);">
        ${totalExtras} duplicate${totalExtras !== 1 ? 's' : ''}
      </span>`
    : '';

  // Deduplicate for display: show each URL once, with (Nx) badge if duped
  const seen = new Set();
  const uniqueTabs = [];
  for (const tab of tabs) {
    if (!seen.has(tab.url)) { seen.add(tab.url); uniqueTabs.push(tab); }
  }

  const visibleTabs = uniqueTabs.slice(0, 10);
  const extraCount  = uniqueTabs.length - visibleTabs.length;

  const pageChips = visibleTabs.map(tab => {
    let label = cleanTitle(smartTitle(stripTitleNoise(tab.title || ''), tab.url), group.domain);
    // For localhost tabs, prepend port number so you can tell projects apart
    try {
      const parsed = new URL(tab.url);
      if (parsed.hostname === 'localhost' && parsed.port) label = `${parsed.port} ${label}`;
    } catch {}
    const count    = urlCounts[tab.url];
    const dupeTag  = count > 1 ? ` <span class="chip-dupe-badge">(${count}x)</span>` : '';
    const chipClass = count > 1 ? ' chip-has-dupes' : '';
    const safeUrl   = (tab.url || '').replace(/"/g, '&quot;');
    const safeTitle = label.replace(/"/g, '&quot;');
    let domain = '';
    try { domain = new URL(tab.url).hostname; } catch {}
    const faviconUrl = domain ? `chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(tab.url)}&size=16` : '';
    return `<div class="page-chip clickable${chipClass}" data-action="focus-tab" data-tab-url="${safeUrl}" title="${safeTitle}">
      ${faviconUrl ? `<img class="chip-favicon" src="${faviconUrl}" alt="" onerror="this.style.display='none'">` : ''}
      <span class="chip-text">${label}</span>${dupeTag}
      <div class="chip-actions">
        <button class="chip-action chip-save" data-action="defer-single-tab" data-tab-url="${safeUrl}" data-tab-title="${safeTitle}" title="Save for later">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" /></svg>
        </button>
        <button class="chip-action chip-close" data-action="close-single-tab" data-tab-url="${safeUrl}" title="Close this tab">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
        </button>
      </div>
    </div>`;
  }).join('') + (extraCount > 0 ? buildOverflowChips(uniqueTabs.slice(10), urlCounts) : '');

  let actionsHtml = `
    <button class="action-btn close-tabs" data-action="close-domain-tabs" data-domain-id="${stableId}">
      ${ICONS.close}
      Close all ${tabCount} tab${tabCount !== 1 ? 's' : ''}
    </button>`;

  if (hasDupes) {
    const dupeUrlsEncoded = dupeUrls.map(([url]) => encodeURIComponent(url)).join(',');
    actionsHtml += `
      <button class="action-btn" data-action="dedup-keep-one" data-dupe-urls="${dupeUrlsEncoded}">
        Close ${totalExtras} duplicate${totalExtras !== 1 ? 's' : ''}
      </button>`;
  }

  return `
    <div class="mission-card domain-card ${hasDupes ? 'has-amber-bar' : 'has-neutral-bar'}" data-domain-id="${stableId}">
      <div class="status-bar"></div>
      <div class="mission-content">
        <div class="mission-top">
          <span class="mission-name">${isLanding ? 'Homepages' : (group.label || friendlyDomain(group.domain))}</span>
          ${tabBadge}
          ${dupeBadge}
        </div>
        <div class="mission-pages">${pageChips}</div>
        <div class="actions">${actionsHtml}</div>
      </div>
      <div class="mission-meta">
        <div class="mission-page-count">${tabCount}</div>
        <div class="mission-page-label">tabs</div>
      </div>
    </div>`;
}


/* ----------------------------------------------------------------
   SAVED FOR LATER — Render Checklist Column
   ---------------------------------------------------------------- */

/**
 * renderDeferredColumn()
 *
 * Reads saved tabs from chrome.storage.local and renders the right-side
 * "Saved for Later" checklist column. Shows active items as a checklist
 * and completed items in a collapsible archive.
 */
async function renderDeferredColumn() {
  const column         = document.getElementById('deferredColumn');
  const list           = document.getElementById('deferredList');
  const empty          = document.getElementById('deferredEmpty');
  const countEl        = document.getElementById('deferredCount');
  const archiveEl      = document.getElementById('deferredArchive');
  const archiveCountEl = document.getElementById('archiveCount');
  const archiveList    = document.getElementById('archiveList');
  const toggleBar      = document.getElementById('deferredToggleBar');
  const toggleCount    = document.getElementById('deferredToggleCount');
  const body           = document.getElementById('deferredBody');

  if (!column) return;
  const dashCols = document.getElementById('dashboardColumns');

  try {
    const { active, archived } = await getSavedTabs();
    const total = active.length + archived.length;

    // Hide everything if nothing to show
    if (total === 0) {
      column.style.display = 'none';
      if (dashCols) dashCols.classList.add('single-column');
      return;
    }

    column.style.display = 'block';
    // Always single-column layout — deferred column sits below, not beside
    if (dashCols) dashCols.classList.add('single-column');

    // Update toggle bar count
    if (toggleCount) {
      toggleCount.textContent = `${active.length} saved`;
    }

    // Render active checklist items
    if (active.length > 0) {
      countEl.textContent = `${active.length} item${active.length !== 1 ? 's' : ''} · auto-expires in 24h`;
      list.innerHTML = active.map(item => renderDeferredItem(item)).join('');
      list.style.display = 'block';
      empty.style.display = 'none';
    } else {
      list.style.display = 'none';
      countEl.textContent = '';
      empty.style.display = 'block';
    }

    // Render archive section
    if (archived.length > 0) {
      archiveCountEl.textContent = `(${archived.length})`;
      archiveList.innerHTML = archived.map(item => renderArchiveItem(item)).join('');
      archiveEl.style.display = 'block';
    } else {
      archiveEl.style.display = 'none';
    }

  } catch (err) {
    console.warn('[tabdash] Could not load saved tabs:', err);
    column.style.display = 'none';
    if (dashCols) dashCols.classList.add('single-column');
  }
}

/**
 * renderDeferredItem(item)
 *
 * Builds HTML for one active checklist item: checkbox, title link,
 * domain, time ago, dismiss button.
 */
function renderDeferredItem(item) {
  let domain = '';
  try { domain = new URL(item.url).hostname.replace(/^www\./, ''); } catch {}
  const faviconUrl = `chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(item.url)}&size=16`;

  // Show remaining time until 24h expiry
  const savedTime = new Date(item.savedAt).getTime();
  const remainMs = Math.max(0, (savedTime + 24 * 60 * 60 * 1000) - Date.now());
  const remainMin = Math.round(remainMs / 60000);
  let expiryLabel;
  if (remainMin <= 0) expiryLabel = 'expiring';
  else if (remainMin < 60) expiryLabel = `${remainMin}m left`;
  else expiryLabel = `${Math.floor(remainMin / 60)}h${remainMin % 60 > 0 ? Math.round(remainMin % 60) + 'm' : ''} left`;
  const urgentClass = remainMin < 60 ? ' deferred-expiry-urgent' : '';

  return `
    <div class="deferred-item" data-deferred-id="${item.id}">
      <input type="checkbox" class="deferred-checkbox" data-action="check-deferred" data-deferred-id="${item.id}">
      <div class="deferred-info">
        <a href="${item.url}" target="_blank" rel="noopener" class="deferred-title" title="${(item.title || '').replace(/"/g, '&quot;')}">
          <img src="${faviconUrl}" alt="" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px" onerror="this.style.display='none'">${item.title || item.url}
        </a>
        <div class="deferred-meta">
          <span>${domain}</span>
          <span class="deferred-expiry${urgentClass}">${expiryLabel}</span>
        </div>
      </div>
      <button class="deferred-dismiss" data-action="dismiss-deferred" data-deferred-id="${item.id}" title="Dismiss">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
      </button>
    </div>`;
}

/**
 * renderArchiveItem(item)
 *
 * Builds HTML for one completed/archived item (simpler: just title + date).
 */
function renderArchiveItem(item) {
  const ago = item.completedAt ? timeAgo(item.completedAt) : timeAgo(item.savedAt);
  return `
    <div class="archive-item">
      <a href="${item.url}" target="_blank" rel="noopener" class="archive-item-title" title="${(item.title || '').replace(/"/g, '&quot;')}">
        ${item.title || item.url}
      </a>
      <span class="archive-item-date">${ago}</span>
    </div>`;
}


/* ----------------------------------------------------------------
   MAIN DASHBOARD RENDERER
   ---------------------------------------------------------------- */

/**
 * renderStaticDashboard()
 *
 * The main render function:
 * 1. Paints greeting + date
 * 2. Fetches open tabs via chrome.tabs.query()
 * 3. Groups tabs by domain (with landing pages pulled out to their own group)
 * 4. Renders domain cards
 * 5. Updates footer stats
 * 6. Renders the "Saved for Later" checklist
 */
/**
 * renderQuickAccessGrid(data)
 *
 * Shared HTML renderer for Quick Access categories.
 * data = [{ category: string, links: [{ title, url }] }]
 */
/**
 * renderSingleQaCard(link)
 *
 * Returns the HTML string for one Quick Access card.
 */
function renderSingleQaCard(link) {
  let domain = '';
  try { domain = new URL(link.url).hostname.replace(/^www\./, ''); } catch {}
  const favicon = domain ? `chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(link.url)}&size=32` : '';
  const safeUrl = (link.url || '').replace(/"/g, '&quot;');
  const safeTitle = (link.title || '').replace(/"/g, '&quot;');

  const visits = link.visitCount || 0;
  const visitLabel = visits > 0 ? `${visits} visit${visits !== 1 ? 's' : ''}` : '';

  let ago = '';
  if (link.lastVisitTime) {
    const diffMs  = Date.now() - link.lastVisitTime;
    const diffMin = Math.floor(diffMs / 60000);
    const diffHr  = Math.floor(diffMs / 3600000);
    const diffDay = Math.floor(diffMs / 86400000);
    if (diffMin < 1)       ago = 'just now';
    else if (diffMin < 60) ago = `${diffMin}m ago`;
    else if (diffHr < 24)  ago = `${diffHr}h ago`;
    else if (diffDay === 1) ago = 'yesterday';
    else                   ago = `${diffDay}d ago`;
  }

  const visitIcon = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="qa-meta-icon"><path stroke-linecap="round" stroke-linejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.64 0 8.577 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.64 0-8.577-3.007-9.963-7.178Z" /><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" /></svg>`;
  const clockIcon = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="qa-meta-icon"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>`;

  const metaParts = [];
  if (visitLabel) metaParts.push(`<span class="qa-meta-item">${visitIcon}${visitLabel}</span>`);
  if (ago)        metaParts.push(`<span class="qa-meta-item">${clockIcon}${ago}</span>`);
  const metaHtml = metaParts.length > 0
    ? `<div class="qa-card-meta">${metaParts.join('<span class="qa-meta-dot">·</span>')}</div>`
    : '';

  return `<div class="qa-card" data-qa-url="${safeUrl}">
    <a href="${safeUrl}" class="qa-card-link" title="${safeTitle}">
      <div class="qa-card-icon">
        ${favicon ? `<img src="${favicon}" alt="" class="qa-card-favicon" onerror="this.parentElement.textContent='🌐'">` : '<span>🌐</span>'}
      </div>
      <div class="qa-card-body">
        <div class="qa-card-title">${link.title}</div>
        <div class="qa-card-domain">${domain}</div>
        ${metaHtml}
      </div>
    </a>
    <button class="qa-card-dismiss" data-action="dismiss-qa" data-qa-url="${safeUrl}" title="Remove">
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
    </button>
  </div>`;
}

function renderQuickAccessGrid(data) {
  return data.map(cat => {
    const cards = cat.links.map(link => renderSingleQaCard(link)).join('');
    return `<div class="quick-access-category">
      <div class="quick-access-label">${cat.category}</div>
      <div class="qa-card-grid">${cards}</div>
    </div>`;
  }).join('');
}

/**
 * buildQuickAccessFromHistory()
 *
 * Queries chrome.history (via background worker) for the last 15 days,
 * returns the top 10 most-visited pages — no category mapping needed.
 *
 * Returns: [{ title, url, visitCount, lastVisitTime }]
 */
/**
 * normalizeQaUrl(url)
 *
 * Normalizes a URL for dedup in Quick Access: strips trailing slash,
 * tracking params, hash, and lowercases the hostname.
 * Two URLs that point to the same page should produce the same key.
 */
function normalizeQaUrl(url) {
  try {
    const u = new URL(url);
    // Remove common tracking / noise parameters
    const junkParams = [
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
      'fbclid', 'gclid', 'ref', 'source', 'mc_cid', 'mc_eid',
      '_ga', 'spm', 'from', 'share_source', 'vd_source',
    ];
    for (const p of junkParams) u.searchParams.delete(p);
    u.hash = '';
    let path = u.pathname;
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
    return u.origin.toLowerCase() + path + u.search;
  } catch { return url; }
}

async function buildQuickAccessFromHistory() {
  // ---- Hostnames to skip ----
  const defaultBlacklist = [
    'accounts.google.com',
    'login.microsoftonline.com',
    'newtab',
  ];
  const blacklist = new Set([
    ...defaultBlacklist,
    ...(typeof LOCAL_QUICK_ACCESS_BLACKLIST !== 'undefined' ? LOCAL_QUICK_ACCESS_BLACKLIST : []),
  ]);

  // ---- Path patterns to skip (auth, login, SAML, etc.) ----
  const skipPathPatterns = ['/login', '/auth', '/saml', '/sso', '/oauth', '/logon'];

  // ---- Ask background worker for history data ----
  const rawItems = await chrome.runtime.sendMessage({ action: 'getHistoryItems' });
  if (!rawItems || rawItems.length === 0) return [];

  // ---- Filter: remove internal pages, auth pages, blacklisted hosts ----
  const candidates = rawItems.filter(item => {
    if (!item.url || !item.weeklyCount) return false;
    try {
      const u = new URL(item.url);
      if (blacklist.has(u.hostname)) return false;
      if (/^(chrome|chrome-extension|about|edge|brave):/.test(u.protocol)) return false;
      if (skipPathPatterns.some(p => u.pathname.toLowerCase().includes(p))) return false;
      return true;
    } catch { return false; }
  });

  // ---- Deduplicate by normalized URL, clean titles ----
  const seenKeys = new Set();
  const results = [];
  for (const item of candidates) {
    const key = normalizeQaUrl(item.url);
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    let hostname = '';
    try { hostname = new URL(item.url).hostname; } catch { continue; }

    let title = stripTitleNoise(item.title || '');
    title = cleanTitle(title, hostname);
    if (title.length > 50) title = title.slice(0, 48) + '…';
    if (!title) title = hostname.replace(/^www\./, '');

    results.push({
      title,
      url: item.url,
      normalizedUrl: key,
      visitCount: item.weeklyCount,
      lastVisitTime: item.lastVisitTime || 0,
    });
  }

  // ---- Already sorted by visit count from background worker ----
  return results;
}

/**
 * renderQuickAccess()
 *
 * Shows the top 10 most-visited pages from the last 15 days.
 * Fetches history from the background worker, renders a flat card grid.
 */
async function renderQuickAccess() {
  const section = document.getElementById('quickAccessSection');
  const grid = document.getElementById('quickAccessGrid');
  if (!section || !grid) return;

  // Load dismissed URLs from storage
  const { qaDismissed = [] } = await chrome.storage.local.get('qaDismissed');
  const dismissed = new Set(qaDismissed);

  try {
    const allPages = await buildQuickAccessFromHistory();
    // Also normalize dismissed URLs so dismissing one variant covers all
    const dismissedKeys = new Set([...dismissed].map(u => normalizeQaUrl(u)));
    const filtered = allPages.filter(l => {
      return !dismissed.has(l.url) && !dismissedKeys.has(l.normalizedUrl || normalizeQaUrl(l.url));
    }).slice(0, 10);
    if (filtered.length === 0) { section.style.display = 'none'; return; }

    section.style.display = 'block';
    // Wrap in a single group so renderQuickAccessGrid still works
    grid.innerHTML = renderQuickAccessGrid([{ category: 'Most visited — last 15 days', links: filtered }]);
  } catch (err) {
    console.warn('[tabdash] Quick Access failed:', err);
    section.style.display = 'none';
  }
}

async function renderStaticDashboard() {
  // --- Header ---
  const greetingEl = document.getElementById('greeting');
  const dateEl     = document.getElementById('dateDisplay');
  if (greetingEl) greetingEl.textContent = getGreeting();
  if (dateEl)     dateEl.textContent     = getDateDisplay();

  // --- Quick Access links ---
  await renderQuickAccess();

  // --- Fetch tabs ---
  await fetchOpenTabs();
  const realTabs = getRealTabs();

  // --- Group tabs by domain ---
  // Landing pages (Gmail inbox, Twitter home, etc.) get their own special group
  // so they can be closed together without affecting content tabs on the same domain.
  const LANDING_PAGE_PATTERNS = [
    { hostname: 'mail.google.com', test: (p, h) =>
        !h.includes('#inbox/') && !h.includes('#sent/') && !h.includes('#search/') },
    { hostname: 'x.com',               pathExact: ['/home'] },
    { hostname: 'www.linkedin.com',    pathExact: ['/'] },
    { hostname: 'github.com',          pathExact: ['/'] },
    { hostname: 'www.youtube.com',     pathExact: ['/'] },
    // Merge personal patterns from config.local.js (if it exists)
    ...(typeof LOCAL_LANDING_PAGE_PATTERNS !== 'undefined' ? LOCAL_LANDING_PAGE_PATTERNS : []),
  ];

  function isLandingPage(url) {
    try {
      const parsed = new URL(url);
      return LANDING_PAGE_PATTERNS.some(p => {
        // Support both exact hostname and suffix matching (for wildcard subdomains)
        const hostnameMatch = p.hostname
          ? parsed.hostname === p.hostname
          : p.hostnameEndsWith
            ? parsed.hostname.endsWith(p.hostnameEndsWith)
            : false;
        if (!hostnameMatch) return false;
        if (p.test)       return p.test(parsed.pathname, url);
        if (p.pathPrefix) return parsed.pathname.startsWith(p.pathPrefix);
        if (p.pathExact)  return p.pathExact.includes(parsed.pathname);
        return parsed.pathname === '/';
      });
    } catch { return false; }
  }

  domainGroups = [];
  const groupMap    = {};
  const landingTabs = [];

  // Custom group rules from config.local.js (if any)
  const customGroups = typeof LOCAL_CUSTOM_GROUPS !== 'undefined' ? LOCAL_CUSTOM_GROUPS : [];

  // Check if a URL matches a custom group rule; returns the rule or null
  function matchCustomGroup(url) {
    try {
      const parsed = new URL(url);
      return customGroups.find(r => {
        const hostMatch = r.hostname
          ? parsed.hostname === r.hostname
          : r.hostnameEndsWith
            ? parsed.hostname.endsWith(r.hostnameEndsWith)
            : false;
        if (!hostMatch) return false;
        if (r.pathPrefix) return parsed.pathname.startsWith(r.pathPrefix);
        return true; // hostname matched, no path filter
      }) || null;
    } catch { return null; }
  }

  for (const tab of realTabs) {
    try {
      if (isLandingPage(tab.url)) {
        landingTabs.push(tab);
        continue;
      }

      // Check custom group rules first (e.g. merge subdomains, split by path)
      const customRule = matchCustomGroup(tab.url);
      if (customRule) {
        const key = customRule.groupKey;
        if (!groupMap[key]) groupMap[key] = { domain: key, label: customRule.groupLabel, tabs: [] };
        groupMap[key].tabs.push(tab);
        continue;
      }

      let hostname;
      if (tab.url && tab.url.startsWith('file://')) {
        hostname = 'local-files';
      } else {
        hostname = new URL(tab.url).hostname;
      }
      if (!hostname) continue;

      if (!groupMap[hostname]) groupMap[hostname] = { domain: hostname, tabs: [] };
      groupMap[hostname].tabs.push(tab);
    } catch {
      // Skip malformed URLs
    }
  }

  if (landingTabs.length > 0) {
    groupMap['__landing-pages__'] = { domain: '__landing-pages__', tabs: landingTabs };
  }

  // Sort: landing pages first, then domains from landing page sites, then by tab count
  // Collect exact hostnames and suffix patterns for priority sorting
  const landingHostnames = new Set(LANDING_PAGE_PATTERNS.map(p => p.hostname).filter(Boolean));
  const landingSuffixes = LANDING_PAGE_PATTERNS.map(p => p.hostnameEndsWith).filter(Boolean);
  function isLandingDomain(domain) {
    if (landingHostnames.has(domain)) return true;
    return landingSuffixes.some(s => domain.endsWith(s));
  }
  domainGroups = Object.values(groupMap).sort((a, b) => {
    const aIsLanding = a.domain === '__landing-pages__';
    const bIsLanding = b.domain === '__landing-pages__';
    if (aIsLanding !== bIsLanding) return aIsLanding ? -1 : 1;

    const aIsPriority = isLandingDomain(a.domain);
    const bIsPriority = isLandingDomain(b.domain);
    if (aIsPriority !== bIsPriority) return aIsPriority ? -1 : 1;

    return b.tabs.length - a.tabs.length;
  });

  // --- Render domain cards ---
  const openTabsSection      = document.getElementById('openTabsSection');
  const openTabsMissionsEl   = document.getElementById('openTabsMissions');
  const openTabsSectionCount = document.getElementById('openTabsSectionCount');
  const openTabsSectionTitle = document.getElementById('openTabsSectionTitle');

  if (domainGroups.length > 0 && openTabsSection) {
    if (openTabsSectionTitle) openTabsSectionTitle.textContent = 'Open tabs';
    openTabsSectionCount.innerHTML = `${domainGroups.length} domain${domainGroups.length !== 1 ? 's' : ''} &nbsp;&middot;&nbsp; <button class="action-btn close-tabs" data-action="close-all-open-tabs" style="font-size:11px;padding:3px 10px;">${ICONS.close} Close all ${realTabs.length} tabs</button>`;
    openTabsMissionsEl.innerHTML = domainGroups.map(g => renderDomainCard(g)).join('');
    openTabsSection.style.display = 'block';
  } else if (openTabsSection) {
    openTabsSection.style.display = 'none';
  }

  // --- Footer stats ---
  const statTabs = document.getElementById('statTabs');
  if (statTabs) statTabs.textContent = openTabs.length;

  // --- Check for duplicate TabDash tabs ---
  checkTabOutDupes();

  // --- Check for stale tabs ---
  checkStaleTabs();

  // --- Render "Saved for Later" column ---
  await renderDeferredColumn();
}

async function renderDashboard() {
  await renderStaticDashboard();
}


/* ----------------------------------------------------------------
   EVENT HANDLERS — using event delegation

   One listener on document handles ALL button clicks.
   Think of it as one security guard watching the whole building
   instead of one per door.
   ---------------------------------------------------------------- */

document.addEventListener('click', async (e) => {
  // Walk up the DOM to find the nearest element with data-action
  const actionEl = e.target.closest('[data-action]');
  if (!actionEl) return;

  const action = actionEl.dataset.action;

  // ---- Organize bookmarks into folders ----
  if (action === 'organize-bookmarks') {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm('Organize all bookmarks into folders?\n\nThis will categorize all bookmarks and move them into "Auto-Organized" in your Bookmarks Bar. You can restore them afterwards.')) return;

    actionEl.disabled = true;
    actionEl.style.opacity = '0.5';

    try {
      const result = await chrome.runtime.sendMessage({ action: 'organizeBookmarks' });
      if (result && result.moved > 0) {
        const folderCount = Object.keys(result.categories).length;
        showToast(`Organized ${result.moved} bookmark${result.moved !== 1 ? 's' : ''} into ${folderCount} folder${folderCount !== 1 ? 's' : ''}`);
        // Show restore button
        updateRestoreButton();
      } else {
        showToast('No loose bookmarks to organize');
      }
    } catch (err) {
      console.error('[tabdash] Organize bookmarks failed:', err);
      showToast('Failed to organize bookmarks');
    }

    actionEl.disabled = false;
    actionEl.style.opacity = '';
    return;
  }

  // ---- Restore bookmarks to pre-organize state ----
  if (action === 'restore-bookmarks') {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm('Restore bookmarks to their original locations?\n\nThis will undo the last auto-organize and move all bookmarks back.')) return;

    actionEl.disabled = true;
    actionEl.style.opacity = '0.5';

    try {
      const result = await chrome.runtime.sendMessage({ action: 'restoreBookmarks' });
      if (result && result.restored > 0) {
        showToast(`Restored ${result.restored} bookmark${result.restored !== 1 ? 's' : ''} to original locations`);
      } else {
        showToast('Nothing to restore');
      }
    } catch (err) {
      console.error('[tabdash] Restore bookmarks failed:', err);
      showToast('Failed to restore bookmarks');
    }

    actionEl.disabled = false;
    actionEl.style.opacity = '';
    // Hide restore button after restoring
    updateRestoreButton();
    return;
  }

  // ---- Close duplicate TabDash tabs ----
  if (action === 'close-tabout-dupes') {
    await closeTabOutDupes();
    playCloseSound();
    const banner = document.getElementById('tabOutDupeBanner');
    if (banner) {
      banner.style.transition = 'opacity 0.4s';
      banner.style.opacity = '0';
      setTimeout(() => { banner.style.display = 'none'; banner.style.opacity = '1'; }, 400);
    }
    showToast('Closed extra TabDash tabs');
    return;
  }

  // ---- Clean up stale tabs ----
  if (action === 'close-stale-tabs') {
    e.preventDefault();
    e.stopPropagation();

    const stale = findStaleTabs();
    if (stale.length === 0) {
      showToast('No stale tabs to clean up');
      return;
    }

    // Build confirm message: count + first few tab titles
    const realTabs = openTabs.filter(t => {
      const url = t.url || '';
      return !url.startsWith('chrome://') && !url.startsWith('chrome-extension://') && !url.startsWith('about:');
    });
    const thresholdMs  = getStaleThresholdMs(realTabs.length);
    const thresholdMin = Math.round(thresholdMs / 60000);
    const label = thresholdMin >= 60 ? `${Math.round(thresholdMin / 60)} hour(s)` : `${thresholdMin} minutes`;

    const preview = stale.map(t => {
      const name = (t.title || t.url || '').slice(0, 60);
      return `  - ${name} (${formatStaleAge(t.lastAccessed)})`;
    }).join('\n');

    const msg = `Close ${stale.length} tab${stale.length !== 1 ? 's' : ''} not viewed in over ${label}?\n\nThey will be saved to "Saved for later" first.\n\n${preview}`;

    if (!confirm(msg)) return;

    actionEl.disabled = true;
    actionEl.style.opacity = '0.5';

    const result = await closeStaleTabs();
    playCloseSound();

    const banner = document.getElementById('staleTabBanner');
    if (banner) {
      banner.style.transition = 'opacity 0.4s';
      banner.style.opacity = '0';
      setTimeout(() => { banner.style.display = 'none'; banner.style.opacity = '1'; }, 400);
    }

    showToast(`Cleaned up ${result.closed} stale tab${result.closed !== 1 ? 's' : ''} → saved for later`);

    actionEl.disabled = false;
    actionEl.style.opacity = '';

    // Re-render dashboard to reflect closed tabs + new saved-for-later items
    await renderDashboard();
    return;
  }

  // ---- Dismiss a Quick Access card ----
  if (action === 'dismiss-qa') {
    e.preventDefault();
    e.stopPropagation();
    const url = actionEl.dataset.qaUrl;
    if (!url) return;

    // Persist dismissed URL
    const { qaDismissed = [] } = await chrome.storage.local.get('qaDismissed');
    if (!qaDismissed.includes(url)) {
      qaDismissed.push(url);
      await chrome.storage.local.set({ qaDismissed });
    }

    // Animate card out
    const qaCard = actionEl.closest('.qa-card');
    if (qaCard) {
      qaCard.style.transition = 'opacity 0.25s, transform 0.25s';
      qaCard.style.opacity = '0';
      qaCard.style.transform = 'scale(0.9)';
    }

    // Wait for fade-out animation
    await new Promise(r => setTimeout(r, 300));

    // Incremental update: remove dismissed card, insert replacement if available
    const grid = document.querySelector('.qa-card-grid');
    if (qaCard && grid) {
      qaCard.remove();

      // Find a replacement card to keep the count at 10
      const dismissedSet = new Set((await chrome.storage.local.get('qaDismissed')).qaDismissed || []);
      const allPages = await buildQuickAccessFromHistory();
      const eligible = allPages.filter(l => !dismissedSet.has(l.url));

      // Collect normalized URLs of cards still visible in the grid
      const visibleCards = grid.querySelectorAll('.qa-card');
      const currentCount = visibleCards.length;
      const visibleKeys = new Set();
      for (const card of visibleCards) {
        const cardUrl = card.dataset.qaUrl;
        if (cardUrl) visibleKeys.add(normalizeQaUrl(cardUrl));
      }

      if (currentCount < 10) {
        // Pick the first eligible page not already visible
        const replacement = eligible.find(l => !visibleKeys.has(l.normalizedUrl || normalizeQaUrl(l.url)));
        if (replacement) {
          const tempDiv = document.createElement('div');
          tempDiv.innerHTML = renderSingleQaCard(replacement);
          const newCard = tempDiv.firstElementChild;
          newCard.classList.add('qa-card-entering');
          grid.appendChild(newCard);
        }
      }
    }
    return;
  }

  const card = actionEl.closest('.mission-card');

  // ---- Expand overflow chips ("+N more") ----
  if (action === 'expand-chips') {
    const overflowContainer = actionEl.parentElement.querySelector('.page-chips-overflow');
    if (overflowContainer) {
      overflowContainer.style.display = 'contents';
      actionEl.remove();
    }
    return;
  }

  // ---- Focus a specific tab ----
  if (action === 'focus-tab') {
    const tabUrl = actionEl.dataset.tabUrl;
    if (tabUrl) await focusTab(tabUrl);
    return;
  }

  // ---- Close a single tab ----
  if (action === 'close-single-tab') {
    e.stopPropagation(); // don't trigger parent chip's focus-tab
    const tabUrl = actionEl.dataset.tabUrl;
    if (!tabUrl) return;

    // Close the tab in Chrome directly
    const allTabs = await chrome.tabs.query({});
    const match   = allTabs.find(t => t.url === tabUrl);
    if (match) await chrome.tabs.remove(match.id);
    await fetchOpenTabs();

    playCloseSound();

    // Animate the chip row out
    const chip = actionEl.closest('.page-chip');
    if (chip) {
      const rect = chip.getBoundingClientRect();
      shootConfetti(rect.left + rect.width / 2, rect.top + rect.height / 2);
      chip.style.transition = 'opacity 0.2s, transform 0.2s';
      chip.style.opacity    = '0';
      chip.style.transform  = 'scale(0.8)';
      setTimeout(() => {
        chip.remove();
        // If the card now has no tabs, remove it too
        const parentCard = document.querySelector('.mission-card:has(.mission-pages:empty)');
        if (parentCard) animateCardOut(parentCard);
        document.querySelectorAll('.mission-card').forEach(c => {
          if (c.querySelectorAll('.page-chip[data-action="focus-tab"]').length === 0) {
            animateCardOut(c);
          }
        });
      }, 200);
    }

    // Update footer
    const statTabs = document.getElementById('statTabs');
    if (statTabs) statTabs.textContent = openTabs.length;

    showToast('Tab closed');
    return;
  }

  // ---- Save a single tab for later (then close it) ----
  if (action === 'defer-single-tab') {
    e.stopPropagation();
    const tabUrl   = actionEl.dataset.tabUrl;
    const tabTitle = actionEl.dataset.tabTitle || tabUrl;
    if (!tabUrl) return;

    // Save to chrome.storage.local
    try {
      await saveTabForLater({ url: tabUrl, title: tabTitle });
    } catch (err) {
      console.error('[tabdash] Failed to save tab:', err);
      showToast('Failed to save tab');
      return;
    }

    // Close the tab in Chrome
    const allTabs = await chrome.tabs.query({});
    const match   = allTabs.find(t => t.url === tabUrl);
    if (match) await chrome.tabs.remove(match.id);
    await fetchOpenTabs();

    // Animate chip out
    const chip = actionEl.closest('.page-chip');
    if (chip) {
      chip.style.transition = 'opacity 0.2s, transform 0.2s';
      chip.style.opacity    = '0';
      chip.style.transform  = 'scale(0.8)';
      setTimeout(() => chip.remove(), 200);
    }

    showToast('Saved for later');
    await renderDeferredColumn();
    return;
  }

  // ---- Check off a saved tab (moves it to archive) ----
  if (action === 'check-deferred') {
    const id = actionEl.dataset.deferredId;
    if (!id) return;

    await checkOffSavedTab(id);

    // Animate: strikethrough first, then slide out
    const item = actionEl.closest('.deferred-item');
    if (item) {
      item.classList.add('checked');
      setTimeout(() => {
        item.classList.add('removing');
        setTimeout(() => {
          item.remove();
          renderDeferredColumn(); // refresh counts and archive
        }, 300);
      }, 800);
    }
    return;
  }

  // ---- Dismiss a saved tab (removes it entirely) ----
  if (action === 'dismiss-deferred') {
    const id = actionEl.dataset.deferredId;
    if (!id) return;

    await dismissSavedTab(id);

    const item = actionEl.closest('.deferred-item');
    if (item) {
      item.classList.add('removing');
      setTimeout(() => {
        item.remove();
        renderDeferredColumn();
      }, 300);
    }
    return;
  }

  // ---- Close all tabs in a domain group ----
  if (action === 'close-domain-tabs') {
    const domainId = actionEl.dataset.domainId;
    const group    = domainGroups.find(g => {
      return 'domain-' + g.domain.replace(/[^a-z0-9]/g, '-') === domainId;
    });
    if (!group) return;

    const urls      = group.tabs.map(t => t.url);
    // Landing pages and custom groups (whose domain key isn't a real hostname)
    // must use exact URL matching to avoid closing unrelated tabs
    const useExact  = group.domain === '__landing-pages__' || !!group.label;

    if (useExact) {
      await closeTabsExact(urls);
    } else {
      await closeTabsByUrls(urls);
    }

    if (card) {
      playCloseSound();
      animateCardOut(card);
    }

    // Remove from in-memory groups
    const idx = domainGroups.indexOf(group);
    if (idx !== -1) domainGroups.splice(idx, 1);

    const groupLabel = group.domain === '__landing-pages__' ? 'Homepages' : (group.label || friendlyDomain(group.domain));
    showToast(`Closed ${urls.length} tab${urls.length !== 1 ? 's' : ''} from ${groupLabel}`);

    const statTabs = document.getElementById('statTabs');
    if (statTabs) statTabs.textContent = openTabs.length;
    return;
  }

  // ---- Close duplicates, keep one copy ----
  if (action === 'dedup-keep-one') {
    const urlsEncoded = actionEl.dataset.dupeUrls || '';
    const urls = urlsEncoded.split(',').map(u => decodeURIComponent(u)).filter(Boolean);
    if (urls.length === 0) return;

    await closeDuplicateTabs(urls, true);
    playCloseSound();

    // Hide the dedup button
    actionEl.style.transition = 'opacity 0.2s';
    actionEl.style.opacity    = '0';
    setTimeout(() => actionEl.remove(), 200);

    // Remove dupe badges from the card
    if (card) {
      card.querySelectorAll('.chip-dupe-badge').forEach(b => {
        b.style.transition = 'opacity 0.2s';
        b.style.opacity    = '0';
        setTimeout(() => b.remove(), 200);
      });
      card.querySelectorAll('.open-tabs-badge').forEach(badge => {
        if (badge.textContent.includes('duplicate')) {
          badge.style.transition = 'opacity 0.2s';
          badge.style.opacity    = '0';
          setTimeout(() => badge.remove(), 200);
        }
      });
      card.classList.remove('has-amber-bar');
      card.classList.add('has-neutral-bar');
    }

    showToast('Closed duplicates, kept one copy each');
    return;
  }

  // ---- Close ALL open tabs ----
  if (action === 'close-all-open-tabs') {
    const allUrls = openTabs
      .filter(t => t.url && !t.url.startsWith('chrome') && !t.url.startsWith('about:'))
      .map(t => t.url);
    await closeTabsByUrls(allUrls);
    playCloseSound();

    document.querySelectorAll('#openTabsMissions .mission-card').forEach(c => {
      shootConfetti(
        c.getBoundingClientRect().left + c.offsetWidth / 2,
        c.getBoundingClientRect().top  + c.offsetHeight / 2
      );
      animateCardOut(c);
    });

    showToast('All tabs closed. Fresh start.');
    return;
  }
});

// ---- Deferred toggle — expand/collapse the saved-for-later panel ----
document.addEventListener('click', (e) => {
  const toggle = e.target.closest('[data-action="toggle-deferred"]');
  if (toggle) {
    toggle.classList.toggle('open');
    const body = document.getElementById('deferredBody');
    if (body) {
      body.style.display = body.style.display === 'none' ? 'block' : 'none';
    }
    return;
  }

  // ---- Archive toggle — expand/collapse the archive section ----
  const archToggle = e.target.closest('#archiveToggle');
  if (!archToggle) return;

  archToggle.classList.toggle('open');
  const archBody = document.getElementById('archiveBody');
  if (archBody) {
    archBody.style.display = archBody.style.display === 'none' ? 'block' : 'none';
  }
});

// ---- Archive search — filter archived items as user types ----
document.addEventListener('input', async (e) => {
  if (e.target.id !== 'archiveSearch') return;

  const q = e.target.value.trim().toLowerCase();
  const archiveList = document.getElementById('archiveList');
  if (!archiveList) return;

  try {
    const { archived } = await getSavedTabs();

    if (q.length < 2) {
      // Show all archived items
      archiveList.innerHTML = archived.map(item => renderArchiveItem(item)).join('');
      return;
    }

    // Filter by title or URL containing the query string
    const results = archived.filter(item =>
      (item.title || '').toLowerCase().includes(q) ||
      (item.url  || '').toLowerCase().includes(q)
    );

    archiveList.innerHTML = results.map(item => renderArchiveItem(item)).join('')
      || '<div style="font-size:12px;color:var(--muted);padding:8px 0">No results</div>';
  } catch (err) {
    console.warn('[tabdash] Archive search failed:', err);
  }
});


/* ----------------------------------------------------------------
   SEARCH BAR — Quick search for history & bookmarks
   ---------------------------------------------------------------- */

/**
 * initSearchBar()
 *
 * Wires up the search input with debounced querying, keyboard navigation,
 * result rendering, and click-outside dismissal.
 */
function initSearchBar() {
  const input      = document.getElementById('searchInput');
  const resultsEl  = document.getElementById('searchResults');
  const shortcut   = document.querySelector('.search-shortcut');
  if (!input || !resultsEl) return;

  // Create backdrop overlay — must be inside .container to share its stacking context
  const backdrop = document.createElement('div');
  backdrop.className = 'search-backdrop';
  const container = document.querySelector('.container');
  (container || document.body).insertBefore(backdrop, container ? container.firstChild : null);

  backdrop.addEventListener('click', () => {
    hideResults();
    input.blur();
  });

  let debounceTimer = null;
  let activeIndex   = -1;
  let currentResults = [];

  // Debounced search on input
  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    const query = input.value.trim();

    if (!query) {
      hideResults();
      return;
    }

    debounceTimer = setTimeout(() => {
      chrome.runtime.sendMessage({ action: 'search', query }, (results) => {
        if (chrome.runtime.lastError) { hideResults(); return; }
        currentResults = results || [];
        activeIndex = -1;
        renderResults();
      });
    }, 200);
  });

  // Keyboard navigation
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      hideResults();
      input.blur();
      return;
    }

    if (currentResults.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIndex = Math.min(activeIndex + 1, currentResults.length - 1);
      updateActiveItem();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIndex = Math.max(activeIndex - 1, -1);
      updateActiveItem();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const idx = activeIndex >= 0 ? activeIndex : 0;
      const link = resultsEl.querySelector(`.search-result-item[data-index="${idx}"]`);
      if (link) link.click();
    }
  });

  // Hide shortcut hint when focused
  input.addEventListener('focus', () => {
    if (shortcut) shortcut.style.display = 'none';
  });

  input.addEventListener('blur', () => {
    if (shortcut && !input.value) shortcut.style.display = '';
  });

  // Click outside closes results
  document.addEventListener('click', (e) => {
    const searchBar = document.getElementById('searchBar');
    if (searchBar && !searchBar.contains(e.target)) {
      hideResults();
    }
  });

  // Global "/" shortcut to focus search
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !isInputFocused()) {
      e.preventDefault();
      input.focus();
    }
  });

  function isInputFocused() {
    const active = document.activeElement;
    return active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable);
  }

  function hideResults() {
    resultsEl.style.display = 'none';
    backdrop.classList.remove('visible');
    currentResults = [];
    activeIndex = -1;
  }

  function renderResults() {
    if (currentResults.length === 0) {
      resultsEl.innerHTML = '<div class="search-no-results">No matches found</div>';
      resultsEl.style.display = 'block';
      backdrop.classList.add('visible');
      return;
    }

    resultsEl.innerHTML = currentResults.map((r, i) => {
      let domain = '';
      try { domain = new URL(r.url).hostname.replace(/^www\./, ''); } catch {}
      const faviconUrl = domain
        ? `chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(r.url)}&size=16`
        : '';

      const safeDomain = domain.replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const title = stripTitleNoise(r.title || '') || domain || r.url;
      const safeUrl = (r.url || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
      const safeTitle = title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

      const sourceBadge = r.source === 'both' ? '<span class="search-source-badge both">both</span>'
        : r.source === 'bookmark' ? '<span class="search-source-badge bookmark">bookmark</span>'
        : '<span class="search-source-badge history">history</span>';

      return `<a href="${safeUrl}" class="search-result-item${i === activeIndex ? ' active' : ''}" data-index="${i}">
        <div class="search-result-favicon">
          ${faviconUrl ? `<img src="${faviconUrl}" alt="" onerror="this.style.display='none'">` : ''}
        </div>
        <div class="search-result-info">
          <div class="search-result-title">${safeTitle}</div>
          <div class="search-result-meta">
            <span class="search-result-domain">${safeDomain}</span>
            ${sourceBadge}
          </div>
        </div>
      </a>`;
    }).join('');

    resultsEl.style.display = 'block';
    backdrop.classList.add('visible');
  }

  function updateActiveItem() {
    const items = resultsEl.querySelectorAll('.search-result-item');
    items.forEach((el, i) => {
      el.classList.toggle('active', i === activeIndex);
    });
  }
}


/* ----------------------------------------------------------------
   THEME TOGGLE — Light / Dark mode
   ---------------------------------------------------------------- */

/**
 * initTheme()
 *
 * Loads the saved theme from chrome.storage.local and applies it.
 * Defaults to 'dark' if nothing is saved.
 */
async function initTheme() {
  try {
    const { theme } = await chrome.storage.local.get('theme');
    if (theme === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
    }
  } catch {}
}

/**
 * toggleTheme()
 *
 * Switches between light and dark mode, persists the choice.
 */
async function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'light' ? 'dark' : 'light';

  if (next === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }

  try {
    await chrome.storage.local.set({ theme: next });
  } catch {}
}

// Apply saved theme immediately (before render to avoid flash)
initTheme();

// Wire up the toggle button
document.getElementById('themeToggle')?.addEventListener('click', toggleTheme);


/* ----------------------------------------------------------------
   BOOKMARK RESTORE — show/hide the restore button based on snapshot
   ---------------------------------------------------------------- */

/**
 * updateRestoreButton()
 *
 * Checks if a bookmark organize snapshot exists. If so, shows the
 * "Restore" button with a tooltip showing when the snapshot was taken.
 */
async function updateRestoreButton() {
  const btn = document.getElementById('restoreBookmarksBtn');
  if (!btn) return;

  try {
    const result = await chrome.runtime.sendMessage({ action: 'hasBookmarkSnapshot' });
    if (result && result.has) {
      const ago = result.time ? timeAgo(new Date(result.time).toISOString()) : '';
      btn.title = `Restore ${result.count} bookmarks to original locations` + (ago ? ` (organized ${ago})` : '');
      btn.style.display = '';
    } else {
      btn.style.display = 'none';
    }
  } catch {
    btn.style.display = 'none';
  }
}


/* ----------------------------------------------------------------
   INITIALIZE
   ---------------------------------------------------------------- */
renderDashboard();
initSearchBar();
updateRestoreButton();
