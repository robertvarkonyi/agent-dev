import type { ProviderUsage, TokenBreakdown } from '@plantbase/rag';

// A token-breakdown emberi olvasásra formázva (ask/chat és rag:index/golden is ezt használja).
// A számokat hu-HU szerint tagoljuk (a repó máshol is így), a provider/fn oszlopokat balra zárjuk.
export function formatTokenBreakdown(breakdown: TokenBreakdown): string {
  const num = (n: number): string => n.toLocaleString('hu-HU');

  if (breakdown.rows.length === 0) {
    return 'Token-használat: nincs (nem történt provider-hívás).';
  }

  const provW = Math.max(...breakdown.rows.map((r) => r.provider.length));
  const fnW = Math.max(...breakdown.rows.map((r) => r.fn.length));

  const lines = breakdown.rows.map(
    (r) =>
      `  ${r.provider.padEnd(provW)}  ${r.fn.padEnd(fnW)}  ${num(r.tokens)}`,
  );

  const sep = '  ' + '─'.repeat(provW + fnW + 4);
  const totalLine = `  ${'Összesen'.padEnd(provW + fnW + 2)}  ${num(breakdown.total)}`;

  return ['Token-használat', ...lines, sep, totalLine].join('\n');
}

// Operátor-riport (rag:index / rag:golden): a thin ask/chat-nézettel szemben megtartja a model-nevet
// és a hívásszámot, és kiegészíti a funkció-címkével (fn). Providerenként+funkciónként egy sor.
export function formatProviderUsage(
  usage: ProviderUsage[],
  total: number,
): string {
  const num = (n: number): string => n.toLocaleString('hu-HU');

  if (usage.length === 0) {
    return 'Token-fogyasztás: nincs (nem történt provider-hívás).';
  }

  const lines = usage.map(
    (u) =>
      `  ${u.provider} (${u.model}) [${u.fn}]: ${num(u.tokens)} token, ${u.calls} hívás`,
  );

  return [
    'Token-fogyasztás providerenként:',
    ...lines,
    `  Összesen: ${num(total)} token`,
  ].join('\n');
}
