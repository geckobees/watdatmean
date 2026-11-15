import type { LearningRequest } from '../../src/types';
import { wombRequest } from './depth-cases';

export const constructorCode = `B() { super(); show(); n += 100; }
@Override void show() { System.out.print(s + n + super.s + super.n + " "); }`;
export const constructorRequest: LearningRequest = {
  task: 'explain',
  audience: 'beginner',
  mode: 'standalone',
  language: 'Java',
  code: constructorCode,
};
export const compactCases = [
  { id: 'java-constructor-fragment', request: constructorRequest },
  { id: 'java-whole-program-compact', request: wombRequest },
  {
    id: 'python-small-compact',
    request: {
      ...constructorRequest,
      language: 'Python',
      code: 'names = ["Ada", "Lin"]\nprint(", ".join(names))',
    },
  },
];
