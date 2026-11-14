import * as vscode from 'vscode';
import type { Evidence, Snippet } from './types';

export interface ContextResult {
  context: string;
  evidence: Evidence[];
  locations: Map<string, vscode.Location>;
  note: string;
}

async function bounded<T>(work: Thenable<T>, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      Promise.resolve(work).catch(() => fallback),
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), 4000);
      }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
}

function allowed(uri: vscode.Uri) {
  return (
    !!vscode.workspace.getWorkspaceFolder(uri) &&
    /\.ts$/i.test(uri.path) &&
    !/(?:^|\/)(?:node_modules|\.git|dist|build|vendor)\//i.test(uri.path)
  );
}

export async function collectContext(
  document: vscode.TextDocument,
  snippet: Snippet,
): Promise<ContextResult> {
  const position = document.positionAt(snippet.symbolOffset);
  const [refs, definitions] = snippet.symbol
    ? await Promise.all([
        bounded(
          vscode.commands.executeCommand<vscode.Location[]>(
            'vscode.executeReferenceProvider',
            document.uri,
            position,
          ),
          [],
        ),
        bounded(
          vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>(
            'vscode.executeDefinitionProvider',
            document.uri,
            position,
          ),
          [],
        ),
      ])
    : [[], []];
  const locations = new Map<string, vscode.Location>();
  const evidence: Evidence[] = [];
  const seen = new Set<string>();
  const candidates = [
    ...(definitions ?? []).map((d) => ({
      location:
        'targetUri' in d
          ? new vscode.Location(d.targetUri, d.targetSelectionRange ?? d.targetRange)
          : d,
      kind: 'definition' as const,
    })),
    ...(refs ?? []).map((location) => ({ location, kind: 'reference' as const })),
  ];
  for (const { location, kind } of candidates) {
    if (evidence.length >= 12) break;
    if (!allowed(location.uri)) continue;
    const key = `${location.uri.toString()}:${location.range.start.line}:${location.range.start.character}`;
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      const doc = await vscode.workspace.openTextDocument(location.uri);
      const line = location.range.start.line;
      // Center the excerpt on the actual reference, including on very long lines.
      const referenceOffset = doc.offsetAt(location.range.start);
      const range = new vscode.Range(
        doc.positionAt(Math.max(0, referenceOffset - 160)),
        doc.positionAt(referenceOffset + 490),
      );
      const id = `E${evidence.length + 1}`;
      const file = vscode.workspace.asRelativePath(location.uri);
      evidence.push({
        id,
        file,
        line: line + 1,
        kind,
        test: /(?:\.(?:test|spec)\.ts$|(?:^|[\\/])(?:tests?|__tests__)[\\/])/.test(file),
        code: doc.getText(range).slice(0, 650),
      });
      locations.set(id, location);
    } catch {
      /* Deleted or inaccessible references cannot support claims. */
    }
  }
  const first = Math.max(0, document.positionAt(snippet.start).line - 12);
  const last = Math.min(document.lineCount - 1, document.positionAt(snippet.end).line + 12);
  const context = document
    .getText(new vscode.Range(first, 0, last, document.lineAt(last).text.length))
    .slice(0, 5000);
  return {
    context,
    evidence,
    locations,
    note: evidence.length
      ? `Showing ${evidence.length} language-service reference/definition locations (maximum 12). Relationships are confirmed; behavioral effects are predictions. Dynamic calls and indirect dependencies may be missing. Tests are identified by filename and have not been run.`
      : 'No workspace references were returned. The TypeScript language service may still be indexing, or this symbol has no known references. This does not mean an edit has no impact.',
  };
}
