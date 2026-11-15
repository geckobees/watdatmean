// Original, deterministic sound; no external recording or sample is used.
// Run from the repository root to regenerate media/button-click.wav.
import { writeFile } from 'node:fs/promises';

const rate = 22050;
const count = Math.round(rate * 0.095);
const wav = Buffer.alloc(44 + count * 2);
wav.write('RIFF', 0);
wav.writeUInt32LE(wav.length - 8, 4);
wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(rate, 24);
wav.writeUInt32LE(rate * 2, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write('data', 36);
wav.writeUInt32LE(count * 2, 40);
let seed = 8529;
let filtered = 0;
for (let i = 0; i < count; i++) {
  const t = i / rate;
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  filtered = filtered * 0.55 + ((seed / 0xffffffff) * 2 - 1) * 0.45;
  const first = Math.min(1, t / 0.0008) * Math.exp(-t / 0.007);
  const second = t > 0.018 ? Math.min(1, (t - 0.018) / 0.001) * Math.exp(-(t - 0.018) / 0.009) : 0;
  const body = Math.sin(2 * Math.PI * 950 * t) * Math.exp(-t / 0.009) * first;
  const fade = Math.min(1, (count - i - 1) / (rate * 0.01));
  const sample = (filtered * (first + second * 0.6) + body * 0.18) * 0.65 * fade;
  wav.writeInt16LE(Math.round(sample * 32767), 44 + i * 2);
}
await writeFile('media/button-click.wav', wav);
console.log(`Generated original soft switch click (${wav.length} bytes).`);
