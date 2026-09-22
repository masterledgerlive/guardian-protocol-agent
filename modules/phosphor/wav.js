/** Deterministic PCM beep — a song-shaped file the self-test can write, read, and play. */

export function synthWav({ seconds = 0.35, freq = 440, rate = 8000 } = {}) {
  const samples = Math.floor(rate * seconds);
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    const env = Math.min(1, i / 80) * Math.min(1, (samples - i) / 200);
    const sample = Math.sin((2 * Math.PI * freq * i) / rate) * 22000 * env;
    const clamped = Math.max(-32767, Math.min(32767, Math.round(sample)));
    data.writeInt16LE(clamped, i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}
