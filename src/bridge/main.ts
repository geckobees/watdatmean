import { createInterface } from 'node:readline';
import { BridgeCore } from './core';

const core = new BridgeCore();
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on('line', (line) => {
  void (async () => {
    let id = 0;
    try {
      if (line.length > 4000000) throw new Error('Bridge request is too large.');
      const message = JSON.parse(line);
      if (!Number.isSafeInteger(message.id) || message.id <= 0)
        throw new Error('Invalid request ID.');
      id = message.id;
      const result = await core.dispatch(id, message.method, message.params);
      process.stdout.write(JSON.stringify({ id, result }) + '\n');
    } catch (error) {
      // JSON parse errors may contain input (including credentials). Never echo them.
      const safe =
        error instanceof SyntaxError
          ? 'Invalid bridge JSON.'
          : error instanceof Error
            ? error.message
            : 'Bridge request failed.';
      process.stdout.write(JSON.stringify({ id, error: safe }) + '\n');
    }
  })();
});
lines.on('close', () => {
  core.cancel();
  process.exit(0);
});
