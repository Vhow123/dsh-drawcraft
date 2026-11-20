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
check('bundle id 正确', bundle?.id === 'dsh-drawcraft', String(bundle?.id));

const contract = bundle.factory((specifier) => {
  if (specifier === 'react') return React;
  if (specifier === 'react-dom') return sandbox.ReactDOM;
  throw new Error(`未预期的 require: ${specifier}`);
});

// layout 必须声明：cordis 的 Proxy 在未 inject 时读 ctx.layout 会直接抛
// 「cannot get property "layout" without inject」，点击处理器当场炸掉，
// 表现就是侧边栏点入口完全没反应。真机复现过，别再删。
check('inject 声明', Array.isArray(contract.inject) && contract.inject.join(',') === 'slots,locale,layout', String(contract.inject));

const ctx = { slots, locale, effect: (fn) => fn() };
contract.apply(ctx);

check('插槽注册项', injections.includes('sidebar.panellist') && injections.includes('main'), injections.join(' | '));
check('不再注册 footer.action', !injections.includes('sidebar.footer.action'), injections.join(' | '));

const panelEntry = registrations.find((item) => item.options?.name === 'sidebar.panellist');
check('panellist 条目存在', Boolean(panelEntry), panelEntry ? String(panelEntry.options.id) : '缺失');
check('panellist id 用命名空间', panelEntry?.options?.id === 'dsh-drawcraft', String(panelEntry?.options?.id));
check('panellist 有 order', typeof panelEntry?.options?.order === 'number', String(panelEntry?.options?.order));
check('panellist label 是函数', typeof panelEntry?.options?.label === 'function', typeof panelEntry?.options?.label);

const label = panelEntry?.options?.label?.();
check('label 命中词典键名', label === 'dsh-drawcraft:meta.title', String(label));

const glyph = panelEntry?.component?.({ size: 18, active: false });
check('glyph 是 svg', glyph?.type === 'svg', String(glyph?.type));
check('glyph 带皮肤钩子', glyph?.props?.['data-dsh-panel-entry'] === 'dsh-drawcraft', String(glyph?.props?.['data-dsh-panel-entry']));
check('glyph 跟着外壳尺寸', glyph?.props?.width === 18 && glyph?.props?.height === 18, String(glyph?.props?.width));

const mainPage = registrations.find((item) => item.options?.name === 'main');
check('main 页存在且键匹配', mainPage?.options?.key === 'dsh-drawcraft', String(mainPage?.options?.key));

const zhFlat = dictionaries.find((item) => item.namespace === 'dsh-drawcraft')?.dict?.zh ?? {};
const enFlat = dictionaries.find((item) => item.namespace === 'dsh-drawcraft')?.dict?.en ?? {};
check('中文词典已拍平', typeof zhFlat['meta.title'] === 'string' && zhFlat['meta.title'].length > 0, zhFlat['meta.title']);
check('英文词典已拍平', typeof enFlat['meta.title'] === 'string' && enFlat['meta.title'].length > 0, enFlat['meta.title']);
const nested = Object.entries(zhFlat).filter(([, value]) => value && typeof value === 'object').map(([key]) => key);
check('词典无嵌套残留', nested.length === 0, nested.join(','));
const required = ['meta.title', 'subtitle', 'idea', 'optimize', 'copy', 'historyEmpty'];
const missing = required.filter((key) => typeof zhFlat[key] !== 'string');
check('关键文案齐全', missing.length === 0, missing.join(','));
for (const key of ['newCanvas', 'newCanvasHint']) {
  check(`新建画布文案 ${key}`, typeof zhFlat[key] === 'string' && zhFlat[key].length > 0 && typeof enFlat[key] === 'string' && enFlat[key].length > 0, `${zhFlat[key]} / ${enFlat[key]}`);
}

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

