import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  decodePDFRawStream,
  type PDFContext,
  type PDFObject,
} from 'pdf-lib';

/**
 * Tolerant accessors over pdf-lib's object model.
 *
 * pdf-lib's typed `lookupMaybe(key, Type)` throws when the value has an
 * unexpected type (e.g. a Type0 font whose /Encoding is an embedded CMap
 * stream rather than a name). Real-world PDFs are messy, so the engine
 * only ever uses these helpers, which resolve references and return
 * `undefined` on any mismatch.
 */

export function deref(ctx: PDFContext, obj: PDFObject | undefined): PDFObject | undefined {
  return obj instanceof PDFRef ? ctx.lookup(obj) : obj;
}

export function get(dict: PDFDict | undefined, key: string): PDFObject | undefined {
  if (!dict) return undefined;
  return dict.lookup(PDFName.of(key));
}

export function getDict(dict: PDFDict | undefined, key: string): PDFDict | undefined {
  const v = get(dict, key);
  if (v instanceof PDFDict) return v;
  if (v instanceof PDFStream) return v.dict;
  return undefined;
}

export function getArray(dict: PDFDict | undefined, key: string): PDFArray | undefined {
  const v = get(dict, key);
  return v instanceof PDFArray ? v : undefined;
}

export function getStream(dict: PDFDict | undefined, key: string): PDFStream | undefined {
  const v = get(dict, key);
  return v instanceof PDFStream ? v : undefined;
}

export function getNumber(dict: PDFDict | undefined, key: string): number | undefined {
  const v = get(dict, key);
  return v instanceof PDFNumber ? v.asNumber() : undefined;
}

export function getName(dict: PDFDict | undefined, key: string): string | undefined {
  const v = get(dict, key);
  return v instanceof PDFName ? v.decodeText() : undefined;
}

export function arrayNumbers(arr: PDFArray | undefined): number[] {
  if (!arr) return [];
  const out: number[] = [];
  for (let i = 0; i < arr.size(); i++) {
    const v = arr.lookup(i);
    out.push(v instanceof PDFNumber ? v.asNumber() : NaN);
  }
  return out;
}

/** Decoded (unfiltered) bytes of any stream, or `undefined` if the filter
 *  chain is unsupported (e.g. image codecs, Crypt). */
export function streamBytes(stream: PDFStream): Uint8Array | undefined {
  try {
    if (stream instanceof PDFRawStream) return decodePDFRawStream(stream).decode();
    const s = stream as PDFStream & { getUnencodedContents?: () => Uint8Array };
    return s.getUnencodedContents?.();
  } catch {
    return undefined;
  }
}

/** Shallow copy of a dict (values are shared, keys are independent). */
export function cloneDict(ctx: PDFContext, dict: PDFDict, omit: readonly string[] = []): PDFDict {
  const copy = PDFDict.withContext(ctx);
  for (const [k, v] of dict.entries()) {
    if (!omit.includes(k.decodeText())) copy.set(k, v);
  }
  return copy;
}
