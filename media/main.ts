// M6 视图层：Webview 前端入口（消息收发与状态）。
// 设计依据：detailed-design §8。只通过 M7 协议与宿主交互，不直接 import 宿主模块。

import type { HostToView, ViewToHost, Layout } from '../src/messaging/protocol';
import type { Session, SessionSummary, Turn } from '../src/model/types';
import { renderNodeList, renderMarkdown, applySearchFilter, escapeHtml } from './render';

interface VsCodeApi {
  postMessage(msg: ViewToHost): void;
  getState<T>(): T | undefined;
  setState<T>(state: T): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();

const state = {
  sessions: [] as SessionSummary[],
  current: undefined as Session | undefined,
  stars: new Set<string>(),
  layout: 'detail' as Layout,
  relativeTime: true,
  selectedTurnId: undefined as string | undefined,
};

function post(msg: ViewToHost): void {
  vscode.postMessage(msg);
}

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Missing element #${id}`);
  }
  return el;
}

function init(): void {
  const sessionSelect = $('session-select') as HTMLSelectElement;
  const searchBox = $('search-box') as HTMLInputElement;
  const refreshBtn = $('refresh-btn');
  const layoutBtn = $('layout-btn');
  const nodeList = $('node-list');

  sessionSelect.addEventListener('change', () => {
    post({ type: 'selectSession', sessionId: sessionSelect.value });
  });

  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  searchBox.addEventListener('input', () => {
    if (searchTimer) {
      clearTimeout(searchTimer);
    }
    searchTimer = setTimeout(() => post({ type: 'search', keyword: searchBox.value }), 150);
  });

  refreshBtn.addEventListener('click', () => post({ type: 'refresh' }));

  layoutBtn.addEventListener('click', () => {
    const next: Layout = state.layout === 'detail' ? 'compact' : 'detail';
    post({ type: 'setLayout', layout: next });
  });

  nodeList.addEventListener('click', (ev) => {
    const target = ev.target as HTMLElement;
    const star = target.closest<HTMLElement>('.star');
    if (star && star.dataset.turnId) {
      toggleStarLocal(star.dataset.turnId);
      post({ type: 'toggleStar', turnId: star.dataset.turnId });
      ev.stopPropagation();
      return;
    }
    const node = target.closest<HTMLElement>('.timeline-node');
    if (node && node.dataset.turnId) {
      selectTurn(node.dataset.turnId);
    }
  });

  window.addEventListener('message', (ev: MessageEvent<HostToView>) => onMessage(ev.data));

  post({ type: 'ready' });
}

function onMessage(msg: HostToView): void {
  switch (msg.type) {
    case 'sessions':
      state.sessions = msg.sessions;
      renderSessionSelect();
      if (msg.failures > 0) {
        showStatus(`${msg.failures} session(s) failed to parse`);
      }
      if (msg.sessions.length === 0) {
        state.current = undefined;
        showEmpty('No chat sessions found for this workspace yet.');
        break;
      }
      // 自动选中第一个（最近）会话。
      if (!state.current) {
        post({ type: 'selectSession', sessionId: msg.sessions[0].id });
        (($('session-select') as HTMLSelectElement).value = msg.sessions[0].id);
      }
      break;
    case 'session':
      state.current = msg.session;
      state.stars = new Set(msg.stars);
      renderTimeline();
      break;
    case 'searchResult':
      applySearchFilter($('node-list'), new Set(msg.turnIds));
      break;
    case 'layout':
      state.layout = msg.layout;
      applyLayout();
      break;
    case 'error':
      showStatus(msg.message);
      break;
  }
}

function renderSessionSelect(): void {
  const select = $('session-select') as HTMLSelectElement;
  select.textContent = '';
  for (const s of state.sessions) {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = `${s.title} (${s.turnCount})`;
    select.appendChild(opt);
  }
}

function renderTimeline(): void {
  if (!state.current) {
    return;
  }
  if (state.current.turns.length === 0) {
    showEmpty('This session has no turns to show.');
    $('detail-pane').textContent = '';
    return;
  }
  renderNodeList($('node-list'), state.current.turns, state.stars, state.relativeTime);
  if (state.selectedTurnId) {
    renderDetail(state.selectedTurnId);
  }
}

function showEmpty(message: string): void {
  const list = $('node-list');
  list.textContent = '';
  const empty = document.createElement('div');
  empty.className = 'empty-state';
  empty.textContent = message;
  list.appendChild(empty);
  $('detail-pane').textContent = '';
}

function selectTurn(turnId: string): void {
  state.selectedTurnId = turnId;
  for (const n of Array.from(document.querySelectorAll('.timeline-node'))) {
    n.classList.toggle('selected', (n as HTMLElement).dataset.turnId === turnId);
  }
  post({ type: 'selectTurn', turnId });
  if (state.layout === 'detail') {
    renderDetail(turnId);
  }
}

function renderDetail(turnId: string): void {
  const detail = $('detail-pane');
  const turn = state.current?.turns.find((t) => t.id === turnId);
  if (!turn) {
    detail.textContent = '';
    return;
  }
  detail.textContent = '';
  detail.appendChild(buildDetail(turn));
}

function buildDetail(turn: Turn): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'detail';

  const promptHead = document.createElement('div');
  promptHead.className = 'detail-section-head';
  promptHead.textContent = 'Prompt';
  const copyPrompt = document.createElement('button');
  copyPrompt.className = 'copy-btn';
  copyPrompt.textContent = 'Copy';
  copyPrompt.addEventListener('click', () => post({ type: 'copy', target: 'prompt', turnId: turn.id }));
  promptHead.appendChild(copyPrompt);
  wrap.appendChild(promptHead);

  const promptBody = document.createElement('pre');
  promptBody.className = 'detail-prompt';
  promptBody.textContent = turn.prompt;
  wrap.appendChild(promptBody);

  const respHead = document.createElement('div');
  respHead.className = 'detail-section-head';
  respHead.textContent = 'Response';
  const copyResp = document.createElement('button');
  copyResp.className = 'copy-btn';
  copyResp.textContent = 'Copy';
  copyResp.addEventListener('click', () => post({ type: 'copy', target: 'response', turnId: turn.id }));
  respHead.appendChild(copyResp);
  wrap.appendChild(respHead);

  const respBody = document.createElement('div');
  respBody.className = 'detail-response markdown-body';
  respBody.innerHTML = renderMarkdown(turn.responseMarkdown);
  wrap.appendChild(respBody);

  if (turn.status === 'error' && turn.errorMessage) {
    const err = document.createElement('div');
    err.className = 'detail-error';
    err.textContent = escapeHtml(turn.errorMessage);
    wrap.appendChild(err);
  }

  return wrap;
}

function toggleStarLocal(turnId: string): void {
  if (state.stars.has(turnId)) {
    state.stars.delete(turnId);
  } else {
    state.stars.add(turnId);
  }
  renderTimeline();
}

function applyLayout(): void {
  document.body.dataset.layout = state.layout;
  $('layout-btn').textContent = state.layout === 'detail' ? 'Compact' : 'Detail';
}

function showStatus(text: string): void {
  const status = $('status-bar');
  status.textContent = text;
  status.classList.add('visible');
  setTimeout(() => status.classList.remove('visible'), 4000);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}
