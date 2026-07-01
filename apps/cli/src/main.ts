// Plantbase CLI — belépési pont (B1: echo, LLM nélkül).
// `ask <kérdés>` egyszeri lekérdezés + interaktív readline mód (kilépés: exit).
// A program visszaírja, amit beírtál (echo). A B2 fázis LLM-hívásra cseréli az echo-t.
import { Command } from 'commander';
import { createInterface } from 'node:readline';
import { echo } from '@plantbase/core';

// Egy kérdés feldolgozása + kiírása, beszédes hibakezeléssel (fail-fast az üres bemenetre).
function answer(input: string): void {
  try {
    console.log(echo(input));
  } catch (error) {
    console.error(`Hiba: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function runInteractive(): void {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'plantbase> ',
  });

  console.log('Plantbase interaktív mód. Kilépés: exit');
  rl.prompt();

  rl.on('line', (line) => {
    const text = line.trim();
    if (text === 'exit' || text === 'quit') {
      rl.close();
      return;
    }
    if (text.length > 0) {
      answer(text);
    }
    rl.prompt();
  });

  rl.on('close', () => {
    console.log('Viszlát!');
    process.exit(0);
  });
}

const program = new Command();

program
  .name('plantbase')
  .description('Plantbase — növény-katalógus AI asszisztens (CLI)')
  .version('0.0.1');

program
  .command('ask')
  .description('Egyszeri kérdés a katalógusról')
  .argument('<kerdes>', 'a természetes nyelvű kérdés')
  .action((kerdes: string) => {
    answer(kerdes);
  });

program
  .command('chat', { isDefault: true })
  .description('Interaktív mód (kilépés: exit)')
  .action(() => {
    runInteractive();
  });

program.parseAsync(process.argv);
