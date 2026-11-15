import type { Lesson } from '../../src/types';

// Regression: this readable answer lost every link when concepts was empty.
export const objectCreationLesson: Lesson = {
  title: 'Creating an Object',
  summary:
    'This line creates a new object using the Scoreboard class. The name is board. The "new" keyword starts the class\'s setup function. That happens automatically. No specific data is provided here. The board variable holds the created object.',
  steps: [
    'The TypeScript compiler checks the Scoreboard type.',
    'JavaScript creates a new empty object for your class. It runs any internal setup code. Finally, it points board to that new object.',
  ],
  concepts: [],
  example: {
    code: 'const player = new Player("Alice");',
    explanation: 'This makes an object and passes "Alice" to the class setup.',
  },
  predictions: [],
  checks: [],
};
