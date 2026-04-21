# TabDash

**Keep tabs on your tabs.**

[English](#features) | [中文](#功能)

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
- **Light / Dark mode** Apple-style frosted glass light theme, industrial dark theme, one-click toggle
- **Masonry layout** cards auto-balance across columns — big cards on one side, small cards stack on the other
- **Close tabs with style** with swoosh sound + confetti burst
- **Duplicate detection** flags when you have the same page open twice, with one-click cleanup
- **Click any tab to jump to it** across windows, no new tab opened
- **Save for later** bookmark tabs to a checklist before closing them
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

---

# TabDash 中文文档

**掌控你的标签页。**

TabDash 是一个 Chrome 扩展，用一个仪表盘替代你的新标签页，展示所有已打开的标签。标签按域名自动分组，首页类网站（Gmail、X、LinkedIn 等）会被归入独立分组。关闭标签时有音效 + 彩带动画。

无需服务器、无需注册、不调用任何外部 API。纯 Chrome 扩展。

---

## 功能

- **一览所有标签** 按域名分组的清爽卡片网格
- **首页分组** 自动将 Gmail、X、YouTube、LinkedIn、GitHub 等首页归为一组
- **常访问页面** 展示最近 15 天访问最多的 10 个页面
- **搜索栏** 同时搜索浏览历史和书签，键盘导航
- **书签自动整理** 一键将所有书签按规则分类到嵌套文件夹
- **书签还原** 基于快照的撤销，一键恢复到整理前的状态
- **明暗主题** 苹果风格毛玻璃亮色主题 / 工业风暗色主题，一键切换
- **瀑布流布局** 卡片自动平衡列宽 — 大卡片在一侧，小卡片堆叠在另一侧
- **有仪式感地关闭标签** 音效 + 彩带
- **重复检测** 标记同一页面打开了多次，一键清理
- **点击标签直接跳转** 跨窗口切换，不会打开新标签
- **稍后阅读** 关闭前先收藏到清单
- **Localhost 分组** 显示端口号，方便区分多个本地开发项目
- **可展开分组** 默认显示前 10 个标签，点击 "+N more" 展开
- **100% 本地** 数据不离开你的机器
- **纯 Chrome 扩展** 无服务器、无 Node.js、无 npm、加载即用

---

## 使用方法

### 搜索栏

在页面任意位置按 `/` 键聚焦搜索栏，或直接点击输入框。输入关键词即可同时搜索浏览历史和书签。

- **上下方向键** 在结果中导航，**回车** 打开选中项
- **Esc** 关闭搜索面板
- 结果会显示来源标签：`history`（历史）、`bookmark`（书签）或 `both`（两者）
- URL 会自动去重 — 同一页面带不同追踪参数只显示一次

### 书签自动整理

点击搜索栏旁边的 **Organize** 按钮（文件夹图标），确认后：

1. 扫描书签树中的所有书签
2. 根据 `CATEGORY_RULES` 中定义的 URL + 标题模式匹配进行分类
3. 书签被移入书签栏下 **"Auto-Organized"** 文件夹中的嵌套子文件夹
4. 移走后留下的空文件夹自动清理
5. 弹出 toast 通知显示整理了多少书签到多少个文件夹

重复运行 Organize 会重新分类所有书签，包括上次已整理过的。

#### 自定义分类规则

编辑 `extension/background.js` 中的 `WORK_URLS` 和 `CATEGORY_RULES`：

```javascript
const WORK_URLS = [
  'wiki.yourcompany.com',
  'jira.yourcompany.com',
  'git.yourcompany.com',
];

const CATEGORY_RULES = [
  // URL 必须匹配，titlePatterns 用于细分子文件夹
  { folder: '技术/架构',
    urlPatterns: WORK_URLS,
    titlePatterns: ['architecture', 'design-doc', '系统设计'] },

  { folder: '技术/CI 流水线',
    urlPatterns: [...WORK_URLS, 'jenkins.yourcompany.com'],
    titlePatterns: ['pipeline', 'cicd', '构建'] },

  // 没有 titlePatterns = 只要 URL 匹配就归类
  { folder: '开发工具',
    urlPatterns: ['github.com', 'stackoverflow.com'] },
];
```

规则按顺序匹配 — **第一个匹配的规则生效**。把更具体（带 titlePatterns）的规则放在宽泛的兜底规则之前。

### 书签还原

整理后，搜索栏旁会出现 **Restore** 按钮（撤销箭头图标）。点击即可将所有书签移回原位。按钮悬停时显示可还原的书签数量和整理时间。

- 还原时会重建整理过程中被清理的用户文件夹
- 还原后自动清理 Auto-Organized 文件夹
- 快照在使用后清除（每次整理对应一次还原机会）

### 常访问页面

最近 15 天访问次数最多的 10 个页面以卡片网格展示在顶部。点击任意卡片打开该页面。

- 鼠标悬停在卡片上点击 **x** 可以隐藏，隐藏后自动补充新卡片
- 被隐藏的 URL 跨会话记忆
- URL 经过归一化处理，同一页面不会重复出现

### 主题切换

点击右上角的 **太阳/月亮图标** 切换明暗主题，偏好设置本地保存。

---

## 安装

### 用 AI 编程助手安装

发给你的编程助手（Claude Code、Codex 等）这个仓库地址并说 **"帮我安装这个"**：

```
https://github.com/390467556/TabDash
```

### 手动安装

**1. 克隆仓库**

```bash
git clone https://github.com/390467556/TabDash.git
```

**2. 加载扩展**

1. 打开 Chrome，访问 `chrome://extensions`
2. 打开右上角的 **开发者模式**
3. 点击 **加载已解压的扩展程序**
4. 选择仓库中的 `extension/` 文件夹

**3. 打开新标签页**

你会看到 TabDash。

---

## 技术栈

| 模块 | 技术 |
|------|------|
| 扩展框架 | Chrome Manifest V3 |
| 数据存储 | chrome.storage.local |
| 历史记录 | chrome.history API |
| 书签管理 | chrome.bookmarks API（整理 / 还原） |
| 音效 | Web Audio API（合成音，无外部文件） |
| 动画 | CSS transitions + JS 彩带粒子 |
| 亮色主题 | Backdrop blur + 毛玻璃效果 |
| 布局 | CSS columns 瀑布流 + 响应式网格 |

---

## 许可证

MIT

---

作者：王哲
