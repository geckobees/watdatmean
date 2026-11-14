/** A small rewards system. Start by hovering over the declaration below. */
export const POINTS_PER_TASK: number = 10;

export class Scoreboard {
  private score: number = 0;

  /** Try replacing `tasks * POINTS_PER_TASK` with `tasks + POINTS_PER_TASK`. */
  addCompletedTasks(tasks: number): number {
    this.score += tasks * POINTS_PER_TASK;
    return this.score;
  }

  getLevel(): string {
    return this.score >= 30 ? 'Explorer' : 'Starter';
  }
}

/** Inspect the function name to see its callers in dashboard.ts and score.test.ts. */
export function calculatePoints(tasks: number): number {
  return tasks * POINTS_PER_TASK;
}
