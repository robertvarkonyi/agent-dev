import { describe, it, expect } from 'vitest';
import {
  GOLDEN_QUESTIONS,
  runGolden,
  renderGoldenMarkdown,
} from '../golden.js';
import type { GoldenProgress, GoldenReport } from '../golden.js';
import { FakeProviders } from '../../providers/providers.js';
import { InMemoryStore } from '../../storage/store.js';
import type { StoredChunk } from '../../storage/store.js';
import type { RetrievedChunk } from '../../pipeline/retrieve.js';

// Egy találat legyártása a render-teszthez: rerankScore megadva → full (rr=), nélküle → raw (d=).
function chunk(
  docId: string,
  opts: { distance: number; rerankScore?: number },
): RetrievedChunk {
  return {
    docId,
    title: docId,
    source: `s/${docId}`,
    category: 'c',
    headingPath: '',
    content: docId,
    distance: opts.distance,
    rerankScore: opts.rerankScore,
  };
}

async function seededStore(): Promise<InMemoryStore> {
  const store = new InMemoryStore();
  const p = new FakeProviders();
  const [emb] = await p.embed(['snake plant water light']);
  const c: StoredChunk = {
    docId: 'snake',
    title: 'Snake',
    source: 's/snake',
    category: 'c',
    headingPath: '',
    chunkIndex: 0,
    content: 'snake plant water light',
    tokenCount: 1,
    embedding: emb,
    embedModel: 'fake',
    relatedDocs: [],
    contentHash: 'h',
  };

  await store.upsertDoc('snake', [c]);

  return store;
}

describe('golden', () => {
  it('legalább 8 kérdés, van megválaszolhatatlan (Vénusz légycsapó)', () => {
    expect(GOLDEN_QUESTIONS.length).toBeGreaterThanOrEqual(8);
    expect(GOLDEN_QUESTIONS.some((q) => /légycsapó|flytrap/i.test(q.q))).toBe(
      true,
    );
    // A grounding-próbához legalább egy szándékosan megválaszolhatatlan kérdés kell.
    expect(GOLDEN_QUESTIONS.some((q) => !q.expectAnswerable)).toBe(true);
    // A Vénusz-légycsapó pont az a negatív kérdés.
    expect(
      GOLDEN_QUESTIONS.find((q) => /légycsapó/i.test(q.q))?.expectAnswerable,
    ).toBe(false);
  });
  it('runGolden minden kérdésre ad raw+full sort, és markdownt renderel', async () => {
    const store = await seededStore();
    const p = new FakeProviders();

    const rep = await runGolden(
      { providers: p, store },
      { topN: 5, topK: 3, minRerankScore: 0.05 },
    );

    expect(rep.rows.length).toBe(GOLDEN_QUESTIONS.length);
    expect(renderGoldenMarkdown(rep)).toMatch(/raw|full/i);
  });

  it('renderGoldenMarkdown kiírja a rerank-átrendezést (miért jobb) és a grounding negatív tesztet', () => {
    // Szintetikus jelentés: egy megválaszolható, ÁTRENDEZETT sor + egy negatív (grounding) sor,
    // ahol a rerank-kapu átengedte a kérdést (rr ≥ küszöb), de a válasz mégis elutasítás.
    const report: GoldenReport = {
      cfg: { topN: 20, topK: 5, minRerankScore: 0.3 },
      rows: [
        {
          id: 1,
          q: 'Miért sárgulnak a leveleim?',
          expectAnswerable: true,
          rerankRationale:
            'A rerank a pontosan témába vágó cikket emeli a #1-re.',
          raw: [chunk('wrong-topic', { distance: 0.66 })],
          full: [chunk('yellow-leaves', { distance: 0.66, rerankScore: 0.65 })],
          grounded: true,
          answer: 'A sárgulás oka általában a túlöntözés.',
        },
        {
          id: 2,
          q: 'Hogyan gondozzam a Vénusz légycsapót?',
          expectAnswerable: false,
          raw: [chunk('zz-plant', { distance: 0.74 })],
          full: [chunk('spider-plant', { distance: 0.74, rerankScore: 0.389 })],
          grounded: false,
          answer: 'Erről nincs információ a Plantbase tudásbázisban.',
        },
      ],
    };

    const md = renderGoldenMarkdown(report);

    // Rerank-átrendezés szakasz: a top-1 megváltozott, és megjelenik a „miért jobb” indoklás.
    expect(md).toContain('## Rerank-átrendezés');
    expect(md).toContain('### Miért jobb az új sorrend?');
    expect(md).toContain(
      'A rerank a pontosan témába vágó cikket emeli a #1-re.',
    );
    expect(md).toMatch(/wrong-topic.*yellow-leaves.*IGEN/s);

    // Grounding negatív teszt: 2/2 egyezés, és a tanulság a valós rr-ből generálva (0.389 ≥ 0.3).
    expect(md).toContain('## Grounding — negatív teszt');
    expect(md).toContain('Grounding-egyezés: **2/2**');
    expect(md).toContain('rerank-kapu átengedte');
    expect(md).toContain('rr=0.389');
  });

  it('runGolden kérdésenként egy question-start és három step eseményt jelez', async () => {
    const store = await seededStore();
    const p = new FakeProviders();

    const events: GoldenProgress[] = [];
    await runGolden(
      { providers: p, store, onProgress: (e) => events.push(e) },
      { topN: 5, topK: 3, minRerankScore: 0.05 },
    );

    const total = GOLDEN_QUESTIONS.length;

    const starts = events.filter((e) => e.type === 'question-start');
    const steps = events.filter((e) => e.type === 'step');

    expect(starts.length).toBe(total);
    expect(steps.length).toBe(total * 3);

    // Az első kérdés eseményei sorrendben: start → raw → full → grounded, mind index=1.
    expect(events.slice(0, 4)).toEqual([
      {
        type: 'question-start',
        index: 1,
        total,
        id: 1,
        q: GOLDEN_QUESTIONS[0].q,
      },
      expect.objectContaining({ type: 'step', index: 1, step: 'raw' }),
      expect.objectContaining({ type: 'step', index: 1, step: 'full' }),
      expect.objectContaining({ type: 'step', index: 1, step: 'grounded' }),
    ]);

    // Minden question-start a saját (three) step-je ELŐTT jön ki.
    const firstStepIdx = events.findIndex((e) => e.type === 'step');
    expect(events[0].type).toBe('question-start');
    expect(firstStepIdx).toBe(1);
  });
});
