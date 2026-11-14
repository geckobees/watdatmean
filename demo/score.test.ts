import { calculatePoints, Scoreboard } from './score';

function equal(actual: unknown, expected: unknown) {
  if (actual !== expected) throw new Error(`Expected ${expected}, received ${actual}`);
}

equal(calculatePoints(3), 30);
equal(calculatePoints(0), 0);
equal(calculatePoints(1), 10);

const board = new Scoreboard();
equal(board.addCompletedTasks(2), 20);
equal(board.getLevel(), 'Starter');
equal(board.addCompletedTasks(1), 30);
equal(board.getLevel(), 'Explorer');
console.log('All score checks passed.');
