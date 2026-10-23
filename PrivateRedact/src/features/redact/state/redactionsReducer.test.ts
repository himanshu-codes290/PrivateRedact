import { describe, expect, it } from 'vitest';
import {
  HISTORY_LIMIT,
  countForFile,
  initialRedactionsState,
  pageRedactionsOf,
  pagesWithRedactions,
  redactionsReducer as reduce,
  toPageRedactions,
  type Redaction,
  type RedactionsState,
} from './redactionsReducer';

const box = (id: string, x = 0): Redaction => ({ id, rect: { x, y: 0, width: 10, height: 10 } });

function apply(...actions: Parameters<typeof reduce>[1][]): RedactionsState {
  return actions.reduce(reduce, initialRedactionsState);
}

describe('redactionsReducer', () => {
  it('adds boxes per file and per page', () => {
    const s = apply(
      { type: 'add', fileId: 'a', page: 0, redactions: [box('1')] },
      { type: 'add', fileId: 'a', page: 2, redactions: [box('2'), box('3')] },
      { type: 'add', fileId: 'b', page: 0, redactions: [box('4')] },
    );
    expect(pageRedactionsOf(s, 'a', 2).map((r) => r.id)).toEqual(['2', '3']);
    expect(countForFile(s, 'a')).toBe(3);
    expect(pagesWithRedactions(s, 'a')).toEqual([0, 2]);
    expect(countForFile(s, 'b')).toBe(1);
  });

  it('updates and removes by id', () => {
    const s = apply(
      { type: 'add', fileId: 'a', page: 0, redactions: [box('1'), box('2')] },
      { type: 'update', fileId: 'a', page: 0, updates: [box('2', 50)] },
      { type: 'remove', fileId: 'a', page: 0, ids: ['1'] },
    );
    expect(pageRedactionsOf(s, 'a', 0)).toEqual([box('2', 50)]);
  });

  it('ignores no-op updates and removals (no history entry)', () => {
    const s1 = apply({ type: 'add', fileId: 'a', page: 0, redactions: [box('1')] });
    expect(reduce(s1, { type: 'update', fileId: 'a', page: 0, updates: [box('1')] })).toBe(s1);
    expect(reduce(s1, { type: 'remove', fileId: 'a', page: 0, ids: ['nope'] })).toBe(s1);
    expect(reduce(s1, { type: 'add', fileId: 'a', page: 0, redactions: [] })).toBe(s1);
    expect(reduce(s1, { type: 'clear-page', fileId: 'a', page: 5 })).toBe(s1);
  });

  it('undoes and redoes every kind of change', () => {
    let s = apply(
      { type: 'add', fileId: 'a', page: 0, redactions: [box('1')] },
      { type: 'update', fileId: 'a', page: 0, updates: [box('1', 99)] },
      { type: 'clear-page', fileId: 'a', page: 0 },
    );
    expect(countForFile(s, 'a')).toBe(0);
    s = reduce(s, { type: 'undo' });
    expect(pageRedactionsOf(s, 'a', 0)).toEqual([box('1', 99)]);
    s = reduce(s, { type: 'undo' });
    expect(pageRedactionsOf(s, 'a', 0)).toEqual([box('1')]);
    s = reduce(s, { type: 'redo' });
    expect(pageRedactionsOf(s, 'a', 0)).toEqual([box('1', 99)]);
    // A new change clears the redo stack.
    s = reduce(s, { type: 'add', fileId: 'a', page: 1, redactions: [box('2')] });
    expect(s.future).toHaveLength(0);
    expect(reduce(s, { type: 'redo' })).toBe(s);
  });

  it('caps history length', () => {
    let s = initialRedactionsState;
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) {
      s = reduce(s, { type: 'add', fileId: 'a', page: 0, redactions: [box(String(i))] });
    }
    expect(s.past).toHaveLength(HISTORY_LIMIT);
  });

  it('removing a file is permanent and cannot be undone back in', () => {
    let s = apply(
      { type: 'add', fileId: 'a', page: 0, redactions: [box('1')] },
      { type: 'add', fileId: 'b', page: 0, redactions: [box('2')] },
      { type: 'remove-file', fileId: 'a' },
    );
    expect(countForFile(s, 'a')).toBe(0);
    s = reduce(s, { type: 'undo' });
    s = reduce(s, { type: 'undo' });
    expect(countForFile(s, 'a')).toBe(0);
  });

  it('builds engine input with holes for pages without boxes', () => {
    const s = apply({ type: 'add', fileId: 'a', page: 2, redactions: [box('1', 5)] });
    const input = toPageRedactions(s, 'a');
    expect(input).toHaveLength(3);
    expect(input[0]).toBeUndefined();
    expect(input[2]).toEqual([{ x: 5, y: 0, width: 10, height: 10 }]);
    expect(toPageRedactions(s, 'missing')).toEqual([]);
  });
});
