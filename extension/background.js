/**
 * background.js — Service Worker for Badge Updates
 *
 * Chrome's "always-on" background script for TabDash.
 * Its only job: keep the toolbar badge showing the current open tab count.
 *
 * Since we no longer have a server, we query chrome.tabs directly.
 * The badge counts real web tabs (skipping chrome:// and extension pages).
 *
 * Color coding gives a quick at-a-glance health signal:
 *   Green  (#3d7a4a) → 1–10 tabs  (focused, manageable)
 *   Amber  (#b8892e) → 11–20 tabs (getting busy)
 *   Red    (#b35a5a) → 21+ tabs   (time to cull!)
 */

// ─── Badge updater ────────────────────────────────────────────────────────────

/**
 * updateBadge()
 *
 * Counts open real-web tabs and updates the extension's toolbar badge.
 * "Real" tabs = not chrome://, not extension pages, not about:blank.
 */
async function updateBadge() {
  try {
    const tabs = await chrome.tabs.query({});

    // Only count actual web pages — skip browser internals and extension pages
    const count = tabs.filter(t => {
      const url = t.url || '';
      return (
        !url.startsWith('chrome://') &&
        !url.startsWith('chrome-extension://') &&
        !url.startsWith('about:') &&
        !url.startsWith('edge://') &&
        !url.startsWith('brave://')
      );
    }).length;

    // Don't show "0" — an empty badge is cleaner
    await chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });

    if (count === 0) return;

    // Pick badge color based on workload level
    let color;
    if (count <= 10) {
      color = '#3d7a4a'; // Green — you're in control
    } else if (count <= 20) {
      color = '#b8892e'; // Amber — things are piling up
    } else {
      color = '#b35a5a'; // Red — time to focus and close some tabs
    }

    await chrome.action.setBadgeBackgroundColor({ color });

  } catch {
    // If something goes wrong, clear the badge rather than show stale data
    chrome.action.setBadgeText({ text: '' });
  }
}

// ─── Event listeners ──────────────────────────────────────────────────────────

// Update badge when the extension is first installed
chrome.runtime.onInstalled.addListener(() => {
  updateBadge();
});

// Update badge when Chrome starts up
chrome.runtime.onStartup.addListener(() => {
  updateBadge();
});

// Update badge whenever a tab is opened
chrome.tabs.onCreated.addListener(() => {
  updateBadge();
});

// Update badge whenever a tab is closed
chrome.tabs.onRemoved.addListener(() => {
  updateBadge();
});

// Update badge when a tab's URL changes (e.g. navigating to/from chrome://)
chrome.tabs.onUpdated.addListener(() => {
  updateBadge();
});

// ─── Bookmark auto-organizer ─────────────────────────────────────────────────

/**
 * CATEGORY_RULES
 *
 * Two-tier: big categories (技术/产品/测试/项目) with topic sub-folders.
 *
 * Each rule:
 *   folder        — path like "技术/Architecture" → creates nested folders
 *   urlPatterns   — URL substrings to match (case-insensitive)
 *   titlePatterns — (optional) if present, the combined (title + decoded-URL)
 *                   must also contain at least one of these keywords
 *
 * First match wins.  More specific (title-gated) rules before catch-alls.
 */

// ── Customizable category rules ──────────────────────────────────────────────
//
// WORK_URLS: URL substrings for your internal work platforms.
// CATEGORY_RULES: ordered list of { folder, urlPatterns, titlePatterns? }.
//   - folder: target path, e.g. "Work/Architecture" → creates nested folders
//   - urlPatterns: URL substrings (case-insensitive) — bookmark must match at least one
//   - titlePatterns: (optional) if present, combined (title + decoded-URL) must also
//                    match at least one keyword.  First matching rule wins.
//
// Customize these to fit your own bookmarks.  The defaults below are generic
// examples — replace them with your actual internal domains and project keywords.
// ─────────────────────────────────────────────────────────────────────────────

const WORK_URLS = [
  // Add your internal wiki / issue tracker / git / CI domains here, e.g.:
  // 'wiki.example.com',
  // 'jira.example.com',
  // 'git.example.com',
  // 'confluence.example.com',
];

