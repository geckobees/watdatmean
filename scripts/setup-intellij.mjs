import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
await build({
  entryPoints: [path.join(root, 'src/build-java.ts')],
  bundle: true,
  platform: 'node',
  mainFields: ['module', 'main'],
  format: 'cjs',
  outfile: path.join(root, 'intellij/.gradle/setup-java.cjs'),
});
const { setupBuildJava } = (
  await import(pathToFileURL(path.join(root, 'intellij/.gradle/setup-java.cjs')).href)
).default;
export const javaHome = await setupBuildJava(root);
