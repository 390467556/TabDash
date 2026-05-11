# TabDash 接入指南

> 面向团队成员的快速接入文档。5 分钟内完成安装和配置。

---

## 前提条件

- Chrome 浏览器（版本 88+，支持 Manifest V3）
- Git（用于 clone 仓库）

---

## 安装步骤

### 1. 获取压缩包

从共享文件夹下载 `TabDash.zip` 并解压到本地任意目录。

### 2. 加载 Chrome 扩展

1. 打开 Chrome，地址栏输入 `chrome://extensions`
2. 右上角打开 **开发者模式**
3. 点击 **加载已解压的扩展程序**
4. 选择 `TabDash/extension/` 文件夹
5. 完成 — 打开新标签页即可看到 TabDash

### 3. 配置公司内网站点（推荐）

编辑 `extension/config.local.js`，按需修改：

```javascript
const LOCAL_QUICK_ACCESS_CATEGORIES = {
  // Jira
  'issue.swf.i.mercedes-benz.com':   'Jira',

  // Confluence
  'wiki.swf.i.mercedes-benz.com':    'Confluence',
  'mercedes-benz.atlassian.net':      'Confluence',

  // DevOps
  'git.swf.i.mercedes-benz.com':     'DevOps',
  'developer.corpinter.net':          'DevOps',

  // Tools
  'starc.i.mercedes-benz.com':       'Tools',
  'mfi.apple.com':                    'Tools',
};
```

修改后刷新新标签页即可生效（无需重新加载扩展）。

---

## 功能速查

| 操作 | 方式 |
|------|------|
| 搜索历史/书签 | 按 `/` 键，输入关键词 |
| 跳转到某个标签 | 点击标签标题 |
| 关闭标签 | 点击标签右侧 × |
| 钉住常访问页面 | 悬停卡片，点击图钉图标 |
| 取消钉住 | 再次点击图钉图标 |
| 整理书签 | 点击搜索栏旁的文件夹图标 |
| 还原书签 | 整理后出现的撤销按钮 |
| 切换主题 | 右上角太阳/月亮图标 |
| 清理过期标签 | 出现琥珀色横幅时点击 Clean up |

---

## 自定义配置详解

`config.local.js` 支持以下配置项：

### Quick Access 分类（AUTO 模式）

```javascript
const LOCAL_QUICK_ACCESS_CATEGORIES = {
  'hostname': 'Category Name',
  // ...
};
```

- 根据最近 7 天浏览历史自动提取最常访问页面
- 按配置的域名→分类映射分组展示
- 每个分类最多显示 6 个链接

### 黑名单

```javascript
const LOCAL_QUICK_ACCESS_BLACKLIST = [
  'authenticator.pingone.eu',
  'login.microsoftonline.com',
  'accounts.google.com',
];
```

- 这些域名的页面永远不会出现在 Quick Access 中
- 适合排除 SSO 登录页、认证跳转页

### 固定链接（Pin）

```javascript
const LOCAL_QUICK_ACCESS_PINNED = [
  {
    category: 'Jira',
    links: [
      { title: 'MobileToCar Dashboard', url: 'https://issue.swf.i.mercedes-benz.com/secure/Dashboard.jspa?selectPageId=2153700' },
    ]
  },
];
```

- 固定在分类顶部，不受历史记录影响

---

## 书签整理规则自定义

编辑 `extension/background.js` 中的 `WORK_URLS` 和 `CATEGORY_RULES`：

```javascript
const WORK_URLS = [
  'wiki.swf.i.mercedes-benz.com',
  'issue.swf.i.mercedes-benz.com',
  'git.swf.i.mercedes-benz.com',
];

const CATEGORY_RULES = [
  { folder: 'Work/Architecture',
    urlPatterns: WORK_URLS,
    titlePatterns: ['architecture', 'design-doc', 'SAD'] },

  { folder: 'Work/ASPICE',
    urlPatterns: WORK_URLS,
    titlePatterns: ['aspice', 'SWE', 'process'] },

  { folder: 'Work/CarPlay',
    urlPatterns: WORK_URLS,
    titlePatterns: ['carplay', 'CarPlay', 'certification'] },

  { folder: 'Development',
    urlPatterns: ['github.com', 'stackoverflow.com', 'developer.android.google.cn'] },
];
```

规则按顺序匹配，第一个命中的生效。

---

## 更新

从共享文件夹下载最新版 `TabDash.zip`，解压覆盖原目录，然后去 `chrome://extensions` 点击 TabDash 的刷新按钮。

---

## 常见问题

**Q: 安装后新标签页没变？**
A: 确认加载的是 `extension/` 文件夹（不是根目录）。检查 `chrome://extensions` 中 TabDash 是否启用。

**Q: 修改了 config.local.js 没生效？**
A: 打开新标签页时会重新读取配置。如果还是不行，去 `chrome://extensions` 点击 TabDash 的刷新图标。

**Q: 和其他新标签页扩展冲突？**
A: Chrome 只允许一个扩展覆盖新标签页。禁用其他 newtab 扩展即可。

**Q: 数据存在哪？**
A: `chrome.storage.local`，完全在本地浏览器中，不上传任何地方。卸载扩展会清除数据。

**Q: 能导出/备份数据吗？**
A: 书签数据本身在 Chrome 书签中，不受影响。"稍后阅读" 的条目存在 storage 中，24h 自动过期。

---

## 联系

- GitHub: https://github.com/390467556/TabDash
- Issues / PRs welcome
- 作者：王哲 (zhwang3)
