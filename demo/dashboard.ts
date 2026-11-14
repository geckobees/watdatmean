import { calculatePoints, Scoreboard } from './score';

export function weeklySummary(completedTasks: number): string {
  const points: number = calculatePoints(completedTasks);
  return `You earned ${points} points this week.`;
}

const board = new Scoreboard();
board.addCompletedTasks(3);
console.log(weeklySummary(3)); // You earned 30 points this week.
console.log(board.getLevel()); // Explorer
