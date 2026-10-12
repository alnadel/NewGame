// Enforces the determinism rules of V1_PLAN §2.1 on src/core and src/config, and the import layering
// of V1_PLAN §2.3 on every layer of src.
//
// Determinism: a TypeScript scanner pass drops comments, string literals and template-literal text
// (template ${…} expressions and code after regex literals are still scanned), then FORBIDDEN token
// patterns are matched against what is left.
//
// Layering (imports are read from the AST, so comments and strings never count):
//   config   → config (pure data tables that may share types and constants)
//   core     → core, config
//   platform → platform
//   meta     → meta, core, config, platform
//   ui       → ui, meta, core, config, platform
//   audio    → audio, core, config, platform
//   render   → render, core, config, meta, platform (+ ../game/camera.ts, ../game/assist.ts)
//   game     → anything (orchestration); src/main.ts likewise.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const src = join(root, 'src');

function listTs(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listTs(p));
    else if (name.endsWith('.ts')) out.push(p);
  }
  return out;
}

const K = ts.SyntaxKind;

/** Keywords after which a `/` starts a regular expression (an operand is expected next). */
const REGEX_AFTER_KEYWORD = new Set<ts.SyntaxKind>([
  K.ReturnKeyword,
  K.TypeOfKeyword,
  K.InstanceOfKeyword,
  K.InKeyword,
  K.OfKeyword,
  K.NewKeyword,
  K.DeleteKeyword,
  K.VoidKeyword,
  K.ThrowKeyword,
  K.CaseKeyword,
  K.DoKeyword,
  K.ElseKeyword,
  K.YieldKeyword,
  K.AwaitKeyword,
]);

/**
 * True when token `kind` ends an operand, so a following `/` is division. Literals, identifiers,
 * closing brackets, postfix ++/-- and identifier-like keywords (`this`, `true`, property names such
 * as `.type`) end operands; other punctuation and the keywords above leave an operand to come.
 * `!` right after an operand is TypeScript's non-null assertion, which also ends it.
 */
function endsOperand(kind: ts.SyntaxKind, prevEnds: boolean): boolean {
  switch (kind) {
    case K.Identifier:
    case K.PrivateIdentifier:
    case K.NumericLiteral:
    case K.BigIntLiteral:
    case K.StringLiteral:
    case K.NoSubstitutionTemplateLiteral:
    case K.TemplateTail:
    case K.RegularExpressionLiteral:
    case K.CloseParenToken:
    case K.CloseBracketToken:
    case K.CloseBraceToken:
    case K.PlusPlusToken:
    case K.MinusMinusToken:
      return true;
    case K.ExclamationToken:
      return prevEnds;
    default:
      return kind >= K.FirstKeyword && kind <= K.LastKeyword && !REGEX_AFTER_KEYWORD.has(kind);
  }
}

/**
 * The code of `source` with comments replaced by a space, string literals emptied ('') and template
 * text emptied (`${…}` expressions kept), using the TypeScript scanner so regex literals, template
 * nesting and division are told apart. Everything else is kept verbatim.
 */
function codeOnly(source: string): string {
  const sc = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, source);
  let out = '';
  // One entry per open `{`: true when it is a template substitution `${`.
  const braces: boolean[] = [];
  let prevEnds = false;
  for (let k = sc.scan(); k !== K.EndOfFileToken; k = sc.scan()) {
    if (k === K.SingleLineCommentTrivia || k === K.MultiLineCommentTrivia || k === K.ShebangTrivia || k === K.ConflictMarkerTrivia) {
      out += ' ';
      continue;
    }
    if (k === K.WhitespaceTrivia || k === K.NewLineTrivia) {
      out += sc.getTokenText();
      continue;
    }
    if ((k === K.SlashToken || k === K.SlashEqualsToken) && !prevEnds) k = sc.reScanSlashToken();
    if (k === K.CloseBraceToken && braces.length > 0 && braces[braces.length - 1] === true) {
      braces.pop();
      k = sc.reScanTemplateToken(false);
    }
    switch (k) {
      case K.StringLiteral:
        out += "''";
        break;
      case K.NoSubstitutionTemplateLiteral:
        out += '``';
        break;
      case K.TemplateHead:
        out += '`${';
        braces.push(true);
        break;
      case K.TemplateMiddle:
        out += '}${';
        braces.push(true);
        break;
      case K.TemplateTail:
        out += '}`';
        break;
      case K.OpenBraceToken:
        braces.push(false);
        out += '{';
        break;
      case K.CloseBraceToken:
        braces.pop();
        out += '}';
        break;
      default:
        out += sc.getTokenText();
    }
    prevEnds = endsOperand(k, prevEnds);
  }
  return out;
}

