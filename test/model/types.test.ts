import { describe, it, expect } from 'vitest';
import type {
  Turn,
  Session,
  SessionSummary,
  TurnFileRef,
  TurnUsage,
  TurnStatus,
  LengthBucket,
  StarSet,
} from '../../src/model/types';

// M3 为纯类型契约：本测试通过构造合法对象在编译期校验类型，
// 并在运行期做最小断言确保对象结构符合预期。

describe('M3 model types', () => {
  it('constructs a valid Turn', () => {
    const file: TurnFileRef = { name: 'a.ts', path: '/x/a.ts' };
    const usage: TurnUsage = { estimated: true, tokens: 10 };
    const status: TurnStatus = 'completed';
    const length: LengthBucket = 'short';
    const turn: Turn = {
      id: 'request_1',
      index: 1,
      prompt: 'hi',
      responseMarkdown: 'hello',
      summary: 'hi',
      status,
      hasCode: false,
      files: [file],
      length,
      charCount: 7,
      toolCallCount: 0,
      usage,
    };
    expect(turn.id).toBe('request_1');
    expect(turn.files[0].name).toBe('a.ts');
    expect(turn.usage?.estimated).toBe(true);
  });

  it('constructs a valid Session and SessionSummary', () => {
    const session: Session = {
      id: 's1',
      title: 'T',
      workspaceId: 'ws',
      turns: [],
    };
    const summary: SessionSummary = {
      id: 's1',
      title: 'T',
      workspaceId: 'ws',
      turnCount: 0,
    };
    expect(session.turns).toHaveLength(0);
    expect(summary.turnCount).toBe(0);
  });

  it('StarSet serializes to string[]', () => {
    const stars: StarSet = new Set(['a', 'b']);
    expect([...stars]).toEqual(['a', 'b']);
  });
});
