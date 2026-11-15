import { inspectCode, checkSyntax, languageId, learningContext } from '../languages';
import { Cache, fingerprint, LESSON_CACHE_VERSION } from '../cache';
import { defaults, generate } from '../provider';
import type { LearningRequest, Lesson, Provider } from '../types';
import { WebResearchService, researchOptions } from '../web-research';
import { retrieveSources } from '../web-retrieval';
import { detectResearchVersions, type VersionManifest } from '../research-versions';

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
  private research: WebResearchService;

  constructor(
    private readonly transport: typeof fetch = fetch,
    retrieve: typeof retrieveSources = retrieveSources,
  ) {
    this.research = new WebResearchService(transport, retrieve);
  }

  cancel() {
    this.active.forEach((controller) => controller.abort());
    this.active.clear();
  }

  async dispatch(id: number, method: string, value: unknown): Promise<unknown> {
    const p = object(value);
    if (method === 'cancel' || method === 'clearCache') {
      this.cancel();
      if (method === 'clearCache') {
        this.cache.clear();
        this.research.clear();
      }
      return {};
    }
    if (method === 'defaults') return defaults;
    if (method === 'researchHints') {
      if (!Array.isArray(p.manifests) || p.manifests.length > 32)
        throw new Error('Invalid version hints.');
      const manifests: VersionManifest[] = p.manifests.map((value) => {
        const m = object(value);
        return { name: text(m.name, 40), text: text(m.text, 65536) };
      });
      return { hints: detectResearchVersions(text(p.language, 100), manifests) };
    }
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
      const language = languageId(text(p.language ?? 'typescript', 100));
      const snippet = inspectCode(code, start, end, language);
      return { ...snippet, learningContext: learningContext(code, language, snippet) };
    }
    if (method === 'syntax' || method === 'checkSyntax') {
      const checked = checkSyntax(
        text(p.code, 512000),
        languageId(text(p.language ?? 'typescript', 100)),
      );
      return method === 'syntax' ? checked.errors : checked;
    }
    if (method !== 'request' && method !== 'research') throw new Error('Unknown bridge method.');
    const provider = text(p.provider, 30) as Provider;
    if (!Object.hasOwn(defaults, provider)) throw new Error('Unsupported AI provider.');
    const key = text(p.key, 2000);
    if (!key.trim() || /\s/.test(key)) throw new Error('Configure an API key first.');
    if (method === 'research') {
      if (p.enabled !== true) throw new Error('Turn on web resources first.');
      const controller = new AbortController();
      this.active.set(id, controller);
      try {
        return await this.research.search(
          provider,
          key,
          text(p.topic, 200),
          p.audience === 'experienced' ? 'experienced' : 'beginner',
          controller.signal,
          researchOptions(p.options),
        );
      } finally {
        this.active.delete(id);
      }
    }
    const model = text(p.model, 200).trim() || defaults[provider];
    const input = object(p.request);
    const task = input.task as LearningRequest['task'];
    if (!['explain', 'walkthrough', 'example', 'concept', 'impact'].includes(task))
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
      if (task === 'walkthrough') request.learningContext = text(input.learningContext ?? '', 2500);
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
    const cacheKey = fingerprint({ version: LESSON_CACHE_VERSION, provider, model, request });
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
