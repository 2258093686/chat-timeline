import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js/lib/common';
import type {
  GlobalSearchHit,
  HostToView,
  MatchTarget,
  SearchScope,
  SortOrder,
  ViewToHost
} from '../src/messaging/protocol';
import type { Session, SessionSummary, Turn, TurnImage } from '../src/model/types';

// ---------------------------------------------------------------------------
// VS Code API + persisted state
// ---------------------------------------------------------------------------
interface VsCodeApi {
  postMessage(msg: ViewToHost): void;
  getState(): PersistedState | undefined;
  setState(state: PersistedState): void;
}
declare function acquireVsCodeApi(): VsCodeApi;
const vscode = acquireVsCodeApi();

interface PersistedState {
  detailHeight: number;
  sortOrder: SortOrder;
  follow: boolean;
  searchScope: SearchScope;
  matchTarget: MatchTarget;
  starredOnly: boolean;
}

const persisted: PersistedState = {
  detailHeight: 240,
  sortOrder: 'newest',
  follow: true,
  searchScope: 'current',
  matchTarget: 'both',
  starredOnly: false,
  ...(vscode.getState() ?? {})
};

function saveState(): void {
  vscode.setState(persisted);
}

// ---------------------------------------------------------------------------
// Runtime state
// ---------------------------------------------------------------------------
let sessions: SessionSummary[] = [];
let activeSessionId: string | undefined;
let session: Session | undefined;
let stars = new Set<string>();
let selectedTurnId: string | undefined;
/** When true, the user closed the detail pane; it stays hidden until reopened. */
let detailHidden = false;
let searchMatches: Set<string> | null = null;
/** When non-null, the timeline is replaced by a flat cross-session result list. */
let globalHits: GlobalSearchHit[] | null = null;
/** The global-search result currently previewed in the detail pane. */
let selectedHit: GlobalSearchHit | null = null;
/** Results stashed when jumping into a session, so we can return to them. */
let stashedHits: GlobalSearchHit[] | null = null;
/** Turn to focus once a session arrives (used when jumping from global results). */
let pendingFocusTurnId: string | undefined;
/** Last keyword submitted, used to highlight matches in the global result list. */
let lastKeyword = '';
/** Session ids whose global-result group is collapsed. */
const collapsedGroups = new Set<string>();

// ---------------------------------------------------------------------------
// Markdown rendering (html disabled -> safe against HTML/script injection)
// ---------------------------------------------------------------------------
const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
  highlight(code: string, lang: string): string {
    try {
      if (lang && hljs.getLanguage(lang)) {
        return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
      }
      return hljs.highlightAuto(code).value;
    } catch {
      return '';
    }
  }
});

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const sessionSelect = $<HTMLSelectElement>('sessionSelect');
const searchInput = $<HTMLInputElement>('search');
const clearBtn = $<HTMLButtonElement>('clearBtn');
const searchBtn = $<HTMLButtonElement>('searchBtn');
const scopeBtn = $<HTMLButtonElement>('scopeBtn');
const scopeMenu = $<HTMLDivElement>('scopeMenu');
const moreBtn = $<HTMLButtonElement>('moreBtn');
const moreMenu = $<HTMLDivElement>('moreMenu');
const targetItems = [
  $<HTMLButtonElement>('targetBoth'),
  $<HTMLButtonElement>('targetPrompt'),
  $<HTMLButtonElement>('targetResponse')
];
const scopeItem = $<HTMLButtonElement>('scopeItem');
const followItem = $<HTMLButtonElement>('followItem');
const starItem = $<HTMLButtonElement>('starItem');
const sortBtn = $<HTMLButtonElement>('sortBtn');
const timelineEl = $<HTMLDivElement>('timeline');
const dragbar = $<HTMLDivElement>('dragbar');
const detailEl = $<HTMLElement>('detail');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function post(msg: ViewToHost): void {
  vscode.postMessage(msg);
}