const CATEGORY_RULES = [
  // ═══════════════════════════════════════════════════════════════════
  //  Work categories (two-tier: big category / sub-folder)
  //  Add rules for your own internal tools and project keywords.
  // ═══════════════════════════════════════════════════════════════════

  // Example: Architecture docs on internal wiki
  // { folder: 'Engineering/Architecture',
  //   urlPatterns: WORK_URLS,
  //   titlePatterns: ['architecture', 'design-doc', 'system design'] },

  // Example: CI/CD pipelines
  // { folder: 'Engineering/Pipeline & CI',
  //   urlPatterns: [...WORK_URLS, 'jenkins.example.com'],
  //   titlePatterns: ['pipeline', 'cicd', 'ci/cd', 'build'] },

  // Example: Project management catch-all for work URLs
  // { folder: 'Project/Other',
  //   urlPatterns: WORK_URLS },

  // ═══════════════════════════════════════════════════════════════════
  //  Generic categories (no titlePatterns → URL match alone is enough)
  // ═══════════════════════════════════════════════════════════════════
  { folder: 'Development',
    urlPatterns: ['github.com', 'gitlab.com', 'bitbucket.org', 'stackoverflow.com',
                  'npmjs.com', 'pypi.org', 'crates.io', 'codepen.io', 'codesandbox.io'] },

  { folder: 'Documentation',
    urlPatterns: ['docs.', 'readthedocs.io', 'devdocs.io', 'developer.mozilla.org',
                  'swagger.io', 'developer.'] },

  { folder: 'Cloud & DevOps',
    urlPatterns: ['console.aws.', 'cloud.google.', 'portal.azure.', 'docker.com',
                  'kubernetes.io', 'jenkins.io', 'vercel.com', 'netlify.com'] },

  { folder: 'Design',
    urlPatterns: ['figma.com', 'sketch.com', 'adobe.com', 'dribbble.com',
                  'canva.com', 'zeplin.io'] },

  { folder: 'Communication',
    urlPatterns: ['slack.com', 'teams.microsoft.com', 'discord.com', 'zoom.us',
                  'meet.google.com'] },

  { folder: 'Social & Media',
    urlPatterns: ['twitter.com', 'x.com', 'reddit.com', 'news.ycombinator.com',
                  'linkedin.com', 'youtube.com'] },

  { folder: 'Shopping',
    urlPatterns: ['amazon.', 'ebay.com', 'etsy.com'] },
];

/**
 * categorizeBookmark(url, title)
 *
 * Returns the category folder path (e.g. "技术/Architecture").
 * Matches on URL patterns; when titlePatterns exist, the combined
 * title + URL-decoded-path must also match.
 */
function categorizeBookmark(url, title) {
  const urlLower = (url || '').toLowerCase();
  const titleLower = (title || '').toLowerCase();

  // URL-decode so "Technical+Architecture" matches "technical architecture"
  let decodedUrl = urlLower;
  try { decodedUrl = decodeURIComponent(urlLower); } catch { /* keep raw */ }
  const combined = titleLower + ' ' + decodedUrl;

  for (const rule of CATEGORY_RULES) {
    const urlMatch = rule.urlPatterns.some(p => urlLower.includes(p));
    if (!urlMatch) continue;

    if (rule.titlePatterns && rule.titlePatterns.length > 0) {
      if (rule.titlePatterns.some(p => combined.includes(p))) return rule.folder;
      continue; // URL matched but title didn't — skip
    }

    return rule.folder;
  }

  return 'Uncategorized';
}

/**
 * collectAllBookmarks(node, skipFolderTitle)
 *
 * Recursively collects all bookmark URLs from a tree node.
 * Skips any folder whose title matches skipFolderTitle.
 */
function collectAllBookmarks(node, skipFolderTitle) {
  const results = [];
  if (node.url) {
    results.push(node);
    return results;
  }
  if (!node.children) return results;
  for (const child of node.children) {
    if (!child.url && child.title === skipFolderTitle) continue;
    results.push(...collectAllBookmarks(child, skipFolderTitle));
  }
  return results;
}

/**
 * getOrCreateFolderPath(parentId, pathParts)
 *
 * Given a parent folder ID and an array of path segments like
 * ["i2 MAX - Wiki", "Phone-to-Car"], creates/reuses each nested folder.
 * Returns the deepest folder's ID.
 */
async function getOrCreateFolderPath(parentId, pathParts) {
  let currentParentId = parentId;
  for (const part of pathParts) {
    const children = await chrome.bookmarks.getChildren(currentParentId);
    let folder = children.find(c => !c.url && c.title === part);
    if (!folder) {
      folder = await chrome.bookmarks.create({ parentId: currentParentId, title: part });
    }
    currentParentId = folder.id;
  }
  return currentParentId;
}

