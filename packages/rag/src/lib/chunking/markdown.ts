export interface ParsedDoc {
  docId: string;
  title: string;
  source: string;
  category: string;
  body: string;
}

export function parseDoc(raw: string, docId: string): ParsedDoc {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const fm = m ? m[1] : '';
  const body = m ? m[2] : raw;
  const get = (k: string) =>
    (fm.match(new RegExp(`^${k}:\\s*(.*)$`, 'm'))?.[1] ?? '').trim();

  return {
    docId,
    title: get('title'),
    source: get('source'),
    category: get('category'),
    body,
  };
}