/** Concrete, sortable timestamp shown on each turn node (e.g. "06-03 17:24"). */
function formatDateTime(ts?: number): string {
  if (!ts) {
    return '';
  }
  const d = new Date(ts);
  const p = (n: number): string => n.toString().padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function renderSessions(): void {
  sessionSelect.replaceChildren();
  for (const s of sessions) {
    const opt = el('option', undefined, `${s.title || 'Untitled'} (${s.turnCount})`);
    opt.value = s.id;
    if (s.id === activeSessionId) {
      opt.selected = true;
    }
    sessionSelect.appendChild(opt);
  }
}

function sortedTurns(turns: Turn[]): Turn[] {
  const copy = turns.slice();
  if (persisted.sortOrder === 'newest') {
    copy.reverse();
  }
  return copy;
}

function showStateScreen(emoji: string, title: string, hint?: string): void {
  detailEl.classList.add('hidden');
  dragbar.style.display = 'none';
  timelineEl.replaceChildren();
  const wrap = el('div', 'state');
  if (emoji === 'spinner') {
    wrap.appendChild(el('div', 'spinner'));
  } else {
    wrap.appendChild(el('div', 'emoji', emoji));
  }
  wrap.appendChild(el('div', 'state-title', title));
  if (hint) {
    wrap.appendChild(el('div', 'state-hint', hint));
  }
  timelineEl.appendChild(wrap);
}

function renderTimeline(): void {
  if (globalHits !== null) {
    renderGlobalHits();
    return;
  }
  if (!session) {
    return;
  }
  if (session.turns.length === 0) {
    showStateScreen('💬', 'No turns in this session yet', 'Start chatting with Copilot.');
    return;
  }

  dragbar.style.display = '';
  detailEl.classList.remove('hidden');

  timelineEl.replaceChildren();

  const turns = sortedTurns(session.turns);

  for (const turn of turns) {
    timelineEl.appendChild(renderNode(turn));
  }

  applySearchFilter();
}

/** A button that returns from a session back to the stashed global results. */
function renderBackButton(): HTMLElement {
  const btn = el('button', 'act primary', '← Back to results');
  btn.title = 'Return to the global search results';
  btn.addEventListener('click', () => {
    globalHits = stashedHits;
    stashedHits = null;
    selectedHit = null;
    renderTimeline();
    renderDetail();
  });
  return btn;
}

/** VS Code-style grouped result tree: session folders with matching turns. */
function renderGlobalHits(): void {
  const hits = globalHits ?? [];
  if (hits.length === 0) {
    selectedHit = null;
    detailEl.classList.add('hidden');
    dragbar.style.display = 'none';
    showStateScreen('🔍', 'No matches across sessions', 'Try a different keyword.');
    return;
  }

  // a hit is previewed in the detail pane -> show it
  const previewing = selectedHit !== null;
  dragbar.style.display = previewing ? '' : 'none';
  detailEl.classList.toggle('hidden', !previewing);

  // group hits by session, preserving the order sessions first appear
  const groups: { id: string; title: string; hits: GlobalSearchHit[] }[] = [];
  const byId = new Map<string, { id: string; title: string; hits: GlobalSearchHit[] }>();
  for (const hit of hits) {
    let g = byId.get(hit.sessionId);
    if (!g) {
      g = { id: hit.sessionId, title: hit.sessionTitle, hits: [] };
      byId.set(hit.sessionId, g);
      groups.push(g);
    }
    g.hits.push(hit);
  }

  timelineEl.replaceChildren();
  const header = el(
    'div',
    'global-head',
    `${hits.length} result${hits.length > 1 ? 's' : ''} in ${groups.length} session${
      groups.length > 1 ? 's' : ''
    }`
  );
  timelineEl.appendChild(header);

  for (const group of groups) {
    const collapsed = collapsedGroups.has(group.id);

    const folder = el('div', `global-folder${collapsed ? ' collapsed' : ''}`);
    folder.appendChild(el('span', 'twisty', collapsed ? '▶' : '▼'));
    folder.appendChild(el('span', 'folder-name', group.title || 'Untitled'));
    folder.appendChild(el('span', 'folder-count', String(group.hits.length)));
    folder.addEventListener('click', () => {
      if (collapsedGroups.has(group.id)) {
        collapsedGroups.delete(group.id);
      } else {
        collapsedGroups.add(group.id);
      }
      renderGlobalHits();
    });
    timelineEl.appendChild(folder);

    if (collapsed) {
      continue;
    }

    for (const hit of group.hits) {
      const row = el('div', 'global-hit');
      if (selectedHit && selectedHit.turnId === hit.turnId) {
        row.classList.add('selected');
      }
      const dot = el('span', `dot ${hit.status}`);
      dot.title = hit.status;
      row.appendChild(dot);
      const snippet = el('div', 'hit-snippet');
      appendHighlighted(snippet, hit.snippet || hit.summary || '(empty)', lastKeyword);
      row.appendChild(snippet);
      row.addEventListener('click', () => {
        selectedHit = hit;
        if (detailHidden) {
          detailHidden = false;
          detailEl.classList.remove('hidden');
          dragbar.style.display = '';
        }
        renderGlobalHits();
        renderDetail();
      });
      timelineEl.appendChild(row);
    }
  }
}

/** Append text to a node, wrapping case-insensitive keyword matches in <mark>. */
function appendHighlighted(parent: HTMLElement, text: string, keyword: string): void {
  const kw = keyword.trim();
  if (!kw) {
    parent.textContent = text;
    return;
  }
  const lower = text.toLowerCase();
  const needle = kw.toLowerCase();
  let from = 0;
  let idx = lower.indexOf(needle, from);
  if (idx === -1) {
    parent.textContent = text;
    return;
  }
  while (idx !== -1) {
    if (idx > from) {
      parent.appendChild(document.createTextNode(text.slice(from, idx)));
    }
    parent.appendChild(el('mark', undefined, text.slice(idx, idx + kw.length)));
    from = idx + kw.length;
    idx = lower.indexOf(needle, from);
  }
  if (from < text.length) {
    parent.appendChild(document.createTextNode(text.slice(from)));
  }
}

/**
 * Walk the rendered text nodes inside `root` and wrap case-insensitive keyword
 * matches in <mark>. Safe against injection: only text nodes and <mark> elements
 * are created. Skips text already inside a <mark>.
 */
function highlightWithin(root: HTMLElement, keyword: string): void {
  const kw = keyword.trim();
  if (!kw) {
    return;
  }
  const needle = kw.toLowerCase();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node): number {
      const parent = node.parentElement;
      if (!parent || parent.closest('mark')) {
        return NodeFilter.FILTER_REJECT;
      }
      return (node.textContent ?? '').toLowerCase().includes(needle)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_SKIP;
    }
  });
  const targets: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    targets.push(current as Text);
    current = walker.nextNode();
  }
  for (const textNode of targets) {
    const text = textNode.textContent ?? '';
    const lower = text.toLowerCase();
    const frag = document.createDocumentFragment();
    let from = 0;
    let idx = lower.indexOf(needle, from);
    while (idx !== -1) {
      if (idx > from) {
        frag.appendChild(document.createTextNode(text.slice(from, idx)));
      }
      const mark = document.createElement('mark');
      mark.textContent = text.slice(idx, idx + kw.length);
      frag.appendChild(mark);
      from = idx + kw.length;
      idx = lower.indexOf(needle, from);
    }
    if (from < text.length) {
      frag.appendChild(document.createTextNode(text.slice(from)));
    }
    textNode.parentNode?.replaceChild(frag, textNode);
  }
}