const FORBIDDEN: [string, RegExp][] = [
  ['Math.random', /\bMath\s*\.\s*random\b/],
  ['Date', /\bDate\b/],
  ['performance', /\bperformance\b/],
  [
    'Math trig/exp/log/pow',
    /\bMath\s*\.\s*(sin|cos|tan|asin|acos|atan|atan2|exp|log|pow|hypot|cbrt|sinh|cosh|tanh|asinh|acosh|atanh|log2|log10|log1p|expm1)\b/,
  ],
  ['** operator', /\*\*/],
  ['toFixed', /\btoFixed\b/],
  ['toPrecision', /\btoPrecision\b/],
  ['toExponential', /\btoExponential\b/],
  ['toLocale*', /\btoLocale\w*/],
  ['parseFloat', /\bparseFloat\b/],
  ['Intl', /\bIntl\b/],
  ['crypto', /\bcrypto\b/],
  ['globalThis', /\bglobalThis\b/],
  ['self', /\bself\b/],
  ['window', /\bwindow\b/],
  ['document', /\bdocument\b/],
  ['localStorage', /\blocalStorage\b/],
  ['Float32Array', /\bFloat32Array\b/],
];

/** Names of the FORBIDDEN patterns that `source` uses outside comments and strings. */
function forbiddenIn(source: string): string[] {
  const code = codeOnly(source);
  return FORBIDDEN.filter(([, re]) => re.test(code)).map(([name]) => name);
}

interface ImportRef {
  spec: string;
  /** `import type …`, `import { type A, type B } …` or `export type … from`. */
  typeOnly: boolean;
}

