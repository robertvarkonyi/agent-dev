import { describe, it, expect } from 'vitest';
import { readFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { logInteraction } from './logger.js';

const baseEntry = {
  model: 'claude-sonnet-4-6',
  system: 'sysprompt',
  messages: [{ role: 'user', content: 'kérdés' }],
  answer: 'válasz',
  usage: { input_tokens: 10, output_tokens: 20 },
};

describe('logInteraction', () => {
  it('JSONL fájlba írja az interakciót (system, üzenetek, válasz, token)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'plantbase-log-'));
    try {
      const file = logInteraction(
        { ...baseEntry, timestamp: '2026-07-01T10:00:00.000Z' },
        dir,
      );
      const parsed = JSON.parse(readFileSync(file, 'utf8').trim());

      expect(parsed.system).toBe('sysprompt');
      expect(parsed.answer).toBe('válasz');
      expect(parsed.usage.output_tokens).toBe(20);
      // Napi fájl: a fájlnév a nap (YYYY-MM-DD), nem az egyes időbélyeg.
      expect(file).toContain('2026-07-01.jsonl');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('append-only: azonos nap interakcióit ugyanabba a fájlba, soronként fűzi', () => {
    const dir = mkdtempSync(join(tmpdir(), 'plantbase-log-'));
    try {
      const file1 = logInteraction(
        { ...baseEntry, timestamp: '2026-07-01T10:00:00.000Z' },
        dir,
      );
      const file2 = logInteraction(
        { ...baseEntry, timestamp: '2026-07-01T11:30:00.000Z' },
        dir,
      );

      expect(file2).toBe(file1);
      const lines = readFileSync(file1, 'utf8').trim().split('\n');
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0]).timestamp).toBe('2026-07-01T10:00:00.000Z');
      expect(JSON.parse(lines[1]).timestamp).toBe('2026-07-01T11:30:00.000Z');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