// 参考库：姿势库缩略图走深度图、种类维度可点选筛选
for (const key of ['galleryAny', 'galleryKinds']) {
  check(`新文案 ${key}`, typeof zhFlat[key] === 'string' && zhFlat[key].length > 0, String(zhFlat[key]));
}
check('种类筛选已渲染', clientSource.includes('dpf-gallery-kinds') && clientSource.includes('dpf-kinds-values'), 'dpf-kinds');
// 原生 select 的选项由系统绘制，深色主题下会是白底浅字：种类一律用胶囊按钮。
check('种类不用原生 select', !clientSource.includes('dpf-kinds-select'), 'no-select');
check('面板声明深色优先', clientSource.includes('color-scheme:dark'), 'color-scheme');
check('种类可展开收起', clientSource.includes('dpf-chip-more') && clientSource.includes('setRefKindsOpen'), 'chip-more');
check('种类走 kinds 动作', clientSource.includes("action: 'kinds'"), 'kinds');
check('切库清空筛选', clientSource.includes('setRefFilters({})') && clientSource.includes('switchLib'), 'switchLib');
check('筛选随检索提交', clientSource.includes('filters: filters &&'), 'filters');
check('缩略图用服务端给的图链', clientSource.includes('src: work.thumbUrl'), 'thumbUrl');
check('检索带分页参数', clientSource.includes('offset: at') && clientSource.includes('REF_PAGE = 24'), 'offset');
check('有加载更多与总数', clientSource.includes('dpf-gallery-more') && clientSource.includes('refTotal'), 'more');

// 图生图：粘贴板导入 + 主图/附加参考 + edit 模式
check('支持粘贴板导入图片', clientSource.includes("window.addEventListener('paste'") && clientSource.includes('clipboardData'), 'paste');
check('附加参考槽已渲染', clientSource.includes('dpf-refshots-row') && clientSource.includes('dpf-refshot-add'), 'shots');
check('附加参考上限四张', clientSource.includes('previous.length >= 4 ? previous'), 'shots-cap');
check('图生图走 edit 模式', clientSource.includes("mode: subject ? 'edit' : 'text'"), 'edit-mode');
check('主图与参考图分别传 image/images', clientSource.includes('...(subject ? { image: subject } : {})') && clientSource.includes('...(gallery.length > 0 ? { images: gallery } : {})'), 'image/images');
check('姿势图可转成内联图', clientSource.includes('remoteImageToDataUrl') && clientSource.includes('new File([blob]'), 'toDataUrl');
check('姿势图条件默认关闭', clientSource.includes('useState(false)') && /\['usePoseRefs'\]|usePoseRefs: '.+'/.test(clientSource), 'usePoseRefs');

// 深度图去审核：灰度检测 + 等高线线稿 + 被拒重试
check('被拒后自动转线稿重试', clientSource.includes('contourDataUrl(primary)') && clientSource.includes("neutralize && primary && !note"), 'neutralize');
check('不再按灰度预判转线稿', !/neutralize && \(await isFlatGray/.test(clientSource), 'no-preconvert');
check('主图槽空时把附加参考提成主图', clientSource.includes("imageTab === 'edit' && gallery.length > 0) primary = gallery.shift()"), 'promote');
check('裸提示词补写实约束', clientSource.includes('PHOTO_NOTE') && clientSource.includes('bare ? PHOTO_NOTE'), 'photo-note');
check('线稿开关默认开', clientSource.includes('const [neutralize, setNeutralize] = useState(true)'), 'neutralize-state');
check('被审核拒绝时降级重试一次', clientSource.includes("failure?.code === 'upstream-rejected'"), 'retry');
check('线稿附带说明前缀', clientSource.includes('CONTOUR_NOTE') && clientSource.includes('深度等值线图'), 'contour-note');
check('等高线算法可独立调用', clientSource.includes('function buildContourMask('), 'contour-mask');

// 不必先优化就能出图
check('生图页空态有引导', clientSource.includes("t('imageOutHint')") && clientSource.includes('const previewCard ='), 'image-empty');
check('生图页有出图按钮', (clientSource.match(/void renderOne\(\)/g) || []).length >= 3, 'render-button');
check('提示词可退回想法与参考名', clientSource.includes("result?.prompt || idea || fallback"), 'fallback');

// 想法输入框收窄 + 自带生图端点
check('想法输入框已收窄', clientSource.includes('.dpf-textarea.dpf-idea{min-height:84px}'), 'idea-height');
check('可自己添加生图模型', clientSource.includes('dpf-target-form') && clientSource.includes("action: 'save'"), 'targets-save');
check('出图请求不带密钥', !/targetId[^}]*apiKey/.test(clientSource), 'no-key-in-render');
check('出图来源可切换', clientSource.includes('sourceOptions') && clientSource.includes('currentSource'), 'source');
check('自定义端点走插件转发', clientSource.includes("activeTarget ? `${API}/render` : GENERATE_API"), 'relay');