/**
 * removeEmptyFolders(folderId)
 *
 * Recursively removes empty folders. Returns true if the folder
 * itself was removed (i.e. it became empty).
 */
async function removeEmptyFolders(folderId) {
  let children;
  try {
    children = await chrome.bookmarks.getChildren(folderId);
  } catch { return false; }

  for (const child of children) {
    if (!child.url) {
      await removeEmptyFolders(child.id);
    }
  }

  // Re-check after cleaning sub-folders
  try {
    const remaining = await chrome.bookmarks.getChildren(folderId);
    if (remaining.length === 0) {
      await chrome.bookmarks.remove(folderId);
      return true;
    }
  } catch { /* already removed */ }
  return false;
}

/**
 * organizeBookmarks()
 *
 * Scans ALL bookmarks across the entire tree (not just loose ones),
 * categorizes by URL + title, and moves each into nested folders
 * under "Auto-Organized" in Bookmarks Bar.
 *
 * - Skips the "Auto-Organized" folder itself (idempotent)
 * - Saves snapshot for restore
 * - Cleans up empty folders after moving
 */
async function organizeBookmarks() {
  const tree = await chrome.bookmarks.getTree();
  const root = tree[0].children; // [Bookmarks Bar, Other Bookmarks, ...]

  // Collect ALL bookmarks recursively (including inside Auto-Organized
  // so re-running with updated rules re-categorizes everything)
  const all = [];
  for (const parent of root) {
    all.push(...collectAllBookmarks(parent, null));
  }

  if (all.length === 0) return { moved: 0, categories: {} };

  // Save snapshot BEFORE moving — every bookmark's original location
  const snapshot = all.map(bm => ({
    id:       bm.id,
    parentId: bm.parentId,
    index:    bm.index,
    title:    bm.title,
    url:      bm.url,
  }));

  // Also remember which user folders existed so restore can recreate them
  const userFolders = [];
  for (const parent of root) {
    if (!parent.children) continue;
    for (const child of parent.children) {
      if (!child.url && child.title !== 'Auto-Organized') {
        userFolders.push({ id: child.id, parentId: child.parentId, title: child.title, index: child.index });
      }
    }
  }

  await chrome.storage.local.set({
    organizeSnapshot: {
      timestamp: Date.now(),
      bookmarks: snapshot,
      userFolders,
    },
  });

  // Categorize each bookmark
  const buckets = {};
  for (const bm of all) {
    const cat = categorizeBookmark(bm.url, bm.title);
    if (!buckets[cat]) buckets[cat] = [];
    buckets[cat].push(bm);
  }

  // Find or create "Auto-Organized" folder in Bookmarks Bar.
  // We reuse the existing folder so bookmarks keep the same parent root.
  // Old sub-folders will be cleaned up after we move everything.
  const barId = root[0].id;
  const barChildren = await chrome.bookmarks.getChildren(barId);
  let autoFolder = barChildren.find(c => !c.url && c.title === 'Auto-Organized');
  if (!autoFolder) {
    autoFolder = await chrome.bookmarks.create({ parentId: barId, title: 'Auto-Organized' });
  }

  // Move bookmarks into categorized folder paths
  const categories = {};
  let moved = 0;

  for (const [catPath, bookmarks] of Object.entries(buckets)) {
    const pathParts = catPath.split('/');
    const targetFolderId = await getOrCreateFolderPath(autoFolder.id, pathParts);

    for (const bm of bookmarks) {
      await chrome.bookmarks.move(bm.id, { parentId: targetFolderId });
      moved++;
    }
    categories[catPath] = bookmarks.length;
  }

  // Clean up empty folders everywhere (old user folders + stale Auto-Organized sub-folders)
  for (const parent of root) {
    if (!parent.children) continue;
    const freshChildren = await chrome.bookmarks.getChildren(parent.id);
    for (const child of freshChildren) {
      if (!child.url && child.id !== autoFolder.id) {
        await removeEmptyFolders(child.id);
      }
    }
  }
  // Also clean stale sub-folders inside Auto-Organized itself
  const autoChildren = await chrome.bookmarks.getChildren(autoFolder.id);
  for (const child of autoChildren) {
    if (!child.url) {
      await removeEmptyFolders(child.id);
    }
  }

  return { moved, categories };
}

