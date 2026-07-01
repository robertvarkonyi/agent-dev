import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

// A CLI-t valódi alfolyamatban futtatjuk (mint `pnpm cli`): node + tsx a forráson,
// a @plantbase/core forrás-feloldásához a source conditionnel.
// Csak hálózat-mentes utakat tesztelünk (nincs LLM-hívás) — a valós agent-választ manuálisan.
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
  it('a --help felsorolja az ask és chat parancsokat', () => {
    const out = runCli(['--help']);
    expect(out).toContain('ask');
    expect(out).toContain('chat');
  });

  it('az interaktív mód elindul és exit-re kilép', () => {
    const out = runCli([], 'exit\n');
    expect(out).toContain('interaktív mód');
    expect(out).toContain('Viszlát!');
  });
});
