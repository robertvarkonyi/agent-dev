// Plantbase CLI — belépési pont (B2: LLM, adatbázis nélkül).
// `ask <kérdés>` egyszeri lekérdezés + interaktív readline mód (kilépés: exit).
// Az agent LLM-mel válaszol; adat-kérdésnél őszintén jelzi, hogy nincs DB-hozzáférése.
// A B3 fázis köti be a runSql toolt.
import 'dotenv/config';
import { Command } from 'commander';
import { createInterface } from 'node:readline';
import {
  askAgent,
  buildPrompt,
  streamChat,
  SYSTEM_PROMPT,
  type ChatMessage,
  type Prompt,
} from '@plantbase/core';

function formatPrompt(prompt: Prompt): string {
  return [
    '----- system -----',
    prompt.system,
    '----- messages -----',
    JSON.stringify(prompt.messages, null, 2),
    '------------------',
  ].join('\n');
}

// Egy kérdés feldolgozása: LLM-válasz kiírása, beszédes hibakezeléssel.
async function answer(input: string, showPrompt: boolean): Promise<void> {
  try {
    if (showPrompt) {
      console.log(formatPrompt(buildPrompt(input)));
    }
    const { answer: text } = await askAgent(input);
    console.log(text);
  } catch (error) {
    console.error(`Hiba: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function runInteractive(showPrompt: boolean): void {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'plantbase> ',
  });

  // A session alatt élő beszélgetés-előzmény (kilépéskor elveszik — nincs perzisztálás).
  const history: ChatMessage[] = [];

  console.log('Plantbase interaktív mód. Kilépés: exit');
  rl.prompt();

  rl.on('line', async (line) => {
    const text = line.trim();
    if (text === 'exit' || text === 'quit') {
      rl.close();
      return;
    }
    if (text.length > 0) {
      // Csak sikeres válasz után írjuk vissza az előzményt (hibánál a history érintetlen).
      const next: ChatMessage[] = [...history, { role: 'user', content: text }];
      if (showPrompt) {
        console.log(formatPrompt({ system: SYSTEM_PROMPT, messages: next }));
      }
      try {
        const { textStream, done } = streamChat(next);
        // A done sosem maradhat kezeletlen: stream-hiba esetén a for-await a catch-be ugrik, mielőtt
        // az await done lefutna, és a done elutasítása Node-on process-crasht okozna. Ezért mindig
        // kötünk rá egy nyelő kezelőt (a happy path await-je így is megkapja az értéket/hibát).
        done.catch(() => undefined);
        for await (const chunk of textStream) {
          process.stdout.write(chunk);
        }
        process.stdout.write('\n');
        const { messages } = await done;
        history.splice(0, history.length, ...messages);
      } catch (error) {
        console.error(
          `Hiba: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
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
  .version('0.0.1')
  .option('--show-prompt', 'a teljes prompt (system + üzenetek) kiírása');

program
  .command('ask')
  .description('Egyszeri kérdés a katalógusról')
  .argument('<kerdes>', 'a természetes nyelvű kérdés')
  .action(async (kerdes: string) => {
    await answer(kerdes, program.opts().showPrompt === true);
  });

program
  .command('chat', { isDefault: true })
  .description('Interaktív mód (kilépés: exit)')
  .action(() => {
    runInteractive(program.opts().showPrompt === true);
  });

program.parseAsync(process.argv);