/** Highlight the active keyword across the detail pane's question/answer blocks. */
function highlightDetailContent(): void {
  const kw = lastKeyword.trim();
  if (!kw || (searchMatches === null && globalHits === null)) {
    return;
  }
  for (const block of Array.from(
    detailEl.querySelectorAll<HTMLElement>('.prompt-block, .response-block, .process-body')
  )) {
    highlightWithin(block, kw);
  }
}

function renderNode(turn: Turn): HTMLElement {
  const node = el('div', 'node');
  node.dataset.id = turn.id;
  if (turn.id === selectedTurnId) {
    node.classList.add('selected');
  }

  const dot = el('span', `dot ${turn.status}`);
  dot.title = turn.status;
  node.appendChild(dot);

  const body = el('div', 'body');

  // line 1: index · time · (model on the right)
  const line1 = el('div', 'line1');
  line1.appendChild(el('span', 'idx', `#${turn.index}`));
  const time = formatDateTime(turn.timestamp);
  if (time) {
    line1.appendChild(el('span', 'time', time));
  }
  if (turn.model) {
    line1.appendChild(el('span', 'model', turn.model));
  }
  body.appendChild(line1);

  // summary
  const summary = el('div', 'summary');
  appendHighlighted(summary, turn.summary || '(empty)', searchMatches !== null ? lastKeyword : '');
  body.appendChild(summary);

  node.appendChild(body);

  // star (enhanced info F)
  const star = el('button', `star ${stars.has(turn.id) ? 'starred' : ''}`, stars.has(turn.id) ? '★' : '☆');
  star.title = 'Star this turn';
  star.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleStar(turn.id);
  });
  node.appendChild(star);

  node.addEventListener('click', () => selectTurn(turn.id));
  return node;
}

