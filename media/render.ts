// M6 视图层：纯渲染函数（节点 → DOM、Markdown 渲染、搜索高亮、时间格式化）。
// 设计依据：detailed-design §8.2/§8.4/§8.6。这些函数不依赖 vscode，可在 jsdom 下单测。

import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js';
import type { Turn, TurnStatus } from '../src/model/types';

const md = new MarkdownIt({
  html: false, // 禁止原始 HTML，防注入（§8.4 消毒）
  linkify: true,
  breaks: false,
  highlight(code, lang): string {
    try {
      if (lang && hljs.getLanguage(lang)) {
        return `<pre class="hljs"><code>${hljs.highlight(code, { language: lang }).value}</code></pre>`;
      }
      return `<pre class="hljs"><code>${hljs.highlightAuto(code).value}</code></pre>`;
    } catch {
      return `<pre class="hljs"><code>${escapeHtml(code)}</code></pre>`;
    }
  },
});

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 渲染 Markdown 为消毒后的 HTML（html:false 已转义原始 HTML）。 */
export function renderMarkdown(markdown: string): string {
  return md.render(markdown ?? '');
}

export function statusClass(status: TurnStatus): string {
  switch (status) {
    case 'completed':
      return 'status-completed';
    case 'error':
      return 'status-error';
    case 'in-progress':
    default:
      return 'status-in-progress';
  }
}

export function formatTime(timestamp: number | undefined, relative: boolean, now = Date.now()): string {
  if (timestamp === undefined) {
    return '';
  }
  if (!relative) {
    const d = new Date(timestamp);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }
  const diff = Math.max(0, now - timestamp);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) {
    return 'just now';
  }
  const min = Math.floor(sec / 60);
  if (min < 60) {
    return `${min}m ago`;
  }
  const hr = Math.floor(min / 60);
  if (hr < 24) {
    return `${hr}h ago`;
  }
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

export interface NodeRenderOptions {
  starred: boolean;
  relativeTime: boolean;
  now?: number;
}

/** 构建一个时间线节点元素（含状态色点、序号、时间、模型、摘要、代码图标、文件、长度、工具徽标、星标）。 */
export function createNodeElement(turn: Turn, opts: NodeRenderOptions): HTMLElement {
  const node = document.createElement('div');
  node.className = 'timeline-node';
  node.dataset.turnId = turn.id;

  const dot = document.createElement('span');
  dot.className = `dot ${statusClass(turn.status)}`;
  dot.setAttribute('title', turn.status);
  node.appendChild(dot);

  const body = document.createElement('div');
  body.className = 'node-body';

  // 主行：序号 · 时间 ………… 星标 · 模型
  const head = document.createElement('div');
  head.className = 'node-head';

  const idx = document.createElement('span');
  idx.className = 'node-index';
  idx.textContent = `#${turn.index}`;
  head.appendChild(idx);

  const time = formatTime(turn.timestamp, opts.relativeTime, opts.now);
  if (time) {
    const timeEl = document.createElement('span');
    timeEl.className = 'node-time';
    timeEl.textContent = time;
    head.appendChild(timeEl);
  }

  const star = document.createElement('button');
  star.className = `star ${opts.starred ? 'starred' : ''}`.trim();
  star.textContent = opts.starred ? '★' : '☆';
  star.dataset.turnId = turn.id;
  star.setAttribute('title', 'toggle star');
  head.appendChild(star);

  if (turn.model) {
    const model = document.createElement('span');
    model.className = 'node-model';
    model.textContent = turn.model;
    model.setAttribute('title', `model: ${turn.model}`);
    head.appendChild(model);
  }

  body.appendChild(head);

  // 摘要：最多两行。
  const summary = document.createElement('div');
  summary.className = 'node-summary';
  summary.textContent = turn.summary || turn.prompt;
  body.appendChild(summary);

  // 次级标记行（仅在有内容时出现）：代码 / 长度 / 工具数 / 用量。
  const markers = document.createElement('div');
  markers.className = 'node-markers';

  if (turn.hasCode) {
    const code = document.createElement('span');
    code.className = 'code-icon';
    code.textContent = '</>';
    code.setAttribute('title', 'contains code');
    markers.appendChild(code);
  }

  if (turn.length === 'long') {
    const lengthEl = document.createElement('span');
    lengthEl.className = `node-length length-${turn.length}`;
    lengthEl.textContent = turn.length;
    markers.appendChild(lengthEl);
  }

  if (turn.toolCallCount > 0) {
    const tools = document.createElement('span');
    tools.className = 'node-tools';
    tools.textContent = `🛠 ${turn.toolCallCount}`;
    tools.setAttribute('title', `${turn.toolCallCount} tool calls`);
    markers.appendChild(tools);
  }

  if (turn.usage) {
    const usage = document.createElement('span');
    usage.className = 'node-usage';
    const parts: string[] = [];
    if (turn.usage.credits !== undefined) {
      parts.push(`${turn.usage.credits} cr`);
    } else if (turn.usage.tokens !== undefined) {
      parts.push(`${turn.usage.tokens} tok`);
    }
    usage.textContent = (turn.usage.estimated ? '~' : '') + parts.join(' ');
    markers.appendChild(usage);
  }

  if (markers.childElementCount > 0) {
    body.appendChild(markers);
  }

  if (turn.files.length > 0) {
    const files = document.createElement('div');
    files.className = 'node-files';
    const first = turn.files[0];
    const fileEl = document.createElement('span');
    fileEl.className = 'file-chip';
    fileEl.textContent = first.name;
    fileEl.setAttribute('title', first.path);
    files.appendChild(fileEl);
    if (turn.files.length > 1) {
      const more = document.createElement('span');
      more.className = 'file-more';
      more.textContent = `+${turn.files.length - 1}`;
      files.appendChild(more);
    }
    body.appendChild(files);
  }

  node.appendChild(body);
  return node;
}

/** 渲染整个节点列表到容器。 */
export function renderNodeList(
  container: HTMLElement,
  turns: Turn[],
  starredIds: Set<string>,
  relativeTime: boolean,
  now?: number,
): void {
  container.textContent = '';
  for (const turn of turns) {
    container.appendChild(
      createNodeElement(turn, { starred: starredIds.has(turn.id), relativeTime, now }),
    );
  }
}

/** 根据搜索命中集设置节点显隐与高亮 class（返回命中数量）。 */
export function applySearchFilter(container: HTMLElement, matchedIds: Set<string> | null): number {
  const nodes = Array.from(container.querySelectorAll<HTMLElement>('.timeline-node'));
  let visible = 0;
  for (const n of nodes) {
    const id = n.dataset.turnId ?? '';
    if (matchedIds === null) {
      n.classList.remove('hidden', 'search-hit');
      visible++;
    } else if (matchedIds.has(id)) {
      n.classList.remove('hidden');
      n.classList.add('search-hit');
      visible++;
    } else {
      n.classList.add('hidden');
      n.classList.remove('search-hit');
    }
  }
  return visible;
}
