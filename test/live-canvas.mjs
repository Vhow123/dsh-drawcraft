// 真机验证：画布 IndexedDB 图片、复制撤销、多画布与历史记录。
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
    localStorage.setItem('dsh-drawcraft:v1', JSON.stringify({ history: [{
      id: 'live-prompt-history', kind: 'prompt', at: Date.now(), title: 'Right history deletion regression',
      prompt: 'Right history prompt', negative: '', fields: {}, variants: [], notes: '',
      dialect: 'natural-en', style: 'photo', aspect: '1:1', model: 'Live prompt model', idea: 'Right history idea',
    }] }));
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

  const bleed = await page.evaluate(() => ({
    data: document.querySelector('.dpf-shell')?.getAttribute('data-canvas') || '',
    rail: document.querySelector('.dpf-rail')?.getBoundingClientRect().width || 0,
    historyVisible: Boolean(document.querySelector('.dpf-rail-list')?.offsetParent),
    fullButton: Boolean(document.querySelector('.dpf-canvas-full')),
  }));
  check('画布页收起左栏历史，画布占满面板', bleed.data === '1' && bleed.rail < 90 && !bleed.historyVisible && bleed.fullButton, JSON.stringify(bleed));
  await page.click('.dpf-canvas-full');
  await new Promise((resolve) => setTimeout(resolve, 300));
  const fullscreen = await page.evaluate(() => {
    const panel = document.querySelector('.dpf-panel');
    const rect = panel?.getBoundingClientRect();
    return { width: Math.round(rect?.width || 0), height: Math.round(rect?.height || 0), viewport: [window.innerWidth, window.innerHeight], full: panel?.classList.contains('dpf-panel-full') || false };
  });
  check('画布可全屏撑满视口', fullscreen.full && Math.abs(fullscreen.width - fullscreen.viewport[0]) <= 2 && Math.abs(fullscreen.height - fullscreen.viewport[1]) <= 2, JSON.stringify(fullscreen));
  await page.click('.dpf-canvas-full');
  await new Promise((resolve) => setTimeout(resolve, 300));

  const pasteResult = await page.evaluate(() => {
    const canvas = document.querySelector('.dpf-canvas');
    canvas?.focus();
    const keydown = new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true, cancelable: true });
    canvas?.dispatchEvent(keydown);
    const transfer = new DataTransfer();
    const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (char) => char.charCodeAt(0));
    transfer.items.add(new File([bytes], 'clipboard.png', { type: 'image/png' }));
    const paste = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer });
    const dispatched = window.dispatchEvent(paste);
    return { keyPrevented: keydown.defaultPrevented, pastePrevented: paste.defaultPrevented, dispatched };
  });
  await page.waitForFunction(() => document.querySelectorAll('.dpf-canvas-node img').length > 0, { timeout: 10000 });
  const pastedImages = await page.$$eval('.dpf-canvas-node img', (images) => images.length);
  check('Ctrl+V 保留默认粘贴并把剪贴板图片落到画布', !pasteResult.keyPrevented && pasteResult.pastePrevented && pastedImages === 1, JSON.stringify({ ...pasteResult, pastedImages }));
  const canvasStored = await page.evaluate(async () => {
    await new Promise((resolve) => setTimeout(resolve, 650));
    const workspace = JSON.parse(localStorage.getItem('dsh-drawcraft:canvases:v1') || '{}');
    const active = workspace.items?.find((item) => item.id === workspace.activeId);
    const image = active?.state?.nodes?.find((node) => node.kind === 'image');
    const database = await new Promise((resolve) => {
      const request = indexedDB.open('dsh-drawcraft-history', 2);
      request.onerror = () => resolve(null);
      request.onsuccess = () => resolve(request.result);
    });
    if (!database || !image) return { image: image || null, store: false, blob: false, inline: JSON.stringify(workspace).includes('data:image/') };
    const result = await new Promise((resolve) => {
      const request = database.transaction('canvas-assets', 'readonly').objectStore('canvas-assets').get(image.assetRef);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(null);
    });
    return { image: { src: image.src, assetRef: image.assetRef }, store: true, blob: result instanceof Blob, mime: result?.type || '', inline: JSON.stringify(workspace).includes('data:image/') };
  });
  check('画布索引只存资产引用且 IndexedDB 保存图片 Blob', canvasStored.store && canvasStored.blob && !canvasStored.inline && canvasStored.image.src === '' && canvasStored.image.assetRef?.startsWith('drawcraft-canvas:'), JSON.stringify(canvasStored));
  await page.evaluate(() => document.querySelector('.dpf-canvas')?.focus());
  await page.keyboard.down('Control');
  await page.keyboard.press('c');
  await page.keyboard.up('Control');
  await page.keyboard.down('Control');
  await page.keyboard.press('v');
  await page.keyboard.up('Control');
  await page.waitForFunction(() => document.querySelectorAll('.dpf-canvas-node img').length === 2, { timeout: 5000 });
  await new Promise((resolve) => setTimeout(resolve, 650));
  const copiedAsset = await page.evaluate(async () => {
    const workspace = JSON.parse(localStorage.getItem('dsh-drawcraft:canvases:v1') || '{}');
    const active = workspace.items?.find((item) => item.id === workspace.activeId);
    const nodes = active?.state?.nodes?.filter((node) => node.kind === 'image') || [];
    const database = await new Promise((resolve) => {
      const request = indexedDB.open('dsh-drawcraft-history', 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    });
    if (!database || nodes.length !== 2) return { ids: nodes.map((node) => node.id), refs: nodes.map((node) => node.assetRef), blobs: [] };
    const blobs = await Promise.all(nodes.map((node) => new Promise((resolve) => {
      const request = database.transaction('canvas-assets', 'readonly').objectStore('canvas-assets').get(node.assetRef);
      request.onsuccess = () => resolve(request.result instanceof Blob);
      request.onerror = () => resolve(false);
    })));
    return { ids: nodes.map((node) => node.id), refs: nodes.map((node) => node.assetRef), blobs };
  });
  check('复制图片生成独立资产键并保存两份 Blob', copiedAsset.ids.length === 2 && copiedAsset.ids[0] !== copiedAsset.ids[1] && copiedAsset.refs[0] !== copiedAsset.refs[1] && copiedAsset.blobs.every(Boolean), JSON.stringify(copiedAsset));
  await page.keyboard.down('Control');
  await page.keyboard.press('z');
  await page.keyboard.up('Control');
  await page.waitForFunction(() => document.querySelectorAll('.dpf-canvas-node img').length === 1, { timeout: 5000 });
  await page.waitForFunction(async () => {
    const workspace = JSON.parse(localStorage.getItem('dsh-drawcraft:canvases:v1') || '{}');
    const active = workspace.items?.find((item) => item.id === workspace.activeId);
    const node = active?.state?.nodes?.find((item) => item.kind === 'image');
    if (!node?.assetRef) return false;
    const database = await new Promise((resolve) => {
      const request = indexedDB.open('dsh-drawcraft-history', 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    });
    if (!database) return false;
    return new Promise((resolve) => {
      const request = database.transaction('canvas-assets', 'readonly').objectStore('canvas-assets').get(node.assetRef);
      request.onsuccess = () => resolve(request.result instanceof Blob);
      request.onerror = () => resolve(false);
    });
  }, { timeout: 5000 });
  check('撤销图片复制后原节点资产仍可读取', true);
  await page.click('.dpf-canvas-node[data-kind="image"]');
  await page.evaluate(() => document.querySelector('.dpf-canvas')?.focus());
  await page.keyboard.press('Delete');
  await page.waitForFunction(() => document.querySelectorAll('.dpf-canvas-node img').length === 0, { timeout: 5000 });
  await new Promise((resolve) => setTimeout(resolve, 700));
  const deletedAsset = await page.evaluate((key) => new Promise((resolve) => {
    const request = indexedDB.open('dsh-drawcraft-history', 2);
    request.onsuccess = () => {
      const get = request.result.transaction('canvas-assets', 'readonly').objectStore('canvas-assets').get(key);
      get.onsuccess = () => resolve(get.result == null);
      get.onerror = () => resolve(false);
    };
    request.onerror = () => resolve(false);
  }), canvasStored.image.assetRef);
  check('删除最后一个图片节点后回收其 IndexedDB 资产', deletedAsset, String(deletedAsset));
  await page.keyboard.down('Control');
  await page.keyboard.press('z');
  await page.keyboard.up('Control');
  await page.waitForFunction(() => document.querySelectorAll('.dpf-canvas-node img').length === 1, { timeout: 5000 });
  await page.waitForFunction(async (key) => {
    const request = indexedDB.open('dsh-drawcraft-history', 2);
    const database = await new Promise((resolve) => { request.onsuccess = () => resolve(request.result); request.onerror = () => resolve(null); });
    if (!database) return false;
    return new Promise((resolve) => {
      const get = database.transaction('canvas-assets', 'readonly').objectStore('canvas-assets').get(key);
      get.onsuccess = () => resolve(get.result instanceof Blob);
      get.onerror = () => resolve(false);
    });
  }, { timeout: 5000 }, canvasStored.image.assetRef);
  check('撤销删除后从运行态图片数据重建 IndexedDB 资产', true);
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
      images: [...document.querySelectorAll('.dpf-canvas-node img')].map((image) => image.getAttribute('src') || ''),
      storedInline: JSON.stringify(JSON.parse(localStorage.getItem('dsh-drawcraft:canvases:v1') || '{}')).includes('data:image/'),
    }));
    check('刷新后画布名称、图片原图与内容仍保留', persisted.count === 1 && persisted.name === '保留内容的画布' && persisted.nodes === before && persisted.images.length === 1 && persisted.images[0].startsWith('data:image/png;base64,') && !persisted.storedInline, JSON.stringify(persisted));
  } else {
    check('画布存在新增文字按钮', false, JSON.stringify(initial.toolButtons));
  }

  await page.evaluate(() => [...document.querySelectorAll('.dpf-rail-tab')].find((node) => /生图|image/i.test(node.textContent || ''))?.click());
  await page.waitForSelector('.dpf-idea', { timeout: 10000 });
  const historyPrompt = 'Live image history regression';
  await page.evaluate((value) => {
    const input = document.querySelector('.dpf-idea');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input?.dispatchEvent(new Event('input', { bubbles: true }));
  }, historyPrompt);
  await page.evaluate(() => {
    const realFetch = window.fetch.bind(window);
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    window.fetch = (input, init) => {
      const path = typeof input === 'string' ? input : input?.url || '';
      if (path.includes('/api/dsh-imagegen/generate') || path.includes('/api/drawcraft/render')) {
        return Promise.resolve(new Response(JSON.stringify({ ok: true, images: [{ b64: png, mime: 'image/png' }] }), { status: 200, headers: { 'content-type': 'application/json' } }));
      }
      return realFetch(input, init);
    };
  });
  await page.click('.dpf-actions .dpf-btn-primary');
  await page.waitForFunction((prompt) => [...document.querySelectorAll('.dpf-rail-item b')].some((item) => item.textContent === prompt), { timeout: 15000 }, historyPrompt);
  const imageHistory = await page.evaluate((prompt) => {
    const row = [...document.querySelectorAll('.dpf-rail-item')].find((item) => item.querySelector('b')?.textContent === prompt);
    const saved = (JSON.parse(localStorage.getItem('dsh-drawcraft:v1') || '{}').history || []).find((entry) => entry.prompt === prompt);
    return { found: Boolean(row), thumbnail: row?.querySelector('.dpf-history-thumb')?.getAttribute('src') || '', originalStored: saved?.originalStored === true, id: saved?.id || '', count: document.querySelectorAll('.dpf-rail-item').length };
  }, historyPrompt);
  const storedOriginal = await page.evaluate((id) => new Promise((resolve) => {
    const request = indexedDB.open('dsh-drawcraft-history', 2);
    request.onerror = () => resolve(null);
    request.onsuccess = () => {
      const get = request.result.transaction('images', 'readonly').objectStore('images').get(id);
      get.onsuccess = () => resolve(get.result?.[0] || null);
      get.onerror = () => resolve(null);
    };
  }), imageHistory.id);
  check('成功生图同时保存列表缩略图与原图记录', imageHistory.found && imageHistory.thumbnail.startsWith('data:image/jpeg;base64,') && imageHistory.originalStored && storedOriginal?.mime === 'image/png' && storedOriginal?.b64?.startsWith('iVBORw0KGgo'), JSON.stringify({ history: imageHistory, original: storedOriginal && { mime: storedOriginal.mime, bytes: storedOriginal.b64.length } }));
  await page.evaluate((prompt) => [...document.querySelectorAll('.dpf-rail-item')].find((item) => item.querySelector('b')?.textContent === prompt)?.click(), historyPrompt);
  await page.waitForFunction(() => document.querySelector('.dpf-preview img')?.getAttribute('src')?.startsWith('data:image/png;base64,'), { timeout: 5000 });
  const restoredImageHistory = await page.evaluate(() => ({
    title: document.querySelector('.dpf-topbar-title')?.textContent || '',
    prompt: document.querySelector('.dpf-idea')?.value || '',
    preview: document.querySelector('.dpf-preview img')?.getAttribute('src') || '',
    stale: Boolean(document.querySelector('.dpf-stale')),
    stored: (JSON.parse(localStorage.getItem('dsh-drawcraft:v1') || '{}').history || []).find((entry) => entry.prompt === document.querySelector('.dpf-idea')?.value)?.originalStored === true,
  }));
  check('点击图片历史恢复原始分辨率预览与提示词', /生图|Image/.test(restoredImageHistory.title) && restoredImageHistory.prompt === historyPrompt && restoredImageHistory.preview.startsWith('data:image/png;base64,') && restoredImageHistory.stored && !restoredImageHistory.stale, JSON.stringify(restoredImageHistory));

  const secondPrompt = 'Second image history row';
  await page.evaluate((value) => {
    const input = document.querySelector('.dpf-idea');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input?.dispatchEvent(new Event('input', { bubbles: true }));
  }, secondPrompt);
  await page.click('.dpf-actions .dpf-btn-primary');
  await page.waitForFunction((prompt) => [...document.querySelectorAll('.dpf-rail-item b')].some((item) => item.textContent === prompt), { timeout: 15000 }, secondPrompt);
  await page.evaluate((prompt) => [...document.querySelectorAll('.dpf-rail-item')].find((item) => item.querySelector('b')?.textContent === prompt)?.click(), historyPrompt);
  await page.waitForFunction((prompt) => document.querySelector('.dpf-idea')?.value === prompt, { timeout: 5000 }, historyPrompt);
  await page.evaluate((prompt) => {
    const row = [...document.querySelectorAll('.dpf-rail-entry')].find((item) => item.querySelector('.dpf-rail-item b')?.textContent === prompt);
    row?.querySelector('.dpf-history-delete')?.click();
  }, historyPrompt);
  await page.waitForFunction((prompt) => ![...document.querySelectorAll('.dpf-rail-item b')].some((item) => item.textContent === prompt), { timeout: 5000 }, historyPrompt);
  const deletion = await page.evaluate((survivorPrompt) => ({
    removed: ![...document.querySelectorAll('.dpf-rail-item b')].some((item) => item.textContent === 'Live image history regression'),
    survivor: [...document.querySelectorAll('.dpf-rail-item b')].some((item) => item.textContent === survivorPrompt),
    currentPrompt: document.querySelector('.dpf-idea')?.value || '',
    preview: document.querySelector('.dpf-preview img')?.getAttribute('src') || '',
    stored: (JSON.parse(localStorage.getItem('dsh-drawcraft:v1') || '{}').history || []).map((entry) => entry.prompt),
    deletedId: (JSON.parse(localStorage.getItem('dsh-drawcraft:v1') || '{}').history || []).find((entry) => entry.prompt === 'Live image history regression')?.id || '',
  }), secondPrompt);
  const deletedOriginal = await page.evaluate((id) => new Promise((resolve) => {
    const request = indexedDB.open('dsh-drawcraft-history', 2);
    request.onerror = () => resolve(false);
    request.onsuccess = () => {
      const get = request.result.transaction('images', 'readonly').objectStore('images').get(id);
      get.onsuccess = () => resolve(get.result == null);
      get.onerror = () => resolve(false);
    };
  }), imageHistory.id);
  check('逐条删除只移除目标历史与原图且不触发恢复', deletion.removed && deletion.survivor && deletion.currentPrompt === historyPrompt && deletion.preview.startsWith('data:image/png;base64,') && !deletion.stored.includes(historyPrompt) && deletion.stored.includes(secondPrompt) && deletedOriginal, JSON.stringify({ deletion, deletedOriginal }));

  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise((resolve) => setTimeout(resolve, 6000));
  await page.evaluate(() => document.querySelector('[data-drawcraft-tab]')?.click());
  await page.waitForSelector('.dpf-shell', { timeout: 15000 });
  await page.evaluate(() => [...document.querySelectorAll('.dpf-rail-item')].find((node) => node.querySelector('b')?.textContent === 'Right history deletion regression')?.click());
  await page.waitForSelector('.dpf-tabs .dpf-tab', { timeout: 5000 });
  await page.evaluate(() => [...document.querySelectorAll('.dpf-tabs .dpf-tab')].find((node) => /历史|history/i.test(node.textContent || ''))?.click());
  await page.waitForSelector('.dpf-history-row', { timeout: 5000 });
  const rightDeleteBefore = await page.evaluate(() => ({
    target: [...document.querySelectorAll('.dpf-history-row')].some((item) => item.querySelector('.dpf-history-title')?.textContent === 'Right history deletion regression'),
    count: document.querySelectorAll('.dpf-history-row').length,
  }));
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('.dpf-history-row')].find((item) => item.querySelector('.dpf-history-title')?.textContent === 'Right history deletion regression');
    row?.querySelector('.dpf-history-delete')?.click();
  });
  await page.waitForFunction(() => ![...document.querySelectorAll('.dpf-history-title')].some((item) => item.textContent === 'Right history deletion regression'), { timeout: 5000 });
  const rightDeleteAfter = await page.evaluate(() => ({
    target: [...document.querySelectorAll('.dpf-history-title')].some((item) => item.textContent === 'Right history deletion regression'),
    count: document.querySelectorAll('.dpf-history-row').length,
    stored: (JSON.parse(localStorage.getItem('dsh-drawcraft:v1') || '{}').history || []).some((entry) => entry.id === 'live-prompt-history'),
  }));
  check('右侧历史列表也可独立删除单条记录', rightDeleteBefore.target && rightDeleteAfter.count === rightDeleteBefore.count - 1 && !rightDeleteAfter.target && !rightDeleteAfter.stored, JSON.stringify({ before: rightDeleteBefore, after: rightDeleteAfter }));

  // 姿势参考：选了参考就必须真的发出去，并在提示词里点名按姿势画。
  const posePng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  await page.evaluate((src) => {
    const stored = JSON.parse(localStorage.getItem('dsh-drawcraft:v1') || '{}');
    stored.refs = [{ lib: 'pose', id: 'live-pose', name: '侧卧·手臂过头', tags: ['侧卧'], imageUrl: src }];
    localStorage.setItem('dsh-drawcraft:v1', JSON.stringify(stored));
  }, posePng);
  await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise((resolve) => setTimeout(resolve, 6000));
  await page.evaluate(() => document.querySelector('[data-drawcraft-tab]')?.click());
  await page.waitForSelector('.dpf-shell', { timeout: 15000 });
  await page.evaluate(() => [...document.querySelectorAll('.dpf-rail-tab')].find((node) => /生图|image/i.test(node.textContent || ''))?.click());
  await page.waitForSelector('.dpf-idea', { timeout: 10000 });
  await page.evaluate(() => {
    window.__posePayloads = [];
    const realFetch = window.fetch.bind(window);
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    window.fetch = (input, init) => {
      const path = typeof input === 'string' ? input : input?.url || '';
      if (path.includes('/api/dsh-imagegen/generate') || path.includes('/api/drawcraft/render')) {
        try {
          window.__posePayloads.push(JSON.parse(init?.body || '{}'));
        } catch {
          window.__posePayloads.push({});
        }
        return Promise.resolve(new Response(JSON.stringify({ ok: true, images: [{ b64: png, mime: 'image/png' }] }), { status: 200, headers: { 'content-type': 'application/json' } }));
      }
      return realFetch(input, init);
    };
  });
  await page.evaluate(() => {
    const input = document.querySelector('.dpf-idea');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(input, '姿势链路回归');
    input?.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.click('.dpf-actions .dpf-btn-primary');
  await page.waitForFunction(() => (window.__posePayloads || []).length > 0, { timeout: 20000 });
  const posePayload = await page.evaluate(() => window.__posePayloads[0]);
  check('选了姿势参考就真的发出去并点名按姿势画', posePayload?.mode === 'edit' && /(姿势参考图是硬约束|The pose reference image is binding)/.test(posePayload?.prompt || '') && String(posePayload?.image || '').startsWith('data:image/') && (Array.isArray(posePayload?.images) ? posePayload.images.every((item) => String(item).startsWith('data:image/')) : true), JSON.stringify({ mode: posePayload?.mode, prompt: String(posePayload?.prompt || '').slice(0, 160), images: posePayload?.images?.length, primary: String(posePayload?.image || '').slice(0, 22) }));

  const legacyImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  await page.evaluate((src) => {
    localStorage.removeItem('dsh-drawcraft:canvases:v1');
    localStorage.setItem('dsh-drawcraft:canvas:v1', JSON.stringify({
      nodes: [{ id: 'legacy-image', kind: 'image', x: 12, y: 18, w: 236, h: 224, title: 'Legacy image', src, text: '' }],
      edges: [], view: { x: 0, y: 0, scale: 1 },
    }));
  }, legacyImage);
  await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise((resolve) => setTimeout(resolve, 6000));
  await page.evaluate(() => document.querySelector('[data-drawcraft-tab]')?.click());
  await page.waitForSelector('.dpf-shell', { timeout: 15000 });
  await page.evaluate(() => [...document.querySelectorAll('.dpf-rail-tab')].find((node) => /画布|canvas/i.test(node.textContent || ''))?.click());
  await page.waitForFunction(() => document.querySelector('.dpf-canvas-node img')?.getAttribute('src')?.startsWith('data:image/png;base64,'), { timeout: 15000 });
  const migrated = await page.evaluate(async () => {
    const workspace = JSON.parse(localStorage.getItem('dsh-drawcraft:canvases:v1') || '{}');
    const active = workspace.items?.find((item) => item.id === workspace.activeId);
    const image = active?.state?.nodes?.find((node) => node.id === 'legacy-image');
    const database = await new Promise((resolve) => {
      const request = indexedDB.open('dsh-drawcraft-history', 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    });
    if (!database || !image) return { image: image || null, blob: false, inline: JSON.stringify(workspace).includes('data:image/') };
    const blob = await new Promise((resolve) => {
      const get = database.transaction('canvas-assets', 'readonly').objectStore('canvas-assets').get(image.assetRef);
      get.onsuccess = () => resolve(get.result instanceof Blob);
      get.onerror = () => resolve(false);
    });
    return { image: { src: image.src, assetRef: image.assetRef }, blob, inline: JSON.stringify(workspace).includes('data:image/') };
  });
  check('旧版内嵌画布图片迁入 IndexedDB 且仍可显示', migrated.blob && !migrated.inline && migrated.image.src === '' && migrated.image.assetRef?.startsWith('drawcraft-canvas:'), JSON.stringify(migrated));

  // 渠道管理与编辑：拦掉宿主设置接口，验证 UI 调用参数与列表刷新，不碰真实渠道配置。
  await page.evaluateOnNewDocument(() => {
    window.__channelStub = {
      revision: 7,
      channels: [
        { id: 'fake-a', name: '假渠道 A', apiUrl: 'https://a.example/v1', models: [{ alias: 'm-a', id: 'm-a' }] },
        { id: 'fake-b', name: '假渠道 B', apiUrl: 'https://b.example/v1', models: [{ alias: 'm-b', id: 'm-b' }] },
      ],
      calls: [],
    };
    const realFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      // 浏览器端现在优先问本插件的服务端代理，两条路径都要能应答。
      if (url.includes('/api/drawcraft/image-channels/mutate') || url.includes('/api/dsh-imagegen/settings/mutate')) {
        let body = {};
        try {
          body = JSON.parse(init?.body || '{}');
        } catch {
          body = {};
        }
        window.__channelStub.calls.push(body);
        for (const op of body.ops || []) {
          if (!Array.isArray(op.path) || op.path[0] !== 'channels') continue;
          const index = op.path[1];
          if (op.op === 'unset') window.__channelStub.channels.splice(index, 1);
          if (op.op === 'set' && op.path.length === 3 && window.__channelStub.channels[index]) {
            window.__channelStub.channels[index][op.path[2]] = op.value;
          }
        }
        window.__channelStub.revision += 1;
        return Promise.resolve(new Response(JSON.stringify({ ok: true, value: { revision: window.__channelStub.revision } }), { status: 200, headers: { 'content-type': 'application/json' } }));
      }
      if (url.includes('/api/drawcraft/image-channels')) {
        return Promise.resolve(new Response(JSON.stringify({ ok: true, ns: 'imagegen', revision: window.__channelStub.revision, channels: window.__channelStub.channels }), { status: 200, headers: { 'content-type': 'application/json' } }));
      }
      if (url.includes('/api/dsh-imagegen/settings/describe')) {
        return Promise.resolve(new Response(JSON.stringify({ ok: true, value: { writable: true, namespaces: [{ ns: 'dsh-imagegen', revision: window.__channelStub.revision, value: { channels: window.__channelStub.channels } }] } }), { status: 200, headers: { 'content-type': 'application/json' } }));
      }
      return realFetch(input, init);
    };
  });
  await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise((resolve) => setTimeout(resolve, 6000));
  await page.evaluate(() => document.querySelector('[data-drawcraft-tab]')?.click());
  await page.waitForSelector('.dpf-shell', { timeout: 15000 });
  await page.evaluate(() => [...document.querySelectorAll('.dpf-rail-tab')].find((node) => /生图|image|render/i.test(node.textContent || ''))?.click());
  await page.waitForSelector('.dpf-channel-manage', { timeout: 15000 });
  await page.click('.dpf-channel-manage');
  await page.waitForSelector('.dpf-channel-row', { timeout: 10000 });
  const channelRows = await page.$$eval('.dpf-channel-row .dpf-channel-name', (nodes) => nodes.map((node) => node.textContent));
  // 先编辑第一行的名字与端点。
  await page.click('.dpf-channel-row .dpf-channel-edit');
  await page.waitForSelector('.dpf-channel-editing .dpf-channel-input', { timeout: 10000 });
  await page.evaluate(() => {
    const inputs = document.querySelectorAll('.dpf-channel-editing .dpf-channel-input');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(inputs[0], '假渠道 A2');
    inputs[0]?.dispatchEvent(new Event('input', { bubbles: true }));
    setter?.call(inputs[1], 'https://edited.example/v1');
    inputs[1]?.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.click('.dpf-channel-editing .dpf-channel-save');
  await page.waitForFunction(() => (window.__channelStub?.calls || []).length > 0, { timeout: 10000 });
  await new Promise((resolve) => setTimeout(resolve, 900));
  const channelEditState = await page.evaluate(() => ({
    calls: window.__channelStub.calls,
    rows: [...document.querySelectorAll('.dpf-channel-row .dpf-channel-name')].map((node) => node.textContent),
    channels: window.__channelStub.channels.map((item) => ({ name: item.name, apiUrl: item.apiUrl })),
  }));
  check(
    '渠道能改名字与端点：set 写回宿主并刷新列表',
    channelEditState.calls.length === 1 &&
      channelEditState.calls[0].expectedRevision === 7 &&
      channelEditState.calls[0].ops?.some((op) => op.op === 'set' && op.path?.[2] === 'name' && op.value === '假渠道 A2') &&
      channelEditState.calls[0].ops?.some((op) => op.op === 'set' && op.path?.[2] === 'apiUrl' && op.value === 'https://edited.example/v1') &&
      channelEditState.channels[0]?.name === '假渠道 A2' &&
      channelEditState.channels[0]?.apiUrl === 'https://edited.example/v1' &&
      channelEditState.rows.some((row) => row.includes('假渠道 A2')),
    JSON.stringify({ rows: channelEditState.rows, channels: channelEditState.channels, ops: channelEditState.calls[0]?.ops }),
  );
  page.on('dialog', (dialog) => dialog.accept());
  await page.click('.dpf-channel-row .dpf-channel-del');
  await page.waitForFunction(() => (window.__channelStub?.calls || []).length > 1, { timeout: 10000 });
  await new Promise((resolve) => setTimeout(resolve, 900));
  const channelState = await page.evaluate(() => ({
    calls: window.__channelStub.calls,
    rows: [...document.querySelectorAll('.dpf-channel-row .dpf-channel-name')].map((node) => node.textContent),
    source: document.querySelector('#dpf-image-source')?.value || '',
  }));
  check(
    '出图渠道能删除：带 revision 写回宿主并刷新列表',
    channelRows.length === 2 &&
      channelState.calls.length === 2 &&
      channelState.calls[1].ns === 'imagegen' &&
      channelState.calls[1].expectedRevision === 8 &&
      channelState.calls[1].ops?.[0]?.op === 'unset' &&
      channelState.calls[1].ops?.[0]?.path?.[0] === 'channels' &&
      channelState.rows.length === 1 &&
      channelState.source === 'host:fake-b',
    JSON.stringify({ rows: channelRows, after: channelState.rows, source: channelState.source, call: channelState.calls[1] }),
  );

  check('没有运行时报错', errors.length === 0, errors.slice(0, 3).join(' | '));
  await page.screenshot({ path: 'live-canvas.png' });
} finally {
  await browser.close();
}
console.log(failed === 0 ? '\n全部通过' : `\n${failed} 项未通过`);
process.exit(failed === 0 ? 0 : 1);
