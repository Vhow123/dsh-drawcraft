import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '..', 'client.js'), 'utf8');

/**
 * client.js 是浏览器模块（依赖 window.__ModuleLoader__），node 里不能直接 import。
 * 等高线算法是纯函数，单独抠出来跑，防止索引写错在浏览器里变成一片空白。
 */
function loadBuildContourMask() {
  const start = source.indexOf('function buildContourMask(');
  const end = source.indexOf('async function contourDataUrl(');
  assert.ok(start > 0 && end > start, 'buildContourMask 应该定义在 contourDataUrl 之前');
  const factory = new Function(`${source.slice(start, end)}; return buildContourMask;`);
  return factory();
}

const buildContourMask = loadBuildContourMask();

function disc(size, radius, value) {
  const gray = new Float32Array(size * size);
  const center = (size - 1) / 2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const d = Math.hypot(x - center, y - center);
      gray[y * size + x] = d <= radius ? value : 0;
    }
  }
  return gray;
}

test('圆盘边缘出线，平坦区域不出线', () => {
  const size = 40;
  const gray = disc(size, 12, 0.9);
  const mask = buildContourMask(gray, size, size, 0, 0.9, 8);
  assert.equal(mask.length, size * size);
  // 圆心是平坦高值，不该有线
  assert.equal(mask[20 * size + 20], 0, '圆心应该是空白');
  // 圆的外缘应该有线（左边界附近）
  const ringHits = [];
  for (let x = 0; x < size; x += 1) if (mask[20 * size + x] === 1) ringHits.push(x);
  assert.ok(ringHits.length >= 2, '水平扫描线应该穿过圆盘左右两条边界');
  assert.ok(Math.min(...ringHits) < 12 && Math.max(...ringHits) > 27, `边界位置不对：${ringHits.join(',')}`);
});

test('线条占比落在合理区间', () => {
  const size = 64;
  const gray = disc(size, 20, 0.85);
  const mask = buildContourMask(gray, size, size, 0, 0.85, 12);
  let ink = 0;
  for (let i = 0; i < mask.length; i += 1) ink += mask[i];
  const ratio = ink / mask.length;
  assert.ok(ratio > 0.02 && ratio < 0.45, `墨线占比异常：${ratio.toFixed(3)}`);
});

test('全平灰度图不会崩，也不产生线', () => {
  const size = 16;
  const gray = new Float32Array(size * size).fill(0.5);
  const mask = buildContourMask(gray, size, size, 0.5, 0.5, 16);
  for (let i = 0; i < mask.length; i += 1) assert.equal(mask[i], 0);
});

test('层级越少线越少', () => {
  const size = 48;
  const gray = new Float32Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) gray[y * size + x] = x / (size - 1);
  }
  const count = (levels) => {
    const mask = buildContourMask(gray, size, size, 0, 1, levels);
    let ink = 0;
    for (let i = 0; i < mask.length; i += 1) ink += mask[i];
    return ink;
  };
  assert.ok(count(4) < count(16), '4 层的线应该少于 16 层');
});
