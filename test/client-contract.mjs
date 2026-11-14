/**
 * 浏览器半的裸契约检查：不需要真实宿主，也不加载真实 React。
 *
 * 验的是三件在真机上才暴露的事：
 *  1. 注册进哪个插槽（sidebar.panellist 与 main，而不是 footer.action）；
 *  2. 词典是否被拍平成 'meta.title' 这样的扁平键（locale 是扁平查表）；
 *  3. panellist 条目组件只画 glyph，且带 data-dsh-panel-entry。
 *
 * 运行：node test/client-contract.mjs
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');

let bundle = null;
const registrations = [];
const injections = [];
const dictionaries = [];

const slots = {
  inject(name, factory) {
    injections.push(name);
    return factory();
  },
  register(options, component) {
    registrations.push({ options, component });
    return () => {};
  },
};

const locale = {
  register(namespace, dict) {
    dictionaries.push({ namespace, dict });
    return () => {};
  },
  subscribe() {
    return () => {};
  },
  getSnapshot() {
    return { revision: 0 };
  },
  bind(namespace) {
    return (key) => `${namespace}:${key}`;
  },
};

const h = (type, props, ...children) => ({ type, props: props || {}, children });
const React = {
  createElement: h,
  Fragment: 'Fragment',
  useCallback: (fn) => fn,
  useEffect() {},
  useMemo: (fn) => fn(),
  useRef: (value) => ({ current: value }),
  useState: (value) => [typeof value === 'function' ? value() : value, () => {}],
  useSyncExternalStore: () => 0,
};

const sandbox = {
  window: { __ModuleLoader__: { load: (value) => (bundle = value) } },
  document: { body: {}, addEventListener() {}, removeEventListener() {} },
  console,
  React,
  ReactDOM: { createPortal: (node) => node },
};
sandbox.globalThis = sandbox;
sandbox.self = sandbox;

vm.runInNewContext(source, sandbox, { filename: 'client.js' });

const fail = [];
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '  ok' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fail.push(label);
};

check('bundle 被注册', Boolean(bundle), bundle ? bundle.id : '未调用 load');
check('bundle id 正确', bundle?.id === '@local/dsh-prompt-forge', String(bundle?.id));

const contract = bundle.factory((specifier) => {
  if (specifier === 'react') return React;
  if (specifier === 'react-dom') return sandbox.ReactDOM;
  throw new Error(`未预期的 require: ${specifier}`);
});

check('inject 声明', Array.isArray(contract.inject) && contract.inject.join(',') === 'slots,locale', String(contract.inject));

const ctx = { slots, locale, effect: (fn) => fn() };
contract.apply(ctx);

check('插槽注册项', injections.includes('sidebar.panellist') && injections.includes('main'), injections.join(' | '));
check('不再注册 footer.action', !injections.includes('sidebar.footer.action'), injections.join(' | '));

const panelEntry = registrations.find((item) => item.options?.name === 'sidebar.panellist');
check('panellist 条目存在', Boolean(panelEntry), panelEntry ? String(panelEntry.options.id) : '缺失');
check('panellist id 用命名空间', panelEntry?.options?.id === 'dsh-prompt-forge', String(panelEntry?.options?.id));
check('panellist 有 order', typeof panelEntry?.options?.order === 'number', String(panelEntry?.options?.order));
check('panellist label 是函数', typeof panelEntry?.options?.label === 'function', typeof panelEntry?.options?.label);

const label = panelEntry?.options?.label?.();
check('label 命中词典键名', label === 'dsh-prompt-forge:meta.title', String(label));

const glyph = panelEntry?.component?.({ size: 18, active: false });
check('glyph 是 svg', glyph?.type === 'svg', String(glyph?.type));
check('glyph 带皮肤钩子', glyph?.props?.['data-dsh-panel-entry'] === 'dsh-prompt-forge', String(glyph?.props?.['data-dsh-panel-entry']));
check('glyph 跟着外壳尺寸', glyph?.props?.width === 18 && glyph?.props?.height === 18, String(glyph?.props?.width));

const mainPage = registrations.find((item) => item.options?.name === 'main');
check('main 页存在且键匹配', mainPage?.options?.key === 'dsh-prompt-forge', String(mainPage?.options?.key));

const zhFlat = dictionaries.find((item) => item.namespace === 'dsh-prompt-forge')?.dict?.zh ?? {};
const enFlat = dictionaries.find((item) => item.namespace === 'dsh-prompt-forge')?.dict?.en ?? {};
check('中文词典已拍平', typeof zhFlat['meta.title'] === 'string' && zhFlat['meta.title'].length > 0, zhFlat['meta.title']);
check('英文词典已拍平', typeof enFlat['meta.title'] === 'string' && enFlat['meta.title'].length > 0, enFlat['meta.title']);
const nested = Object.entries(zhFlat).filter(([, value]) => value && typeof value === 'object').map(([key]) => key);
check('词典无嵌套残留', nested.length === 0, nested.join(','));
const required = ['meta.title', 'subtitle', 'idea', 'optimize', 'copy', 'historyEmpty'];
const missing = required.filter((key) => typeof zhFlat[key] !== 'string');
check('关键文案齐全', missing.length === 0, missing.join(','));

if (fail.length) {
  console.error(`\n${fail.length} 项未通过：${fail.join('、')}`);
  process.exit(1);
}
console.log('\n全部通过');