/**
 * restoreBookmarks()
 *
 * Reads the saved snapshot and moves every bookmark back to its
 * original parentId + index. Recreates user folders that were
 * cleaned up if needed. Cleans up Auto-Organized after restoring.
 */
async function restoreBookmarks() {
  const { organizeSnapshot } = await chrome.storage.local.get('organizeSnapshot');
  if (!organizeSnapshot || !organizeSnapshot.bookmarks || organizeSnapshot.bookmarks.length === 0) {
    return { restored: 0 };
  }

  // Recreate any user folders that were removed during organize
  if (organizeSnapshot.userFolders) {
    for (const f of organizeSnapshot.userFolders) {
      try {
        await chrome.bookmarks.get(f.id);
      } catch {
        // Folder was deleted — recreate it at original location
        try {
          await chrome.bookmarks.create({ parentId: f.parentId, title: f.title });
        } catch { /* parent might not exist either */ }
      }
    }
  }

  // Group by parentId, sort each group by index, then restore in order
  const grouped = {};
  for (const entry of organizeSnapshot.bookmarks) {
    if (!grouped[entry.parentId]) grouped[entry.parentId] = [];
    grouped[entry.parentId].push(entry);
  }

  let restored = 0;
  for (const entries of Object.values(grouped)) {
    entries.sort((a, b) => a.index - b.index);
    for (const entry of entries) {
      try {
        // Check if the original parent still exists
        await chrome.bookmarks.get(entry.parentId);
        await chrome.bookmarks.move(entry.id, { parentId: entry.parentId, index: entry.index });
        restored++;
      } catch {
        // Bookmark or parent was manually deleted — skip
      }
    }
  }

  // Clean up Auto-Organized (recursively remove empty folders)
  const tree = await chrome.bookmarks.getTree();
  const barId = tree[0].children[0].id;
  const barChildren = await chrome.bookmarks.getChildren(barId);
  const autoFolder = barChildren.find(c => !c.url && c.title === 'Auto-Organized');
  if (autoFolder) {
    await removeEmptyFolders(autoFolder.id);
  }

  // Delete snapshot
  await chrome.storage.local.remove('organizeSnapshot');

  return { restored };
}

// ─── Quick Access history query ──────────────────────────────────────────────

