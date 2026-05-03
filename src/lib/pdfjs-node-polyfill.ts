/**
 * Node.js polyfill for browser DOM APIs that pdfjs-dist references.
 *
 * pdf-parse v2 bundles pdfjs-dist v4+, whose code paths reference
 * `DOMMatrix`, `Path2D`, and `ImageData` even when only doing text
 * extraction. Node has none of these. On certain PDFs (those with
 * rotated/transformed content streams or embedded images) pdfjs hits
 * one of those refs and throws "DOMMatrix is not defined" — which we
 * surface to the user as "extraction failed: DOMMatrix is not defined".
 *
 * For TEXT extraction we don't actually need real implementations —
 * pdfjs only checks `instanceof` and stores values it never reads.
 * Minimal stubs satisfy the references without pulling in `canvas`
 * (which is a 50MB native build).
 *
 * Import this module ONCE before any `import("pdf-parse")` call.
 */

type AnyCtor = new (...args: unknown[]) => unknown;

// Minimal DOMMatrix — pdfjs uses it for transforms during page parsing.
// We expose just enough surface area that property reads don't throw.
class DOMMatrixStub {
  a = 1;
  b = 0;
  c = 0;
  d = 1;
  e = 0;
  f = 0;
  is2D = true;
  isIdentity = true;
  m11 = 1;
  m12 = 0;
  m13 = 0;
  m14 = 0;
  m21 = 0;
  m22 = 1;
  m23 = 0;
  m24 = 0;
  m31 = 0;
  m32 = 0;
  m33 = 1;
  m34 = 0;
  m41 = 0;
  m42 = 0;
  m43 = 0;
  m44 = 1;

  constructor(init?: number[] | string) {
    if (Array.isArray(init) && init.length >= 6) {
      this.a = init[0];
      this.b = init[1];
      this.c = init[2];
      this.d = init[3];
      this.e = init[4];
      this.f = init[5];
      this.m11 = this.a;
      this.m12 = this.b;
      this.m21 = this.c;
      this.m22 = this.d;
      this.m41 = this.e;
      this.m42 = this.f;
    }
  }

  multiply(): DOMMatrixStub {
    return new DOMMatrixStub();
  }
  translate(): DOMMatrixStub {
    return new DOMMatrixStub();
  }
  scale(): DOMMatrixStub {
    return new DOMMatrixStub();
  }
  rotate(): DOMMatrixStub {
    return new DOMMatrixStub();
  }
  inverse(): DOMMatrixStub {
    return new DOMMatrixStub();
  }
  transformPoint(p?: { x?: number; y?: number; z?: number; w?: number }) {
    return { x: p?.x ?? 0, y: p?.y ?? 0, z: p?.z ?? 0, w: p?.w ?? 1 };
  }
}

class Path2DStub {
  // pdfjs only constructs and forgets it during text-only extraction
  addPath(): void {}
  closePath(): void {}
  moveTo(): void {}
  lineTo(): void {}
  bezierCurveTo(): void {}
  quadraticCurveTo(): void {}
  arc(): void {}
  arcTo(): void {}
  ellipse(): void {}
  rect(): void {}
}

class ImageDataStub {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  colorSpace = "srgb" as const;
  constructor(w: number, h: number) {
    this.width = w;
    this.height = h;
    this.data = new Uint8ClampedArray(w * h * 4);
  }
}

const g = globalThis as unknown as Record<string, unknown>;
if (typeof g.DOMMatrix === "undefined") {
  g.DOMMatrix = DOMMatrixStub as unknown as AnyCtor;
}
if (typeof g.Path2D === "undefined") {
  g.Path2D = Path2DStub as unknown as AnyCtor;
}
if (typeof g.ImageData === "undefined") {
  g.ImageData = ImageDataStub as unknown as AnyCtor;
}

export {};
