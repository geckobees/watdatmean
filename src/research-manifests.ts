import { open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { manifestNames, type VersionManifest } from './research-versions';

export async function readVersionManifests(
  rootPath: string,
  filePath: string,
): Promise<VersionManifest[]> {
  const result: VersionManifest[] = [];
  try {
    const root = await realpath(rootPath),
      file = await realpath(filePath);
    const inside = (p: string) => {
      const rel = path.relative(root, p);
      return !rel.startsWith('..') && !path.isAbsolute(rel);
    };
    if (!inside(file)) return result;
    for (
      let dir = path.dirname(file), depth = 0;
      depth < 10 && inside(dir);
      depth++, dir = path.dirname(dir)
    ) {
      for (const name of manifestNames) {
        if (result.length >= 32) return result;
        try {
          const target = await realpath(path.join(dir, name));
          if (!inside(target)) continue;
          const handle = await open(target, 'r');
          try {
            const stat = await handle.stat();
            if (!stat.isFile() || stat.size > 65536) continue;
            const bytes = Buffer.alloc(65537),
              { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
            if (bytesRead <= 65536)
              result.push({ name, text: bytes.subarray(0, bytesRead).toString('utf8') });
          } finally {
            await handle.close();
          }
        } catch {
          /* Missing, unreadable or changing files leave hints unknown. */
        }
      }
      if (dir === root) break;
    }
  } catch {
    /* Untitled/nonlocal/outside-project sources have no detected target. */
  }
  return result;
}
