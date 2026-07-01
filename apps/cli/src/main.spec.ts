import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

// A CLI-t valódi alfolyamatban futtatjuk (mint `pnpm cli`): node + tsx a forráson,
// a @plantbase/core forrás-feloldásához a source conditionnel.
const mainPath = fileURLToPath(new URL('./main.ts', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));

function runCli(args: string[], input = ''): string {
  return execFileSync(
    process.execPath,
    ['--import', 'tsx', '--conditions=@plantbase/source', mainPath, ...args],
    { cwd: repoRoot, input, encoding: 'utf8' },
  );
}

describe('plantbase CLI (integráció)', () => {
  it('az ask visszaírja a kérdést (echo)', () => {
    const out = runCli(['ask', 'teszt kérdés']);
    expect(out.trim()).toBe('teszt kérdés');
  });

  it('az interaktív mód visszhangoz, majd exit-re kilép', () => {
    const out = runCli([], 'szia\nexit\n');
    expect(out).toContain('szia');
    expect(out).toContain('Viszlát!');
  });
});
