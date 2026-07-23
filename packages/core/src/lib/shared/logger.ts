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
  tokenBreakdown?: unknown;
  sql?: string;
  result?: unknown;
}

// Az interakciót JSONL-be írja (soronként egy rekord), naponta egy fájlba: logs/<YYYY-MM-DD>.jsonl.
// Append-only, így egy nap összes interakciója egy — utólag streamelhető — fájlban gyűlik.
// Visszaadja a fájl útját.
export function logInteraction(entry: InteractionLog, dir = 'logs'): string {
  mkdirSync(dir, { recursive: true });
  const day = entry.timestamp.slice(0, 10); // YYYY-MM-DD az ISO-időbélyegből
  const file = join(dir, `${day}.jsonl`);
  appendFileSync(file, `${JSON.stringify(entry)}\n`, 'utf8');

  return file;
}
