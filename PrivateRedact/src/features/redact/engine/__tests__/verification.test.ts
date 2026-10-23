import { describe, expect, it } from 'vitest';
import { redactPdf } from '../redactPdf';
import { charactersInsideRects } from '@/features/redact/lib/verifyRedaction';
import { buildPdf } from './helpers';

/**
 * End-to-end check of the production verification step: run the engine,
 * then extract text from the OUTPUT with PDF.js (a different parser) and
 * count characters still under the boxes, exactly as the app does.
 */
async function textItems(bytes: Uint8Array) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 });
  const pdf = await task.promise;
  const page = await pdf.getPage(1);
  const content = await page.getTextContent();
  const items = content.items.filter((i) => 'str' in i) as {
    str: string;
    transform: number[];
    width: number;
    height: number;
  }[];
  await task.destroy();
  return items;
}

describe('independent verification with PDF.js', () => {
  const rect = { x: 98, y: 696, width: 68, height: 22 };

  it('finds the text under the box BEFORE redaction', async () => {
    const input = await buildPdf([{ content: 'BT /F1 20 Tf 100 700 Td (HELLO WORLD) Tj ET' }]);
    expect(charactersInsideRects(await textItems(input), [rect])).toBe(5);
  });

  it('finds nothing under the box AFTER redaction', async () => {
    const input = await buildPdf([{ content: 'BT /F1 20 Tf 100 700 Td (HELLO WORLD) Tj ET' }]);
    const { bytes } = await redactPdf(input, [[rect]]);
    const items = await textItems(bytes);
    expect(charactersInsideRects(items, [rect])).toBe(0);
    expect(items.map((i) => i.str).join('')).toContain('WORLD');
  });
});
