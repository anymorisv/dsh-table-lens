window.__ModuleLoader__.load({
  id: 'dsh-table-lens',
  factory(require) {
    'use strict';

    /* ================================================================== */
    /* dsh-table-lens —— 表格放大镜                                        */
    /*                                                                     */
    /* 聊天里 / 文档预览里的 Markdown 表格：                                */
    /*   1) 本体加上好读的边框、斑马纹、悬停高亮，一眼看出“这是张表”；      */
    /*   2) 点一下表格 → 弹出大表格：点表头排序、输入关键词筛选、          */
    /*      冻结首列、切换紧凑/宽松、复制 TSV、导出 CSV。                   */
    /* 全程不改写聊天区域的 DOM（不包 wrapper、不搬节点），只在 document    */
    /* 上挂一个捕获阶段的 click，所以不会和 React 抢孩子。                  */
    /* ================================================================== */

    const STYLE_ID = 'dsh-table-lens-style';
    const HOST_ID = 'dsh-table-lens-host';

    let styleEl = null;
    let hostEl = null;
    let shadow = null;
    let overlay = null;
    let nodes = null;
    let mounted = false;

    /** 当前打开状态的上下文；null 表示放大层关着。 */
    let view = null;

    /* ------------------------------------------------------------------ */
    /* 1. 聊天区表格样式（作用在真实页面上）                               */
    /* ------------------------------------------------------------------ */

    const CHAT_CSS = `
      /* 只挑“有表头的真表格”，不碰代码块/布局用的 table */
      table:has(> thead) {
        width: 100%;
        border-collapse: separate;
        border-spacing: 0;
        font-size: 13px;
        line-height: 1.55;
        color: inherit;
        border: 1px solid rgba(127, 127, 127, .28);
        border: 1px solid color-mix(in srgb, currentColor 16%, transparent);
        border-radius: 10px;
        overflow: hidden;
        cursor: zoom-in;
        margin: 10px 0;
        outline: 2px solid transparent;
        outline-offset: 2px;
        transition: box-shadow .15s ease, outline-color .15s ease;
      }
      table:has(> thead):hover {
        outline-color: rgba(59, 130, 246, .45);
        box-shadow: 0 3px 14px rgba(15, 23, 42, .08);
      }

      table:has(> thead) > thead th {
        background: rgba(127, 127, 127, .10);
        background: color-mix(in srgb, currentColor 8%, transparent);
        font-weight: 600;
        text-align: left;
        white-space: nowrap;
        padding: 8px 12px;
        vertical-align: bottom;
        border-bottom: 1px solid rgba(127, 127, 127, .30);
        border-bottom: 1px solid color-mix(in srgb, currentColor 18%, transparent);
      }

      table:has(> thead) > tbody td {
        padding: 7px 12px;
        vertical-align: top;
        border-top: 1px solid rgba(127, 127, 127, .18);
        border-top: 1px solid color-mix(in srgb, currentColor 10%, transparent);
        overflow-wrap: anywhere;
      }
      table:has(> thead) > tbody tr:first-child td { border-top: 0; }
      table:has(> thead) > tbody tr:nth-child(even) td {
        background: rgba(127, 127, 127, .04);
        background: color-mix(in srgb, currentColor 3.5%, transparent);
      }
      table:has(> thead) > tbody tr:hover td {
        background: rgba(59, 130, 246, .09);
        background: color-mix(in srgb, #3b82f6 10%, transparent);
      }

      /* 竖向分隔线：列多的时候更容易对齐 */
      table:has(> thead) > thead th:not(:last-child),
      table:has(> thead) > tbody td:not(:last-child) {
        border-right: 1px solid rgba(127, 127, 127, .16);
        border-right: 1px solid color-mix(in srgb, currentColor 9%, transparent);
      }

      /* 单元格里的行内代码不要撑爆列宽 */
      table:has(> thead) > tbody td code {
        white-space: nowrap;
      }
    `;

    /* ------------------------------------------------------------------ */
    /* 2. 放大层样式（作用在 shadow root 里，和宿主 CSS 完全隔离）         */
    /* ------------------------------------------------------------------ */

    const LENS_CSS = `
      :host { all: initial; }
      * { box-sizing: border-box; }

      .overlay {
        --bg: #ffffff;
        --fg: #16181d;
        --muted: #6b7280;
        --line: rgba(15, 23, 42, .12);
        --line-strong: rgba(15, 23, 42, .22);
        --head: #f4f6f9;
        --zebra: #fafbfc;
        --hover: #eef4ff;
        --chip: #f2f4f7;
        --accent: #2563eb;
        --shadow: 0 24px 64px rgba(15, 23, 42, .28);

        position: fixed;
        inset: 0;
        z-index: 2147483000;
        pointer-events: auto;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 3.2vh 2.6vw;
        background: rgba(12, 16, 24, .46);
        backdrop-filter: blur(3px);
        font-family: "PingFang SC", "Microsoft YaHei", "Segoe UI", system-ui, -apple-system, sans-serif;
        font-size: 13px;
        color: var(--fg);
        animation: fade .12s ease-out;
      }
      .overlay[hidden] { display: none !important; }
      .overlay[data-theme="dark"] {
        --bg: #171a1f;
        --fg: #e7eaf0;
        --muted: #9aa3b2;
        --line: rgba(255, 255, 255, .10);
        --line-strong: rgba(255, 255, 255, .20);
        --head: #1f242b;
        --zebra: #1b1f25;
        --hover: #22304a;
        --chip: #23272e;
        --accent: #60a5fa;
        --shadow: 0 24px 64px rgba(0, 0, 0, .55);
      }
      @keyframes fade { from { opacity: 0 } to { opacity: 1 } }
      @keyframes pop { from { opacity: 0; transform: translateY(8px) scale(.99) } to { opacity: 1; transform: none } }

      .panel {
        width: min(1220px, 96vw);
        max-height: 90vh;
        display: flex;
        flex-direction: column;
        background: var(--bg);
        border: 1px solid var(--line);
        border-radius: 14px;
        box-shadow: var(--shadow);
        overflow: hidden;
        animation: pop .16s ease-out;
      }

      header.head {
        display: flex;
        align-items: flex-start;
        gap: 14px;
        padding: 14px 18px 12px;
        border-bottom: 1px solid var(--line);
      }
      .titles { min-width: 0; flex: 1; }
      .title {
        font-size: 15.5px;
        font-weight: 650;
        line-height: 1.35;
        letter-spacing: .1px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .sub { margin-top: 3px; font-size: 12px; color: var(--muted); }

      .icon-btn {
        flex: none;
        width: 30px;
        height: 30px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: 1px solid var(--line);
        border-radius: 8px;
        background: var(--chip);
        color: var(--muted);
        font-size: 15px;
        line-height: 1;
        cursor: pointer;
      }
      .icon-btn:hover { color: var(--fg); border-color: var(--line-strong); }

      .tools {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
        padding: 10px 18px;
        border-bottom: 1px solid var(--line);
        background: var(--chip);
      }
      .search-wrap {
        position: relative;
        flex: 1 1 260px;
        max-width: 430px;
        display: flex;
        align-items: center;
      }
      .search-wrap svg { position: absolute; left: 9px; width: 14px; height: 14px; color: var(--muted); pointer-events: none; }
      input.filter {
        width: 100%;
        height: 32px;
        padding: 0 30px 0 29px;
        border: 1px solid var(--line-strong);
        border-radius: 8px;
        background: var(--bg);
        color: var(--fg);
        font: inherit;
        font-size: 13px;
        outline: none;
      }
      input.filter:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(37, 99, 235, .16); }
      input.filter::-webkit-search-cancel-button { display: none; }
      .clear-filter {
        position: absolute;
        right: 6px;
        width: 20px;
        height: 20px;
        display: none;
        align-items: center;
        justify-content: center;
        border: 0;
        border-radius: 50%;
        background: transparent;
        color: var(--muted);
        cursor: pointer;
        font-size: 13px;
      }
      .has-value .clear-filter { display: inline-flex; }
      .clear-filter:hover { background: var(--chip); color: var(--fg); }

      .spacer { flex: 1 1 auto; }

      .btn {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        height: 32px;
        padding: 0 11px;
        border: 1px solid var(--line-strong);
        border-radius: 8px;
        background: var(--bg);
        color: var(--fg);
        font: inherit;
        font-size: 12.5px;
        cursor: pointer;
        white-space: nowrap;
      }
      .btn:hover { border-color: var(--accent); color: var(--accent); }
      .btn[aria-pressed="true"] {
        background: rgba(37, 99, 235, .10);
        border-color: var(--accent);
        color: var(--accent);
        font-weight: 600;
      }
      .btn.ghost { border-color: transparent; color: var(--muted); }
      .btn.ghost:hover { color: var(--fg); border-color: var(--line-strong); }

      .body { position: relative; flex: 0 1 auto; min-height: 0; overflow: hidden; }
      .body.is-empty { display: flex; align-items: center; justify-content: center; min-height: 180px; }
      .body.is-empty .scroller { display: none; }
      .scroller { max-height: calc(90vh - 196px); overflow: auto; overscroll-behavior: contain; }

      table {
        border-collapse: separate;
        border-spacing: 0;
        width: 100%;
        font-size: 13px;
        line-height: 1.55;
      }
      thead th {
        position: sticky;
        top: 0;
        z-index: 3;
        background: var(--head);
        text-align: left;
        font-weight: 650;
        padding: 9px 14px;
        white-space: nowrap;
        vertical-align: bottom;
        border-bottom: 1px solid var(--line-strong);
        border-right: 1px solid var(--line);
        cursor: pointer;
        user-select: none;
      }
      thead th:last-child { border-right: 0; }
      thead th:hover { background: var(--hover); }
      thead th .arrow { margin-left: 5px; font-size: 10px; opacity: .35; }
      thead th[data-sort] .arrow { opacity: 1; color: var(--accent); }

      tbody td {
        padding: 8px 14px;
        vertical-align: top;
        border-bottom: 1px solid var(--line);
        border-right: 1px solid var(--line);
        max-width: 46ch;
        overflow-wrap: anywhere;
      }
      tbody td:last-child { border-right: 0; }
      tbody tr:nth-child(odd) td { background: var(--bg); }
      tbody tr:nth-child(even) td { background: var(--zebra); }
      tbody tr:hover td { background: var(--hover); }

      td > :first-child { margin-top: 0; }
      td > :last-child { margin-bottom: 0; }
      td code {
        font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
        font-size: 12px;
        padding: 1px 4px;
        border-radius: 4px;
        background: var(--chip);
      }
      td a { color: var(--accent); text-decoration: none; }
      td a:hover { text-decoration: underline; }

      /* 冻结首列 */
      .freeze thead th:first-child { left: 0; z-index: 5; box-shadow: 1px 0 0 var(--line-strong); }
      .freeze tbody td:first-child {
        position: sticky;
        left: 0;
        z-index: 2;
        box-shadow: 1px 0 0 var(--line-strong);
      }

      /* 紧凑 */
      .dense tbody td { padding: 4px 10px; }
      .dense thead th { padding: 6px 10px; }
      .dense table, table.dense { font-size: 12.5px; }

      .empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 28px 16px;
        color: var(--muted);
        font-size: 13px;
      }
      .empty[hidden] { display: none !important; }
      .empty b { color: var(--fg); font-size: 14px; }

      footer.foot {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 8px 18px;
        border-top: 1px solid var(--line);
        color: var(--muted);
        font-size: 12px;
        background: var(--chip);
      }
      footer.foot .count b { color: var(--fg); font-weight: 600; }
      footer.foot .tip { margin-left: auto; }
      kbd {
        font: inherit;
        font-size: 11px;
        padding: 1px 5px;
        border: 1px solid var(--line-strong);
        border-bottom-width: 2px;
        border-radius: 4px;
        background: var(--bg);
      }
    `;

    /* ------------------------------------------------------------------ */
    /* 3. 小工具                                                          */
    /* ------------------------------------------------------------------ */

    function textOf(cell) {
      const raw = cell.innerText !== undefined ? cell.innerText : cell.textContent;
      return String(raw || '').replace(/\s+/g, ' ').trim();
    }

    function clamp(value, min, max) {
      return Math.min(max, Math.max(min, value));
    }

    /** 数字列排序用：容忍千分位、货币符号、百分号、单位后缀（如 12kg → 12）。 */
    function asNumber(text) {
      if (!text) return null;
      const cleaned = String(text)
        .replace(/[,，\s]/g, '')
        .replace(/^[¥$€£]/, '')
        .replace(/%$/, '')
        .replace(/^(-?\d+(?:\.\d+)?)[a-zA-Z\u4e00-\u9fa5]+$/, '$1');
      if (!/^-?\d+(?:\.\d+)?$/.test(cleaned)) return null;
      const value = Number(cleaned);
      return Number.isFinite(value) ? value : null;
    }

    function compareText(a, b) {
      return String(a).localeCompare(String(b), 'zh-Hans-CN', { numeric: true, sensitivity: 'base' });
    }

    /** 单元格网格填充：处理 colspan / rowspan（Markdown 一般没有，但别崩）。 */
    function fillGrid(rowEls) {
      const grid = [];
      const taken = [];
      for (let r = 0; r < rowEls.length; r += 1) {
        const cells = Array.from(rowEls[r].cells || []);
        if (!grid[r]) grid[r] = [];
        if (!taken[r]) taken[r] = [];
        let c = 0;
        for (const cell of cells) {
          while (taken[r][c]) c += 1;
          const colSpan = clamp(Number(cell.colSpan) || 1, 1, 64);
          const rowSpan = clamp(Number(cell.rowSpan) || 1, 1, 512);
          const text = textOf(cell);
          for (let i = 0; i < rowSpan; i += 1) {
            const rr = r + i;
            if (!grid[rr]) grid[rr] = [];
            if (!taken[rr]) taken[rr] = [];
            for (let j = 0; j < colSpan; j += 1) {
              const cc = c + j;
              taken[rr][cc] = true;
              grid[rr][cc] = i === 0 && j === 0
                ? { text, html: cell.innerHTML, origin: true }
                : { text: '', html: '', origin: false };
            }
          }
          c += colSpan;
        }
      }
      return grid;
    }

    /** 从真实 <table> 里读出表头 + 数据行（只读，不改原表）。 */
    function buildModel(table) {
      const headRows = table.tHead ? Array.from(table.tHead.rows) : [];
      const bodyRows = [];
      for (const section of Array.from(table.tBodies || [])) {
        for (const row of Array.from(section.rows)) bodyRows.push(row);
      }
      if (!table.tHead) {
        // 没有 thead 就把第一行当表头（Markdown 表格一定有 thead，这里只是兜底）
        const loose = Array.from(table.rows).filter((row) => !row.parentElement || row.parentElement.tagName !== 'THEAD');
        const first = loose.shift();
        if (first) headRows.push(first);
        for (const row of loose) if (bodyRows.indexOf(row) === -1) bodyRows.push(row);
      }
      if (!headRows.length) return null;

      const grid = fillGrid(headRows.concat(bodyRows));
      const headCount = headRows.length;

      let colCount = 0;
      for (const row of grid) colCount = Math.max(colCount, row ? row.length : 0);
      if (colCount === 0) return null;

      const headers = [];
      for (let c = 0; c < colCount; c += 1) {
        const parts = [];
        for (let r = 0; r < headCount; r += 1) {
          const cell = grid[r] && grid[r][c];
          if (cell && cell.origin && cell.text) parts.push(cell.text);
        }
        headers.push(parts.join(' / ') || '第 ' + (c + 1) + ' 列');
      }

      const rows = [];
      for (let r = headCount; r < grid.length; r += 1) {
        const line = grid[r] || [];
        const cells = [];
        let empty = true;
        for (let c = 0; c < colCount; c += 1) {
          const cell = line[c] || { text: '', html: '' };
          if (cell.text) empty = false;
          cells.push({ text: cell.text, html: cell.html, lower: cell.text.toLowerCase() });
        }
        if (empty) continue; // 全空的填充行不要
        rows.push({ index: rows.length, cells });
      }

      return { headers, rows, colCount };
    }

    /** 猜标题：往上找最近的小标题（h1~h6），找不到就用“表格”。 */
    function guessTitle(table) {
      let node = table;
      for (let depth = 0; depth < 6 && node; depth += 1) {
        let sibling = node.previousElementSibling;
        while (sibling) {
          if (/^H[1-6]$/.test(sibling.tagName)) {
            const text = String(sibling.textContent || '').trim();
            if (text) return text.slice(0, 120);
          }
          const heading = sibling.querySelector && sibling.querySelector('h1,h2,h3,h4,h5,h6');
          if (heading) {
            const text = String(heading.textContent || '').trim();
            if (text) return text.slice(0, 120);
          }
          sibling = sibling.previousElementSibling;
        }
        node = node.parentElement;
      }
      return '表格';
    }

    /** 页面是深色还是浅色：直接看 body 背景亮度，比 prefers-color-scheme 准。 */
    function detectTheme() {
      try {
        const bg = getComputedStyle(document.body).backgroundColor || '';
        const match = /rgba?\(([^)]+)\)/.exec(bg);
        if (!match) return 'light';
        const parts = match[1].split(',').map((value) => parseFloat(value));
        const alpha = parts.length > 3 ? parts[3] : 1;
        if (alpha === 0) return 'light';
        const luminance = (parts[0] * 0.299 + parts[1] * 0.587 + parts[2] * 0.114) / 255;
        return luminance < 0.45 ? 'dark' : 'light';
      } catch (error) {
        return 'light';
      }
    }

    function downloadText(filename, text) {
      const blob = new Blob(['\uFEFF' + text], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    }

    function quoteCsv(value) {
      const text = String(value == null ? '' : value);
      return /[",\n\r]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
    }

    async function copyText(text) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (error) {
        try {
          const area = document.createElement('textarea');
          area.value = text;
          area.style.position = 'fixed';
          area.style.opacity = '0';
          document.body.appendChild(area);
          area.select();
          const ok = document.execCommand('copy');
          area.remove();
          return ok;
        } catch (inner) {
          return false;
        }
      }
    }

    /* ------------------------------------------------------------------ */
    /* 4. 放大层                                                          */
    /* ------------------------------------------------------------------ */

    function el(tag, attrs, children) {
      const node = document.createElement(tag);
      if (attrs) {
        for (const [key, value] of Object.entries(attrs)) {
          if (value == null || value === false) continue;
          if (key === 'class') node.className = value;
          else if (key === 'html') node.innerHTML = value;
          else if (key === 'text') node.textContent = value;
          else if (key.slice(0, 2) === 'on' && typeof value === 'function') node.addEventListener(key.slice(2), value);
          else node.setAttribute(key, value === true ? '' : String(value));
        }
      }
      for (const child of children || []) {
        if (child == null) continue;
        node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
      }
      return node;
    }

    const ICON_SEARCH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.6 15.6 21 21"/></svg>';

    function buildOverlay() {
      const searchInput = el('input', { class: 'filter', type: 'search', placeholder: '筛选：输入关键词，空格分词表示同时满足' });
      const clearBtn = el('button', { class: 'clear-filter', type: 'button', title: '清空筛选', text: '✕' });

      const tableEl = el('table');
      const countEl = el('span', { class: 'count' });
      const emptyEl = el('div', { class: 'empty' }, [
        el('b', { text: '没有匹配的行' }),
        el('span', { text: '换个关键词试试，或点「重置」' }),
      ]);
      const scroller = el('div', { class: 'scroller' }, [tableEl]);
      const bodyEl = el('div', { class: 'body' }, [scroller, emptyEl]);

      overlay = el('div', { class: 'overlay', role: 'dialog', 'aria-modal': 'true' }, [
        el('section', { class: 'panel' }, [
          el('header', { class: 'head' }, [
            el('div', { class: 'titles' }, [
              el('div', { class: 'title', text: '表格' }),
              el('div', { class: 'sub' }),
            ]),
            el('button', { class: 'icon-btn', type: 'button', title: '关闭（Esc）', text: '✕', onclick: close }),
          ]),
          el('div', { class: 'tools' }, [
            el('div', { class: 'search-wrap', html: ICON_SEARCH }, [searchInput, clearBtn]),
            el('div', { class: 'spacer' }),
            el('button', { class: 'btn', type: 'button', 'data-act': 'freeze', 'aria-pressed': 'true', text: '冻结首列', onclick: () => toggleFlag('freeze') }),
            el('button', { class: 'btn', type: 'button', 'data-act': 'dense', 'aria-pressed': 'false', text: '紧凑', onclick: () => toggleFlag('dense') }),
            el('button', { class: 'btn', type: 'button', 'data-act': 'copy', text: '复制 TSV', onclick: () => copyRows() }),
            el('button', { class: 'btn', type: 'button', 'data-act': 'csv', text: '导出 CSV', onclick: () => exportCsv() }),
            el('button', { class: 'btn ghost', type: 'button', 'data-act': 'reset', text: '重置', onclick: reset }),
          ]),
          bodyEl,
          el('footer', { class: 'foot' }, [
            countEl,
            el('span', { class: 'tip', html: '点表头排序（升 → 降 → 还原）· <kbd>Esc</kbd> 关闭 · <kbd>/</kbd> 搜索' }),
          ]),
        ]),
      ]);

      overlay.addEventListener('mousedown', (event) => {
        if (event.target === overlay) close();
      });
      searchInput.addEventListener('input', () => {
        if (!view) return;
        view.filter = searchInput.value;
        nodes.searchWrap.classList.toggle('has-value', Boolean(searchInput.value));
        render();
      });
      clearBtn.addEventListener('click', () => {
        if (!view) return;
        searchInput.value = '';
        view.filter = '';
        nodes.searchWrap.classList.remove('has-value');
        searchInput.focus();
        render();
      });
      overlay.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      });

      overlay.hidden = true;
      shadow.appendChild(overlay);
      nodes = {
        overlay,
        panel: overlay.querySelector('.panel'),
        searchWrap: overlay.querySelector('.search-wrap'),
        searchInput,
        body: bodyEl,
        tableEl,
        emptyEl,
        countEl,
        scroller,
        titleEl: overlay.querySelector('.title'),
        subEl: overlay.querySelector('.sub'),
      };
    }

    function ensureOverlay() {
      if (hostEl && hostEl.isConnected && shadow && overlay) return;
      hostEl = document.getElementById(HOST_ID);
      if (!hostEl) {
        hostEl = document.createElement('div');
        hostEl.id = HOST_ID;
        hostEl.style.cssText = 'position:fixed;inset:0;z-index:2147483000;pointer-events:none;';
        document.body.appendChild(hostEl);
      }
      if (!hostEl.shadowRoot) hostEl.attachShadow({ mode: 'open' });
      shadow = hostEl.shadowRoot;
      if (!shadow.querySelector('style')) {
        const style = document.createElement('style');
        style.textContent = LENS_CSS;
        shadow.appendChild(style);
      }
      if (!shadow.querySelector('.overlay')) buildOverlay();
      if (!overlay || !overlay.isConnected) {
        overlay = shadow.querySelector('.overlay');
      }
    }

    function toggleFlag(name) {
      if (!view) return;
      view[name] = !view[name];
      const btn = nodes.overlay.querySelector('[data-act="' + name + '"]');
      if (btn) btn.setAttribute('aria-pressed', view[name] ? 'true' : 'false');
      render();
    }

    function reset() {
      if (!view) return;
      view.filter = '';
      view.sort = null;
      view.dense = false;
      view.freeze = view.model.colCount > 1;
      nodes.searchInput.value = '';
      nodes.searchWrap.classList.remove('has-value');
      for (const name of ['freeze', 'dense']) {
        const btn = nodes.overlay.querySelector('[data-act="' + name + '"]');
        if (btn) btn.setAttribute('aria-pressed', view[name] ? 'true' : 'false');
      }
      render();
    }

    function visibleRows() {
      if (!view) return [];
      const tokens = String(view.filter || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
      let rows = view.model.rows;
      if (tokens.length) {
        rows = rows.filter((row) => tokens.every((token) => row.cells.some((cell) => cell.lower.indexOf(token) !== -1)));
      }
      if (view.sort) {
        const column = view.sort.column;
        const dir = view.sort.dir;
        const decorated = rows.map((row) => ({ row, value: row.cells[column] ? row.cells[column].text : '' }));
        decorated.sort((a, b) => {
          const na = asNumber(a.value);
          const nb = asNumber(b.value);
          let result;
          if (na !== null && nb !== null) result = na - nb;
          else result = compareText(a.value, b.value);
          if (result === 0) result = a.row.index - b.row.index;
          return result * dir;
        });
        rows = decorated.map((item) => item.row);
      }
      return rows;
    }

    function render() {
      if (!view || !nodes) return;
      const model = view.model;
      const rows = visibleRows();

      nodes.overlay.classList.toggle('freeze', Boolean(view.freeze));
      nodes.tableEl.classList.toggle('dense', Boolean(view.dense));

      // 表头
      const thead = document.createElement('thead');
      const headRow = document.createElement('tr');
      model.headers.forEach((label, index) => {
        const sorted = view.sort && view.sort.column === index ? view.sort.dir : 0;
        const th = document.createElement('th');
        th.setAttribute('scope', 'col');
        th.title = label;
        th.appendChild(document.createTextNode(label));
        const arrow = document.createElement('span');
        arrow.className = 'arrow';
        arrow.textContent = sorted === 1 ? '▲' : sorted === -1 ? '▼' : '↕';
        th.appendChild(arrow);
        if (sorted) th.setAttribute('data-sort', String(sorted));
        th.addEventListener('click', () => {
          if (!view) return;
          const current = view.sort && view.sort.column === index ? view.sort.dir : 0;
          if (current === 0) view.sort = { column: index, dir: 1 };
          else if (current === 1) view.sort = { column: index, dir: -1 };
          else view.sort = null;
          render();
        });
        headRow.appendChild(th);
      });
      thead.appendChild(headRow);

      // 数据行
      const tbody = document.createElement('tbody');
      const fragment = document.createDocumentFragment();
      for (const row of rows) {
        const tr = document.createElement('tr');
        for (let c = 0; c < model.colCount; c += 1) {
          const cell = row.cells[c];
          const td = document.createElement('td');
          td.innerHTML = cell && cell.html ? cell.html : '';
          tr.appendChild(td);
        }
        fragment.appendChild(tr);
      }
      tbody.appendChild(fragment);

      nodes.tableEl.textContent = '';
      nodes.tableEl.appendChild(thead);
      nodes.tableEl.appendChild(tbody);

      nodes.emptyEl.hidden = rows.length > 0;
      nodes.body.classList.toggle('is-empty', rows.length === 0);
      nodes.countEl.innerHTML = '显示 <b>' + rows.length + '</b> / ' + model.rows.length + ' 行 · ' + model.colCount + ' 列';
      nodes.subEl.textContent = '共 ' + model.rows.length + ' 行 × ' + model.colCount + ' 列';
    }

    function tsvOf(rows) {
      const headers = view.model.headers;
      const lines = [headers.join('\t')];
      for (const row of rows) {
        lines.push(headers.map((_label, index) => String(row.cells[index] ? row.cells[index].text : '').replace(/\s*\t\s*/g, ' ')).join('\t'));
      }
      return lines.join('\n');
    }

    async function copyRows() {
      if (!view) return;
      const rows = visibleRows();
      const ok = await copyText(tsvOf(rows));
      const btn = nodes.overlay.querySelector('[data-act="copy"]');
      if (!btn) return;
      btn.textContent = ok ? '已复制 ' + rows.length + ' 行' : '复制失败';
      setTimeout(() => { btn.textContent = '复制 TSV'; }, 1400);
    }

    function exportCsv() {
      if (!view) return;
      const rows = visibleRows();
      const headers = view.model.headers;
      const lines = [headers.map(quoteCsv).join(',')];
      for (const row of rows) {
        lines.push(headers.map((_label, index) => quoteCsv(row.cells[index] ? row.cells[index].text : '')).join(','));
      }
      const stamp = new Date();
      const pad = (value) => String(value).padStart(2, '0');
      const name = '表格-' + stamp.getFullYear() + pad(stamp.getMonth() + 1) + pad(stamp.getDate()) + '-' + pad(stamp.getHours()) + pad(stamp.getMinutes()) + '.csv';
      downloadText(name, lines.join('\r\n'));
    }

    /* ------------------------------------------------------------------ */
    /* 5. 打开 / 关闭                                                      */
    /* ------------------------------------------------------------------ */

    function open(table) {
      const model = buildModel(table);
      if (!model || !model.rows.length) return;
      ensureOverlay();

      view = {
        model,
        filter: '',
        sort: null,
        freeze: model.colCount > 1,
        dense: false,
      };

      overlay.setAttribute('data-theme', detectTheme());
      nodes.titleEl.textContent = guessTitle(table);
      nodes.searchWrap.classList.remove('has-value');
      nodes.searchInput.value = '';
      for (const name of ['freeze', 'dense']) {
        const btn = overlay.querySelector('[data-act="' + name + '"]');
        if (btn) btn.setAttribute('aria-pressed', view[name] ? 'true' : 'false');
      }
      nodes.scroller.scrollTop = 0;
      nodes.scroller.scrollLeft = 0;
      overlay.hidden = false;
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      render();
      setTimeout(() => {
        try {
          if (view && !overlay.hidden) nodes.searchInput.focus({ preventScroll: true });
        } catch (error) { /* ignore */ }
      }, 30);
      document.addEventListener('keydown', onDocumentKeydown, true);
    }

    function close() {
      if (!overlay) return;
      overlay.hidden = true;
      view = null;
      document.removeEventListener('keydown', onDocumentKeydown, true);
    }

    function onDocumentKeydown(event) {
      if (!view || !overlay || overlay.hidden) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close();
        return;
      }
      if (event.key === '/' && document.activeElement !== nodes.searchInput) {
        event.preventDefault();
        nodes.searchInput.focus();
      }
    }

    /* ------------------------------------------------------------------ */
    /* 6. 点表格 → 打开大表                                                */
    /* ------------------------------------------------------------------ */

    function onClick(event) {
      if (event.defaultPrevented) return;
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('a, button, input, select, textarea, label, [contenteditable="true"]')) return;
      if (target.closest('#' + HOST_ID)) return;
      const table = target.closest('table');
      if (!table || !table.tHead) return;
      if (table.closest('[data-no-table-lens]')) return;
      const selection = window.getSelection();
      if (selection && String(selection).length > 0) return;
      event.stopPropagation();
      open(table);
    }

    /* ------------------------------------------------------------------ */
    /* 7. 生命周期                                                         */
    /* ------------------------------------------------------------------ */

    function mount() {
      if (mounted || !document.body) return;
      mounted = true;
      if (!document.getElementById(STYLE_ID)) {
        styleEl = document.createElement('style');
        styleEl.id = STYLE_ID;
        styleEl.textContent = CHAT_CSS;
        document.head.appendChild(styleEl);
      }
      document.addEventListener('click', onClick, true);
    }

    function unmount() {
      if (!mounted) return;
      mounted = false;
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onDocumentKeydown, true);
      if (styleEl && styleEl.isConnected) styleEl.remove();
      styleEl = null;
      if (hostEl && hostEl.isConnected) hostEl.remove();
      hostEl = null;
      shadow = null;
      overlay = null;
      nodes = null;
      view = null;
    }

    const plugin = {
      apply(ctx) {
        if (typeof document === 'undefined' || typeof window === 'undefined') return;
        if (document.body) mount();
        else document.addEventListener('DOMContentLoaded', mount, { once: true });
        try {
          if (ctx && typeof ctx.on === 'function') ctx.on('dispose', unmount);
        } catch (error) { /* ignore */ }
      },
    };

    return plugin;
  },
});
