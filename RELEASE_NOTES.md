# TabDash v1.2.0 Release Notes

## New Features

### Stale Tab Cleanup
- One-click cleanup of tabs you haven't viewed in a while
- Dynamic threshold based on open tab count — the more tabs you have, the shorter the threshold:
  - ≤10 tabs: no cleanup needed
  - 11–20: 24 hours
  - 21–35: 12 hours
  - 36–50: 4 hours
  - 51+: 2 hours
- Amber banner appears automatically when stale tabs are detected
- Confirm dialog shows every tab that will be closed, with last-viewed time
- Protected tabs (pinned, audible, active, TabDash) are never closed
- Stale tabs are automatically saved to "Saved for later" before closing

### Saved for Later — 24h Auto-Expiry
- Saved items now auto-expire after 24 hours to keep the list clean
- Each item shows remaining time (e.g. "23h15m left"), amber warning when < 1 hour
- Panel is now collapsed by default — click "Saved for later" toggle bar to expand
- No longer occupies a full column; sits below the open tabs section

---

# TabDash v1.1.0 Release Notes

## New Features

### Search Bar
- Global quick-search across browser history and bookmarks
- Keyboard shortcut: press `/` to focus search from anywhere
- Arrow key navigation + Enter to open results
- Relevance scoring: title match > URL match > visit frequency > recency
- URL normalization to deduplicate results (strips tracking params, hash, trailing slash)
- Source badges show whether a result comes from history, bookmarks, or both

### Bookmark Auto-Organizer
- One-click "Organize" button to categorize all bookmarks into nested folders
- Two-tier folder structure: top-level categories with topic sub-folders
- Customizable `CATEGORY_RULES` in `background.js` — match by URL patterns and/or title keywords
- URL decoding for accurate keyword matching in encoded paths
- Bookmarks are moved under an "Auto-Organized" folder in the Bookmarks Bar
- Re-running Organize re-categorizes everything (including previously organized bookmarks)
- Automatic cleanup of empty folders after organizing

### Bookmark Restore
- "Restore" button appears after organizing — one click to undo
- Snapshot-based: saves every bookmark's original `parentId` and `index`
- Recreates user folders that were cleaned up during organize
- Cleans up the Auto-Organized folder after restoring

### Quick Access Improvements
- URL normalization for deduplication: multiple URLs pointing to the same page are collapsed
- Backfill after dismissing a card no longer introduces duplicates

## Changes

### Permissions
- Added `bookmarks` permission to `manifest.json` (required for the auto-organizer)

### UI
- Organize and Restore buttons integrated into the search bar area
- Industrial theme styling with silver (organize) and amber (restore) accents
- Light/dark theme support for both buttons

## Customization

The bookmark organizer uses `WORK_URLS` and `CATEGORY_RULES` arrays in `background.js`.
Edit these to match your own internal domains and project keywords:

```javascript
const WORK_URLS = [
  'wiki.example.com',
  'jira.example.com',
  // ...
];

const CATEGORY_RULES = [
  { folder: 'Engineering/Architecture',
    urlPatterns: WORK_URLS,
    titlePatterns: ['architecture', 'design-doc'] },
  // ...
];
```
