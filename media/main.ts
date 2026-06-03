import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js/lib/common';
import type { HostToView, Layout, SortOrder, ViewToHost } from '../src/messaging/protocol';
import type { Session, SessionSummary, Turn } from '../src/model/types';

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
  layout: Layout;
}

const persisted: PersistedState = {
  detailHeight: 240,
  sortOrder: 'newest',
  follow: true,
  layout: 'detail',
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
let searchMatches: Set<string> | null = null;

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
const sortBtn = $<HTMLButtonElement>('sortBtn');
const followBtn = $<HTMLButtonElement>('followBtn');
const layoutBtn = $<HTMLButtonElement>('layoutBtn');
const refreshBtn = $<HTMLButtonElement>('refreshBtn');
const timelineEl = $<HTMLDivElement>('timeline');
const dragbar = $<HTMLDivElement>('dragbar');
const detailEl = $<HTMLElement>('detail');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function post(msg: ViewToHost): void {
  vscode.postMessage(msg);
}

function relativeTime(ts?: number): string {
  if (!ts) {
    return '';
  }
  const diff = Date.now() - ts;
  const sec = Math.round(diff / 1000);
  if (sec < 60) {
    return 'just now';
  }
  const min = Math.round(sec / 60);
  if (min < 60) {
    return `${min}m ago`;
  }
  const hr = Math.round(min / 60);
  if (hr < 24) {
    return `${hr}h ago`;
  }
  const day = Math.round(hr / 24);
  if (day < 7) {
    return `${day}d ago`;
  }
  return new Date(ts).toLocaleDateString();
}

function clockTime(ts?: number): string {
  if (!ts) {
    return '';
  }
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, '0')}:${d
    .getMinutes()
    .toString()
    .padStart(2, '0')}`;
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
    const opt = el('option', undefined, s.title || 'Untitled');
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
  if (!session) {
    return;
  }
  if (session.turns.length === 0) {
    showStateScreen('💬', 'No turns in this session yet', 'Start chatting with Copilot.');
    return;
  }

  dragbar.style.display = persisted.layout === 'detail' ? '' : 'none';
  detailEl.classList.toggle('hidden', persisted.layout !== 'detail');

  timelineEl.replaceChildren();
  const turns = sortedTurns(session.turns);

  for (const turn of turns) {
    timelineEl.appendChild(renderNode(turn));
  }

  applySearchDim();
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

  // line 1: index · time · model
  const line1 = el('div', 'line1');
  line1.appendChild(el('span', 'idx', `#${turn.index}`));
  const time = relativeTimeEnabled ? relativeTime(turn.timestamp) : clockTime(turn.timestamp);
  if (time) {
    line1.appendChild(el('span', 'time', time));
  }
  if (turn.model) {
    line1.appendChild(el('span', 'model', turn.model));
  }
  body.appendChild(line1);

  // summary
  body.appendChild(el('div', 'summary', turn.summary || '(empty)'));

  // badges (enhanced info B–E)
  const badges = el('div', 'badges');
  if (turn.hasCode) {
    badges.appendChild(el('span', 'badge code', '</>'));
  }
  if (turn.files.length > 0) {
    const first = turn.files[0].name;
    const label = turn.files.length > 1 ? `${first} +${turn.files.length - 1}` : first;
    const b = el('span', 'badge file', `📄 ${label}`);
    b.title = turn.files.map((f) => f.path).join('\n');
    badges.appendChild(b);
  }
  if (turn.length === 'long') {
    badges.appendChild(el('span', 'badge len', 'long'));
  }
  if (turn.toolCallCount > 0) {
    badges.appendChild(el('span', 'badge tool', `🔧 ${turn.toolCallCount}`));
  }
  if (turn.usage?.tokens) {
    const u = el('span', 'badge usage', `${turn.usage.tokens}t${turn.usage.estimated ? '~' : ''}`);
    badges.appendChild(u);
  }
  if (badges.childElementCount > 0) {
    body.appendChild(badges);
  }

  node.appendChild(body);

  // star (enhanced info F)
  const star = el('button', `star ${stars.has(turn.id) ? 'starred' : ''}`, stars.has(turn.id) ? '★' : '☆');
  star.title = 'Star this turn';
  star.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleStar(turn.id);
  });
  node.appendChild(star);

  node.addEventListener('click', () => selectTurn(turn.id, true));
  return node;
}

const relativeTimeEnabled = true;

