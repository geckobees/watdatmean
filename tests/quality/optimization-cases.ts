import type { LearningRequest } from '../../src/types';
import { wombRequest, wombOutput } from './depth-cases';

const python = `def make():
    late = []
    saved = []
    for n in range(3):
        late.append(lambda: n)
        saved.append(lambda n=n: n)
    return late, saved
late, saved = make()
print([f() for f in late])
print([f() for f in saved])`;
const checkout = `import { applyDiscount } from './prices';
const due = applyDiscount(100, 0.2);
console.log(due);`;
const prices = `export function applyDiscount(price: number, rate: number): number {
    return price * (1 - rate);
}`;

export const optimizationCases: { id: string; request: LearningRequest; expectedOutput: string }[] =
  [
    {
      id: 'java-construction',
      expectedOutput: wombOutput,
      request: { ...wombRequest, mode: 'project', context: wombRequest.code, evidence: [] },
    },
    {
      id: 'python-closures',
      expectedOutput: '[2, 2, 2]\n[0, 1, 2]\n',
      request: {
        ...wombRequest,
        language: 'Python',
        code: python,
        mode: 'project',
        context:
          '# Compare two ways of keeping loop values.\n' + python + '\n# End of demonstration.',
        evidence: [
          { id: 'E1', file: 'closures.py', line: 1, kind: 'definition', test: false, code: python },
        ],
      },
    },
    {
      id: 'typescript-import',
      expectedOutput: '80\n',
      request: {
        ...wombRequest,
        language: 'TypeScript',
        code: checkout,
        mode: 'project',
        context: '// Checkout\n' + checkout,
        evidence: [
          { id: 'E1', file: 'prices.ts', line: 1, kind: 'definition', test: false, code: prices },
          {
            id: 'E2',
            file: 'prices-copy.ts',
            line: 11,
            kind: 'reference',
            test: false,
            code: prices,
          },
        ],
      },
    },
  ];