/**
 * Message handler: app.js sends { action: 'getHistoryItems' } and
 * gets back an array of { url, title, weeklyCount } sorted by visit
 * count in the last 15 days.
 *
 * chrome.history is only available in the service worker, not in the
 * new-tab override page, so the query must happen here.
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // ── Quick Search: history + bookmarks ──────────────────────────────────
  if (message.action === 'search') {
    const query = (message.query || '').trim();
    if (!query) { sendResponse([]); return true; }

    const qLower = query.toLowerCase();

    // Normalize URL for deduplication: strip trailing slash, tracking params, hash
    function normalizeUrl(url) {
      try {
        const u = new URL(url);
        // Remove common tracking parameters
        const trackingParams = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
          'fbclid', 'gclid', 'ref', 'source', 'mc_cid', 'mc_eid'];
        for (const p of trackingParams) u.searchParams.delete(p);
        // Remove hash fragment
        u.hash = '';
        // Remove trailing slash (but keep root "/")
        let path = u.pathname;
        if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
        return u.origin + path + u.search;
      } catch { return url; }
    }

    Promise.all([
      chrome.history.search({ text: query, maxResults: 30 }),
      chrome.bookmarks.search(query),
    ]).then(([historyItems, bookmarkItems]) => {
      const resultMap = {};

      // Process history items
      for (const item of historyItems) {
        if (!item.url) continue;
        const key = normalizeUrl(item.url);
        if (resultMap[key]) {
          // Keep the entry with higher visitCount / more recent visit
          if ((item.visitCount || 0) > resultMap[key].visitCount) {
            resultMap[key].url = item.url;
            resultMap[key].title = item.title || resultMap[key].title;
            resultMap[key].visitCount = item.visitCount || 0;
          }
          if ((item.lastVisitTime || 0) > resultMap[key].lastVisitTime) {
            resultMap[key].lastVisitTime = item.lastVisitTime;
          }
        } else {
          resultMap[key] = {
            url: item.url,
            title: item.title || '',
            source: 'history',
            visitCount: item.visitCount || 0,
            lastVisitTime: item.lastVisitTime || 0,
          };
        }
      }

      // Process bookmark items — merge or add
      for (const item of bookmarkItems) {
        if (!item.url) continue;
        const key = normalizeUrl(item.url);
        if (resultMap[key]) {
          resultMap[key].source = resultMap[key].source === 'history' ? 'both' : resultMap[key].source;
          if (!resultMap[key].title && item.title) resultMap[key].title = item.title;
        } else {
          resultMap[key] = {
            url: item.url,
            title: item.title || '',
            source: 'bookmark',
            visitCount: 0,
            lastVisitTime: 0,
          };
        }
      }

      // Score and sort
      const now = Date.now();
      const results = Object.values(resultMap)
        .filter(r => {
          const url = r.url || '';
          return !url.startsWith('chrome://') &&
                 !url.startsWith('chrome-extension://') &&
                 !url.startsWith('about:');
        })
        .map(r => {
          let score = 0;
          const titleLower = (r.title || '').toLowerCase();
          const urlLower = (r.url || '').toLowerCase();

          if (titleLower.startsWith(qLower)) score += 100;
          else if (titleLower.includes(qLower)) score += 50;
          if (urlLower.includes(qLower)) score += 30;
          if (r.source === 'bookmark' || r.source === 'both') score += 20;
          score += Math.min(r.visitCount, 50);

          // Recency bonus: 0–20 based on last visit within 30 days
          if (r.lastVisitTime > 0) {
            const ageMs = now - r.lastVisitTime;
            const ageDays = ageMs / 86400000;
            if (ageDays < 30) score += Math.round(20 * (1 - ageDays / 30));
          }

          r.score = score;
          return r;
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, 8);

      sendResponse(results);
    }).catch(() => sendResponse([]));

    return true;
  }

  // ── Bookmark auto-organizer ─────────────────────────────────────────────
  if (message.action === 'organizeBookmarks') {
    organizeBookmarks()
      .then(result => sendResponse(result))
      .catch(() => sendResponse({ moved: 0, categories: {} }));
    return true;
  }

  // ── Restore bookmarks to pre-organize state ───────────────────────────
  if (message.action === 'restoreBookmarks') {
    restoreBookmarks()
      .then(result => sendResponse(result))
      .catch(() => sendResponse({ restored: 0 }));
    return true;
  }

  // ── Check if a restore snapshot exists ────────────────────────────────
  if (message.action === 'hasBookmarkSnapshot') {
    chrome.storage.local.get('organizeSnapshot').then(({ organizeSnapshot }) => {
      const has = !!(organizeSnapshot && organizeSnapshot.bookmarks && organizeSnapshot.bookmarks.length > 0);
      const count = has ? organizeSnapshot.bookmarks.length : 0;
      const time = has ? organizeSnapshot.timestamp : 0;
      sendResponse({ has, count, time });
    });
    return true;
  }

  if (message.action !== 'getHistoryItems') return false;

  const halfMonthAgo = Date.now() - 15 * 24 * 60 * 60 * 1000;

  chrome.history.search({ text: '', startTime: halfMonthAgo, maxResults: 500 })
    .then(async items => {
      // Pre-sort by lifetime visitCount, take top 100 for detailed counting
      items.sort((a, b) => (b.visitCount || 0) - (a.visitCount || 0));
      const top = items.slice(0, 100);

      const withCounts = await Promise.all(top.map(async item => {
        try {
          const visits = await chrome.history.getVisits({ url: item.url });
          const recentVisits = visits.filter(v => v.visitTime > halfMonthAgo);
          const weeklyCount = recentVisits.length;
          const lastVisitTime = recentVisits.length > 0
            ? Math.max(...recentVisits.map(v => v.visitTime))
            : (item.lastVisitTime || 0);
          return { url: item.url, title: item.title || '', weeklyCount, lastVisitTime };
        } catch {
          return { url: item.url, title: item.title || '', weeklyCount: item.visitCount || 0, lastVisitTime: item.lastVisitTime || 0 };
        }
      }));

      withCounts.sort((a, b) => b.weeklyCount - a.weeklyCount);
      sendResponse(withCounts);
    })
    .catch(() => sendResponse([]));

  return true; // keep the message channel open for the async response
});


// ─── Initial run ─────────────────────────────────────────────────────────────

// Run once immediately when the service worker first loads
updateBadge();
