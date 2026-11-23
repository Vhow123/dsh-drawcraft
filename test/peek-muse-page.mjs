/**
 * 调试：连上内置通道的 Chrome，打印当前页面的对话内容。
 * 跑法：node test/peek-muse-page.mjs [port]
 */
import { CdpConnection } from '../vendor/muse/cdp.js';

const port = Number(process.argv[2]) || 19220;
const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = list.find((item) => item.type === 'page');
if (!page) {
  console.log('没有页面');
  process.exit(1);
}
console.log('URL:', page.url);

const cdp = await CdpConnection.connect(page.webSocketDebuggerUrl);
const evaluate = async (expression) => {
  const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  return result?.result?.value;
};

console.log('--- 页面文本 ---');
console.log(String(await evaluate('document.body.innerText')).slice(-2500));

console.log('--- 输入框/按钮 ---');
console.log(
  await evaluate(`JSON.stringify({
    textareas: [...document.querySelectorAll('textarea')].map(t => t.value.slice(0, 80)),
    editables: [...document.querySelectorAll('[contenteditable="true"]')].map(t => t.innerText.slice(0, 80)),
    buttons: [...document.querySelectorAll('button')].map(b => (b.innerText || b.getAttribute('aria-label') || '').trim()).filter(Boolean).slice(0, 20),
    imgs: [...document.querySelectorAll('img')].map(i => ({ src: i.currentSrc.slice(0, 90), w: i.naturalWidth, h: i.naturalHeight })).slice(-8),
    videos: document.querySelectorAll('video').length,
  }, null, 1)`),
);

cdp.close?.();
process.exit(0);
