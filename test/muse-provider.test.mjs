/**
 * 内置 Muse 通道的离线测试：不碰浏览器、不花额度。
 *
 * 跑法：node test/muse-provider.test.mjs
 */
import assert from 'node:assert/strict';

import { MuseProvider, MUSE_ACCOUNT_ID, composePrompt, sniffMime } from '../lib/muse-provider.js';

let pass = 0;
let fail = 0;

async function check(name, fn) {
  try {
    await fn();
    pass += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    fail += 1;
    console.log(`FAIL ${name}\n     ${error && error.message}`);
  }
}

const provider = new MuseProvider({ log: () => {} });

await check('账号槽固定为 default', () => {
  assert.equal(MUSE_ACCOUNT_ID, 'default');
  assert.match(provider.profileDir.replace(/\\/g, '/'), /\/\.dsh\/drawcraft-muse\/profiles\/default$/);
});

await check('status() 不启动浏览器', async () => {
  const state = await provider.status();
  assert.equal(state.ok, true);
  assert.equal(state.running, false);
  assert.equal(state.signedIn, undefined);
});

await check('空提示词在发送前被拦下', async () => {
  await assert.rejects(() => provider.generate({ prompt: '   ' }), (error) => {
    assert.equal(error.code, 'EMPTY_PROMPT');
    return true;
  });
});

await check('参考图超过 4 张直接拒绝', async () => {
  const refs = ['a.png', 'b.png', 'c.png', 'd.png', 'e.png'];
  await assert.rejects(() => provider.generate({ prompt: 'x', references: refs }), (error) => {
    assert.equal(error.code, 'TOO_MANY_REFERENCES');
    return true;
  });
});

await check('画幅提示拼在提示词后面', () => {
  assert.equal(composePrompt('一只猫', '16:9'), '一只猫\n\n画面比例 16:9，横版宽幅构图。');
});

await check('未知画幅不改写提示词', () => {
  assert.equal(composePrompt('一只猫', 'auto'), '一只猫');
  assert.equal(composePrompt('一只猫', undefined), '一只猫');
});

await check('signOut() 在没有 profile 时也返回 ok', async () => {
  const result = await provider.signOut();
  assert.equal(result.ok, true);
});

await check('按字节头认出真实图片类型', () => {
  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8X'), Buffer.alloc(8)]);
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16)]);
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8)]);
  assert.equal(sniffMime(webp), 'image/webp');
  assert.equal(sniffMime(jpeg), 'image/jpeg');
  assert.equal(sniffMime(png), 'image/png');
  assert.equal(sniffMime(new Uint8Array(jpeg)), 'image/jpeg');
  assert.equal(sniffMime(Buffer.from('not an image at all')), undefined);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