function renderDetail(): void {
  // global-search preview takes over the detail pane while results are shown
  if (globalHits !== null) {
    renderHitDetail();
    return;
  }
  const turn = session?.turns.find((t) => t.id === selectedTurnId);
  detailEl.replaceChildren();
  if (!turn) {
    detailEl.appendChild(el('div', 'state-hint', 'Select a turn to see the full question & answer.'));
    return;
  }

  const head = el('div', 'detail-head');
  head.appendChild(el('span', 'idx', `#${turn.index}`));
  if (turn.model) {
    head.appendChild(el('span', 'model', turn.model));
  }
  if (turn.status === 'error' && turn.errorMessage) {
    const err = el('span', 'badge', `error: ${turn.errorMessage}`);
    head.appendChild(err);
  }
  const actions = el('div', 'detail-actions');
  if (stashedHits !== null) {
    actions.appendChild(renderBackButton());
  }
  const copyP = el('button', 'act', 'Copy prompt');
  copyP.addEventListener('click', () => post({ type: 'copy', target: 'prompt', turnId: turn.id }));
  const copyR = el('button', 'act', 'Copy response');
  copyR.addEventListener('click', () => post({ type: 'copy', target: 'response', turnId: turn.id }));
  actions.append(copyP, copyR);
  actions.appendChild(renderCloseButton());
  head.appendChild(actions);
  detailEl.appendChild(head);

  const prompt = el('div', 'prompt-block');
  prompt.textContent = turn.prompt;
  detailEl.appendChild(prompt);

  appendImages(detailEl, turn.images);

  appendResponse(detailEl, turn.processMarkdown, turn.answerMarkdown || turn.responseMarkdown);

  highlightDetailContent();
  detailEl.scrollTop = 0;
}

/** A ✕ button that hides the detail pane until a turn/hit is reopened. */
function renderCloseButton(): HTMLElement {
  const btn = el('button', 'act close-detail', '✕');
  btn.title = 'Close detail';
  btn.addEventListener('click', () => {
    detailHidden = true;
    detailEl.classList.add('hidden');
    dragbar.style.display = 'none';
  });
  return btn;
}

