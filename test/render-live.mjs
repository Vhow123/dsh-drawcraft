/**
 * 真实出图：走绘语自己的 /api/drawcraft/render，目标选内置 muse。
 *
 * 跑法：node test/render-live.mjs "提示词" [size] [n]
 * 注意：每张都是一次真实发送，会消耗 Muse 额度。
 */
import { writeFileSync } from 'node:fs';

const prompt = process.argv[2] || '一只橘猫趴在木质书桌上打盹，午后斜光，电影感，浅景深';
const size = process.argv[3] || '16:9';
const n = Number(process.argv[4]) || 1;
const base = process.env.DRAWCRAFT_BASE || 'http://127.0.0.1:55186';

const started = Date.now();
const response = await fetch(`${base}/api/drawcraft/render`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ targetId: 'muse', mode: 'text', prompt, size, n, model: 'muse' }),
});
const result = await response.json();
console.log(
  JSON.stringify(
    {
      ok: result.ok,
      code: result.code,
      message: result.message,
      durationMs: result.durationMs ?? Date.now() - started,
      images: (result.images || []).map((shot) => ({ mime: shot.mime, b64len: shot.b64.length })),
    },
    null,
    1,
  ),
);
if (result.ok) {
  for (const [index, shot] of result.images.entries()) {
    const ext = shot.mime === 'image/png' ? 'png' : shot.mime === 'image/jpeg' ? 'jpg' : 'webp';
    const path = `F:/杂项/muse-builtin-${index + 1}.${ext}`;
    writeFileSync(path, Buffer.from(shot.b64, 'base64'));
    console.log('saved', path);
  }
} else {
  process.exitCode = 1;
}
