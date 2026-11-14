import type { Task } from './types';

// Groq requires every object property to be required in strict mode.
// An unused section is represented by an empty array or empty strings.
const text = { type: 'string' };
const textList = { type: 'array', items: text };

export const lessonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'summary', 'steps', 'concepts', 'example', 'predictions', 'checks'],
  properties: {
    title: text,
    summary: text,
    steps: textList,
    concepts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['term', 'explanation'],
        properties: { term: text, explanation: text },
      },
    },
    example: {
      type: 'object',
      additionalProperties: false,
      required: ['code', 'explanation'],
      properties: { code: text, explanation: text },
    },
    predictions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['description', 'evidenceIds'],
        properties: { description: text, evidenceIds: textList },
      },
    },
    checks: textList,
  },
};

// Other/custom models retain JSON object mode instead of receiving an unsupported format.
// https://console.groq.com/docs/structured-outputs#supported-models
const strictGroqModels = new Set([
  'openai/gpt-oss-20b',
  'openai/gpt-oss-120b',
  'qwen/qwen3.8-27b',
  'meta-models/muse-spark-open',
]);

// Request only the sections needed for this action, retaining strict validation
// without forcing a full lesson into the small completion budget.
export function lessonSchemaForTask(task: Task) {
  const properties: Record<string, unknown> = { summary: lessonSchema.properties.summary };
  if (task === 'explain') properties.concepts = lessonSchema.properties.concepts;
  if (task === 'example') properties.example = lessonSchema.properties.example;
  if (task === 'impact') {
    properties.predictions = lessonSchema.properties.predictions;
    properties.checks = lessonSchema.properties.checks;
  }
  return {
    type: 'object',
    additionalProperties: false,
    required: Object.keys(properties),
    properties,
  };
}

export function groqResponseFormat(model: string, task?: Task) {
  return strictGroqModels.has(model)
    ? {
        type: 'json_schema',
        json_schema: {
          name: 'code_lesson',
          strict: true,
          schema: task ? lessonSchemaForTask(task) : lessonSchema,
        },
      }
    : { type: 'json_object' };
}