// 无限画布
check('画布视图可切换', clientSource.includes("const [page, setPage] = useState('prompt')") && /canvasView\s*\?\s*canvasBody/.test(clientSource), 'canvas-view');
check('画布状态单独落盘', clientSource.includes('CANVAS_KEY') && clientSource.includes('function writeCanvas('), 'canvas-store');
check('拖动不逐帧写盘', clientSource.includes('canvasTouched') && clientSource.includes('}, [canvas]);'), 'canvas-debounce');
check('滚轮是非 passive 监听', clientSource.includes("addEventListener('wheel', onWheel, { passive: false })"), 'canvas-wheel');
check('节点可拖动与缩放', clientSource.includes('canvasStartDrag') && clientSource.includes(".dpf-canvas-resize"), 'canvas-drag');
check('空白处拖动平移', clientSource.includes('canvasPanStart') && clientSource.includes('canvasPan.current'), 'canvas-pan');
check('选中节点再出图', clientSource.includes('canvasGenerate') && clientSource.includes('canvasSel.includes(node.id)'), 'canvas-generate');
check('出图结果带血缘线', clientSource.includes('canvasEdgePath') && clientSource.includes('edges: ['), 'canvas-edges');
check('画布支持粘贴与拖入', (clientSource.includes('clipboardData?.items') || clientSource.includes('event.clipboardData && event.clipboardData.items')) && clientSource.includes('void canvasLoadFile(file)'), 'canvas-paste');
check('进画布的图会压缩', clientSource.includes('CANVAS_MAX_EDGE') && clientSource.includes('readImageFile(file, CANVAS_MAX_EDGE)'), 'canvas-compress');
check('节点能送回工坊', clientSource.includes('canvasSendToWorkshop'), 'canvas-to-workshop');
check('图库缩略图能直接加到画布', clientSource.includes('refToCanvas') && clientSource.includes('dpf-gallery-canvas'), 'canvas-from-gallery');

