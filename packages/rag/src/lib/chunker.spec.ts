import { describe, it, expect } from 'vitest';
import {
  parseDoc,
  stripBoilerplate,
  extractRelated,
  resolveRelated,
  chunkDoc,
} from './chunker.js';

const RAW = `---
title: How To Care for a Monstera
source: https://example.com/monstera
category: plants-101
---

# How To Care for a Monstera

## Light
Monstera likes bright indirect light. Learn more here.

## Water
Water when the top inch is dry.

### Learn More
* How To Care for a Snake Plant
* Nonexistent Article

## Perfect Pairings For Your Plants
* Premium Potting Mix From $19

##### Words By The Sill
Empowering all people...`;

describe('parseDoc', () => {
  it('frontmattert és törzset bont', () => {
    const d = parseDoc(RAW, 'plants-101__how-to-care-for-a-monstera');
    expect(d.title).toBe('How To Care for a Monstera');
    expect(d.source).toBe('https://example.com/monstera');
    expect(d.category).toBe('plants-101');
    expect(d.body).toContain('## Light');
  });
});

describe('stripBoilerplate', () => {
  it('kivágja a Perfect Pairings / Words By The Sill / Learn More blokkokat', () => {
    const s = stripBoilerplate(parseDoc(RAW, 'x').body);
    expect(s).not.toMatch(/Perfect Pairings/);
    expect(s).not.toMatch(/Words By The Sill/);
    expect(s).not.toMatch(/Learn More/);
    expect(s).toMatch(/bright indirect light/);
  });
});

describe('extractRelated + resolveRelated', () => {
  it('kinyeri a Learn More címeket és feloldja a létezőket', () => {
    const titles = extractRelated(parseDoc(RAW, 'x').body);
    expect(titles).toEqual([
      'How To Care for a Snake Plant',
      'Nonexistent Article',
    ]);
    const map = new Map([
      ['how to care for a snake plant', 'plants-101__snake'],
    ]);
    expect(resolveRelated(titles, map)).toEqual(['plants-101__snake']); // ismeretlent kihagy
  });
  it('üres, ha nincs Learn More', () => {
    expect(extractRelated('## Light\nx')).toEqual([]);
  });
});

describe('chunkDoc', () => {
  const doc = parseDoc(RAW, 'plants-101__how-to-care-for-a-monstera');
  it('heading-path prefixet tesz minden chunk elé', () => {
    const chunks = chunkDoc(doc);
    expect(chunks.length).toBeGreaterThan(0);
    for (const c of chunks) {
      expect(c.content.startsWith(`${doc.title} — `)).toBe(true);
      expect(c.tokenCount).toBeGreaterThan(0);
    }
  });
  it('a Light szekció chunkja tartalmazza a heading-patht', () => {
    const light = chunkDoc(doc).find((c) => c.headingPath.includes('Light'));
    expect(light).toBeTruthy();
    expect(light!.content).toContain('bright indirect light');
  });
  it('nagy szekciót maxChars alatti chunkokra vág, overlappal', () => {
    const big = parseDoc(
      `---\ntitle: T\nsource: s\ncategory: c\n---\n## H\n` +
        Array.from(
          { length: 30 },
          (_, i) => `Paragraph number ${i} with some filler text.`,
        ).join('\n\n'),
      'big',
    );
    const chunks = chunkDoc(big, { maxChars: 400 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks)
      expect(c.content.length).toBeLessThanOrEqual(400 + 200); // prefix + overlap tolerancia
  });
  it('üres törzs → nincs chunk', () => {
    expect(
      chunkDoc(parseDoc(`---\ntitle: T\nsource: s\ncategory: c\n---\n`, 'e')),
    ).toEqual([]);
  });
});
