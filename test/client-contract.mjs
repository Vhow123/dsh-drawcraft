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
check('bundle id 正确', bundle?.id === 'dsh-image-prompt-forge', String(bundle?.id));

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
check('panellist id 用命名空间', panelEntry?.options?.id === 'dsh-image-prompt-forge', String(panelEntry?.options?.id));
check('panellist 有 order', typeof panelEntry?.options?.order === 'number', String(panelEntry?.options?.order));
check('panellist label 是函数', typeof panelEntry?.options?.label === 'function', typeof panelEntry?.options?.label);

const label = panelEntry?.options?.label?.();
check('label 命中词典键名', label === 'dsh-image-prompt-forge:meta.title', String(label));

const glyph = panelEntry?.component?.({ size: 18, active: false });
check('glyph 是 svg', glyph?.type === 'svg', String(glyph?.type));
check('glyph 带皮肤钩子', glyph?.props?.['data-dsh-panel-entry'] === 'dsh-image-prompt-forge', String(glyph?.props?.['data-dsh-panel-entry']));
check('glyph 跟着外壳尺寸', glyph?.props?.width === 18 && glyph?.props?.height === 18, String(glyph?.props?.width));

const mainPage = registrations.find((item) => item.options?.name === 'main');
check('main 页存在且键匹配', mainPage?.options?.key === 'dsh-image-prompt-forge', String(mainPage?.options?.key));

const zhFlat = dictionaries.find((item) => item.namespace === 'dsh-image-prompt-forge')?.dict?.zh ?? {};
const enFlat = dictionaries.find((item) => item.namespace === 'dsh-image-prompt-forge')?.dict?.en ?? {};
check('中文词典已拍平', typeof zhFlat['meta.title'] === 'string' && zhFlat['meta.title'].length > 0, zhFlat['meta.title']);
check('英文词典已拍平', typeof enFlat['meta.title'] === 'string' && enFlat['meta.title'].length > 0, enFlat['meta.title']);
const nested = Object.entries(zhFlat).filter(([, value]) => value && typeof value === 'object').map(([key]) => key);
check('词典无嵌套残留', nested.length === 0, nested.join(','));
const required = ['meta.title', 'subtitle', 'idea', 'optimize', 'copy', 'historyEmpty'];
const missing = required.filter((key) => typeof zhFlat[key] !== 'string');
check('关键文案齐全', missing.length === 0, missing.join(','));

// 清空输入框的按钮：文案要有，且渲染路径确实挂了 dpf-clear 钩子
check('清空按钮文案', typeof zhFlat.clear === 'string' && zhFlat.clear.length > 0, zhFlat.clear);
check('清空按钮提示', typeof zhFlat.clearIdeaHint === 'string' && zhFlat.clearIdeaHint.length > 0, zhFlat.clearIdeaHint);
const clientSource = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
check('清空按钮已渲染', clientSource.includes('dpf-clear') && clientSource.includes("setIdea(''"), 'dpf-clear');

// 三件新能力：图片拖放、改一句、试一张
for (const key of ['dropImage', 'describeHint', 'patchPlaceholder', 'patchHint', 'previewHint', 'noImagegen']) {
  check(`新文案 ${key}`, typeof zhFlat[key] === 'string' && zhFlat[key].length > 0, String(zhFlat[key]));
}
check('拖放区已渲染', clientSource.includes('dpf-drop') && clientSource.includes('onDrop: onDropImage'), 'dpf-drop');
check('改一句入口已渲染', clientSource.includes('dpf-patch') && clientSource.includes('applyPatch'), 'dpf-patch');
check('试一张走本机 imagegen 代理', clientSource.includes("'/api/dsh-imagegen/generate'"), 'GENERATE_API');
check('预览图已渲染', clientSource.includes('dpf-preview') && clientSource.includes('shot.b64'), 'dpf-preview');
check('404 解释为宿主过期', clientSource.includes("HOST_STALE") && typeof zhFlat.hostStale === 'string', zhFlat.hostStale);
check('出图模型选择器已渲染', clientSource.includes('IMAGE_CHANNELS_API') && clientSource.includes('pickImageModel') && typeof zhFlat.imageModel === 'string', zhFlat.imageModel);
check('出图请求带渠道与模型', clientSource.includes('channelId: activeChannel.id') && clientSource.includes('model: effectiveImageModel'), 'channelId/model');
check('三方向路由齐全', ['describe', 'patch', 'optimize'].every((name) => clientSource.includes(`post('${name}'`)), 'post()');

// 预览图：点开放大、保存到本地
for (const key of ['zoomHint', 'zoomWheel', 'zoomIn', 'zoomOut', 'zoomReset', 'save', 'imageSize', 'imageQuality', 'sizeAuto', 'qualityAuto']) {
  check(`新文案 ${key}`, typeof zhFlat[key] === 'string' && zhFlat[key].length > 0, String(zhFlat[key]));
}
check('预览图可点开放大', clientSource.includes('dpf-lightbox') && clientSource.includes('openLightbox(shot)'), 'dpf-lightbox');
check('预览图可保存', clientSource.includes('dpf-shot-save') && clientSource.includes('link.download'), 'dpf-shot-save');
check('Esc 先收大图再关面板', clientSource.includes('if (lightbox) {'), 'lightbox');
check('出图尺寸可调', clientSource.includes("const IMAGE_SIZES = ['auto', '1:1'") && clientSource.includes('pickImageSize'), 'IMAGE_SIZES');
check('出图清晰度可调', clientSource.includes("const IMAGE_QUALITIES = ['auto', '1k', '2k', '4k']") && clientSource.includes('pickImageQuality'), 'IMAGE_QUALITIES');
check('尺寸与清晰度带进出图请求', clientSource.includes('quality: imageQuality') && clientSource.includes("imageSize !== 'auto'"), 'size/quality');
// 大图滚轮缩放：非 passive 原生监听 + 以指针为中心 + 拖拽平移
check('滚轮缩放用非 passive 监听', clientSource.includes("addEventListener('wheel', onWheel, { passive: false })") && clientSource.includes('event.preventDefault()'), 'wheel');
check('缩放范围有上下限', clientSource.includes('const MIN_ZOOM = 0.2') && clientSource.includes('const MAX_ZOOM = 8'), 'MIN_ZOOM/MAX_ZOOM');
check('以指针为中心缩放', clientSource.includes('const ratio = scale / prev.scale') && clientSource.includes('cx - (cx - prev.x) * ratio'), 'ratio');
check('拖动平移', clientSource.includes('onPointerDown: startDrag') && clientSource.includes('onPointerMove: moveDrag') && clientSource.includes('moveDrag') && clientSource.includes('setPointerCapture'), 'drag');
check('双击复位', clientSource.includes('onDoubleClick') && clientSource.includes('prev.scale === 1 ? { scale: 2'), 'dblclick');
check('倍率条与缩放按钮', clientSource.includes('dpf-zoom-level') && clientSource.includes("Math.round(zoom.scale * 100)") && clientSource.includes('zoomBy(1.25)'), 'zoom-level');
check('大图提示文案', clientSource.includes("className: 'dpf-lightbox-hint'"), 'hint');

if (fail.length) {
  console.error(`\n${fail.length} 项未通过：${fail.join('、')}`);
  process.exit(1);
}
console.log('\n全部通过');
