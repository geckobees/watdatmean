import { inspect, syntaxErrors } from '../analyzer';
import { Cache, fingerprint } from '../cache';
import { defaults, generate } from '../provider';
import type { LearningRequest, Lesson, Provider } from '../types';

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid bridge request.');
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length > max)
    throw new Error(`Expected text under ${max.toLocaleString('en-US')} characters.`);
  return value;
}

/** Private stdio protocol. No network listener, file access, or editor dependencies. */
export class BridgeCore {
  private cache = new Cache<Lesson>();
  private active = new Map<number, AbortController>();

  constructor(private readonly transport: typeof fetch = fetch) {}

  cancel() {
    this.active.forEach((controller) => controller.abort());
    this.active.clear();
  }

  async dispatch(id: number, method: string, value: unknown): Promise<unknown> {
    const p = object(value);
    if (method === 'cancel' || method === 'clearCache') {
      this.cancel();
      if (method === 'clearCache') this.cache.clear();
      return {};
    }
    if (method === 'defaults') return defaults;
    if (method === 'inspect') {
      const code = text(p.code, 500000);
      const start = Number(p.start);
      const end = Number(p.end);
      if (
        !Number.isInteger(start) ||
        !Number.isInteger(end) ||
        start < 0 ||
        end < start ||
        end > code.length
      )
        throw new Error('Invalid selection range.');
      return inspect(code, start, end);
    }
    if (method === 'syntax') return syntaxErrors(text(p.code, 512000));
    if (method !== 'request') throw new Error('Unknown bridge method.');
    const provider = text(p.provider, 30) as Provider;
    if (!Object.hasOwn(defaults, provider)) throw new Error('Unsupported AI provider.');
    const model = text(p.model, 200).trim() || defaults[provider];
    const key = text(p.key, 2000);
    if (!key.trim() || /\s/.test(key)) throw new Error('Configure an API key first.');
    const input = object(p.request);
    const task = input.task as LearningRequest['task'];
    if (!['explain', 'example', 'concept', 'impact'].includes(task))
      throw new Error('Invalid task.');
    const request: LearningRequest = {
      task,
      audience: input.audience === 'experienced' ? 'experienced' : 'beginner',
      mode: task === 'impact' || input.mode === 'project' ? 'project' : 'standalone',
      code: text(input.code, 12000),
      language: text(input.language, 100),
    };
    if (task === 'concept') request.concept = text(input.concept, 150);
    if (task === 'impact') request.replacement = text(input.replacement, 12000);
    if (request.mode === 'project') {
      request.context = text(input.context ?? '', 5000);
      if (!Array.isArray(input.evidence) || input.evidence.length > 12)
        throw new Error('Invalid evidence.');
      request.evidence = input.evidence.map((item) => {
        const e = object(item);
        if (
          !Number.isInteger(e.line) ||
          Number(e.line) < 1 ||
          !['reference', 'definition'].includes(String(e.kind))
        )
          throw new Error('Invalid evidence location.');
        return {
          id: text(e.id, 10),
          file: text(e.file, 1000),
          line: Number(e.line),
          code: text(e.code, 650),
          kind: e.kind as 'reference' | 'definition',
          test: e.test === true,
        };
      });
    }
    const cacheKey = fingerprint({ version: 2, provider, model, request });
    const cached = this.cache.get(cacheKey);
    if (cached) return { lesson: cached, cached: true, provider, model };
    const controller = new AbortController();
    this.active.set(id, controller);
    try {
      const lesson = await generate(
        provider,
        model,
        key,
        request,
        controller.signal,
        this.transport,
      );
      if (controller.signal.aborted) throw new Error('Request cancelled.');
      this.cache.set(cacheKey, lesson);
      return { lesson, cached: false, provider, model };
    } finally {
      this.active.delete(id);
    }
  }
}
