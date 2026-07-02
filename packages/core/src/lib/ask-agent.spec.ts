import { describe, it, expect } from 'vitest';
import { extractText, buildPrompt } from './ask-agent.js';
import { SYSTEM_PROMPT } from './system-prompt.js';

describe('extractText', () => {
  it('összefűzi a text blokkok szövegét', () => {
    const content = [
      { type: 'text', text: 'Szia' },
      { type: 'text', text: ' világ' },
    ];
    expect(extractText(content)).toBe('Szia világ');
  });

  it('kihagyja a nem-text blokkokat', () => {
    const content = [
      { type: 'text', text: 'A' },
      { type: 'tool_use', text: undefined },
    ];
    expect(extractText(content)).toBe('A');
  });
});

describe('buildPrompt', () => {
  it('a system promptot és a user üzenetet adja vissza', () => {
    const prompt = buildPrompt('szia');
    expect(prompt.system).toBe(SYSTEM_PROMPT);
    expect(prompt.messages).toEqual([{ role: 'user', content: 'szia' }]);
  });

  it('trimmeli a kérdést', () => {
    expect(buildPrompt('  szia  ').messages[0].content).toBe('szia');
  });

  it('hibát dob üres kérdésre', () => {
    expect(() => buildPrompt('   ')).toThrow();
  });
});
