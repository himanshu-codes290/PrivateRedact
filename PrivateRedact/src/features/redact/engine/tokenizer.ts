/**
 * PDF content-stream tokenizer.
 *
 * Works directly on the decoded stream bytes and records the byte range of
 * every operator (operands + keyword), so the interpreter can splice edits
 * into the original bytes while leaving everything else byte-identical.
 *
 * Robustness rules (a malformed or hostile PDF must never hang the worker):
 *  - every loop iteration advances the cursor by at least one byte;
 *  - literal strings track balanced parentheses, as the spec allows;
 *  - nesting depth of arrays / dictionaries is capped;
 *  - stray delimiters are skipped instead of being re-read forever.
 */

export type Operand =
  | { t: 'num'; v: number }
  | { t: 'name'; v: string }
  | { t: 'str'; bytes: Uint8Array }
  | { t: 'array'; items: Operand[] }
  | { t: 'dict' }
  | { t: 'bool'; v: boolean }
  | { t: 'null' };

export interface InlineImageParams {
  [key: string]: Operand | undefined;
}

export interface Op {
  name: string;
  operands: Operand[];
  /** Byte offset of the first operand (or of the keyword when none). */
  start: number;
  /** Byte offset just past the keyword (past `EI` for inline images). */
  end: number;
  /** Present only for `BI … ID … EI` inline images. */
  inlineImage?: InlineImageParams;
}

const MAX_NESTING = 64;

const CH = {
  LPAREN: 0x28,
  RPAREN: 0x29,
  LT: 0x3c,
  GT: 0x3e,
  LBRACKET: 0x5b,
  RBRACKET: 0x5d,
  LBRACE: 0x7b,
  RBRACE: 0x7d,
  SLASH: 0x2f,
  PERCENT: 0x25,
  BACKSLASH: 0x5c,
  HASH: 0x23,
  CR: 0x0d,
  LF: 0x0a,
} as const;

export function isWhite(c: number | undefined): boolean {
  return c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09 || c === 0x0c || c === 0x00;
}

export function isDelimiter(c: number | undefined): boolean {
  return (
    c === CH.LPAREN ||
    c === CH.RPAREN ||
    c === CH.LT ||
    c === CH.GT ||
    c === CH.LBRACKET ||
    c === CH.RBRACKET ||
    c === CH.LBRACE ||
    c === CH.RBRACE ||
    c === CH.SLASH ||
    c === CH.PERCENT
  );
}

function isRegular(c: number | undefined): boolean {
  return c !== undefined && !isWhite(c) && !isDelimiter(c);
}

function isNumberStart(c: number): boolean {
  return (c >= 0x30 && c <= 0x39) || c === 0x2b || c === 0x2d || c === 0x2e;
}

function hexValue(c: number): number {
  if (c >= 0x30 && c <= 0x39) return c - 0x30;
  if (c >= 0x41 && c <= 0x46) return c - 0x37;
  if (c >= 0x61 && c <= 0x66) return c - 0x57;
  return -1;
}

class Tokenizer {
  pos = 0;
  private readonly data: Uint8Array;
  private readonly n: number;

  constructor(data: Uint8Array) {
    this.data = data;
    this.n = data.length;
  }

  /** Skip whitespace and `%` comments. */
  skipWhiteAndComments(): void {
    const { data, n } = this;
    while (this.pos < n) {
      const c = data[this.pos];
      if (isWhite(c)) {
        this.pos++;
      } else if (c === CH.PERCENT) {
        while (this.pos < n && data[this.pos] !== CH.LF && data[this.pos] !== CH.CR) this.pos++;
      } else {
        return;
      }
    }
  }

  readWord(): string {
    const { data, n } = this;
    const start = this.pos;
    while (this.pos < n && isRegular(data[this.pos])) this.pos++;
    let s = '';
    for (let i = start; i < this.pos; i++) s += String.fromCharCode(data[i]!);
    return s;
  }

