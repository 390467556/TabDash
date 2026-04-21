# TabDash

**Keep tabs on your tabs.**

English | [中文](README_CN.md)

TabDash is a Chrome extension that replaces your new tab page with a dashboard of everything you have open. Tabs are grouped by domain, with homepages (Gmail, X, LinkedIn, etc.) pulled into their own group. Close tabs with a satisfying swoosh + confetti.

No server. No account. No external API calls. Just a Chrome extension.

---

## Features

- **See all your tabs at a glance** on a clean grid, grouped by domain
- **Homepages group** pulls Gmail inbox, X home, YouTube, LinkedIn, GitHub homepages into one card
- **Frequently visited** shows your top 10 most-visited pages from the last 15 days
- **Search bar** quick-search across browser history & bookmarks with keyboard navigation
- **Bookmark auto-organizer** one-click categorization of all bookmarks into nested folders
- **Bookmark restore** snapshot-based undo to revert organized bookmarks to their original locations
- **Stale tab cleanup** one-click cleanup of long-untouched tabs with dynamic threshold, auto-saved before closing
- **Save for later** with 24h auto-expiry — collapsed panel, click to expand, items expire automatically
- **Light / Dark mode** Apple-style frosted glass light theme, industrial dark theme, one-click toggle
- **Masonry layout** cards auto-balance across columns — big cards on one side, small cards stack on the other
- **Close tabs with style** with swoosh sound + confetti burst
- **Duplicate detection** flags when you have the same page open twice, with one-click cleanup
- **Click any tab to jump to it** across windows, no new tab opened
- **Localhost grouping** shows port numbers next to each tab so you can tell your vibe coding projects apart
- **Expandable groups** show the first 10 tabs with a clickable "+N more"
- **100% local** your data never leaves your machine
- **Pure Chrome extension** no server, no Node.js, no npm, no setup beyond loading the extension

---

## Usage

### Search Bar

Press `/` anywhere on the page to focus the search bar, or click into it directly. Type a keyword to search across your browser history and bookmarks simultaneously.

- **Arrow keys** to navigate results, **Enter** to open
- **Esc** to close the search panel
- Results show a source badge: `history`, `bookmark`, or `both`
- URLs are deduplicated — the same page with different tracking params appears only once

### Bookmark Auto-Organizer

Click the **Organize** button (folder icon) next to the search bar. A confirmation dialog will appear. After confirming:

1. All bookmarks across your entire bookmark tree are scanned
2. Each bookmark is categorized by URL + title pattern matching against `CATEGORY_RULES`
3. Bookmarks are moved into nested folders under **"Auto-Organized"** in the Bookmarks Bar
4. Empty folders left behind are automatically cleaned up
5. A toast notification shows how many bookmarks were organized into how many folders

Re-running Organize re-categorizes everything, including bookmarks from a previous run.

#### Customizing Categories

Edit `WORK_URLS` and `CATEGORY_RULES` in `extension/background.js` to match your own domains and keywords:

```javascript
const WORK_URLS = [
  'wiki.yourcompany.com',
  'jira.yourcompany.com',
  'git.yourcompany.com',
];

const CATEGORY_RULES = [
  // URL must match, then title keywords (if given) refine the sub-folder
  { folder: 'Engineering/Architecture',
    urlPatterns: WORK_URLS,
    titlePatterns: ['architecture', 'design-doc', 'system design'] },

  { folder: 'Engineering/CI & Pipeline',
    urlPatterns: [...WORK_URLS, 'jenkins.yourcompany.com'],
    titlePatterns: ['pipeline', 'cicd', 'build'] },

  // No titlePatterns = URL match alone is enough
  { folder: 'Development',
    urlPatterns: ['github.com', 'stackoverflow.com'] },
];
```

Rules are evaluated in order — **first match wins**. Put more specific (title-gated) rules before broader catch-all rules.

### Bookmark Restore

After organizing, a **Restore** button (undo arrow icon) appears next to the Organize button. Click it to move all bookmarks back to their original locations. The button shows a tooltip with how many bookmarks can be restored and when they were organized.

- Restore recreates any user folders that were removed during organizing
- The Auto-Organized folder is cleaned up after restoring
- The restore snapshot is cleared after use (one undo per organize run)

### Stale Tab Cleanup

When you have many open tabs, TabDash detects tabs you haven't viewed in a while and shows an amber banner. Click **Clean up** to close them — they're automatically saved to "Saved for later" first.

The threshold is dynamic based on how many tabs you have open:

| Open tabs | Threshold |
|-----------|-----------|
| ≤10 | No cleanup (too few tabs) |
| 11–20 | 24 hours |
| 21–35 | 12 hours |
| 36–50 | 4 hours |
| 51+ | 2 hours |

Protected tabs are never closed: pinned tabs, tabs playing audio, the active tab, and TabDash itself.

The confirm dialog lists every tab that will be closed with its last-viewed time, so you can review before confirming.

### Saved for Later

Tabs saved for later (manually or via stale tab cleanup) appear in a collapsible panel below the open tabs section. Click the **"Saved for later"** toggle bar to expand/collapse.

- Items auto-expire after **24 hours** — each item shows remaining time
- Expiry label turns amber when less than 1 hour remains
- Check off items to archive them; click **x** to dismiss immediately

### Frequently Visited

The top 10 most-visited pages from the last 15 days appear in a grid at the top. Click any card to open that page.

- Hover over a card and click **x** to dismiss it — a replacement is backfilled automatically
- Dismissed URLs are remembered across sessions
- URLs are normalized to prevent the same page from showing up as multiple cards

### Theme Toggle

Click the **sun/moon icon** in the top-right corner to switch between dark and light mode. Your preference is saved locally.

---

## Install with a coding agent

Send your coding agent (Claude Code, Codex, etc.) this repo and say **"install this"**:

```
https://github.com/390467556/TabDash
```

The agent will walk you through it.

---

## Manual Setup

**1. Clone the repo**

```bash
git clone https://github.com/390467556/TabDash.git
```

**2. Load the Chrome extension**

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Navigate to the `extension/` folder inside the cloned repo and select it

**3. Open a new tab**

You'll see TabDash.

---

## How it works

```
You open a new tab
  -> TabDash shows your open tabs grouped by domain
  -> Homepages (Gmail, X, etc.) get their own group at the top
  -> Frequently visited pages shown at the top for quick access
  -> Press "/" to search history & bookmarks
  -> Click "Organize" to auto-sort bookmarks into folders
  -> Click any tab title to jump to it
  -> Close groups you're done with (swoosh + confetti)
  -> Save tabs for later before closing them
  -> Toggle light/dark mode with the sun/moon button
```

Everything runs inside the Chrome extension. No external server, no API calls, no data sent anywhere. Saved tabs are stored in `chrome.storage.local`.

---

## Tech stack

| What | How |
|------|-----|
| Extension | Chrome Manifest V3 |
| Storage | chrome.storage.local |
| History | chrome.history API (top visited pages) |
| Bookmarks | chrome.bookmarks API (organize / restore) |
| Sound | Web Audio API (synthesized, no files) |
| Animations | CSS transitions + JS confetti particles |
| Light theme | Backdrop blur + frosted glass (Apple-style) |
| Layout | CSS columns masonry + responsive grid |

---

## License

MIT

---

Built by 王哲
