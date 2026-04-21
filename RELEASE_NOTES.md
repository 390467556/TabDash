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