  readLiteralString(): Uint8Array {
    const { data, n } = this;
    this.pos++; // '('
    const out: number[] = [];
    let depth = 1;
    while (this.pos < n) {
      const c = data[this.pos]!;
      if (c === CH.BACKSLASH) {
        this.pos++;
        if (this.pos >= n) break;
        const e = data[this.pos]!;
        switch (e) {
          case 0x6e:
            out.push(0x0a);
            this.pos++;
            break; // \n
          case 0x72:
            out.push(0x0d);
            this.pos++;
            break; // \r
          case 0x74:
            out.push(0x09);
            this.pos++;
            break; // \t
          case 0x62:
            out.push(0x08);
            this.pos++;
            break; // \b
          case 0x66:
            out.push(0x0c);
            this.pos++;
            break; // \f
          case CH.CR:
            // Line continuation: backslash + EOL produces nothing.
            this.pos++;
            if (data[this.pos] === CH.LF) this.pos++;
            break;
          case CH.LF:
            this.pos++;
            break;
          default:
            if (e >= 0x30 && e <= 0x37) {
              let v = 0;
              let digits = 0;
              while (
                digits < 3 &&
                this.pos < n &&
                data[this.pos]! >= 0x30 &&
                data[this.pos]! <= 0x37
              ) {
                v = v * 8 + (data[this.pos]! - 0x30);
                this.pos++;
                digits++;
              }
              out.push(v & 0xff);
            } else {
              out.push(e); // \( \) \\ and unknown escapes yield the char itself
              this.pos++;
            }
        }
        continue;
      }
      if (c === CH.LPAREN) depth++;
      if (c === CH.RPAREN) {
        depth--;
        if (depth === 0) {
          this.pos++;
          break;
        }
      }
      out.push(c);
      this.pos++;
    }
    return Uint8Array.from(out);
  }

  readHexString(): Uint8Array {
    const { data, n } = this;
    this.pos++; // '<'
    const out: number[] = [];
    let hi = -1;
    while (this.pos < n && data[this.pos] !== CH.GT) {
      const v = hexValue(data[this.pos]!);
      this.pos++;
      if (v < 0) continue; // whitespace / junk
      if (hi < 0) {
        hi = v;
      } else {
        out.push((hi << 4) | v);
        hi = -1;
      }
    }
    if (hi >= 0) out.push(hi << 4); // odd digit count: final digit padded with 0
    if (this.pos < n) this.pos++; // '>'
    return Uint8Array.from(out);
  }

  /** Skip a `<< … >>` dictionary (kept opaque; its bytes stay untouched). */
  skipDictionary(): void {
    const { data, n } = this;
    this.pos += 2;
    let depth = 1;
    while (this.pos < n && depth > 0) {
      const c = data[this.pos];
      if (c === CH.LT && data[this.pos + 1] === CH.LT) {
        depth++;
        this.pos += 2;
      } else if (c === CH.GT && data[this.pos + 1] === CH.GT) {
        depth--;
        this.pos += 2;
      } else if (c === CH.LPAREN) {
        this.readLiteralString();
      } else if (c === CH.PERCENT) {
        this.skipWhiteAndComments();
      } else {
        this.pos++;
      }
    }
  }

  readName(): string {
    const { data, n } = this;
    this.pos++; // '/'
    let s = '';
    while (this.pos < n && isRegular(data[this.pos])) {
      const c = data[this.pos]!;
      if (c === CH.HASH && this.pos + 2 < n) {
        const h = hexValue(data[this.pos + 1]!);
        const l = hexValue(data[this.pos + 2]!);
        if (h >= 0 && l >= 0) {
          s += String.fromCharCode((h << 4) | l);
          this.pos += 3;
          continue;
        }
      }
      s += String.fromCharCode(c);
      this.pos++;
    }
    return s;
  }

