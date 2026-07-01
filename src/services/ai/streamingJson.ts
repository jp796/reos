/**
 * Incremental top-level JSON field emitter for streamed model output.
 *
 * The extraction model returns one big JSON object. As tokens stream in,
 * this parser detects each top-level `"key": <value>` pair the instant it
 * completes and fires onField(key, parsedValue) — so the UI can show a
 * field the moment the model produces it, instead of waiting for the
 * whole response. Values may be objects, strings, numbers, arrays.
 *
 * It is tolerant of partial input: push() can be called with any chunk
 * boundaries; incomplete pairs are held until more text arrives.
 */
export class IncrementalObjectParser {
  private buf = "";
  private i = 0;
  private started = false;
  private emitted = new Set<string>();

  constructor(private onField: (key: string, value: unknown) => void) {}

  push(chunk: string): void {
    this.buf += chunk;
    this.scan();
  }

  private scan(): void {
    const s = this.buf;
    if (!this.started) {
      const b = s.indexOf("{", this.i);
      if (b < 0) return;
      this.i = b + 1;
      this.started = true;
    }
    for (;;) {
      // skip whitespace + commas between pairs
      while (this.i < s.length && /[\s,]/.test(s[this.i])) this.i++;
      if (this.i >= s.length) return;
      if (s[this.i] === "}") { this.i++; return; } // root object closed
      if (s[this.i] !== '"') return; // wait for a key to start

      const keyRes = this.readString(this.i);
      if (!keyRes) return; // key not fully arrived
      const key = keyRes.value;
      let j = keyRes.end;

      while (j < s.length && /\s/.test(s[j])) j++;
      if (j >= s.length || s[j] !== ":") return;
      j++;
      while (j < s.length && /\s/.test(s[j])) j++;
      if (j >= s.length) return;

      const end = this.readValueEnd(j);
      if (end == null) return; // value not fully arrived

      const valStr = s.slice(j, end);
      let parsed: unknown;
      try {
        parsed = JSON.parse(valStr);
      } catch {
        parsed = undefined;
      }
      if (!this.emitted.has(key)) {
        this.emitted.add(key);
        this.onField(key, parsed);
      }
      this.i = end;
    }
  }

  private readString(p: number): { value: string; end: number } | null {
    const s = this.buf;
    if (s[p] !== '"') return null;
    let esc = false;
    for (let k = p + 1; k < s.length; k++) {
      const ch = s[k];
      if (esc) { esc = false; continue; }
      if (ch === "\\") { esc = true; continue; }
      if (ch === '"') return { value: s.slice(p + 1, k), end: k + 1 };
    }
    return null;
  }

  /** Returns the index just past a complete JSON value at p, or null. */
  private readValueEnd(p: number): number | null {
    const s = this.buf;
    const c = s[p];
    if (c === '"') {
      const r = this.readString(p);
      return r ? r.end : null;
    }
    if (c === "{" || c === "[") return this.readBalancedEnd(p);
    // primitive (number / true / false / null): read to next , } ]
    let k = p;
    while (k < s.length && !",}]".includes(s[k])) k++;
    return k < s.length ? k : null;
  }

  private readBalancedEnd(p: number): number | null {
    const s = this.buf;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let k = p; k < s.length; k++) {
      const ch = s[k];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') { inStr = true; continue; }
      if (ch === "{" || ch === "[") depth++;
      else if (ch === "}" || ch === "]") {
        depth--;
        if (depth === 0) return k + 1;
      }
    }
    return null;
  }
}