/** Open a full-size lightbox overlay for an image. Closes on backdrop click, ✕, or ESC. */
function openLightbox(src: string, alt: string): void {
  const overlay = el('div', 'image-lightbox');

  const close = (): void => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      close();
    }
  };

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      close();
    }
  });

  const figure = el('div', 'image-lightbox-figure');
  const big = document.createElement('img');
  big.src = src;
  big.alt = alt;
  figure.appendChild(big);

  const closeBtn = el('button', 'image-lightbox-close', '✕');
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.addEventListener('click', close);
  figure.appendChild(closeBtn);

  overlay.appendChild(figure);
  document.body.appendChild(overlay);
  document.addEventListener('keydown', onKey);
}

/** Append the user's attached images as thumbnails (click opens a lightbox). */
function appendImages(parent: HTMLElement, images: TurnImage[] | undefined): void {
  if (!images || images.length === 0) {
    return;
  }
  const box = el('div', 'image-block');
  for (const image of images) {
    const img = document.createElement('img');
    img.className = 'prompt-image';
    img.src = image.dataUri;
    img.alt = image.name || 'attached image';
    img.title = `${image.name || 'image'} — click to enlarge`;
    img.addEventListener('click', () => openLightbox(image.dataUri, img.alt));
    box.appendChild(img);
  }
  parent.appendChild(box);
}

/**
 * Append the answer, optionally preceded by a collapsed "process" section
 * holding the narration that appeared between tool calls.
 */
function appendResponse(parent: HTMLElement, processMd: string | undefined, answerMd: string): void {
  if (processMd) {
    const details = document.createElement('details');
    details.className = 'process-block';
    const summary = document.createElement('summary');
    summary.textContent = 'Process / thinking';
    details.appendChild(summary);
    const body = el('div', 'process-body');
    body.innerHTML = md.render(processMd);
    details.appendChild(body);
    parent.appendChild(details);
  }
  const response = el('div', 'response-block');
  // markdown-it with html:false escapes raw HTML in the source -> safe.
  response.innerHTML = md.render(answerMd || '_(no response)_');
  parent.appendChild(response);
}

/** Render the detail pane for a previewed global-search hit. */
function renderHitDetail(): void {
  detailEl.replaceChildren();
  const hit = selectedHit;
  if (!hit) {
    return;
  }

  const head = el('div', 'detail-head');
  head.appendChild(el('span', 'idx', `#${hit.index}`));
  head.appendChild(el('span', 'session-name', hit.sessionTitle || 'Untitled'));
  if (hit.model) {
    head.appendChild(el('span', 'model', hit.model));
  }
  const actions = el('div', 'detail-actions');
  const openBtn = el('button', 'act primary', 'Open in session ↗');
  openBtn.title = 'Jump to this turn in its session';
  openBtn.addEventListener('click', () => {
    pendingFocusTurnId = hit.turnId;
    activeSessionId = hit.sessionId;
    stashedHits = globalHits;
    globalHits = null;
    selectedHit = null;
    post({ type: 'selectSession', sessionId: hit.sessionId, focusTurnId: hit.turnId });
  });
  actions.appendChild(openBtn);
  actions.appendChild(renderCloseButton());
  head.appendChild(actions);
  detailEl.appendChild(head);

  const prompt = el('div', 'prompt-block');
  appendHighlighted(prompt, hit.prompt, lastKeyword);
  detailEl.appendChild(prompt);

  appendImages(detailEl, hit.images);

  appendResponse(detailEl, hit.processMarkdown, hit.answerMarkdown || hit.responseMarkdown);

  highlightDetailContent();
  detailEl.scrollTop = 0;
}
function selectTurn(id: string): void {
  selectedTurnId = id;
  // Reopen the detail pane if the user had closed it.
  if (detailHidden) {
    detailHidden = false;
    detailEl.classList.remove('hidden');
    dragbar.style.display = '';
  }
  for (const node of Array.from(timelineEl.querySelectorAll('.node'))) {
    node.classList.toggle('selected', (node as HTMLElement).dataset.id === id);
  }
  const active = timelineEl.querySelector('.node.selected');
  active?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  renderDetail();
}