  readNumber(): number {
    const { data, n } = this;
    const start = this.pos;
    this.pos++;
    while (this.pos < n && isNumberStart(data[this.pos]!)) this.pos++;
    let s = '';
    for (let i = start; i < this.pos; i++) s += String.fromCharCode(data[i]!);
    const v = parseFloat(s);
    return Number.isFinite(v) ? v : 0;
  }

  /**
   * Read one operand at the cursor. Returns `undefined` when the byte at the
   * cursor does not start an operand (the caller then decides what to do).
   */
  readOperand(depth: number): Operand | undefined {
    const c = this.data[this.pos];
    if (c === undefined) return undefined;
    if (c === CH.LPAREN) return { t: 'str', bytes: this.readLiteralString() };
    if (c === CH.LT) {
      if (this.data[this.pos + 1] === CH.LT) {
        this.skipDictionary();
        return { t: 'dict' };
      }
      return { t: 'str', bytes: this.readHexString() };
    }
    if (c === CH.LBRACKET) return this.readArray(depth + 1);
    if (c === CH.SLASH) return { t: 'name', v: this.readName() };
    if (isNumberStart(c)) return { t: 'num', v: this.readNumber() };
    return undefined;
  }

  readArray(depth: number): Operand {
    const { data, n } = this;
    this.pos++; // '['
    const items: Operand[] = [];
    while (this.pos < n) {
      this.skipWhiteAndComments();
      const c = data[this.pos];
      if (c === undefined) break;
      if (c === CH.RBRACKET) {
        this.pos++;
        break;
      }
      if (depth > MAX_NESTING) {
        this.pos++;
        continue;
      }
      const before = this.pos;
      const v = this.readOperand(depth);
      if (v) {
        items.push(v);
      } else if (isRegular(c)) {
        const w = this.readWord();
        if (w === 'true' || w === 'false') items.push({ t: 'bool', v: w === 'true' });
        else items.push({ t: 'null' });
      }
      if (this.pos === before) this.pos++; // stray delimiter inside an array
    }
    return { t: 'array', items };
  }

  /**
   * Parse an inline image starting just after the `BI` keyword.
   * Returns the parameters; the cursor ends just past `EI`.
   */
  readInlineImage(): InlineImageParams {
    const { data, n } = this;
    const params: InlineImageParams = {};
    // Key/value pairs until the `ID` keyword.
    while (this.pos < n) {
      this.skipWhiteAndComments();
      if (this.pos >= n) return params;
      const c = data[this.pos]!;
      if (isRegular(c) && !isNumberStart(c)) {
        const w = this.readWord();
        if (w === 'ID') break;
        if (w === 'EI') return params; // malformed: no data at all
        continue;
      }
      const before = this.pos;
      const key = this.readOperand(0);
      if (key?.t === 'name') {
        this.skipWhiteAndComments();
        const vc = data[this.pos];
        if (isRegular(vc) && vc !== undefined && !isNumberStart(vc)) {
          const w = this.readWord();
          if (w === 'ID') break;
          params[key.v] =
            w === 'true' || w === 'false' ? { t: 'bool', v: w === 'true' } : { t: 'name', v: w };
        } else {
          params[key.v] = this.readOperand(0);
        }
      }
      if (this.pos === before) this.pos++;
    }
    // Exactly one whitespace byte separates `ID` from the binary data.
    if (isWhite(data[this.pos])) this.pos++;
    const dataStart = this.pos;

    const expected = expectedInlineImageLength(params);
    if (expected !== undefined) {
      let p = dataStart + expected;
      while (p < n && isWhite(data[p])) p++;
      if (data[p] === 0x45 && data[p + 1] === 0x49 && !isRegular(data[p + 2])) {
        this.pos = p + 2;
        return params;
      }
    }
    this.pos = findEndOfInlineImage(data, dataStart);
    return params;
  }
}

