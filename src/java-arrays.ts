import { reject } from './java-trace-parser';
import type { Value } from './java-trace';
export type JArray = { type: string; items: Value[] };
export const arrayComponent = (type: string): string | undefined =>
  type.endsWith('[]') ? type.slice(0, -2) : undefined;
// Ordinary array toString contains an identity hash, never a predictable item list.
export function arrayText(value: Value, deep = false, seen = new Set<JArray>()): string {
  if (value.kind === 'array') {
    const data = value.array;
    if (!data) return 'null';
    if (seen.has(data)) return '[...]';
    const next = new Set(seen);
    next.add(data);
    return (
      '[' +
      data.items
        .map((item) => {
          if (item.kind === 'array') {
            if (!item.array) return 'null';
            if (!deep) reject();
            return arrayText(item, true, next);
          }
          if (['int', 'Integer', 'boolean', 'String', 'null'].includes(item.kind))
            return String((item as { value: unknown }).value);
          if (item.kind === 'ref' && !item.object) return 'null';
          reject();
        })
        .join(', ') +
      ']'
    );
  }
  reject();
}