function toggleStar(id: string): void {
  if (stars.has(id)) {
    stars.delete(id);
  } else {
    stars.add(id);
  }
  post({ type: 'toggleStar', turnId: id });
  const node = timelineEl.querySelector(`.node[data-id="${cssEscape(id)}"] .star`);
  if (node) {
    const on = stars.has(id);
    node.classList.toggle('starred', on);
    node.textContent = on ? '★' : '☆';
  }
  // When viewing starred-only, an un-starred turn should disappear right away.
  if (persisted.starredOnly) {
    applySearchFilter();
  }
}

function cssEscape(s: string): string {
  return s.replace(/"/g, '\\"');
}

// ---------------------------------------------------------------------------
// Search (X7 debounce)
// ---------------------------------------------------------------------------
let searchTimer: number | undefined;
function onSearchInput(): void {
  if (searchTimer) {
    window.clearTimeout(searchTimer);
  }
  searchTimer = window.setTimeout(performSearch, 200);
}

/** Run the search immediately for the current input value (no debounce). */
function performSearch(): void {
  if (searchTimer) {
    window.clearTimeout(searchTimer);
    searchTimer = undefined;
  }
  const kw = searchInput.value.trim();
  updateClearBtn();
  lastKeyword = kw;
  if (!kw) {
    searchMatches = null;
    if (globalHits !== null) {
      globalHits = null;
      selectedHit = null;
      stashedHits = null;
      renderTimeline();
      renderDetail();
    } else {
      renderTimeline();
    }
    return;
  }
  post({ type: 'search', keyword: kw, scope: persisted.searchScope, target: persisted.matchTarget });
}

function applySearchFilter(): void {
  for (const node of Array.from(timelineEl.querySelectorAll('.node'))) {
    const id = (node as HTMLElement).dataset.id ?? '';
    const hiddenBySearch = searchMatches !== null && !searchMatches.has(id);
    const hiddenByStar = persisted.starredOnly && !stars.has(id);
    (node as HTMLElement).classList.toggle('hidden', hiddenBySearch || hiddenByStar);
  }
}

// ---------------------------------------------------------------------------
// Toolbar buttons
// ---------------------------------------------------------------------------
function updateSortBtn(): void {
  const newest = persisted.sortOrder === 'newest';
  sortBtn.textContent = newest ? '↓' : '↑';
  sortBtn.title = newest ? 'Sort: newest first' : 'Sort: oldest first';
}
function updateFollowBtn(): void {
  const on = persisted.follow;
  followItem.classList.toggle('checked', on);
  followItem.setAttribute('aria-checked', String(on));
}
function updateStarFilterBtn(): void {
  const on = persisted.starredOnly;
  starItem.classList.toggle('checked', on);
  starItem.setAttribute('aria-checked', String(on));
}
function updateScopeBtn(): void {
  const global = persisted.searchScope === 'global';
  scopeItem.classList.toggle('checked', global);
  scopeItem.setAttribute('aria-checked', String(global));
}
function updateClearBtn(): void {
  clearBtn.style.display = searchInput.value.length > 0 ? '' : 'none';
}

const TARGET_TITLE: Record<MatchTarget, string> = {
  both: 'Match in question and answer',
  prompt: 'Match in question only',
  response: 'Match in answer only'
};
const TARGET_LABEL: Record<MatchTarget, string> = {
  both: '≡',
  prompt: 'Q',
  response: 'A'
};
function updateTargetBtn(): void {
  scopeBtn.textContent = TARGET_LABEL[persisted.matchTarget];
  scopeBtn.title = TARGET_TITLE[persisted.matchTarget];
  scopeBtn.classList.toggle('scope-trigger--letter', persisted.matchTarget !== 'both');
  for (const item of targetItems) {
    const t = item.dataset.target as MatchTarget;
    const on = t === persisted.matchTarget;
    item.classList.toggle('checked', on);
    item.setAttribute('aria-checked', String(on));
    item.title = TARGET_TITLE[t];
  }
}

sortBtn.addEventListener('click', () => {
  persisted.sortOrder = persisted.sortOrder === 'newest' ? 'oldest' : 'newest';
  saveState();
  updateSortBtn();
  renderTimeline();
});

followItem.addEventListener('click', () => {
  persisted.follow = !persisted.follow;
  saveState();
  updateFollowBtn();
  if (persisted.follow) {
    // Jump to the most recently changed session right away.
    renderSessions();
    maybeFollowNewestSession();
  }
});

starItem.addEventListener('click', () => {
  persisted.starredOnly = !persisted.starredOnly;
  saveState();
  updateStarFilterBtn();
  applySearchFilter();
});

for (const item of targetItems) {
  item.addEventListener('click', () => {
    persisted.matchTarget = item.dataset.target as MatchTarget;
    saveState();
    updateTargetBtn();
    // Collapse the dropdown once a scope is chosen.
    scopeMenu.classList.add('hidden');
    scopeBtn.setAttribute('aria-expanded', 'false');
    if (searchInput.value.trim()) {
      onSearchInput();
    }
  });
}

scopeItem.addEventListener('click', () => {
  persisted.searchScope = persisted.searchScope === 'global' ? 'current' : 'global';
  saveState();
  updateScopeBtn();
  // re-run search (if any) under the new scope, immediately
  if (searchInput.value.trim()) {
    performSearch();
  } else if (globalHits !== null) {
    globalHits = null;
    selectedHit = null;
    renderTimeline();
    renderDetail();
  }
});

// Popup menus (match-scope + more-settings) --------------------------------
/**
 * Wire a trigger button + dropdown so it toggles on click, closes on Escape,
 * on an outside click, and when the webview loses focus. Returns nothing; the
 * menus are self-contained.
 */
function setupMenu(btn: HTMLButtonElement, menu: HTMLElement): void {
  const wrap = btn.closest('.menu-wrap') as HTMLElement;
  const isOpen = (): boolean => !menu.classList.contains('hidden');
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      close();
      btn.focus();
    }
  };
  function open(): void {
    menu.classList.remove('hidden');
    btn.setAttribute('aria-expanded', 'true');
    document.addEventListener('keydown', onKey);
  }
  function close(): void {
    menu.classList.add('hidden');
    btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('keydown', onKey);
  }
  document.addEventListener('click', (e) => {
    if (isOpen() && !wrap.contains(e.target as Node)) {
      close();
    }
  });
  // Clicks outside the webview (editor, other panels) never reach the document
  // above, but they steal focus from the webview — close on blur too.
  window.addEventListener('blur', () => {
    if (isOpen()) {
      close();
    }
  });
  btn.addEventListener('click', (e) => {
    // Stop this click from immediately reaching the document handler above.
    e.stopPropagation();
    if (isOpen()) {
      close();
    } else {
      open();
    }
  });
}
setupMenu(scopeBtn, scopeMenu);
setupMenu(moreBtn, moreMenu);

