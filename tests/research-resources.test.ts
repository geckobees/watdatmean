import { retrieve, summaryPayload } from './fixtures/web-fakes';
import { describe, it, expect, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { detectResearchVersions } from '../src/research-versions';
import { readVersionManifests } from '../src/research-manifests';
import { ResourceBookmarks, BOOKMARK_LIMIT } from '../src/resource-bookmarks';
import { BridgeCore } from '../src/bridge/core';
import { researchOptions, researchRequest, WebResearchService } from '../src/web-research';
const source = {
  url: 'https://docs.example.com/java',
  title: 'Java reference',
  kind: 'Documentation',
};
const research = {
  topic: 'Java streams',
  checkedAt: 123,
  options: { version: 'Java 17', filter: 'docs' as const },
};
const manifest = (name: string, text: string) => ({ name, text });

describe('declared research versions', () => {
  it('does not turn computed declarations into literal prefixes or inherit an outer target', () => {
    for (const text of [
      'options.release.set(17 + offset)\nsourceCompatibility = 11',
      'sourceCompatibility = "17-custom"',
      'sourceCompatibility = JavaVersion.VERSION_17 + offset',
    ]) {
      expect(
        detectResearchVersions('Java', [
          manifest('build.gradle', text),
          manifest('build.gradle', 'sourceCompatibility = 21'),
        ]),
      ).toEqual([]);
    }
    expect(
      detectResearchVersions('Java', [
        manifest(
          'pom.xml',
          '<properties><maven.compiler.release>17</maven.compiler.release></properties><plugin><artifactId>maven-compiler-plugin</artifactId><configuration><release>21</release></configuration></plugin>',
        ),
      ])[0].version,
    ).toBe('Java 21');
    expect(
      detectResearchVersions('TypeScript', [
        manifest('package.json', '{"dependencies":{"typescript":"workspace:*"}}'),
        manifest('package.json', '{"dependencies":{"typescript":"5.9"}}'),
      ]),
    ).toEqual([]);
  });
  it.each([
    [
      'Java',
      'pom.xml',
      '<project><properties><maven.compiler.release>17</maven.compiler.release></properties></project>',
      'Java 17',
    ],
    [
      'Java',
      'build.gradle.kts',
      'java { toolchain { languageVersion.set(JavaLanguageVersion.of(21)) } }\ntasks.withType<JavaCompile> { options.release.set(17) }',
      'Java 17',
    ],
    ['Java', 'build.gradle', 'sourceCompatibility = JavaVersion.VERSION_1_8', 'Java 1.8'],
    [
      'TypeScript',
      'package.json',
      '{"devDependencies":{"typescript":"~5.9.3"}}',
      'TypeScript ~5.9.3',
    ],
    ['JavaScript', 'package.json', '{"engines":{"node":">=22.12"}}', 'Node.js >=22.12'],
    [
      'Python',
      'pyproject.toml',
      '[project]\nname="private"\nrequires-python=">=3.11,<3.13"\n[tool.other]\nvalue=42',
      'Python >=3.11,<3.13',
    ],
    ['Python', '.python-version', '3.12.5\n', 'Python 3.12.5'],
    ['Go', 'go.mod', 'module private\ngo 1.23.0\n', 'Go 1.23.0'],
    ['Rust', 'Cargo.toml', '[package]\nrust-version = "1.80"\n', 'Rust 1.80'],
  ])('reads %s target from %s', (language, name, text, expected) => {
    expect(detectResearchVersions(language, [manifest(name, text)])[0]).toEqual({
      version: expected,
      source: name,
    });
  });
  it('preserves nearest declarations and only suggests fixed public library names', () => {
    const hints = detectResearchVersions('typescriptreact', [
      manifest(
        'package.json',
        JSON.stringify({
          dependencies: {
            typescript: '^5.8',
            react: '^18.3',
            'private-secret-company': '2.0',
            vue: 'file:../internal',
          },
        }),
      ),
      manifest('package.json', '{"devDependencies":{"typescript":"5.9"}}'),
    ]);
    expect(hints.map((h) => h.version)).toEqual(['TypeScript ^5.8', 'React ^18.3']);
    expect(JSON.stringify(hints)).not.toMatch(/private|internal/);
  });
  it('leaves dynamic, commented, malformed and unknown versions absent', () => {
    expect(
      detectResearchVersions('java', [
        manifest(
          'pom.xml',
          '<project><!-- <properties><java.version>99</java.version></properties> --><properties><java.version>${target}</java.version></properties></project>',
        ),
        manifest(
          'build.gradle',
          '// sourceCompatibility = 23\nsourceCompatibility = project.target',
        ),
      ]),
    ).toEqual([]);
    expect(
      detectResearchVersions('typescript', [
        manifest('package.json', '{bad'),
        manifest('private.txt', 'typescript 5.9'),
      ]),
    ).toEqual([]);
    expect(
      detectResearchVersions('python', [
        manifest('pyproject.toml', '[tool.fake]\nrequires-python="3.99"'),
      ]),
    ).toEqual([]);
  });
  it('reads bounded nearest files within the project only', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'wdm-versions-'));
    try {
      await mkdir(path.join(dir, 'project/src'), { recursive: true });
      await writeFile(path.join(dir, 'package.json'), '{"dependencies":{"typescript":"99"}}');
      await writeFile(
        path.join(dir, 'project/package.json'),
        '{"dependencies":{"typescript":"5.9"}}',
      );
      await writeFile(path.join(dir, 'project/src/sample.ts'), 'let n = 1');
      await writeFile(path.join(dir, 'project/pom.xml'), ' '.repeat(65537));
      const found = await readVersionManifests(
        path.join(dir, 'project'),
        path.join(dir, 'project/src/sample.ts'),
      );
      expect(found).toEqual([manifest('package.json', '{"dependencies":{"typescript":"5.9"}}')]);
      expect(
        await readVersionManifests(path.join(dir, 'project'), path.join(dir, 'package.json')),
      ).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it('parses native bridge hints without any provider request', async () => {
    const transport = vi.fn(),
      bridge = new BridgeCore(transport, retrieve);
    expect(
      await bridge.dispatch(1, 'researchHints', {
        language: 'Java',
        manifests: [
          manifest('pom.xml', '<properties><java.version>17</java.version></properties>'),
        ],
      }),
    ).toEqual({ hints: [{ version: 'Java 17', source: 'pom.xml' }] });
    expect(transport).not.toHaveBeenCalled();
    await expect(
      bridge.dispatch(2, 'researchHints', {
        language: 'Java',
        manifests: [manifest('pom.xml', ' '.repeat(65537))],
      }),
    ).rejects.toThrow();
  });
});

describe('local source bookmarks', () => {
  it('deduplicates URLs, survives reload and stores only bounded public source metadata', async () => {
    const persist = vi.fn().mockResolvedValue(undefined),
      store = new ResourceBookmarks(undefined, persist);
    await Promise.all([store.add(source, research), store.add(source, research)]);
    expect(store.snapshot().entries).toHaveLength(1);
    const restored = new ResourceBookmarks(store.snapshot(), persist);
    expect(restored.snapshot().entries[0]).toMatchObject({
      ...source,
      version: 'Java 17',
      topic: 'Java streams',
    });
    const copy = restored.snapshot();
    copy.entries.length = 0;
    expect(restored.snapshot().entries).toHaveLength(1);
    await restored.remove(source.url);
    expect(restored.snapshot().entries).toEqual([]);
  });
  it('never silently evicts bookmarks and recovers after storage failure', async () => {
    const persist = vi.fn().mockResolvedValue(undefined),
      store = new ResourceBookmarks(undefined, persist);
    persist.mockRejectedValueOnce(new Error('disk'));
    await expect(store.add(source, research)).rejects.toThrow('disk');
    expect(store.snapshot().entries).toEqual([]);
    for (let i = 0; i < BOOKMARK_LIMIT; i++)
      await store.add({ ...source, url: `${source.url}/${i}` }, research);
    await expect(store.add(source, research)).rejects.toThrow('100 bookmarks');
    expect(store.snapshot().entries).toHaveLength(100);
    await store.remove(`${source.url}/0`);
    await store.add(source, research);
    expect(store.snapshot().entries[0].url).toBe(source.url);
  });
  it('rejects unsafe links and sanitizes corrupted storage', async () => {
    const store = new ResourceBookmarks(
      {
        version: 1,
        entries: [null, { ...source, url: 'file:///secret', savedAt: 1, checkedAt: 1 }],
      },
      async () => {},
    );
    expect(store.snapshot().entries).toEqual([]);
    await expect(
      store.add({ ...source, url: 'https://localhost/private' }, research),
    ).rejects.toThrow();
  });
});

describe('version and resource search options', () => {
  it.each(['groq', 'openai', 'anthropic'] as const)(
    'adds compact options without changing budgets for %s',
    (provider) => {
      const original = JSON.parse(
        researchRequest(provider, 'fixture-key', 'Java streams', 'beginner').body,
      );
      const updated = JSON.parse(
        researchRequest(provider, 'fixture-key', 'Java streams', 'beginner', research.options).body,
      );
      expect(JSON.stringify(updated)).toContain('Java 17');
      expect(JSON.stringify(updated)).toContain('docs');
      expect(updated.max_tokens ?? updated.max_output_tokens ?? updated.max_completion_tokens).toBe(
        original.max_tokens ?? original.max_output_tokens ?? original.max_completion_tokens,
      );
      // A compact official-docs query hint prevents expensive off-version browsing.
      expect(JSON.stringify(updated).length - JSON.stringify(original).length).toBeLessThan(300);
      expect(JSON.stringify(updated)).toContain('version compatibility is unknown');
    },
  );
  it('validates options before network calls', () => {
    expect(researchOptions()).toEqual({ version: '', filter: 'all' });
    expect(() => researchOptions({ version: 'Java 17\nprivate code' })).toThrow();
    expect(() => researchOptions({ filter: 'run-code' })).toThrow();
    expect(() => researchOptions({ version: 'x'.repeat(121) })).toThrow();
  });
  it('partitions cache by version and filter on both shared paths', async () => {
    const payload = summaryPayload();
    const transport = vi.fn().mockImplementation(async () => Response.json(payload));
    const service = new WebResearchService(transport, retrieve),
      signal = new AbortController().signal;
    await service.search('groq', 'key', 'Java streams', 'beginner', signal, research.options);
    expect(
      (await service.search('groq', 'key', 'Java streams', 'beginner', signal, research.options))
        .cached,
    ).toBe(true);
    await service.search('groq', 'key', 'Java streams', 'beginner', signal, {
      version: 'Java 21',
      filter: 'docs',
    });
    await service.search('groq', 'key', 'Java streams', 'beginner', signal, {
      version: 'Java 21',
      filter: 'videos',
    });
    expect(transport).toHaveBeenCalledTimes(3);
    const bridge = new BridgeCore(transport, retrieve);
    const result: any = await bridge.dispatch(1, 'research', {
      provider: 'groq',
      key: 'key',
      enabled: true,
      topic: 'Java streams',
      audience: 'beginner',
      options: research.options,
    });
    expect(result.options).toEqual(research.options);
    expect(
      JSON.parse((transport.mock.calls.at(-1) as any)[1].body).messages.at(-1).content,
    ).toContain('Java 17');
  });
});
