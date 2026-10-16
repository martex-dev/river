/** A message as a quote to answer under (2.10.11: reply privately): its first three lines. */
export function quoteOf(text: string, fallback: string): string {
  const lines = text.trim() ? text.trim().split('\n').slice(0, 3) : [fallback];
  return `${lines.map((line) => `> ${line}`).join('\n')}\n`;
}
