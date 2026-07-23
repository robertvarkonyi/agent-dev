import type { RagConfig } from './config.js';
import type { UsageTracker } from './usage.js';
import { embedFromOpenAI } from './openai-embeddings.js';
import { rerankFromJina } from './jina-rerank.js';
import { hydeFromAnthropic, answerFromAnthropic } from './anthropic-gen.js';

export interface RerankHit {
  index: number;
  score: number;
}
export interface Providers {
  embed(texts: string[]): Promise<number[][]>;
  hyde(query: string): Promise<string>;
  rerank(query: string, docs: string[], topN: number): Promise<RerankHit[]>;
  answer(system: string, prompt: string): Promise<string>;
}

const tokenize = (s: string) => s.toLowerCase().match(/[a-z0-9]+/g) ?? [];

export class FakeProviders implements Providers {
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => {
      const v = new Array(1536).fill(0);
      for (const tok of tokenize(t)) {
        let h = 0;
        for (let i = 0; i < tok.length; i++)
          h = (h * 31 + tok.charCodeAt(i)) >>> 0;
        v[h % 1536] += 1;
      }
      const norm = Math.hypot(...v) || 1;
      return v.map((x) => x / norm);
    });
  }
  async hyde(query: string): Promise<string> {
    return `Hypothetical answer about: ${query}`;
  }
  async rerank(
    query: string,
    docs: string[],
    topN: number,
  ): Promise<RerankHit[]> {
    const q = new Set(tokenize(query));
    return docs
      .map((d, index) => {
        const toks = tokenize(d);
        const overlap = toks.filter((t) => q.has(t)).length;
        return { index, score: overlap / (toks.length || 1) };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, topN);
  }
  async answer(_system: string, prompt: string): Promise<string> {
    return `ANSWER: ${prompt.slice(0, 80)}`;
  }
}

// A `tracker` opcionális: ha átadod, minden éles provider-hívás bejegyzi a token-fogyasztását
// (a rag:index / rag:golden a végén ezt írja ki providerenként). Tracker nélkül a viselkedés változatlan.
export function createProviders(
  cfg: RagConfig,
  tracker?: UsageTracker,
): Providers {
  return {
    embed: (texts) => embedFromOpenAI(cfg, texts, tracker),
    hyde: (query) => hydeFromAnthropic(cfg, query, tracker),
    rerank: (query, docs, topN) =>
      rerankFromJina(cfg, query, docs, topN, tracker),
    answer: (system, prompt) =>
      answerFromAnthropic(cfg, system, prompt, tracker),
  };
}
