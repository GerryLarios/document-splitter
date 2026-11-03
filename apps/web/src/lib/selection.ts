export function toggleSelection(order: string[], id: string): string[] {
  return order.includes(id) ? order.filter(value => value !== id) : [...order, id];
}
export function addSelection(order: string[], ids: string[]): string[] {
  return [...new Set([...order, ...ids])];
}
export function moveSelection(order: string[], from: number, to: number): string[] {
  if (from < 0 || to < 0 || from >= order.length || to >= order.length) return order;
  const next = [...order];
  next.splice(to, 0, next.splice(from, 1)[0]);
  return next;
}
export function parseRange(value: string, count: number): number[] {
  const indexes = new Set<number>();
  if (!value.trim()) throw new Error('Enter a range, for example 1-5, 8, 12-15.');
  for (const part of value.split(',')) {
    const match = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(part);
    if (!match) throw new Error('Use page numbers or ranges, for example 1-5, 8.');
    const start = Number(match[1]);
    const end = Number(match[2] ?? start);
    if (start < 1 || end > count || start > end) throw new Error(`Choose a range between 1 and ${count}.`);
    for (let n = start; n <= end; n++) indexes.add(n - 1);
  }
  return [...indexes].sort((a, b) => a - b);
}
