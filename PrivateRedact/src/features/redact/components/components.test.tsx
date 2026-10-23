// @vitest-environment happy-dom
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import userEvent from '@testing-library/user-event';
import { renderHook } from '@testing-library/react';
import { ConfirmRedactionDialog } from './ConfirmRedactionDialog';
import { PageThumbnails } from './PageThumbnails';
import { useWorkspaceShortcuts, type ShortcutHandlers } from '../hooks/useWorkspaceShortcuts';

const file = { name: 'a.pdf', index: 1, total: 3, boxes: 2, pages: 1 };

function dialog(overrides: Partial<Parameters<typeof ConfirmRedactionDialog>[0]> = {}) {
  const props = {
    file,
    processing: false,
    progress: 0,
    stage: '',
    error: null,
    onApply: vi.fn(),
    onApplyAll: vi.fn(),
    onSkip: vi.fn(),
    onEditAgain: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
  render(<ConfirmRedactionDialog {...props} />);
  return props;
}

describe('ConfirmRedactionDialog', () => {
  it('is an accessible modal that focuses the primary action', () => {
    dialog();
    const modal = screen.getByRole('dialog', { name: 'Apply redactions' });
    expect(modal).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('button', { name: 'Apply' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Apply to all 3' })).toBeInTheDocument();
  });

  it('closes with Escape when idle and traps Tab focus', async () => {
    const user = userEvent.setup();
    const props = dialog();
    await user.keyboard('{Escape}');
    expect(props.onEditAgain).toHaveBeenCalledOnce();
    // Tab from the last control wraps to the first.
    screen.getByRole('button', { name: 'Apply' }).focus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Back to editing' })).toHaveFocus();
  });

  it('shows progress and only Cancel while processing; Escape does nothing', async () => {
    const user = userEvent.setup();
    const props = dialog({ processing: true, progress: 0.42, stage: 'Removing content…' });
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '42');
    expect(screen.queryByRole('button', { name: 'Apply' })).not.toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(props.onEditAgain).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(props.onCancel).toHaveBeenCalledOnce();
  });

  it('offers retry after an error', () => {
    dialog({ error: 'encrypted' });
    expect(screen.getByRole('alert')).toHaveTextContent('encrypted');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});

describe('useWorkspaceShortcuts', () => {
  const handlers = (): ShortcutHandlers => ({
    selectTool: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    deleteSelection: vi.fn(),
    deselect: vi.fn(),
    nextPage: vi.fn(),
    prevPage: vi.fn(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    zoomReset: vi.fn(),
  });

  it('maps keys to actions', async () => {
    const user = userEvent.setup();
    const h = handlers();
    renderHook(() => useWorkspaceShortcuts(h, true));
    await user.keyboard('r');
    expect(h.selectTool).toHaveBeenCalledWith('rect');
    await user.keyboard('{Control>}z{/Control}');
    expect(h.undo).toHaveBeenCalled();
    await user.keyboard('{Control>}{Shift>}z{/Shift}{/Control}');
    expect(h.redo).toHaveBeenCalled();
    await user.keyboard('{Delete}');
    expect(h.deleteSelection).toHaveBeenCalled();
    await user.keyboard('{PageDown}');
    expect(h.nextPage).toHaveBeenCalled();
  });

  it('ignores keys typed into inputs and when disabled', async () => {
    const user = userEvent.setup();
    const h = handlers();
    const { rerender } = renderHook(({ on }) => useWorkspaceShortcuts(h, on), {
      initialProps: { on: true },
    });
    render(<input aria-label="page" />);
    await user.click(screen.getByLabelText('page'));
    await user.keyboard('r');
    expect(h.selectTool).not.toHaveBeenCalled();
    rerender({ on: false });
    (document.activeElement as HTMLElement).blur();
    await user.keyboard('r');
    expect(h.selectTool).not.toHaveBeenCalled();
  });
});

describe('PageThumbnails', () => {
  /** A fake PDF.js document: pages are 600×800 pt and "render" instantly. */
  function fakeDoc(numPages: number) {
    const page = {
      getViewport: ({ scale }: { scale: number }) => ({
        width: 600 * scale,
        height: 800 * scale,
        convertToViewportPoint: (x: number, y: number) => [x * scale, (800 - y) * scale],
      }),
      render: () => ({ promise: Promise.resolve(), cancel: () => {} }),
      cleanup: () => true,
    };
    return { numPages, getPage: vi.fn(() => Promise.resolve(page)) } as unknown as PDFDocumentProxy;
  }

  it('lists every page, marks the current one, and navigates on click', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<PageThumbnails doc={fakeDoc(4)} currentPage={2} pages={{}} onSelect={onSelect} />);
    const nav = screen.getByRole('complementary', { name: 'Pages' });
    expect(within(nav).getAllByRole('button')).toHaveLength(4);
    expect(within(nav).getByRole('button', { name: 'Page 2' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await user.click(within(nav).getByRole('button', { name: 'Page 4' }));
    expect(onSelect).toHaveBeenCalledWith(4);
  });

  it('shows how many boxes each page has and previews them', async () => {
    // happy-dom has no layout, so nothing ever "intersects": report every
    // observed thumbnail as on screen, as a real browser would when scrolled.
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        private readonly cb: IntersectionObserverCallback;
        constructor(cb: IntersectionObserverCallback) {
          this.cb = cb;
        }
        observe(target: Element) {
          this.cb(
            [{ isIntersecting: true, target } as IntersectionObserverEntry],
            this as unknown as IntersectionObserver,
          );
        }
        disconnect() {}
      },
    );
    onTestFinished(() => {
      vi.unstubAllGlobals();
    });
    const doc = fakeDoc(3);
    render(
      <PageThumbnails
        doc={doc}
        currentPage={1}
        pages={{
          2: [
            { id: 'a', rect: { x: 0, y: 700, width: 300, height: 100 } },
            { id: 'b', rect: { x: 0, y: 0, width: 60, height: 80 } },
          ],
        }}
        onSelect={vi.fn()}
      />,
    );
    const third = screen.getByRole('button', { name: 'Page 3, 2 redaction boxes' });
    expect(third).toHaveTextContent('2');
    expect(screen.getByText('Boxes on 1 page')).toBeInTheDocument();
    // Once rendered, the first box covers the top half of the 132 px wide thumbnail.
    const { getPage } = doc as unknown as { getPage: ReturnType<typeof vi.fn> };
    await waitFor(() => expect(getPage).toHaveBeenCalledWith(3));
    await waitFor(() => {
      const boxes = third.querySelectorAll<HTMLElement>('[data-redaction-preview]');
      expect(boxes).toHaveLength(2);
      expect(boxes[0]!.style.width).toBe('66px');
      expect(boxes[0]!.style.top).toBe('0px');
    });
  });
});
