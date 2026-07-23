import { describe, it, expect } from 'vitest';
import { errorMessage } from '../errors.js';

describe('errorMessage', () => {
  it('az Error .message-ét adja vissza', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom');
  });

  it('a nem-Error értéket string-gé alakítja', () => {
    expect(errorMessage('nyers')).toBe('nyers');
    expect(errorMessage(42)).toBe('42');
    expect(errorMessage(null)).toBe('null');
  });
});
