import { appendFileSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Miért eszkalál az agent egy vásárlói kérdést emberhez. A vásárlói prompt confidence gate-je
// ezekből az okokból választ (lásd customer-system-prompt.ts), és a kolléga ezt látja a soron.
export type EscalationReason =
  | 'out_of_scope' // rendelés/szállítás státusz, panasz, visszáru, fizetés, garancia, számla
  | 'no_grounding' // searchKnowledge grounded=false — nincs fedő forrás, nem talál ki tényt
  | 'ambiguous' // egy tisztázó visszakérdezés után is kétértelmű a kérés
  | 'commitment' // kereskedelmi elköteleződés: félretétel, egyedi kedvezmény, ártárgyalás
  | 'human_requested'; // a vásárló kifejezetten embert kér

// Amit az escalateToHuman tool átad: a kiváltó vásárlói üzenet + összefoglaló a kollégának.
export interface EscalationInput {
  reason: EscalationReason;
  customerMessage: string;
  summary: string;
  triedTools?: string[];
}

export type ResolutionAction =
  | 'approved' // a kolléga jóváhagyta és átvette a jegyet
  | 'rejected' // az eszkaláció visszavonva (visszaadva az AI-nak)
  | 'answered'; // a kolléga saját választ írt a vásárlónak

export interface TicketResolution {
  action: ResolutionAction;
  by: string;
  ts: string;
  note?: string;
}

// A sor eseményei (append-only, event-sourced): a jegy létrejötte és a lezárása külön sor.
export interface CreatedEvent extends EscalationInput {
  type: 'created';
  ticketId: string;
  ts: string;
}

export interface ResolvedEvent {
  type: 'resolved';
  ticketId: string;
  ts: string;
  action: ResolutionAction;
  by: string;
  note?: string;
}

export type EscalationEvent = CreatedEvent | ResolvedEvent;

// A foldolt (aktuális állapotú) jegy — ezt látja a `sor` nézet és a handoff.
export interface EscalationTicket extends EscalationInput {
  ticketId: string;
  ts: string;
  status: 'open' | 'resolved';
  resolution?: TicketResolution;
}

// Egy eseményt a sorba fűz (append-only JSONL), naponta egy fájlba: tickets/<YYYY-MM-DD>.jsonl.
// A logger.ts mintáját követi; a `created` esemény ts-éből veszi a napot. Visszaadja a fájl útját.
export function appendEscalationEvent(
  event: EscalationEvent,
  dir = 'tickets',
): string {
  mkdirSync(dir, { recursive: true });

  const day = event.ts.slice(0, 10); // YYYY-MM-DD az ISO-időbélyegből
  const file = join(dir, `${day}.jsonl`);

  appendFileSync(file, `${JSON.stringify(event)}\n`, 'utf8');

  return file;
}

// A sor összes eseménye időrendben (a *.jsonl fájlok soronként). Hiányzó mappa esetén üres tömb.
export function readEscalationEvents(dir = 'tickets'): EscalationEvent[] {
  let files: string[];

  try {
    files = readdirSync(dir).filter((name) => name.endsWith('.jsonl'));
  } catch {
    return []; // nincs még sor-mappa
  }

  const events: EscalationEvent[] = [];

  for (const name of files.sort()) {
    const raw = readFileSync(join(dir, name), 'utf8').trim();

    if (raw.length === 0) {
      continue;
    }

    for (const line of raw.split('\n')) {
      events.push(JSON.parse(line) as EscalationEvent);
    }
  }

  return events;
}

// Eseményekből az aktuális jegyállapotot állítja elő ticketId szerint: a `created` adja az alapot
// (status: open), a `resolved` lezárja (status: resolved + resolution). A visszaadott lista a
// létrejöttük sorrendjében van. Az árva `resolved` (nincs hozzá created) eseményt kihagyja.
export function foldTickets(events: EscalationEvent[]): EscalationTicket[] {
  const byId = new Map<string, EscalationTicket>();

  for (const event of events) {
    if (event.type === 'created') {
      byId.set(event.ticketId, {
        ticketId: event.ticketId,
        ts: event.ts,
        reason: event.reason,
        customerMessage: event.customerMessage,
        summary: event.summary,
        triedTools: event.triedTools,
        status: 'open',
      });

      continue;
    }

    const ticket = byId.get(event.ticketId);

    if (!ticket) {
      continue; // árva resolved — nincs mit lezárni
    }

    ticket.status = 'resolved';
    ticket.resolution = {
      action: event.action,
      by: event.by,
      ts: event.ts,
      note: event.note,
    };
  }

  return [...byId.values()];
}
