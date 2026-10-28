// Codifica PCM float a WAV de 24 bits (sin pérdida a efectos prácticos).
export function encodeWav(channels: Float32Array[], sampleRate: number, bits: 16 | 24 = 24): Blob {
  const nch = channels.length;
  const frames = channels[0]?.length ?? 0;
  const bytes = bits / 8;
  const dataSize = frames * nch * bytes;
  const buffer = new ArrayBuffer(44 + dataSize);
  const v = new DataView(buffer);
  const tag = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };

  tag(0, 'RIFF');
  v.setUint32(4, 36 + dataSize, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, nch, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * nch * bytes, true);
  v.setUint16(32, nch * bytes, true);
  v.setUint16(34, bits, true);
  tag(36, 'data');
  v.setUint32(40, dataSize, true);

  let o = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < nch; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][i]));
      if (bits === 16) {
        v.setInt16(o, Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), true);
        o += 2;
        continue;
      }
      const x = Math.round(s < 0 ? s * 0x800000 : s * 0x7fffff);
      v.setUint8(o, x & 0xff);
      v.setUint8(o + 1, (x >> 8) & 0xff);
      v.setUint8(o + 2, (x >> 16) & 0xff);
      o += 3;
    }
  }
  return new Blob([buffer], { type: 'audio/wav' });
}