function numParam(params: InlineImageParams, ...keys: string[]): number | undefined {
  for (const k of keys) {
    const v = params[k];
    if (v?.t === 'num') return v.v;
  }
  return undefined;
}

/** Exact byte length of an UNFILTERED inline image, when computable. */
function expectedInlineImageLength(params: InlineImageParams): number | undefined {
  const explicit = numParam(params, 'L', 'Length');
  if (explicit !== undefined) return explicit;
  if (params.F ?? params.Filter) return undefined;
  const w = numParam(params, 'W', 'Width');
  const h = numParam(params, 'H', 'Height');
  if (w === undefined || h === undefined) return undefined;
  const mask = params.IM ?? params.ImageMask;
  let bpc = numParam(params, 'BPC', 'BitsPerComponent');
  let comps: number | undefined;
  if (mask?.t === 'bool' && mask.v) {
    comps = 1;
    bpc = 1;
  } else {
    const cs = params.CS ?? params.ColorSpace;
    if (cs?.t === 'name') {
      comps = {
        G: 1,
        DeviceGray: 1,
        RGB: 3,
        DeviceRGB: 3,
        CMYK: 4,
        DeviceCMYK: 4,
        I: 1,
        Indexed: 1,
      }[cs.v];
    } else if (cs?.t === 'array') {
      comps = 1; // [/Indexed base hival lookup]
    }
  }
  if (comps === undefined || bpc === undefined) return undefined;
  return h * Math.ceil((w * comps * bpc) / 8);
}

/**
 * Locate the `EI` that ends inline-image data of unknown length. Mirrors
 * PDF.js' heuristic: `EI` must be whitespace-delimited and followed by
 * text-like bytes (the next operators), not more binary data.
 */
function findEndOfInlineImage(data: Uint8Array, from: number): number {
  const n = data.length;
  for (let i = from; i + 1 < n; i++) {
    if (data[i] !== 0x45 || data[i + 1] !== 0x49) continue;
    if (i > from && !isWhite(data[i - 1])) continue;
    const after = data[i + 2];
    if (after !== undefined && isRegular(after)) continue;
    let binary = false;
    for (let k = i + 2; k < Math.min(n, i + 2 + 75); k++) {
      const b = data[k]!;
      if ((b < 0x20 && !isWhite(b)) || b > 0x7e) {
        binary = true;
        break;
      }
    }
    if (!binary) return i + 2;
  }
  return n;
}

/** Tokenize a decoded content stream into operators with byte ranges. */
export function parseContentStream(data: Uint8Array): Op[] {
  const tk = new Tokenizer(data);
  const ops: Op[] = [];
  let operands: Operand[] = [];
  let operandsStart = -1;
  const n = data.length;

  while (tk.pos < n) {
    tk.skipWhiteAndComments();
    if (tk.pos >= n) break;
    const c = data[tk.pos]!;
    const start = tk.pos;

    const operand = tk.readOperand(0);
    if (operand) {
      if (operandsStart < 0) operandsStart = start;
      operands.push(operand);
      if (tk.pos === start) tk.pos++;
      continue;
    }

    if (!isRegular(c)) {
      tk.pos++; // stray ')', '>', ']', '{' or '}': skip it
      continue;
    }

    const word = tk.readWord();
    if (word === 'true' || word === 'false') {
      if (operandsStart < 0) operandsStart = start;
      operands.push({ t: 'bool', v: word === 'true' });
      continue;
    }
    if (word === 'null') {
      if (operandsStart < 0) operandsStart = start;
      operands.push({ t: 'null' });
      continue;
    }

    const op: Op = {
      name: word,
      operands,
      start: operandsStart >= 0 ? operandsStart : start,
      end: tk.pos,
    };
    if (word === 'BI') {
      op.inlineImage = tk.readInlineImage();
      op.end = tk.pos;
    }
    ops.push(op);
    operands = [];
    operandsStart = -1;
  }
  return ops;
}
