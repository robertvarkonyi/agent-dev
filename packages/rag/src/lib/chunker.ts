import type { ParsedDoc } from './markdown.js';
export { parseDoc, type ParsedDoc } from './markdown.js';

export interface Chunk {
  docId: string;
  title: string;
  source: string;
  category: string;
  headingPath: string;
  chunkIndex: number;
  content: string;
  tokenCount: number;
}

export const estimateTokens = (s: string): number => Math.ceil(s.length / 4);

// A Perfect Pairings szekciótól a fájl végéig minden upsell/footer; a Learn More blokk is navigáció.
export function stripBoilerplate(body: string): string {
  let out = body;
  out = out.replace(/^#{1,6}\s*Perfect Pairings[\s\S]*$/im, '');
  out = out.replace(/^#{1,6}\s*Words By The Sill[\s\S]*$/im, '');
  out = out.replace(
    /^#{1,6}\s*Learn More[\s\S]*?(?=^#{1,6}\s|(?![\s\S]))/gim,
    '',
  );
  out = out.replace(/^\s*Shop .*!\s*$/gim, '');
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

export function extractRelated(body: string): string[] {
  const block = body.match(
    /^#{1,6}\s*Learn More\s*\n([\s\S]*?)(?=^#{1,6}\s|(?![\s\S]))/im,
  );
  if (!block) return [];
  return block[1]
    .split('\n')
    .map((l) => l.replace(/^\s*[*-]\s*/, '').trim())
    .filter((l) => l.length > 0);
}

export function resolveRelated(
  titles: string[],
  titleToDocId: Map<string, string>,
): string[] {
  const out: string[] = [];
  for (const t of titles) {
    const id = titleToDocId.get(t.toLowerCase().trim());
    if (id) out.push(id);
  }
  return out;
}

interface Section {
  headingPath: string;
  text: string;
}

// A törzset heading-szekciókra bontja, heading-path stack-kel (## > ### > ####).
function splitSections(body: string): Section[] {
  const lines = body.split('\n');
  const stack: { level: number; title: string }[] = [];
  const sections: Section[] = [];
  let buf: string[] = [];
  const path = () => stack.map((s) => s.title).join(' > ');
  const flush = () => {
    const text = buf.join('\n').trim();
    if (text) sections.push({ headingPath: path(), text });
    buf = [];
  };
  for (const line of lines) {
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flush();
      const level = h[1].length;
      while (stack.length && stack[stack.length - 1].level >= level)
        stack.pop();
      stack.push({ level, title: h[2].trim() });
    } else {
      buf.push(line);
    }
  }
  flush();
  return sections;
}

// Egy maxChars-nál hosszabb bekezdést ≤maxChars darabokra vág: előbb mondat-
// határon (`.!?` után), és ha egy mondat maga is túl hosszú, kemény maxChars-
// széles ablakokra szeletel. A normál (≤maxChars) bekezdést változatlanul adja.
function splitParagraph(p: string, maxChars: number): string[] {
  if (p.length <= maxChars) return [p];
  const out: string[] = [];
  let buf = '';
  const flush = () => {
    if (buf) {
      out.push(buf);
      buf = '';
    }
  };
  for (const s of p.split(/(?<=[.!?])\s+/)) {
    if (s.length > maxChars) {
      flush();
      for (let i = 0; i < s.length; i += maxChars)
        out.push(s.slice(i, i + maxChars));
      continue;
    }
    const candidate = buf ? `${buf} ${s}` : s;
    if (candidate.length > maxChars) {
      flush();
      buf = s;
    } else {
      buf = candidate;
    }
  }
  flush();
  return out;
}

// Bekezdés-határon pakol maxChars-ig, 1 bekezdés overlappal; nem lép át szekció-
// határt. Minden chunk törzse (a prefix nélkül) ≤ maxChars: a túl hosszú bekezdést
// előbb szétdaraboljuk, az overlapot csak akkor visszük tovább, ha még belefér.
export function chunkDoc(
  doc: ParsedDoc,
  opts?: { maxChars?: number },
): Chunk[] {
  const maxChars = opts?.maxChars ?? 1600; // ~400 token
  const clean = stripBoilerplate(doc.body);
  const sections = splitSections(clean);
  const chunks: Chunk[] = [];
  let index = 0;
  const push = (rawHeadingPath: string, text: string) => {
    const body = text.trim();
    if (!body) return;
    // headingPath dedup: a doc.title-lel egyező vezető szegmenst eldobjuk
    // (különben "Title — Title > Szekció" lenne a prefix).
    const segs = rawHeadingPath.split(' > ');
    if (segs[0] === doc.title) segs.shift();
    const headingPath = segs.join(' > ');
    const prefix = `${doc.title}${headingPath ? ` — ${headingPath}` : ''}\n\n`;
    const content = prefix + body;
    chunks.push({
      docId: doc.docId,
      title: doc.title,
      source: doc.source,
      category: doc.category,
      headingPath,
      chunkIndex: index++,
      content,
      tokenCount: estimateTokens(content),
    });
  };
  for (const sec of sections) {
    const paras = sec.text
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter(Boolean)
      .flatMap((p) => splitParagraph(p, maxChars));
    let buf: string[] = [];
    for (const p of paras) {
      const candidate = buf.length ? `${buf.join('\n\n')}\n\n${p}` : p;
      if (buf.length && candidate.length > maxChars) {
        push(sec.headingPath, buf.join('\n\n'));
        const overlap = buf[buf.length - 1] ?? '';
        // overlapot csak akkor visszük tovább, ha vele együtt is ≤ maxChars marad
        buf = overlap.length + 2 + p.length <= maxChars ? [overlap, p] : [p];
      } else {
        buf.push(p);
      }
    }
    if (buf.join('').trim()) push(sec.headingPath, buf.join('\n\n'));
  }
  return chunks;
}