clearBtn.addEventListener('click', () => {
  searchInput.value = '';
  updateClearBtn();
  searchMatches = null;
  stashedHits = null;
  if (globalHits !== null) {
    globalHits = null;
    selectedHit = null;
    renderTimeline();
    renderDetail();
  } else {
    renderTimeline();
  }
  searchInput.focus();
});

sessionSelect.addEventListener('change', () => {
  activeSessionId = sessionSelect.value;
  stashedHits = null;
  post({ type: 'selectSession', sessionId: sessionSelect.value });
});

searchInput.addEventListener('input', onSearchInput);
searchBtn.addEventListener('click', () => {
  performSearch();
  searchInput.focus();
});
searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    performSearch();
  }
});

// ---------------------------------------------------------------------------
// Drag bar (X3)
// ---------------------------------------------------------------------------
let dragging = false;
dragbar.addEventListener('mousedown', (e) => {
  dragging = true;
  e.preventDefault();
  document.body.style.userSelect = 'none';
});
window.addEventListener('mousemove', (e) => {
  if (!dragging) {
    return;
  }
  const rect = document.getElementById('app')!.getBoundingClientRect();
  const fromBottom = rect.bottom - e.clientY;
  const h = Math.min(Math.max(fromBottom, 80), rect.height - 120);
  persisted.detailHeight = h;
  detailEl.style.height = `${h}px`;
});
window.addEventListener('mouseup', () => {
  if (dragging) {
    dragging = false;
    document.body.style.userSelect = '';
    saveState();
  }
});

