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
  // 每次真机回归从默认空工作区开始，避免上一次运行留下的画布干扰断言。
  await page.evaluate(() => {
    localStorage.removeItem('dsh-drawcraft:canvases:v1');
    localStorage.removeItem('dsh-drawcraft:canvas:v1');
    localStorage.removeItem('dsh-image-prompt-forge:canvas:v1');
  });
  await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });
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
    const first = await page.evaluate(() => {
      const select = document.querySelector('.dpf-canvas-workspace-select');
      return { id: select?.value || '', name: select?.selectedOptions?.[0]?.textContent || '', count: select?.options?.length || 0 };
    });
    check('画布能新增节点并保留旧工作区', before > 0 && Boolean(first.id), JSON.stringify({ before, first }));
    await page.click('.dpf-canvas-new');
    await new Promise((resolve) => setTimeout(resolve, 500));
    const second = await page.evaluate(() => {
      const select = document.querySelector('.dpf-canvas-workspace-select');
      return { id: select?.value || '', name: select?.selectedOptions?.[0]?.textContent || '', count: select?.options?.length || 0, nodes: document.querySelectorAll('.dpf-canvas-node').length };
    });
    check('新建画布增加列表项并切换', second.count === first.count + 1 && second.id !== first.id, JSON.stringify({ first, second }));
    check('新画布从空白开始', second.nodes === 0, String(second.nodes));
    await page.select('.dpf-canvas-workspace-select', first.id);
    await new Promise((resolve) => setTimeout(resolve, 400));
    const restored = await page.$$eval('.dpf-canvas-node', (nodes) => nodes.length);
    check('切回旧画布后节点仍在', restored === before, String(restored));

    let renameDialog = false;
    page.once('dialog', async (dialog) => { renameDialog = true; await dialog.accept('保留内容的画布'); });
    await page.evaluate(() => {
      const button = [...document.querySelectorAll('.dpf-canvas-workspace button')].find((item) => /重命名|rename/i.test(item.textContent || ''));
      button?.click();
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const renamed = await page.$eval('.dpf-canvas-workspace-select option:checked', (option) => option.textContent || '');
    check('当前画布支持命名', renameDialog && renamed === '保留内容的画布', renamed);

    await page.click('.dpf-canvas-new');
    await new Promise((resolve) => setTimeout(resolve, 350));
    // 先删非当前画布，再删当前画布，覆盖两种删除路径并确认至少保留一张。
    await page.select('.dpf-canvas-workspace-select', second.id);
    await page.waitForFunction((id) => document.querySelector('.dpf-canvas-workspace-select')?.value === id, { timeout: 5000 }, second.id);
    await new Promise((resolve) => setTimeout(resolve, 350));
    let nonActiveDeleteDialog = false;
    page.once('dialog', async (dialog) => { nonActiveDeleteDialog = true; await dialog.accept(); });
    await page.click('.dpf-canvas-delete');
    await new Promise((resolve) => setTimeout(resolve, 450));
    const afterNonActiveDelete = await page.evaluate(() => ({
      count: document.querySelector('.dpf-canvas-workspace-select')?.options?.length || 0,
      id: document.querySelector('.dpf-canvas-workspace-select')?.value || '',
    }));
    check('删除选中画布后切换到保留画布', nonActiveDeleteDialog && afterNonActiveDelete.count === 2 && afterNonActiveDelete.id !== second.id, JSON.stringify(afterNonActiveDelete));
    let activeDeleteDialog = false;
    page.once('dialog', async (dialog) => { activeDeleteDialog = true; await dialog.accept(); });
    await page.click('.dpf-canvas-delete');
    await new Promise((resolve) => setTimeout(resolve, 450));
    const afterDelete = await page.evaluate(() => ({
      count: document.querySelector('.dpf-canvas-workspace-select')?.options?.length || 0,
      name: document.querySelector('.dpf-canvas-workspace-select option:checked')?.textContent || '',
      nodes: document.querySelectorAll('.dpf-canvas-node').length,
    }));
    check('当前画布支持删除且至少保留一张', activeDeleteDialog && afterDelete.count === 1 && afterDelete.name === '保留内容的画布' && afterDelete.nodes === before, JSON.stringify(afterDelete));
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
      const tab = [...document.querySelectorAll('.dpf-rail-tab')].find((node) => /画布|canvas/i.test(node.textContent || ''));
      tab?.click();
    });
    await page.waitForSelector('.dpf-canvas', { timeout: 15000 });
    await new Promise((resolve) => setTimeout(resolve, 700));
    const persisted = await page.evaluate(() => ({
      count: document.querySelector('.dpf-canvas-workspace-select')?.options?.length || 0,
      name: document.querySelector('.dpf-canvas-workspace-select option:checked')?.textContent || '',
      nodes: document.querySelectorAll('.dpf-canvas-node').length,
    }));
    check('刷新后画布名称与内容仍保留', persisted.count === 1 && persisted.name === '保留内容的画布' && persisted.nodes === before, JSON.stringify(persisted));
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
