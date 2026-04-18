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
