/** Parse declarations only: no execution, resolution, network or inference from installed tools. */
export interface VersionManifest {
  name: string;
  text: string;
}
export interface VersionHint {
  version: string;
  source: string;
}
export const manifestNames = [
  'pom.xml',
  'build.gradle.kts',
  'build.gradle',
  'package.json',
  'pyproject.toml',
  '.python-version',
  'go.mod',
  'Cargo.toml',
];
const version = (s: unknown) =>
  typeof s === 'string' && /^[\d\s.^~<>=!*|,+xX-]{1,40}$/.test(s.trim()) && /\d/.test(s)
    ? s.trim()
    : '';
export function detectResearchVersions(
  language: string,
  manifests: VersionManifest[],
): VersionHint[] {
  const lang = language.toLowerCase(),
    hints: VersionHint[] = [],
    seen = new Set<string>();
  const add = (name: string, raw: unknown, source: string) => {
    const v = version(raw);
    if (seen.has(name) || hints.length >= 8) return;
    // A nearer dynamic declaration must not inherit an unrelated outer version.
    if (!v) {
      if (raw !== undefined && raw !== null) seen.add(name);
      return;
    }
    seen.add(name);
    hints.push({ version: `${name} ${v}`, source });
  };
  for (const file of manifests.slice(0, 32)) {
    if (
      !manifestNames.includes(file.name) ||
      typeof file.text !== 'string' ||
      file.text.length > 65536
    )
      continue;
    let t = file.text;
    if (lang === 'java' || lang === 'kotlin') {
      if (file.name === 'pom.xml') {
        t = t.replace(/<!--[\s\S]*?-->/g, '');
        // Properties are accepted literally; unresolved Maven expressions remain unknown.
        const props = t.match(/<properties\b[^>]*>([\s\S]*?)<\/properties>/)?.[1] ?? '';
        const property = (name: string) =>
          props.match(new RegExp(`<${name}>([^<]+)</${name}>`))?.[1]?.trim();
        if (/<artifactId>maven-compiler-plugin<\/artifactId>/.test(t)) {
          const config =
            t.match(
              /<plugin>\s*(?:<groupId>[^<]+<\/groupId>\s*)?<artifactId>maven-compiler-plugin<\/artifactId>([\s\S]*?)<\/plugin>/,
            )?.[1] ?? '';
          add(
            'Java',
            config.match(/<release>([^<]+)<\/release>/)?.[1] ??
              config.match(/<source>([^<]+)<\/source>/)?.[1],
            file.name,
          );
        }
        add(
          'Java',
          property('maven\\.compiler\\.release') ??
            property('maven\\.compiler\\.source') ??
            property('java\\.version'),
          file.name,
        );
      } else if (/^build\.gradle/.test(file.name)) {
        t = t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
        const release = /options\.release(?:\.set\(|\s*=)/.test(t),
          source = /sourceCompatibility\s*=/.test(t);
        const target = release
          ? (t.match(/options\.release\.set\(\s*(\d+)\s*\)/)?.[1] ??
            t.match(/options\.release\s*=\s*(\d+)(?=\s*(?:[;\r\n}]|\/\/|$))/)?.[1] ??
            '')
          : source
            ? (t
                .match(
                  /sourceCompatibility\s*=\s*JavaVersion\.VERSION_(\d+(?:_\d+)?)(?=\s*(?:[;\r\n}]|\/\/|$))/,
                )?.[1]
                ?.replace('_', '.') ??
              t.match(
                /sourceCompatibility\s*=\s*(['"])([\d.]+)\1(?=\s*(?:[;\r\n}]|\/\/|$))/,
              )?.[2] ??
              t.match(/sourceCompatibility\s*=\s*([\d.]+)(?=\s*(?:[;\r\n}]|\/\/|$))/)?.[1] ??
              '')
            : t.match(/JavaLanguageVersion\.of\(\s*(\d+)\s*\)/)?.[1];
        add('Java', target, file.name);
      }
    }
    if (/typescript|javascript/.test(lang) && file.name === 'package.json')
      try {
        const p = JSON.parse(t),
          deps = { ...p.devDependencies, ...p.dependencies };
        if (lang.includes('typescript')) add('TypeScript', deps.typescript, file.name);
        else add('Node.js', p.engines?.node, file.name);
        // Fixed public names only; never copy private package names into a search suggestion.
        for (const [key, label] of Object.entries({
          react: 'React',
          vue: 'Vue',
          '@angular/core': 'Angular',
          next: 'Next.js',
          express: 'Express',
        }))
          add(label, deps[key], file.name);
      } catch {
        /* Malformed manifests leave the version unknown. */
      }
    if (lang === 'python') {
      if (file.name === '.python-version') add('Python', t.trim(), file.name);
      if (file.name === 'pyproject.toml') {
        const section = t.match(/^\[project\]\s*([\s\S]*?)(?=^\[|$(?![\s\S]))/m)?.[1] ?? '';
        add('Python', section.match(/^requires-python\s*=\s*["']([^"']+)["']/m)?.[1], file.name);
        for (const name of ['django', 'flask', 'fastapi', 'numpy', 'pandas']) {
          const declared = section.match(
            new RegExp(`["']${name}\\s*([<>=!~^][0-9.,*<>=!~^ ]+)["']`, 'i'),
          )?.[1];
          add(
            name === 'fastapi' ? 'FastAPI' : name[0].toUpperCase() + name.slice(1),
            declared,
            file.name,
          );
        }
      }
    }
    if (lang === 'go' && file.name === 'go.mod')
      add('Go', t.match(/^go\s+([\d.]+)\s*$/m)?.[1], file.name);
    if (lang === 'rust' && file.name === 'Cargo.toml')
      add('Rust', t.match(/^rust-version\s*=\s*"([\d.]+)"/m)?.[1], file.name);
  }
  return hints;
}
