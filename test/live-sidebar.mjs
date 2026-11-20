// 真机验证：侧边栏入口能不能打开面板。
//
// 单测和契约只读源码，读不出「点了没反应」——v1.10.4 就是这么漏过去的：
// inject 少写一个 layout，cordis 的 Proxy 取值就抛，点击处理器当场炸，
// 而所有静态断言都是绿的。
//
// 用法：
//   1. 起一个真的实例（desktop profile 被 Electron 独占，得复制一份）：
//        dsh web --port 0 --no-open
//      日志里会打印 http://127.0.0.1:<port>/?token=<TOKEN>
//   2. node test/live-sidebar.mjs "<那个带 token 的地址>"
//
// 依赖 puppeteer-core 与本机 Chrome；路径按需改下面两个常量。

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

// 插件自己不带 puppeteer；借宿主 profile 里那份（dsh 的 desktop profile 一般都有）。
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

const puppeteer = await loadPuppeteer();

const url = process.argv[2];
if (!url) {
  console.error('用法: node test/live-sidebar.mjs "http://127.0.0.1:<port>/?token=<TOKEN>"');
  process.exit(2);
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 950 });

const errors = [];
page.on('pageerror', (error) => errors.push(`[pageerror] ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error' && /drawcraft|without inject/.test(message.text())) {
    errors.push(`[console] ${message.text().slice(0, 200)}`);
  }
});

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failed += 1;
};

await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
await new Promise((resolve) => setTimeout(resolve, 6000));

// 宿主里可能压着别的插件的遮罩（例如 dsh-purge 的「用户须知」），
// 它会让 elementFromPoint 命中一个 DIV，坐标点击永远落不到入口上。
// 那个弹窗要先勾选条款，按钮才可点。
await page.evaluate(() => {
  const mask = document.querySelector('.dshp-auth-mask');
  if (!mask) return;
  const boxes = [...document.querySelectorAll('input[type="checkbox"]')];
  boxes.forEach((box) => { if (!box.checked) box.click(); });
  const button = [...document.querySelectorAll('button')].find((item) => /我已知晓并继续/.test(item.textContent || ''));
  if (button) button.click();
});
await new Promise((resolve) => setTimeout(resolve, 900));

const tab = await page.evaluate(() => {
  const node = document.querySelector('[data-drawcraft-tab]');
  if (!node) return null;
  const box = node.getBoundingClientRect();
  const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
  const host = node.previousElementSibling;
  return {
    text: node.textContent.trim(),
    width: Math.round(box.width),
    height: Math.round(box.height),
    covered: hit !== node && !node.contains(hit),
    coveredBy: coveredBy(hit),
    besideHost: Boolean(host && Math.abs(host.getBoundingClientRect().top - box.top) < 6),
  };
  function coveredBy(node) {
    return node ? String(node.className || node.tagName).slice(0, 60) : '';
  }
});

check('入口存在', Boolean(tab), tab ? `${tab.width}×${tab.height}「${tab.text}」` : '没找到 [data-drawcraft-tab]');
if (tab) {
  check('入口与相邻按钮同一行（左右并排）', tab.besideHost === true);
  check('入口没有被别的元素盖住', tab.covered === false, tab.covered ? '被 ' + tab.coveredBy : '');
}

// 用 DOM 派发而不是坐标点击：坐标点击会被任何浮层挡住，测出来的假失败没有意义。
await page.evaluate(() => document.querySelector('[data-drawcraft-tab]')?.click());
await new Promise((resolve) => setTimeout(resolve, 3000));

const panel = await page.evaluate(() => {
  const box = (selector) => {
    const node = document.querySelector(selector);
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    return { w: Math.round(rect.width), h: Math.round(rect.height) };
  };
  return {
    shell: Boolean(document.querySelector('.dpf-shell')),
    rail: box('.dpf-rail'),
    tabs: [...document.querySelectorAll('.dpf-rail-tab')].map((node) => node.textContent.trim()),
    title: (document.querySelector('.dpf-topbar-title')?.textContent || '').trim(),
    body: box('.dpf-body'),
    foot: Boolean(document.querySelector('.dpf-foot')),
  };
});

check('点击后面板渲染出来', panel.shell === true);
check('左栏 214px', panel.rail?.w === 214, panel.rail ? panel.rail.w + 'px' : '没有 .dpf-rail');
check('三个页签', panel.tabs.join('/') === '提示词/生图/画布', panel.tabs.join('/'));
check('顶栏标题跟着页签', panel.title.length > 0, panel.title);
check('页面内容区有尺寸', Boolean(panel.body && panel.body.w > 400 && panel.body.h > 300));
check('页脚在', panel.foot === true);

check('没有运行时报错', errors.length === 0, errors.slice(0, 3).join(' | '));

await page.screenshot({ path: 'live-sidebar.png' });
await browser.close();
console.log(failed === 0 ? '\n全部通过' : `\n${failed} 项未通过`);
process.exit(failed === 0 ? 0 : 1);
