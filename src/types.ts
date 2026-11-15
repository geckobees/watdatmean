export type Provider = 'openai' | 'anthropic' | 'groq';
export type Audience = 'beginner' | 'experienced';
export type Mode = 'standalone' | 'project';
export type Task = 'explain' | 'walkthrough' | 'example' | 'concept' | 'impact';
export interface Part {
  token: string;
  brief: string;
  detail: string;
  start?: number;
  end?: number;
}
export interface Snippet {
  code: string;
  start: number;
  end: number;
  symbol: string;
  symbolOffset: number;
  parts: Part[];
  explanation?: string;
}
export interface Evidence {
  id: string;
  file: string;
  line: number;
  code: string;
  kind: 'reference' | 'definition';
  test: boolean;
}
export interface LearningRequest {
  language?: string;
  task: Task;
  audience: Audience;
  mode: Mode;
  code: string;
  context?: string;
  learningContext?: string;
  evidence?: Evidence[];
  replacement?: string;
  concept?: string;
}
export interface TokenUsage {
  input: number;
  output: number;
  total: number;
}
export interface Lesson {
  notice?: string;
  local?: boolean;
  usage?: TokenUsage;
  title: string;
  summary: string;
  note?: string;
  steps: string[];
  stepOutput?: (string | null)[];
  connections?: string[];
  output?: { text: string; explanation: string };
  pitfalls?: string[];
  concepts: { term: string; explanation: string }[];
  example: { code: string; explanation: string };
  predictions: { description: string; evidenceIds: string[] }[];
  checks: string[];
}
