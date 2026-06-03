// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  createNodeElement,
  renderNodeList,
  renderMarkdown,
  applySearchFilter,
  formatTime,
  statusClass,
} from '../../media/render';
import type { Turn } from '../../src/model/types';

function turn(partial: Partial<Turn> = {}): Turn {
  return {
    id: 't1',
    index: 1,
    prompt: 'How do I sort an array?',
    responseMarkdown: 'Use `.sort()`',
    summary: 'How do I sort an array?',
    status: 'completed',
    hasCode: false,
    files: [],
    length: 'short',
    charCount: 30,
    toolCallCount: 0,
    ...partial,
  };
}

describe('M6 statusClass / formatTime', () => {
  it('maps status to css class', () => {
    expect(statusClass('completed')).toBe('status-completed');
    expect(statusClass('error')).toBe('status-error');
    expect(statusClass('in-progress')).toBe('status-in-progress');
  });

  it('formats relative and absolute time', () => {
    const now = 1_000_000_000_000;
    expect(formatTime(now - 30_000, true, now)).toBe('just now');
    expect(formatTime(now - 5 * 60_000, true, now)).toBe('5m ago');
    expect(formatTime(now - 3 * 3600_000, true, now)).toBe('3h ago');
    expect(formatTime(now - 2 * 86400_000, true, now)).toBe('2d ago');
    expect(formatTime(undefined, true, now)).toBe('');
    expect(/^\d{2}:\d{2}$/.test(formatTime(now, false, now))).toBe(true);
  });
});

describe('M6 createNodeElement', () => {
  it('renders status color dot', () => {
    const el = createNodeElement(turn({ status: 'error' }), { starred: false, relativeTime: true });
    const dot = el.querySelector('.dot')!;
    expect(dot.classList.contains('status-error')).toBe(true);
  });

  it('shows </> icon only when hasCode', () => {
    const withCode = createNodeElement(turn({ hasCode: true }), { starred: false, relativeTime: true });
    expect(withCode.querySelector('.code-icon')?.textContent).toBe('</>');
    const noCode = createNodeElement(turn({ hasCode: false }), { starred: false, relativeTime: true });
    expect(noCode.querySelector('.code-icon')).toBeNull();
  });

  it('reflects starred state', () => {
    const starred = createNodeElement(turn(), { starred: true, relativeTime: true });
    expect(starred.querySelector('.star')?.classList.contains('starred')).toBe(true);
    expect(starred.querySelector('.star')?.textContent).toBe('★');
    const unstarred = createNodeElement(turn(), { starred: false, relativeTime: true });
    expect(unstarred.querySelector('.star')?.classList.contains('starred')).toBe(false);
  });

  it('shows tool badge only when toolCallCount > 0', () => {
    const withTools = createNodeElement(turn({ toolCallCount: 3 }), { starred: false, relativeTime: true });
    expect(withTools.querySelector('.node-tools')?.textContent).toContain('3');
    const noTools = createNodeElement(turn({ toolCallCount: 0 }), { starred: false, relativeTime: true });
    expect(noTools.querySelector('.node-tools')).toBeNull();
  });

  it('collapses extra files into +N', () => {
    const el = createNodeElement(
      turn({ files: [{ name: 'a.ts', path: '/a.ts' }, { name: 'b.ts', path: '/b.ts' }, { name: 'c.ts', path: '/c.ts' }] }),
      { starred: false, relativeTime: true },
    );
    expect(el.querySelector('.file-chip')?.textContent).toBe('a.ts');
    expect(el.querySelector('.file-more')?.textContent).toBe('+2');
  });

  it('renders length marker', () => {
    const el = createNodeElement(turn({ length: 'long' }), { starred: false, relativeTime: true });
    expect(el.querySelector('.node-length')?.classList.contains('length-long')).toBe(true);
  });
});

describe('M6 renderMarkdown (sanitization + highlight)', () => {
  it('renders markdown and highlights code', () => {
    const html = renderMarkdown('Hello **world**\n\n```js\nconst x = 1;\n```');
    expect(html).toContain('<strong>world</strong>');
    expect(html).toContain('hljs');
  });

  it('escapes raw HTML to prevent injection', () => {
    const html = renderMarkdown('<script>alert(1)</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('M6 list rendering + search filter', () => {
  it('renders a node per turn and filters by matched ids', () => {
    const container = document.createElement('div');
    const turns = [turn({ id: 'a' }), turn({ id: 'b' }), turn({ id: 'c' })];
    renderNodeList(container, turns, new Set(['b']), true);
    expect(container.querySelectorAll('.timeline-node')).toHaveLength(3);
    expect(container.querySelector('[data-turn-id="b"] .star')?.classList.contains('starred')).toBe(true);

    const visible = applySearchFilter(container, new Set(['a', 'c']));
    expect(visible).toBe(2);
    expect((container.querySelector('[data-turn-id="b"]') as HTMLElement).classList.contains('hidden')).toBe(true);
    expect((container.querySelector('[data-turn-id="a"]') as HTMLElement).classList.contains('search-hit')).toBe(true);

    // null clears the filter
    const all = applySearchFilter(container, null);
    expect(all).toBe(3);
  });
});
