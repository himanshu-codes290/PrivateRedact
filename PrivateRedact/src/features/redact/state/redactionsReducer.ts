import type { PageRedactions, PdfRect } from '@/features/redact/engine';

/**
 * Single source of truth for every redaction box in the session.
 *
 * Shape: fileId → pageIndex (0-based) → boxes. Every update is immutable,
 * so undo/redo history is just a stack of previous `byFile` references —
 * structural sharing keeps each snapshot cheap. The Fabric overlay is a
 * pure VIEW of this state: it renders whatever is here and dispatches
 * actions; it never owns redactions itself.
 */

export interface Redaction {
  id: string;
  rect: PdfRect;
}

export type PageMap = Readonly<Record<number, readonly Redaction[]>>;
export type FileMap = Readonly<Record<string, PageMap>>;

export interface RedactionsState {
  byFile: FileMap;
  past: readonly FileMap[];
  future: readonly FileMap[];
}

export const HISTORY_LIMIT = 100;

export type RedactionsAction =
  | { type: 'add'; fileId: string; page: number; redactions: readonly Redaction[] }
  | { type: 'update'; fileId: string; page: number; updates: readonly Redaction[] }
  | { type: 'remove'; fileId: string; page: number; ids: readonly string[] }
  | { type: 'clear-page'; fileId: string; page: number }
  | { type: 'remove-file'; fileId: string }
  | { type: 'undo' }
  | { type: 'redo' };

export const initialRedactionsState: RedactionsState = { byFile: {}, past: [], future: [] };

function setPage(
  byFile: FileMap,
  fileId: string,
  page: number,
  list: readonly Redaction[],
): FileMap {
  const pages: Record<number, readonly Redaction[]> = { ...(byFile[fileId] ?? {}) };
  if (list.length === 0) delete pages[page];
  else pages[page] = list;
  return { ...byFile, [fileId]: pages };
}

function commit(state: RedactionsState, next: FileMap): RedactionsState {
  if (next === state.byFile) return state;
  return {
    byFile: next,
    past: [...state.past, state.byFile].slice(-HISTORY_LIMIT),
    future: [],
  };
}

export function redactionsReducer(
  state: RedactionsState,
  action: RedactionsAction,
): RedactionsState {
  switch (action.type) {
    case 'add': {
      if (action.redactions.length === 0) return state;
      const current = state.byFile[action.fileId]?.[action.page] ?? [];
      return commit(
        state,
        setPage(state.byFile, action.fileId, action.page, [...current, ...action.redactions]),
      );
    }
    case 'update': {
      const current = state.byFile[action.fileId]?.[action.page];
      if (!current) return state;
      const updates = new Map(action.updates.map((u) => [u.id, u.rect]));
      let changed = false;
      const next = current.map((r) => {
        const rect = updates.get(r.id);
        if (!rect || sameRect(rect, r.rect)) return r;
        changed = true;
        return { ...r, rect };
      });
      return changed
        ? commit(state, setPage(state.byFile, action.fileId, action.page, next))
        : state;
    }
    case 'remove': {
      const current = state.byFile[action.fileId]?.[action.page];
      if (!current) return state;
      const ids = new Set(action.ids);
      const next = current.filter((r) => !ids.has(r.id));
      return next.length === current.length
        ? state
        : commit(state, setPage(state.byFile, action.fileId, action.page, next));
    }
    case 'clear-page': {
      if (!state.byFile[action.fileId]?.[action.page]?.length) return state;
      return commit(state, setPage(state.byFile, action.fileId, action.page, []));
    }
    case 'remove-file': {
      if (!(action.fileId in state.byFile)) return state;
      const { [action.fileId]: _removed, ...rest } = state.byFile;
      // Removing a file is not undoable: drop it from history too, so an
      // undo can never resurrect boxes for a file that is gone.
      const strip = (m: FileMap): FileMap => {
        if (!(action.fileId in m)) return m;
        const { [action.fileId]: _gone, ...others } = m;
        return others;
      };
      return { byFile: rest, past: state.past.map(strip), future: state.future.map(strip) };
    }
    case 'undo': {
      const prev = state.past.at(-1);
      if (!prev) return state;
      return {
        byFile: prev,
        past: state.past.slice(0, -1),
        future: [state.byFile, ...state.future],
      };
    }
    case 'redo': {
      const next = state.future[0];
      if (!next) return state;
      return { byFile: next, past: [...state.past, state.byFile], future: state.future.slice(1) };
    }
  }
}

function sameRect(a: PdfRect, b: PdfRect): boolean {
  const eps = 0.01;
  return (
    Math.abs(a.x - b.x) < eps &&
    Math.abs(a.y - b.y) < eps &&
    Math.abs(a.width - b.width) < eps &&
    Math.abs(a.height - b.height) < eps
  );
}

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

const EMPTY: readonly Redaction[] = [];

export function pageRedactionsOf(
  state: RedactionsState,
  fileId: string,
  page: number,
): readonly Redaction[] {
  return state.byFile[fileId]?.[page] ?? EMPTY;
}

export function countForFile(state: RedactionsState, fileId: string): number {
  const pages = state.byFile[fileId];
  if (!pages) return 0;
  return Object.values(pages).reduce((n, list) => n + list.length, 0);
}

export function pagesWithRedactions(state: RedactionsState, fileId: string): number[] {
  const pages = state.byFile[fileId];
  if (!pages) return [];
  return Object.entries(pages)
    .filter(([, list]) => list.length > 0)
    .map(([p]) => Number(p))
    .sort((a, b) => a - b);
}

/** Engine input: index i = rects for page i (holes are undefined). */
export function toPageRedactions(state: RedactionsState, fileId: string): PageRedactions {
  const pages = state.byFile[fileId];
  if (!pages) return [];
  const out: (PdfRect[] | undefined)[] = [];
  for (const [p, list] of Object.entries(pages)) {
    if (list.length > 0) out[Number(p)] = list.map((r) => r.rect);
  }
  return Array.from({ length: out.length }, (_, i) => out[i]);
}

export function newRedactionId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `r-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
