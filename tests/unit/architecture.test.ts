// Enforces the determinism and layering rules of V1_PLAN §2.1/§2.3 on src/core and src/config.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const coreDir = join(root, 'src/core');
const configDir = join(root, 'src/config');

function listTs(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listTs(p));
    else if (name.endsWith('.ts')) out.push(p);
  }
  return out;
}

/** Removes comments and string/template literal contents so tokens inside them don't count. */
function stripCommentsAndStrings(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i] as string;
    const n = src[i + 1];
    if (c === '/' && n === '/') {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (c === '/' && n === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
    } else if (c === "'" || c === '"' || c === '`') {
      out += c;
      i++;
      while (i < src.length && src[i] !== c) {
        if (src[i] === '\\') i++;
        i++;
      }
      out += c;
      i++;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

const FORBIDDEN: [string, RegExp][] = [
  ['Math.random', /\bMath\s*\.\s*random\b/],
  ['Date', /\bDate\b/],
  ['performance', /\bperformance\b/],
  ['Math trig/exp/log/pow', /\bMath\s*\.\s*(sin|cos|tan|asin|acos|atan|atan2|exp|log|pow|hypot|cbrt|sinh|cosh|tanh|log2|log10|log1p|expm1)\b/],
  ['** operator', /\*\*/],
  ['toFixed', /\btoFixed\b/],
  ['parseFloat', /\bparseFloat\b/],
  ['window', /\bwindow\b/],
  ['document', /\bdocument\b/],
  ['localStorage', /\blocalStorage\b/],
  ['Float32Array', /\bFloat32Array\b/],
];

function importsOf(src: string): string[] {
  const out: string[] = [];
  const re = /(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]/g;
  for (let m = re.exec(src); m; m = re.exec(src)) out.push(m[1] as string);
  const dyn = /import\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (let m = dyn.exec(src); m; m = dyn.exec(src)) out.push(m[1] as string);
  return out;
}

describe('architecture', () => {
  const files = [...listTs(coreDir), ...listTs(configDir)];

  it('finds the core and config sources', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  for (const file of files) {
    const rel = relative(root, file);
    const raw = readFileSync(file, 'utf8');
    const code = stripCommentsAndStrings(raw);

    it(`${rel}: no forbidden nondeterministic tokens`, () => {
      for (const [name, re] of FORBIDDEN) {
        expect(re.test(code), `${rel} uses ${name}`).toBe(false);
      }
    });

    it(`${rel}: respects import layering`, () => {
      for (const spec of importsOf(raw)) {
        expect(spec.startsWith('.'), `${rel} imports package '${spec}'`).toBe(true);
        expect(spec.endsWith('.ts'), `${rel} import '${spec}' needs an explicit .ts extension`).toBe(true);
        const target = resolve(dirname(file), spec);
        if (file.startsWith(configDir)) {
          throw new Error(`${rel}: src/config must import nothing (imports '${spec}')`);
        }
        const ok = target.startsWith(coreDir + '/') || target.startsWith(configDir + '/');
        expect(ok, `${rel} imports '${spec}' outside core/config`).toBe(true);
      }
    });
  }

  it('the stripper keeps code and drops comments', () => {
    const s = stripCommentsAndStrings("const a = 2; // Math.sin\n/** x ** y */ const b = 'window';");
    expect(s).toContain('const a = 2;');
    expect(s).not.toContain('Math.sin');
    expect(s).not.toContain('**');
    expect(s).not.toContain('window');
  });
});