function renderDetail(): void {
  if (persisted.layout !== 'detail') {
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
  const copyP = el('button', 'act', 'Copy prompt');
  copyP.addEventListener('click', () => post({ type: 'copy', target: 'prompt', turnId: turn.id }));
  const copyR = el('button', 'act', 'Copy response');
  copyR.addEventListener('click', () => post({ type: 'copy', target: 'response', turnId: turn.id }));
  actions.append(copyP, copyR);
  head.appendChild(actions);
  detailEl.appendChild(head);

  const prompt = el('div', 'prompt-block');
  prompt.textContent = turn.prompt;
  detailEl.appendChild(prompt);

  const response = el('div', 'response-block');
  // markdown-it with html:false escapes raw HTML in the source -> safe.
  response.innerHTML = md.render(turn.responseMarkdown || '_(no response)_');
  detailEl.appendChild(response);

  detailEl.scrollTop = 0;
}

// ---------------------------------------------------------------------------
// Selection + follow (X5)
// ---------------------------------------------------------------------------
function selectTurn(id: string, manual: boolean): void {
  selectedTurnId = id;
  if (manual && persisted.follow) {
    // manual selection locks following
    persisted.follow = false;
    saveState();
    updateFollowBtn();
  }
  for (const node of Array.from(timelineEl.querySelectorAll('.node'))) {
    node.classList.toggle('selected', (node as HTMLElement).dataset.id === id);
  }
  const active = timelineEl.querySelector('.node.selected');
  active?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  renderDetail();
}

function followLatest(): void {
  if (!session || session.turns.length === 0) {
    return;
  }
  const latest = session.turns[session.turns.length - 1];
  selectTurn(latest.id, false);
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
  searchTimer = window.setTimeout(() => {
    const kw = searchInput.value.trim();
    if (!kw) {
      searchMatches = null;
      applySearchDim();
      return;
    }
    post({ type: 'search', keyword: kw });
  }, 200);
}

function applySearchDim(): void {
  for (const node of Array.from(timelineEl.querySelectorAll('.node'))) {
    const id = (node as HTMLElement).dataset.id ?? '';
    const dim = searchMatches !== null && !searchMatches.has(id);
    node.classList.toggle('dimmed', dim);
  }
}

// ---------------------------------------------------------------------------
// Toolbar buttons
// ---------------------------------------------------------------------------
function updateSortBtn(): void {
  sortBtn.classList.toggle('active', persisted.sortOrder === 'newest');
  sortBtn.title = persisted.sortOrder === 'newest' ? 'Newest on top' : 'Oldest on top';
}
function updateFollowBtn(): void {
  followBtn.classList.toggle('active', persisted.follow);
  followBtn.title = persisted.follow ? 'Following latest (click to unlock)' : 'Click to follow latest';
}
function updateLayoutBtn(): void {
  layoutBtn.classList.toggle('active', persisted.layout === 'detail');
  layoutBtn.title = persisted.layout === 'detail' ? 'Detail layout' : 'Compact layout';
}

sortBtn.addEventListener('click', () => {
  persisted.sortOrder = persisted.sortOrder === 'newest' ? 'oldest' : 'newest';
  saveState();
  updateSortBtn();
  renderTimeline();
});

followBtn.addEventListener('click', () => {
  persisted.follow = !persisted.follow;
  saveState();
  updateFollowBtn();
  if (persisted.follow) {
    followLatest();
  }
});

layoutBtn.addEventListener('click', () => {
  const next: Layout = persisted.layout === 'detail' ? 'compact' : 'detail';
  post({ type: 'setLayout', layout: next });
});

refreshBtn.addEventListener('click', () => post({ type: 'refresh' }));

sessionSelect.addEventListener('change', () => {
  activeSessionId = sessionSelect.value;
  post({ type: 'selectSession', sessionId: sessionSelect.value });
});

searchInput.addEventListener('input', onSearchInput);

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
      renderSessions();
      break;
    case 'session':
      session = msg.session;
      stars = new Set(msg.stars);
      activeSessionId = msg.session.id;
      reconcileSelection();
      renderTimeline();
      renderDetail();
      break;
    case 'searchResult':
      searchMatches = new Set(msg.turnIds);
      applySearchDim();
      break;
    case 'layout':
      persisted.layout = msg.layout;
      saveState();
      updateLayoutBtn();
      renderTimeline();
      renderDetail();
      break;
  }
});

function reconcileSelection(): void {
  if (!session || session.turns.length === 0) {
    selectedTurnId = undefined;
    return;
  }
  const stillExists = selectedTurnId && session.turns.some((t) => t.id === selectedTurnId);
  if (persisted.follow || !stillExists) {
    selectedTurnId = session.turns[session.turns.length - 1].id;
  }
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
detailEl.style.height = `${persisted.detailHeight}px`;
updateSortBtn();
updateFollowBtn();
updateLayoutBtn();
showStateScreen('spinner', 'Loading…');
post({ type: 'ready' });