/** Every static import/export-from and dynamic import() specifier of a file, from its AST. */
function importsOf(file: string, source: string): ImportRef[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  const out: ImportRef[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
      const c = n.importClause;
      const named = c?.namedBindings && ts.isNamedImports(c.namedBindings) ? c.namedBindings.elements : null;
      const typeOnly = !!c && (c.isTypeOnly || (!c.name && !!named && named.length > 0 && named.every((e) => e.isTypeOnly)));
      out.push({ spec: n.moduleSpecifier.text, typeOnly });
    } else if (ts.isExportDeclaration(n) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) {
      out.push({ spec: n.moduleSpecifier.text, typeOnly: n.isTypeOnly });
    } else if (ts.isCallExpression(n) && n.expression.kind === K.ImportKeyword) {
      const a = n.arguments[0];
      out.push({ spec: a && ts.isStringLiteralLike(a) ? a.text : '<dynamic>', typeOnly: false });
    } else if (ts.isImportTypeNode(n) && ts.isLiteralTypeNode(n.argument) && ts.isStringLiteral(n.argument.literal)) {
      out.push({ spec: n.argument.literal.text, typeOnly: true });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

type Layer = 'config' | 'core' | 'platform' | 'meta' | 'ui' | 'audio' | 'render';

/** Layers each layer may import from (V1_PLAN §2.3). src/game and src/main.ts may import anything. */
const ALLOWED: Record<Layer, readonly Layer[]> = {
  config: ['config'],
  core: ['core', 'config'],
  platform: ['platform'],
  meta: ['meta', 'core', 'config', 'platform'],
  ui: ['ui', 'meta', 'core', 'config', 'platform'],
  audio: ['audio', 'core', 'config', 'platform'],
  render: ['render', 'core', 'config', 'meta', 'platform'],
};

/** Single files a layer may import from outside its allowed layers. */
const FILE_ALLOW: Partial<Record<Layer, readonly string[]>> = {
  render: ['src/game/camera.ts', 'src/game/assist.ts'],
};

/**
 * Known type-only exceptions (erased at build time), kept until their owners move the type. A value
 * import along the same edge still fails. Entries that no longer occur are harmless.
 */
const TYPE_ONLY_EXCEPTIONS: readonly (readonly [string, string])[] = [
  // haptics maps sim events to patterns; it should take its own event-name type instead.
  ['src/platform/haptics.ts', 'src/core/sim/events.ts'],
];

function layerOf(abs: string): Layer | 'game' | 'other' {
  const rel = relative(src, abs);
  if (rel.startsWith('..')) return 'other';
  const top = rel.split(/[\\/]/)[0] as string;
  if (top in ALLOWED) return top as Layer;
  return top === 'game' || top === 'main.ts' ? 'game' : 'other';
}

/** Layering violations of one file (empty when it complies). */
function layeringErrors(file: string, source: string): string[] {
  const from = layerOf(file);
  if (from === 'game' || from === 'other') return [];
  const rel = relative(root, file);
  const errors: string[] = [];
  for (const { spec, typeOnly } of importsOf(file, source)) {
    if (!spec.startsWith('.')) {
      errors.push(`${rel} imports package '${spec}'`);
      continue;
    }
    if ((from === 'core' || from === 'config') && !spec.endsWith('.ts')) {
      errors.push(`${rel} import '${spec}' needs an explicit .ts extension`);
    }
    const target = resolve(dirname(file), spec);
    const targetRel = relative(root, target).split('\\').join('/');
    const to = layerOf(target);
    if (to !== 'game' && to !== 'other' && ALLOWED[from].includes(to)) continue;
    if (FILE_ALLOW[from]?.includes(targetRel)) continue;
    if (typeOnly && TYPE_ONLY_EXCEPTIONS.some(([a, b]) => a === rel.split('\\').join('/') && b === targetRel)) continue;
    errors.push(`${rel} (${from}) imports '${spec}' from ${to}`);
  }
  return errors;
}

describe('architecture: determinism of src/core and src/config', () => {
  const files = [...listTs(join(src, 'core')), ...listTs(join(src, 'config'))];

  it('finds the core and config sources', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  for (const file of files) {
    const rel = relative(root, file);
    const raw = readFileSync(file, 'utf8');
    it(`${rel}: no forbidden nondeterministic tokens`, () => {
      expect(forbiddenIn(raw), `${rel} uses forbidden tokens`).toEqual([]);
    });
  }
});

describe('architecture: import layering', () => {
  const files = listTs(src);

  it('finds a file in every layer', () => {
    const seen = new Set(files.map(layerOf));
    for (const l of [...Object.keys(ALLOWED), 'game']) expect(seen.has(l as Layer)).toBe(true);
  });

  for (const file of files) {
    const rel = relative(root, file);
    if (layerOf(file) === 'game' || layerOf(file) === 'other') continue;
    it(`${rel}: respects import layering`, () => {
      expect(layeringErrors(file, readFileSync(file, 'utf8'))).toEqual([]);
    });
  }
});

describe('architecture: the scanner and the rules themselves', () => {
  it('keeps code and drops comments and strings', () => {
    const s = codeOnly("const a = 2; // Math.sin\n/** x ** y */ const b = 'window';");
    expect(s).toContain('const a = 2;');
    expect(s).not.toContain('Math.sin');
    expect(s).not.toContain('**');
    expect(s).not.toContain('window');
  });

  it('flags code inside template ${…} expressions but not template text', () => {
    expect(forbiddenIn('const id = `c${Math.random()}`;')).toContain('Math.random');
    expect(forbiddenIn('const t = `Math.random() and window`;')).toEqual([]);
    expect(forbiddenIn('const t = `a${`b${ { k: window }.k }`}c${1}d`;')).toEqual(['window']);
    expect(forbiddenIn('const t = `${x}window${y}`;')).toEqual([]);
  });

  it('keeps scanning after a regex literal that contains a quote', () => {
    expect(forbiddenIn("const r = /'/; const z = Math.sin(1);")).toContain('Math trig/exp/log/pow');
    expect(forbiddenIn('const r = /`/g; const z = Date;')).toContain('Date');
    expect(forbiddenIn('const r = x.split(/"/); const w = window;')).toContain('window');
  });

  it('tells division from regex literals', () => {
    expect(codeOnly('const q = a / b / c;')).toBe('const q = a / b / c;');
    expect(codeOnly('const q = (a + 1) / 2 / (b[0]! / 3);')).toBe('const q = (a + 1) / 2 / (b[0]! / 3);');
    expect(forbiddenIn("const q = a / 2; const s = 'x'; Math.cos(q);")).toContain('Math trig/exp/log/pow');
    expect(forbiddenIn("const q = a[i]! / 2; // '\nconst d = Date;")).toContain('Date');
  });

  it('flags the extended token list', () => {
    expect(forbiddenIn('Math.atanh(x)')).toEqual(['Math trig/exp/log/pow']);
    expect(forbiddenIn('Math.asinh(x) + Math.acosh(y)')).toEqual(['Math trig/exp/log/pow']);
    expect(forbiddenIn('x.toPrecision(3)')).toEqual(['toPrecision']);
    expect(forbiddenIn('x.toExponential(3)')).toEqual(['toExponential']);
    expect(forbiddenIn('x.toLocaleString()')).toEqual(['toLocale*']);
    expect(forbiddenIn('new Intl.NumberFormat()')).toEqual(['Intl']);
    expect(forbiddenIn('crypto.getRandomValues(a)')).toEqual(['crypto']);
    expect(forbiddenIn('globalThis.x = 1')).toEqual(['globalThis']);
    expect(forbiddenIn('self.postMessage(1)')).toEqual(['self']);
    expect(forbiddenIn("const s = 'self crypto Intl'; // globalThis")).toEqual([]);
  });

  it('enforces the layer table, the render allowlist and value imports along type-only exceptions', () => {
    const at = (p: string): string => join(root, p);
    expect(layeringErrors(at('src/ui/x.ts'), "import { a } from '../render/sprites.ts';")).toHaveLength(1);
    expect(layeringErrors(at('src/ui/x.ts'), "import { a } from '../game/session.ts';")).toHaveLength(1);
    expect(layeringErrors(at('src/ui/x.ts'), "import { a } from '../meta/save.ts';\nimport './ui.css';")).toEqual([]);
    expect(layeringErrors(at('src/meta/x.ts'), "import type { A } from '../ui/types.ts';")).toHaveLength(1);
    expect(layeringErrors(at('src/meta/x.ts'), "export { a } from '../render/color.ts';")).toHaveLength(1);
    expect(layeringErrors(at('src/audio/x.ts'), "const m = await import('../meta/save.ts');")).toHaveLength(1);
    expect(layeringErrors(at('src/audio/x.ts'), "import { TUNING } from '../core/index.ts';")).toEqual([]);
    expect(layeringErrors(at('src/platform/x.ts'), "import { a } from '../meta/save.ts';")).toHaveLength(1);
    expect(layeringErrors(at('src/render/x.ts'), "import { a } from '../game/camera.ts';\nimport { b } from '../game/assist.ts';")).toEqual([]);
    expect(layeringErrors(at('src/render/x.ts'), "import { a } from '../game/session.ts';")).toHaveLength(1);
    expect(layeringErrors(at('src/render/x.ts'), "import { a } from '../ui/ui.ts';")).toHaveLength(1);
    expect(layeringErrors(at('src/core/x.ts'), "import { a } from '../meta/save.ts';")).toHaveLength(1);
    expect(layeringErrors(at('src/core/x.ts'), "import { a } from 'some-package';")).toHaveLength(1);
    expect(layeringErrors(at('src/config/x.ts'), "import { a } from './days.ts';")).toEqual([]);
    expect(layeringErrors(at('src/config/x.ts'), "import { a } from '../core/clock.ts';")).toHaveLength(1);
    expect(layeringErrors(at('src/config/x.ts'), "import { a } from './days';")).toHaveLength(1);
    expect(layeringErrors(at('src/game/x.ts'), "import { a } from '../ui/ui.ts';")).toEqual([]);
    // Comments and strings never count as imports.
    expect(layeringErrors(at('src/ui/x.ts'), "// import { a } from '../game/session.ts';\nconst s = \"import x from '../game/y.ts'\";")).toEqual([]);
    // The type-only exception does not cover a value import.
    expect(layeringErrors(at('src/platform/haptics.ts'), "import type { SimEvent } from '../core/sim/events.ts';")).toEqual([]);
    expect(layeringErrors(at('src/platform/haptics.ts'), "import { NO } from '../core/sim/events.ts';")).toHaveLength(1);
  });
});
