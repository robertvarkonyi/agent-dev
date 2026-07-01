// Plantbase CLI — belépési pont (A6: üres váz).
// Keretstruktúra: `ask <kérdés>` egyszeri lekérdezés + interaktív readline mód (kilépés: exit).
// A tényleges logikát a B fázisok töltik fel: B1 echo, B2 LLM, B3 runSql.
import { Command } from 'commander';
import { createInterface } from 'node:readline';

// A6-ban még nincs valódi feldolgozás; helyőrző választ ad, hogy a csővezeték látható legyen.
function handleQuestion(input: string): string {
  return `[plantbase] (váz) beérkezett kérdés: ${input}`;
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
      console.log(handleQuestion(text));
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
    console.log(handleQuestion(kerdes));
  });

program
  .command('chat', { isDefault: true })
  .description('Interaktív mód (kilépés: exit)')
  .action(() => {
    runInteractive();
  });

program.parseAsync(process.argv);
