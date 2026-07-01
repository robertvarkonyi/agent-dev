import { describe, it, expect } from 'vitest';
import { readFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { logInteraction } from './logger';

describe('logInteraction', () => {
  it('JSONL fájlba írja az interakciót (system, üzenetek, válasz, token)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'plantbase-log-'));
    try {
      const entry = {
        timestamp: '2026-07-01T10:00:00.000Z',
        model: 'claude-sonnet-4-6',
        system: 'sysprompt',
        messages: [{ role: 'user', content: 'kérdés' }],
        answer: 'válasz',
        usage: { input_tokens: 10, output_tokens: 20 },
      };

      const file = logInteraction(entry, dir);
      const parsed = JSON.parse(readFileSync(file, 'utf8').trim());

      expect(parsed.system).toBe('sysprompt');
      expect(parsed.answer).toBe('válasz');
      expect(parsed.usage.output_tokens).toBe(20);
      expect(file).toContain('2026-07-01T10-00-00');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