// 三页结构
check('左栏有提示词/生图/画布三个页签', clientSource.includes("className: 'dpf-rail-tabs'") && clientSource.includes("t('pagePrompt')") && clientSource.includes("t('pageImage')") && clientSource.includes("t('pageCanvas')"), 'pages');
check('生图页有文生图与图生图两个子页', clientSource.includes("className: 'dpf-image-tab'") && clientSource.includes("setImageTab('text')") && clientSource.includes("setImageTab('edit')"), 'image-tabs');
check('生图主体区只在图生图子页出现', /imageTab === 'edit' &&\s*h\(/.test(clientSource), 'image-only-edit');
check('文生图子页忽略手边的主图', clientSource.includes("imageTab === 'edit' ? imageRef.current?.data || '' : ''"), 'text-ignores-subject');
check('预览卡不在提示词页', clientSource.includes('const previewCard =') && !/dpf-right'[\s\S]{0,4000}dpf-preview/.test(clientSource.split('dpf-right')[1] || ''), 'preview-moved');

// 画布增强：撤销重做、框选、小地图、剪贴板、导入导出、按记录重试
check('画布有撤销与重做栈', clientSource.includes('CANVAS_HISTORY') && clientSource.includes('const canvasUndo = useCallback') && clientSource.includes('const canvasRedo = useCallback'), 'canvas-undo');
check('拖动只压一次栈', clientSource.includes('canvasDragBase') && clientSource.includes('canvasRemember(base)'), 'canvas-drag-once');
check('shift 拖空白框选', clientSource.includes('canvasMarquee.current') && clientSource.includes('event.shiftKey'), 'canvas-marquee');
check('有小地图', clientSource.includes("className: 'dpf-minimap'") && clientSource.includes('dpf-minimap-box'), 'canvas-minimap');
check('缩放滑杆与回到 100%', clientSource.includes('dpf-canvas-range') && clientSource.includes('const canvasZoomTo = useCallback'), 'canvas-zoom-to');
check('支持复制粘贴节点', clientSource.includes('canvasClip') && clientSource.includes('const canvasPaste = useCallback'), 'canvas-clipboard');
check('支持全选', clientSource.includes('const canvasSelectAll = useCallback') && clientSource.includes("mod && key === 'a'"), 'canvas-select-all');
check('支持导出与导入画布', clientSource.includes('const canvasExport = useCallback') && clientSource.includes('const canvasImport = useCallback') && clientSource.includes('canvasImportFile'), 'canvas-io');
check('节点记录生成参数', clientSource.includes('meta: {') && clientSource.includes('withImage: Boolean(primary)'), 'canvas-meta');
check('可按节点记录再出一张', clientSource.includes('const canvasRetryNode = useCallback') && clientSource.includes("'↻'"), 'canvas-retry');
check('双击空白复位视图', clientSource.includes('onDoubleClick') && (clientSource.includes('canvasZoomTo(1)') || clientSource.includes('view: { x: 0, y: 0, scale: 1 }')), 'canvas-dblclick');
check('快捷键提示挂到工具栏', clientSource.includes('(Ctrl+Z)') && clientSource.includes('(Ctrl+Shift+Z)'), 'canvas-keys');

// 画布粘贴：Ctrl+V 直接落图，且不跟图生图的主图槽抢
check('画布页粘贴的图落到画布', clientSource.includes('canvasPasteRef') && clientSource.includes("pageRef.current === 'canvas' && canvasPasteRef.current"), 'canvas-paste-routing');
check('画布能接图链粘贴', clientSource.includes('const canvasPasteLink = useCallback') && clientSource.includes('text/html'), 'canvas-paste-link');
check('点画布拿回焦点', clientSource.includes('onPointerDownCapture') && clientSource.includes('canvasRef.current?.focus?.()'), 'canvas-focus');
check('输入框里的粘贴不抢', clientSource.includes("tag === 'TEXTAREA' || tag === 'INPUT'"), 'canvas-paste-typing');
check('画布载入图片取的是 data URL 字符串', clientSource.includes('const data = await readImageFile(file, CANVAS_MAX_EDGE)') && !/const shot = await readImageFile/.test(clientSource), 'canvas-load-src');
check('节点两侧有连线端口', clientSource.includes('const canvasPortDown') && clientSource.includes("'data-side': 'out'") && clientSource.includes('.dpf-canvas-port'), 'canvas-ports');
check('连线带箭头', clientSource.includes('dpf-canvas-arrow') && clientSource.includes('markerEnd'), 'canvas-edge-arrow');
check('点线可以删掉', clientSource.includes('const canvasRemoveEdge') && clientSource.includes('dpf-canvas-hit'), 'canvas-edge-remove');
check('拉线时有预览线', clientSource.includes('canvasLink') && clientSource.includes('dpf-canvas-live'), 'canvas-edge-live');
check('拉线用捕获阶段，不会被节点拖动抢走', clientSource.includes("window.addEventListener('pointermove', onMove, true)"), 'canvas-port-capture');
check('拉线预览直接改 DOM，不靠每帧重渲染', clientSource.includes('livePath.current') && clientSource.includes('setAttribute('), 'canvas-port-draw');
check('点在端口上不会触发画布平移', clientSource.includes("target.closest('.dpf-canvas-port')"), 'canvas-pan-guard');
check('端口常显，不用悬停才看得见', /\.dpf-canvas-port\{[^}]*opacity:\.9/.test(clientSource), 'canvas-port-visible');
check('没连上会告诉用户', clientSource.includes('canvasLinkMiss') && clientSource.includes('canvasLinkDone'), 'canvas-link-msg');
check('松手后清掉预览线，不留幽灵线', clientSource.includes("livePath.current.setAttribute('d', '')"), 'canvas-live-cleanup');
check('节点上有自己的出图按钮', clientSource.includes('canvasGenerateFrom') && clientSource.includes("'⚡'"), 'canvas-node-generate');
check(
  '单个节点出图会沿连线把所有上游都带上',
  clientSource.includes('const queue = [node.id];') && clientSource.includes('if (edge.to !== at || ids.has(edge.from)) return;'),
  'canvas-node-upstream',
);
check('输入框里按删除键不删节点', clientSource.includes("if (tag === 'TEXTAREA' || tag === 'INPUT') return;") && clientSource.includes('onKeyDown: (event) => event.stopPropagation()'), 'canvas-typing-safe');
check('没有图时不拿改图指令硬出图', clientSource.includes('canvasNeedSubject') && clientSource.includes('if (!primary && instruction)'), 'canvas-instruction-guard');

// 画布里的参考库：面板内直接搜、按种类筛、点一张就落到画布
check('画布有新建画布按钮与独立清空流程', clientSource.includes("const newCanvas = useCallback") && clientSource.includes("t('newCanvas')") && clientSource.includes("className: 'dpf-btn dpf-btn-small dpf-btn-primary dpf-canvas-new'") && clientSource.includes('onClick: newCanvas'), 'canvas-new');
check('画布有自己的一套参考库 state', clientSource.includes('const [canvasGalOpen, setCanvasGalOpen]') && clientSource.includes('const [canvasGalWorks, setCanvasGalWorks]'), 'canvas-gallery-state');
check('画布有参考库面板', clientSource.includes("className: 'dpf-canvas-gal'") && clientSource.includes('dpf-canvas-gal-grid'), 'canvas-gallery-panel');
check('参考库检索在工坊与画布之间共用', clientSource.includes('const fetchGallery = useCallback') && clientSource.includes('const searchCanvasGallery = useCallback'), 'canvas-gallery-shared-fetch');
check('种类筛选条共用同一个渲染函数', clientSource.includes('const renderKindsBox = (st) =>') && clientSource.includes('const canvasKindsBox = renderKindsBox('), 'canvas-gallery-kinds-shared');
check('画布参考库点一张就落到画布', clientSource.includes('onClick: () => void refToCanvas(work)'), 'canvas-gallery-drop');
check('工具条有参考库开关', clientSource.includes("t('canvasGallery')"), 'canvas-gallery-button');
check('参考库面板里滚轮不缩放画布', clientSource.includes("closest('.dpf-canvas-gal')"), 'canvas-gallery-wheel');
check('参考库能直接喂给选中的节点', clientSource.includes('const applyRefToNode = useCallback') && clientSource.includes("t('canvasApplyNode')"), 'canvas-gallery-apply');
check('图片节点换图、文字节点追加描述', clientSource.includes("if (target.kind === 'text')") && clientSource.includes("patchCanvasNode(target.id, { text: next })"), 'canvas-gallery-apply-kind');
check('面板里点按钮不抢画布焦点', clientSource.includes("closest('.dpf-canvas-gal')) return;"), 'canvas-gallery-focus');

check(
  '主图就是连线上的第一张，不靠猜',
  clientSource.includes('primaryNode = pinned || ordered[0]') && !clientSource.includes('const humans = triaged.filter'),
  'canvas-subject-order',
);
check(
  '灰阶图才转姿态卡',
  clientSource.includes('if (primary && (await imageLooksFlat(primary)))'),
  'canvas-flat-card',
);
check(
  '附加参考只取版型与姿态，不抄渲染风格',
  clientSource.includes('CANVAS_REF_NOTE') && clientSource.includes('const refNote = extras.length > 0'),
  'canvas-ref-note',
);
check(
  '画布出图默认补写实约束',
  clientSource.includes('CANVAS_REAL_NOTE') && clientSource.includes('CANVAS_REAL_NOTE[language] || CANVAS_REAL_NOTE.en') && clientSource.includes('${words'),
  'canvas-real-note',
);
check(
  '单色灰图当主图被拒时改发白底姿态卡',
  clientSource.includes('async function poseCardDataUrl(') && clientSource.includes('await imageLooksFlat(subject)'),
  'canvas-pose-card',
);
check(
  '可以手动指定哪张图是主体',
  clientSource.includes('const pinned = ordered.find((node) => node.subject)') &&
    clientSource.includes("t('canvasSubjectOn')") &&
    clientSource.includes("node.subject ? '◉' : '◎'"),
  'canvas-subject-pin',
);
check(
  '附图编号按连线顺序而不是坐标',
  /function chainOrder\(nodes, edges(?:, graphNodes = nodes)?\)/.test(clientSource) &&
    /const ordered = chainOrder\(images, state\.edges(?:, state\.nodes)?\)/.test(clientSource) &&
    !clientSource.includes('images.slice().sort((left, right) => left.x - right.x'),
  'canvas-chain-order',
);
check(
  '出图节点记下主图与参考图的名字',
  clientSource.includes('primary: primaryNode ? String(primaryNode.title') &&
    clientSource.includes('extras: extrasNodes.map'),
  'canvas-meta-names',
);
check(
  '透视面料按不透明还原（画布）',
  clientSource.includes('const CANVAS_OPAQUE_NOTE = {') &&
    clientSource.includes('const opaqueNote = extras.length > 0 ? CANVAS_OPAQUE_NOTE[language]') &&
    clientSource.includes('${refNote}${opaqueNote}'),
  'canvas-opaque-note',
);
check(
  '被拒后先试不透明面料，再试姿态卡',
  clientSource.includes('let opaqued = false;') &&
    clientSource.includes('if (extras.length > 0) {') &&
    clientSource.includes('shots.opaqued = true;') &&
    clientSource.includes('const flat = await imageLooksFlat(subject);'),
  'canvas-opaque-retry',
);
check(
  '工坊图生图也会补一句不透明面料',
  clientSource.includes('body = await submit(primary, `${note || EDIT_PREFIX[language] || EDIT_PREFIX.en}${CANVAS_OPAQUE_NOTE[language]'),
  'workshop-opaque-retry',
);

check('插件整体采用白色主题', clientSource.includes('.dpf-panel{--dsw-alias-bg-primary:#fff') && clientSource.includes('.dpf-canvas{background-color:#f8fafc') && clientSource.includes('color-scheme:light'), 'light-theme');
check(
  '左栏固定宽度、内容区独立滚动',
  clientSource.includes('.dpf-rail{width:214px;flex:none') &&
    clientSource.includes('.dpf-rail-list{flex:1;min-height:0;overflow:auto') &&
    clientSource.includes('.dpf-stage{flex:1;min-width:0;min-height:0;display:flex;flex-direction:column}'),
  'rail-fixed',
);
check(
  '左栏列出历史记录，点一条就恢复',
  clientSource.includes("className: 'dpf-rail-list'") &&
    clientSource.includes('history.map((entry) =>') &&
    clientSource.includes('onClick: () => restore(entry)'),
  'rail-history',
);
check(
  '左栏有新建按钮，按页清空',
  clientSource.includes('const newSession = useCallback') &&
    clientSource.includes("h('button', { className: 'dpf-newbtn'") &&
    clientSource.includes("if (page === 'canvas') {"),
  'rail-new',
);
check(
  '顶部横栏显示当前页与模型选择',
  clientSource.includes("className: 'dpf-topbar'") &&
    clientSource.includes("className: 'dpf-topbar-title'") &&
    clientSource.includes("className: 'dpf-topbar-note'"),
  'topbar',
);

check(
  '入口与「新会话」按钮左右并排',
  clientSource.includes('data-drawcraft-tab') &&
    clientSource.includes('host.nextElementSibling !== tab) host.after(tab)') &&
    clientSource.includes('data-drawcraft-host') &&
    clientSource.includes("row.querySelector('nav[class*=\"panelList\"]')") &&
    clientSource.includes('ctx.layout?.selectPanel') && clientSource.includes('ctx.layout.selectPanel(NS)'),
  'sidebar-tab',
);
check(
  '不改宿主容器的布局，只做绝对定位',
  !/\[data-drawcraft-host="1"\]\{display:/.test(clientSource) &&
    /\[data-drawcraft-host="1"\]\{position:relative\}/.test(clientSource) &&
    clientSource.includes("const box = host.getBoundingClientRect()"),
  'sidebar-tab-layout',
);
check(
  '展开时隐藏 panelList 里的重复行，收起时反过来',
  clientSource.includes('nav[class*=\"panelList\"] button:has([data-dsh-panel-entry=\"dsh-drawcraft\"]){display:none}') &&
    clientSource.includes('[data-sidebar-collapsed] [data-drawcraft-tab]{display:none}'),
  'sidebar-tab-dedupe',
);
check(
  '没有真 DOM 时跳过注入',
  clientSource.includes("typeof document.createElement !== 'function') return () => {}"),
  'sidebar-tab-guard',
);
// 点击必须三条路兜底：selectPanel 抛错、面板行点击失败，都不能让点击变哑巴。
check(
  '点开面板有三条兜底，任何一条抛错都不会没反应',
  clientSource.includes('layout.selectPanel failed') &&
    clientSource.includes('panel row click failed') &&
    clientSource.includes('no way to open the panel'),
  'sidebar-tab-open',
);

if (fail.length) {
  console.error(`\n${fail.length} 项未通过：${fail.join('、')}`);
  process.exit(1);
}
console.log('\n全部通过');
