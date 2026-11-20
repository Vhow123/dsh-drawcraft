// 真机验证：无限画布的新建画布按钮和白色主题。
// 用法：node test/live-canvas.mjs "http://127.0.0.1:<port>/?token=<TOKEN>"

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

async function loadPuppeteer() {
  const candidates = [
    'puppeteer-core',
    process.env.PUPPETEER_CORE || '',
    'file:///C:/Users/Administrator/.dsh/profiles/desktop/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js',
    'file:///F:/AppData-Moved/.dsh/profiles/desktop/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js',
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const loaded = await import(candidate);
      return loaded.default || loaded;
    } catch (failure) {
      void failure;
    }
  }
  console.error('找不到 puppeteer-core，用 PUPPETEER_CORE=<绝对路径> 指定。');
  process.exit(2);
}

const url = process.argv[2];
if (!url) {
  console.error('用法: node test/live-canvas.mjs "http://127.0.0.1:<port>/?token=<TOKEN>"');
  process.exit(2);
}

const puppeteer = await loadPuppeteer();
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 950 });
const errors = [];
page.on('pageerror', (error) => errors.push(`[pageerror] ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error' && /drawcraft|without inject/.test(message.text())) errors.push(`[console] ${message.text().slice(0, 200)}`);
});
let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failed += 1;
};

try {
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise((resolve) => setTimeout(resolve, 6000));
  await page.evaluate(() => {
    const mask = document.querySelector('.dshp-auth-mask');
    if (!mask) return;
    document.querySelectorAll('input[type="checkbox"]').forEach((box) => { if (!box.checked) box.click(); });
    [...document.querySelectorAll('button')].find((button) => /我已知晓并继续/.test(button.textContent || ''))?.click();
  });
  await new Promise((resolve) => setTimeout(resolve, 900));
  await page.evaluate(() => document.querySelector('[data-drawcraft-tab]')?.click());
  await page.waitForSelector('.dpf-shell', { timeout: 15000 });
  await page.evaluate(() => {
    const tab = [...document.querySelectorAll('.dpf-rail-tab')].find((node) => /画布/.test(node.textContent || ''));
    tab?.click();
  });
  await page.waitForSelector('.dpf-canvas', { timeout: 10000 });
  await new Promise((resolve) => setTimeout(resolve, 500));

  const initial = await page.evaluate(() => {
    const style = (selector) => {
      const node = document.querySelector(selector);
      if (!node) return null;
      const css = getComputedStyle(node);
      return { background: css.backgroundColor, color: css.color, scheme: css.colorScheme };
    };
    return {
      button: Boolean(document.querySelector('.dpf-canvas-new')),
      buttonText: document.querySelector('.dpf-canvas-new')?.textContent.trim() || '',
      panel: style('.dpf-panel'),
      canvas: style('.dpf-canvas'),
      tools: style('.dpf-canvas-tools'),
      lightbox: style('.dpf-lightbox'),
      toolButtons: [...document.querySelectorAll('.dpf-canvas-tools button')].map((button) => ({ text: button.textContent.trim(), title: button.title })),
    };
  });
  check('画布页有新建画布按钮', initial.button, initial.buttonText);
  check('新建按钮文案正确', /新建画布|New canvas/.test(initial.buttonText), initial.buttonText);
  check('面板白底', initial.panel?.background === 'rgb(255, 255, 255)', JSON.stringify(initial.panel));
  check('画布浅色底', initial.canvas?.background === 'rgb(248, 250, 252)', JSON.stringify(initial.canvas));
  check('面板使用浅色配色', initial.panel?.scheme === 'light', JSON.stringify(initial.panel));
  check('大图预览仍使用深色配色', !initial.lightbox || initial.lightbox.scheme === 'dark', JSON.stringify(initial.lightbox));

  const addText = initial.toolButtons.find((item) => /提示词|text/i.test(item.text || '') || /提示词|text/i.test(item.title || ''));
  if (addText) {
    await page.evaluate(() => {
      const button = [...document.querySelectorAll('.dpf-canvas-tools button')].find((item) => /提示词|prompt/i.test(item.textContent || '') || /提示词|prompt/i.test(item.title || ''));
      if (button) button.click();
    });
    await new Promise((resolve) => setTimeout(resolve, 400));
    const before = await page.$$eval('.dpf-canvas-node', (nodes) => nodes.length);
    check('画布能新增节点用于重置验证', before > 0, String(before));
    let dialogSeen = false;
    page.once('dialog', async (dialog) => { dialogSeen = true; await dialog.accept(); });
    await page.click('.dpf-canvas-new');
    await new Promise((resolve) => setTimeout(resolve, 500));
    const after = await page.$$eval('.dpf-canvas-node', (nodes) => nodes.length);
    check('新建画布清空节点', after === 0, String(after));
    check('非空画布新建会确认', dialogSeen);
  } else {
    check('画布存在新增文字按钮', false, JSON.stringify(initial.toolButtons));
  }
  check('没有运行时报错', errors.length === 0, errors.slice(0, 3).join(' | '));
  await page.screenshot({ path: 'live-canvas.png' });
} finally {
  await browser.close();
}
console.log(failed === 0 ? '\n全部通过' : `\n${failed} 项未通过`);
process.exit(failed === 0 ? 0 : 1);
