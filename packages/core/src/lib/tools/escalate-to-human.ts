import { tool } from 'ai';
import { z } from 'zod';
import { errorMessage } from '../shared/errors.js';
import type {
  EscalationInput,
  EscalationTicket,
} from '../shared/escalation-queue.js';

// A tool a DI-vel kapott sinken keresztül ír a jegysorba (teszt: fake; éles: fájl-alapú sink a CLI-ben).
// A `create` szinkron (a queue append is az, mint a logger) és a létrehozott, azonosítóval ellátott
// jegyet adja vissza — ezt a CLI a fordulóban a handoffhoz begyűjti.
export interface EscalationSink {
  create(input: EscalationInput): EscalationTicket;
}

// A confidence gate „menekülő ága": ha az agent bizonytalan / hatókörön kívüli a kérés, NEM találgat,
// hanem ezzel a tool­lal jegyet ír egy kollégának. Az input reason-je a queue kategóriáiból választ.
export function buildEscalateToHuman(sink: EscalationSink) {
  return tool({
    description:
      'Emberi kollégához irányítja a kérdést, ha az agent NEM tud biztonságosan/grounded módon ' +
      'válaszolni. Hívd, ha: a searchKnowledge grounded=false; a kérés hatókörön kívüli ' +
      '(rendelés/szállítás státusz, panasz, visszáru, fizetés, garancia, számla); egy tisztázó ' +
      'visszakérdezés után is kétértelmű; kereskedelmi elköteleződést kér (félretétel, egyedi ' +
      'kedvezmény, ártárgyalás); vagy a vásárló kifejezetten embert kér. Ne találgass helyette.',
    inputSchema: z.object({
      reason: z
        .enum([
          'out_of_scope',
          'no_grounding',
          'ambiguous',
          'commitment',
          'human_requested',
        ])
        .describe('Az eszkaláció oka (a queue kategóriáiból).'),
      customerMessage: z
        .string()
        .describe('A vásárló kiváltó (utolsó) üzenete, szó szerint.'),
      summary: z
        .string()
        .describe(
          'Rövid, a kollégának szóló összefoglaló: mit kér a vásárló és miért kell ember.',
        ),
      triedTools: z
        .array(z.string())
        .optional()
        .describe('Milyen tool-okat próbált az agent, mielőtt eszkalált.'),
    }),
    // Az execute SOSEM dobhat: a dobott Error az AI SDK-ban üres tool_result-tá szerializálódik
    // (JSON.stringify(Error) === '{}'), amit az Anthropic 400-zal elutasít. Helyette beszédes,
    // NEM üres hibaszöveget adunk vissza — a modell olvassa és aszerint válaszol.
    execute: async (input) => {
      try {
        const ticket = sink.create(input);

        return {
          escalated: true,
          ticketId: ticket.ticketId,
          message:
            'Továbbítottam egy kollégának. Hamarosan jelentkezünk — köszönjük a türelmet!',
        };
      } catch (error) {
        return `Hiba: ${errorMessage(error)}`;
      }
    },
  });
}