// ---------------------------------------------------------------------------
// Host messages
// ---------------------------------------------------------------------------
window.addEventListener('message', (event: MessageEvent<HostToView>) => {
  const msg = event.data;
  switch (msg.type) {
    case 'loading':
      showStateScreen('spinner', 'Loading…');
      break;
    case 'empty':
      showStateScreen(
        '🕓',
        msg.reason === 'no-data' ? 'No Copilot Chat data found' : 'No sessions yet',
        'Chat with Copilot to populate the timeline.'
      );
      break;
    case 'error':
      showStateScreen('⚠️', 'Something went wrong', msg.message);
      break;
    case 'sessions':
      sessions = msg.sessions;
      activeSessionId = msg.activeSessionId;
      maybeFollowNewestSession();
      renderSessions();
      break;
    case 'session':
      session = msg.session;
      stars = new Set(msg.stars);
      activeSessionId = msg.session.id;
      globalHits = null;
      reconcileSelection();
      renderSessions();
      renderTimeline();
      renderDetail();
      break;
    case 'searchResult':
      searchMatches = new Set(msg.turnIds);
      // A current-scope result means we are no longer in global-results mode.
      globalHits = null;
      selectedHit = null;
      renderTimeline();
      renderDetail();
      break;
    case 'globalSearchResult':
      globalHits = msg.hits;
      selectedHit = null;
      stashedHits = null;
      searchMatches = null;
      renderTimeline();
      renderDetail();
      break;
  }
});

function reconcileSelection(): void {
  if (!session || session.turns.length === 0) {
    selectedTurnId = undefined;
    pendingFocusTurnId = undefined;
    return;
  }
  if (pendingFocusTurnId && session.turns.some((t) => t.id === pendingFocusTurnId)) {
    selectedTurnId = pendingFocusTurnId;
    pendingFocusTurnId = undefined;
    return;
  }
  pendingFocusTurnId = undefined;
  const stillExists = selectedTurnId && session.turns.some((t) => t.id === selectedTurnId);
  if (!stillExists) {
    selectedTurnId = session.turns[session.turns.length - 1].id;
  }
}

/**
 * When "Follow newest session" is on, always track the session that changed
 * most recently (the host sorts sessions newest-first). Any new message in any
 * session bubbles it to the top, so the view jumps to wherever activity is.
 * A manual pick of an older session is respected until the next change.
 */
function maybeFollowNewestSession(): void {
  if (!persisted.follow || sessions.length === 0) {
    return;
  }
  const newestId = sessions[0].id;
  if (newestId !== activeSessionId) {
    activeSessionId = newestId;
    stashedHits = null;
    post({ type: 'selectSession', sessionId: newestId });
  }
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
detailEl.style.height = `${persisted.detailHeight}px`;
updateSortBtn();
updateFollowBtn();
updateScopeBtn();
updateTargetBtn();
updateStarFilterBtn();
updateClearBtn();
showStateScreen('spinner', 'Loading…');
post({ type: 'ready' });
