import { PDFDict, PDFName, PDFRef, PDFStream, type PDFContext } from 'pdf-lib';
import { cloneDict, deref, getDict } from './pdfObjects';

/**
 * A view over one `/Resources` dictionary with copy-on-write semantics.
 *
 * Resource dictionaries are frequently SHARED (inherited from the page
 * tree, or the same object referenced by many pages / forms). The engine
 * must never mutate a shared dictionary, or redacting page 1 would change
 * page 7. The first mutation therefore clones the dictionary (and its
 * /XObject sub-dictionary) and hands the clone to its owner via `adopt`.
 *
 * The scope also tracks which XObject names are still drawn and which were
 * removed, so `finalize()` can drop entries for removed images/forms —
 * otherwise the original, unredacted object would stay reachable and be
 * written to the output file.
 */
export class ResourceScope {
  private dict: PDFDict | undefined;
  private owned = false;
  private readonly used = new Set<string>();
  private readonly removed = new Set<string>();
  private readonly ctx: PDFContext;
  private readonly adopt: (dict: PDFDict) => void;

  constructor(ctx: PDFContext, dict: PDFDict | undefined, adopt: (dict: PDFDict) => void) {
    this.ctx = ctx;
    this.dict = dict;
    this.adopt = adopt;
  }

  font(name: string): PDFDict | undefined {
    return getDict(getDict(this.dict, 'Font'), name);
  }

  xobject(name: string): { ref?: PDFRef; stream?: PDFStream } {
    const xobjects = getDict(this.dict, 'XObject');
    const raw = xobjects?.get(PDFName.of(name));
    const resolved = deref(this.ctx, raw);
    return {
      ref: raw instanceof PDFRef ? raw : undefined,
      stream: resolved instanceof PDFStream ? resolved : undefined,
    };
  }

  markUsed(name: string): void {
    this.used.add(name);
  }

  markRemoved(name: string): void {
    this.removed.add(name);
  }

  /** Register a new XObject under a fresh name and return that name. */
  addXObject(ref: PDFRef): string {
    const xobjects = this.ownXObjectDict();
    let i = 1;
    while (xobjects.has(PDFName.of(`PRx${i}`))) i++;
    const name = `PRx${i}`;
    xobjects.set(PDFName.of(name), ref);
    this.used.add(name);
    return name;
  }

  /** Drop XObject entries that were removed and are no longer drawn. */
  finalize(): void {
    const stale = [...this.removed].filter((n) => !this.used.has(n));
    if (stale.length === 0) return;
    const xobjects = this.ownXObjectDict();
    for (const name of stale) xobjects.delete(PDFName.of(name));
  }

  private ensureOwned(): PDFDict {
    if (!this.owned || !this.dict) {
      const copy = this.dict ? cloneDict(this.ctx, this.dict) : PDFDict.withContext(this.ctx);
      const xobjects = getDict(copy, 'XObject');
      if (xobjects) copy.set(PDFName.of('XObject'), cloneDict(this.ctx, xobjects));
      this.dict = copy;
      this.owned = true;
      this.adopt(copy);
    }
    return this.dict;
  }

  private ownXObjectDict(): PDFDict {
    const dict = this.ensureOwned();
    const existing = dict.get(PDFName.of('XObject'));
    if (existing instanceof PDFDict) return existing;
    const fresh = PDFDict.withContext(this.ctx);
    dict.set(PDFName.of('XObject'), fresh);
    return fresh;
  }
}
