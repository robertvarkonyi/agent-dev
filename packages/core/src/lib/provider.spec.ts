import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveModel } from './provider.js';

describe('resolveModel', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env = { ...saved };
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it('anthropic modellt ad vissza a beállított modell-id-vel', () => {
    process.env.AI_PROVIDER = 'anthropic';
    process.env.ANTHROPIC_API_KEY = 'sk-teszt';
    process.env.ANTHROPIC_MODEL = 'claude-teszt';
    const model = resolveModel();
    expect((model as { modelId: string }).modelId).toBe('claude-teszt');
  });

  it('hibát dob ismeretlen providerre', () => {
    process.env.AI_PROVIDER = 'openai';
    process.env.ANTHROPIC_API_KEY = 'sk-teszt';
    expect(() => resolveModel()).toThrow(/Ismeretlen AI_PROVIDER/);
  });

  it('hibát dob, ha hiányzik az ANTHROPIC_API_KEY', () => {
    process.env.AI_PROVIDER = 'anthropic';
    delete process.env.ANTHROPIC_API_KEY;
    expect(() => resolveModel()).toThrow(/ANTHROPIC_API_KEY/);
  });
});
