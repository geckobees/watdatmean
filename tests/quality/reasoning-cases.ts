import type { LearningRequest } from '../../src/types';
import { optimizationCases } from './optimization-cases';

const simple = (language: string, code: string): LearningRequest => ({
  task: 'explain',
  audience: 'beginner',
  mode: 'standalone',
  language,
  code,
});
export const reasoningCases = [
  {
    id: 'typescript-simple',
    request: simple('TypeScript', 'const name = "Ada";\nconsole.log("Hello, " + name);'),
    expectedOutput: 'Hello, Ada\n',
  },
  {
    id: 'python-simple',
    request: simple('Python', 'name = "Ada"\nprint("Hello, " + name)'),
    expectedOutput: 'Hello, Ada\n',
  },
  {
    id: 'java-simple',
    request: simple('Java', 'System.out.println("Hello, Ada");'),
    expectedOutput: 'Hello, Ada\n',
  },
  optimizationCases[0],
];
