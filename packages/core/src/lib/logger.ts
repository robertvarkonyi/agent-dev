import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// Egy interakció naplórekordja (FR4): system prompt, üzenetek, válasz, token-felhasználás.
export interface InteractionLog {
  timestamp: string;
  model: string;
  system: string;
  messages: unknown;
  answer: string;
  usage: unknown;
  sql?: string;
  result?: unknown;
}

// Az interakciót JSONL-be írja: logs/<timestamp>.jsonl. Visszaadja a fájl útját.
export function logInteraction(entry: InteractionLog, dir = 'logs'): string {
  mkdirSync(dir, { recursive: true });
  const safeStamp = entry.timestamp.replace(/[:.]/g, '-');
  const file = join(dir, `${safeStamp}.jsonl`);
  appendFileSync(file, `${JSON.stringify(entry)}\n`, 'utf8');
  return file;
}
