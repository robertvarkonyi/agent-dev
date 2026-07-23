// Plantbase agent-eval runner.
// A golden.json minden kérdésére lefuttatja a valódi askAgent-et (élő Anthropic API + read-only DB),
// és menti a választ + token-felhasználást + latenciát egy results.json-be. NEM ítél — a gradinget
// a skill Claude-dal végezteti a results + golden alapján.
//
// Futtatás (Node 22, source-conditions kell a workspace-importhoz):
//   nvm use 22
//   NODE_OPTIONS=--conditions=@plantbase/source pnpm exec tsx .claude/skills/agent-eval/scripts/run-eval.ts
//
// Előfeltétel: .env kitöltve (ANTHROPIC_API_KEY, DATABASE_URL_READONLY) és a Postgres fut
// (docker compose up -d), seedelt katalógussal.
import 'dotenv/config';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { askAgent } from '@plantbase/core';

interface GoldenCase {
  id: string;
  question: string;
  expects: string;
  must_include?: string[];
  should_ask_back?: boolean;
}

interface CaseResult {
  id: string;
  question: string;
  expects: string;
  must_include: string[];
  should_ask_back: boolean;
  answer: string;
  usage: { input_tokens: number; output_tokens: number };
  latency_ms: number;
  error?: string;
}

const here = dirname(fileURLToPath(import.meta.url));
const goldenPath = join(here, '..', 'evals', 'golden.json');
const golden = JSON.parse(readFileSync(goldenPath, 'utf8')) as {
  cases: GoldenCase[];
};

async function main(): Promise<void> {
  const results: CaseResult[] = [];

  for (const c of golden.cases) {
    process.stdout.write(`[eval] ${c.id} … `);
    const started = Date.now();

    try {
      const { answer, usage } = await askAgent(c.question);
      results.push({
        id: c.id,
        question: c.question,
        expects: c.expects,
        must_include: c.must_include ?? [],
        should_ask_back: c.should_ask_back ?? false,
        answer,
        usage,
        latency_ms: Date.now() - started,
      });
      process.stdout.write('kész\n');
    } catch (error) {
      results.push({
        id: c.id,
        question: c.question,
        expects: c.expects,
        must_include: c.must_include ?? [],
        should_ask_back: c.should_ask_back ?? false,
        answer: '',
        usage: { input_tokens: 0, output_tokens: 0 },
        latency_ms: Date.now() - started,
        error: error instanceof Error ? error.message : String(error),
      });
      process.stdout.write('HIBA\n');
    }
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = join('logs', 'eval', stamp);
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, 'results.json');
  writeFileSync(
    outFile,
    JSON.stringify(
      { stamp, model: process.env.ANTHROPIC_MODEL, results },
      null,
      2,
    ),
    'utf8',
  );

  const failed = results.filter((r) => r.error).length;
  console.log(
    `\n${results.length} eset lefutott (${failed} hiba). Eredmény: ${outFile}`,
  );
  console.log(
    'Grading: add át a skillnek ezt a fájlt, és értékeltesd a golden kritériumokkal.',
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
