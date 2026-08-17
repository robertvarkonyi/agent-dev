import { describe, it, expect } from 'vitest';
import { readFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  appendEscalationEvent,
  readEscalationEvents,
  foldTickets,
  type CreatedEvent,
  type ResolvedEvent,
} from '../escalation-queue.js';

const created: CreatedEvent = {
  type: 'created',
  ticketId: 'esc_1',
  ts: '2026-08-17T10:00:00.000Z',
  reason: 'out_of_scope',
  customerMessage: 'Hol tart a rendelésem?',
  summary:
    'A vásárló a rendelése státuszát kérdezi — nincs rendelési adat a rendszerben.',
  triedTools: ['searchKnowledge'],
};

describe('appendEscalationEvent', () => {
  it('JSONL-be írja az eseményt, napi fájlba (a ts napja szerint)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'plantbase-tickets-'));

    try {
      const file = appendEscalationEvent(created, dir);
      const parsed = JSON.parse(readFileSync(file, 'utf8').trim());

      expect(parsed.type).toBe('created');
      expect(parsed.ticketId).toBe('esc_1');
      expect(parsed.reason).toBe('out_of_scope');
      expect(file).toContain('2026-08-17.jsonl');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('append-only: több eseményt soronként, ugyanabba a napi fájlba fűz', () => {
    const dir = mkdtempSync(join(tmpdir(), 'plantbase-tickets-'));

    const resolved: ResolvedEvent = {
      type: 'resolved',
      ticketId: 'esc_1',
      ts: '2026-08-17T10:05:00.000Z',
      action: 'approved',
      by: 'operator',
      note: 'Átvettem, e-mailben válaszolok.',
    };

    try {
      const file1 = appendEscalationEvent(created, dir);
      const file2 = appendEscalationEvent(resolved, dir);

      expect(file2).toBe(file1);
      const lines = readFileSync(file1, 'utf8').trim().split('\n');
      expect(lines).toHaveLength(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('readEscalationEvents', () => {
  it('hiányzó mappánál üres tömböt ad (nem dob)', () => {
    const events = readEscalationEvents(
      join(tmpdir(), 'nincs-ilyen-mappa-plantbase-xyz'),
    );

    expect(events).toEqual([]);
  });

  it('visszaolvassa az összes eseményt időrendben', () => {
    const dir = mkdtempSync(join(tmpdir(), 'plantbase-tickets-'));

    try {
      appendEscalationEvent(created, dir);
      appendEscalationEvent(
        { ...created, ticketId: 'esc_2', reason: 'no_grounding' },
        dir,
      );

      const events = readEscalationEvents(dir);

      expect(events).toHaveLength(2);
      expect(events.map((e) => e.ticketId)).toEqual(['esc_1', 'esc_2']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('foldTickets', () => {
  it('a created jegyet nyitottként adja vissza', () => {
    const tickets = foldTickets([created]);

    expect(tickets).toHaveLength(1);
    expect(tickets[0].status).toBe('open');
    expect(tickets[0].resolution).toBeUndefined();
  });

  it('a resolved esemény lezárja a jegyet (visszavonás = rejected is)', () => {
    const rejected: ResolvedEvent = {
      type: 'resolved',
      ticketId: 'esc_1',
      ts: '2026-08-17T10:05:00.000Z',
      action: 'rejected',
      by: 'operator',
      note: 'Ezt az AI is meg tudta volna válaszolni.',
    };

    const tickets = foldTickets([created, rejected]);

    expect(tickets[0].status).toBe('resolved');
    expect(tickets[0].resolution?.action).toBe('rejected');
    expect(tickets[0].resolution?.by).toBe('operator');
  });

  it('az árva resolved eseményt kihagyja (nincs hozzá created)', () => {
    const orphan: ResolvedEvent = {
      type: 'resolved',
      ticketId: 'nincs_ilyen',
      ts: '2026-08-17T10:05:00.000Z',
      action: 'approved',
      by: 'operator',
    };

    expect(foldTickets([orphan])).toEqual([]);
  });
});
