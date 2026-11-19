/**
 * dsh-image-prompt-forge browser half.
 *
 * A single sidebar-footer launcher that opens a two-column workspace:
 * left = the brief (idea, dialect, style, framing, advanced constraints),
 * right = the optimized prompt, its field-by-field breakdown, and history.
 *
 * Everything that needs the model goes through the host routes in index.js;
 * the panel never talks to a provider directly and never sees a key.
 */
window.__ModuleLoader__.load({
  id: 'dsh-image-prompt-forge',
  factory(require) {
    const React = require('react');
    const ReactDOM = require('react-dom');

    const NS = 'dsh-image-prompt-forge';
    const API = '/api/prompt-forge';
    const HOST_STALE = 'HOST_STALE';
    // 本机 dsh-imagegen 插件暴露的设置视图与生图代理接口；没装时都返回 404。
    const IMAGE_CHANNELS_API = '/api/dsh-imagegen/settings/describe';
    // 按渠道向上游探一次真实可用模型；失败就沿用设置里的模型目录。
    const IMAGE_MODELS_API = '/api/dsh-imagegen/image-models';
    const GENERATE_API = '/api/dsh-imagegen/generate';
    const IMAGE_MAX_EDGE = 1280;
    // 图生图的前置指令：不加这句，模型会照着提示词重画一个人，导入的图等于白给。
    const EDIT_PREFIX = {
      en: 'Use the first reference image as the only subject: keep the same person — face, hair, body type and skin tone unchanged — and change only the pose, outfit and scene described below.\n\n',
      zh: '以第一张参考图为唯一主体：保持人物身份不变（脸、发型、体型、肤色都不改），只按下面这段描述调整姿态、服装与场景。\n\n',
    };
    // 出图尺寸用比例字符串（dsh-imagegen 会按协议换算成像素），清晰度用 1k/2k/4k。
    const IMAGE_SIZES = ['auto', '1:1', '3:4', '4:3', '9:16', '2:3', '3:2', '16:9', '21:9'];
    const IMAGE_QUALITIES = ['auto', '1k', '2k', '4k'];
    // 大图缩放范围与步长。
    const MIN_ZOOM = 0.2;
    const MAX_ZOOM = 8;
    const STORE_KEY = 'dsh-image-prompt-forge:v1';
    const HISTORY_LIMIT = 24;
    // 页脚显示，用来一眼判断浏览器加载的是哪一版 bundle（缓存排查用）。
    const BUILD = '1.3.0';

    // Labels are duplicated from engine.js on purpose: client.js is loaded as a
    // separate bundle and cannot import ESM. The host catalog (fetched on open)
    // overwrites these, so a mismatch only matters for the first paint.
    const FALLBACK = {
      dialects: [
        { key: 'natural-en', label: '自然英文（通用）' },
        { key: 'natural-zh', label: '自然中文' },
        { key: 'gpt-image', label: 'GPT-Image / DALL·E' },
        { key: 'midjourney', label: 'Midjourney' },
        { key: 'stable-diffusion', label: 'Stable Diffusion' },
        { key: 'nano-banana', label: 'Nano Banana / 改图' },
      ],
      styles: [
        { key: 'auto', label: '自动判断' },
        { key: 'photo', label: '写实摄影' },
        { key: 'cinematic', label: '电影感' },
        { key: 'editorial', label: '商业广告' },
        { key: 'product', label: '电商产品图' },
        { key: 'illustration', label: '插画绘本' },
        { key: 'anime', label: '日系动画' },
        { key: 'concept', label: '游戏原画' },
        { key: '3d', label: '3D 渲染' },
        { key: 'cyberpunk', label: '赛博朋克' },
        { key: 'minimal', label: '极简海报' },
        { key: 'watercolor', label: '水彩手绘' },
        { key: 'ink', label: '国风水墨' },
        { key: 'clay', label: '黏土玩具' },
        { key: 'pixel', label: '像素复古' },
        { key: 'architecture', label: '建筑可视化' },
        { key: 'icon', label: '图标矢量' },
        { key: 'custom', label: '自定义风格' },
      ],
      modes: [
        { key: 'create', label: '从零创作' },
        { key: 'refine', label: '精修改写' },
        { key: 'variation', label: '换方向' },
      ],
      aspects: ['auto', '1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9'],
      languages: [
        { key: 'en', label: '英文' },
        { key: 'zh', label: '中文' },
      ],
      fields: [
        { key: 'subject', label: '主体' },
        { key: 'action', label: '动作 / 状态' },
        { key: 'environment', label: '环境 / 背景' },
        { key: 'composition', label: '构图 / 机位' },
        { key: 'lighting', label: '光线' },
        { key: 'camera', label: '镜头 / 画质' },
        { key: 'style', label: '风格 / 媒介' },
        { key: 'palette', label: '色彩 / 影调' },
        { key: 'materials', label: '材质 / 细节' },
        { key: 'mood', label: '氛围' },
        { key: 'details', label: '关键细节' },
      ],
    };

    const zh = {
      meta: {
        title: '提示词工坊',
        description: '把模糊的生图想法整理成可直接投喂图像模型的提示词，含字段拆解、负向提示与备选方向。',
      },
      subtitle: '想法 → 结构 → 可直接执行的提示词',
      brief: '出图意图',
      idea: '你想画什么',
      ideaPlaceholder: '例如：雨天便利店门口，一个穿黄色雨衣的女孩回头，手里拎着便利店的塑料袋…',
      ideaCount: '字',
      target: '目标设定',
      dialect: '目标模型方言',
      style: '视觉风格',
      styleHint: '自定义风格描述',
      styleHintPlaceholder: '例如：1970 年代苏联科普插图，粗颗粒网点印刷，赭石与钴蓝双色…',
      aspect: '画幅',
      language: '提示词语言',
      mode: '任务模式',
      candidates: '备选方向',
      advanced: '高级约束',
      purpose: '用途',
      purposePlaceholder: '例如：公众号首图、商品详情页主图',
      mustInclude: '必须保留',
      mustIncludePlaceholder: '用户已定死的元素，例如「黄色雨衣」「塑料袋」',
      mustAvoid: '必须避免',
      mustAvoidPlaceholder: '例如：不要出现人脸特写、不要英文文字',
      optimize: '优化提示词',
      optimizeHint: 'Ctrl / ⌘ + Enter',
      stop: '停止',
      result: '优化结果',
      resultEmpty: '左边写好想法，点「优化提示词」',
      resultEmptyHint: '会返回一段可直接粘贴到图像模型的提示词，以及逐字段的画面拆解。',
      prompt: '最终提示词',
      negative: '负向提示词',
      variants: '备选方向',
      notes: '建议',
      breakdown: '画面拆解',
      history: '历史',
      historyEmpty: '还没有生成记录',
      copy: '复制',
      copied: '已复制',
      copyField: '复制此字段',
      again: '作为想法再优化',
      clear: '清空',
      clearIdeaHint: '清空上面这段描述',
      removeHistory: '删除这条',
      clearHistory: '清空历史',
      gallery: '参考库（可选）',
      galleryHint: '4,345 条中文参考：姿势库带深度图，挑中什么模型就照什么写，不用自己描述',
      galleryAll: '全部',
      gallerySearch: '搜索，例如「蹲 侧面」「针织衫」「长发」',
      galleryLoading: '检索中…首次要下 2 MB 索引，之后离线可用',
      galleryEmpty: '没有命中，换成更短的关键词试试',
      galleryPick: '点一下加入参考',
      gallerySelected: '已选参考',
      galleryAny: '不限',
      galleryKinds: '种类',
      kindsMore: '更多',
      kindsLess: '收起',
      galleryMore: '加载更多',
      shotAdd: '加一张参考图',
      shotHint: 'Ctrl+V 直接粘贴剪贴板里的图；第一张当主体，其余当参考，最多四张。',
      usePoseRefs: '把手上的姿势图也发过去',
      shotLoadedNoModel: '图已载入，可以直接拿去图生图。',
      renderEdit: '图生图',
      model: '优化模型',
      provider: '渠道',
      noModel: '未选择模型',
      chooseModel: '选择模型',
      needModel: '先在顶部选好优化用的对话模型',
      needIdea: '先写下你想画的画面',
      loadingCatalog: '正在读取模型目录…',
      catalogEmpty: '当前没有可用模型，请先在模型设置里添加',
      elapsed: '耗时',
      chars: '字符',
      footnote: '密钥由 Host 托管；优化请求走本机回环接口，不经第三方。',
      settings: '设定',
      close: '关闭',
      untitled: '未命名提示词',
      stopDone: '已停止',
      describe: '反推图片',
      describeHint: '上传一张参考图，倒推出它的提示词',
      pickImage: '选一张图',
      dropImage: '把图片拖到这里，或点「选一张图」',
      imageReady: '已选图',
      imageListening: '松手即反推',
      describing: '正在读图…',
      describeDone: '已反推',
      fromImage: '图片反推',
      patch: '改一句',
      patchPlaceholder: '例如：光线换成黄昏，镜头压低一点',
      patchHint: '只改你点名的部分，其余字段原样保留',
      patchApply: '改',
      patching: '正在改…',
      needInstruction: '先写下要改什么',
      fromPatch: '改一句',
      preview: '试一张',
      previewHint: '用本机生图插件按当前提示词出一张图',
      generating: '出图中…',
      previewTitle: '预览图',
      noImagegen: '没找到本机的生图插件（dsh-imagegen），装好后这里就能直接出图',
      hostStale: '宿主还在跑旧版本的插件，退出桌面端重新打开一次就能用了',
      imageChannel: '出图渠道',
      imageModel: '出图模型',
      imageModelHint: '出图用的是本机生图插件里的渠道与模型，和上面的对话模型互不影响',
      imageSize: '出图尺寸',
      imageQuality: '出图清晰度',
      sizeAuto: '跟随画幅',
      qualityAuto: '渠道默认',
      zoomHint: '点击放大',
      zoomWheel: '滚轮缩放 · 拖动平移 · 双击复位',
      zoomIn: '放大',
      zoomOut: '缩小',
      zoomReset: '复位到 100%',
      save: '保存',
      previewFailed: '出图失败',
      regenerate: '再出一张',
    };

    const en = {
      meta: {
        title: 'Prompt Forge',
        description: 'Turn a vague image idea into a prompt a model can execute, with a field-by-field breakdown, negative prompt and alternate directions.',
      },
      subtitle: 'idea → structure → an executable prompt',
      brief: 'Brief',
      idea: 'What do you want to see',
      ideaPlaceholder: 'e.g. A girl in a yellow raincoat looks back outside a rainy convenience store, a plastic bag in her hand…',
      ideaCount: 'chars',
      target: 'Target',
      dialect: 'Target dialect',
      style: 'Visual preset',
      styleHint: 'Custom style',
      styleHintPlaceholder: 'e.g. 1970s Soviet popular-science illustration, coarse halftone print, ochre and cobalt duotone…',
      aspect: 'Aspect ratio',
      language: 'Prompt language',
      mode: 'Task mode',
      candidates: 'Alternates',
      advanced: 'Constraints',
      purpose: 'Intended use',
      purposePlaceholder: 'e.g. WeChat article header, product detail hero',
      mustInclude: 'Must keep',
      mustIncludePlaceholder: 'Elements the user already fixed, e.g. "yellow raincoat", "plastic bag"',
      mustAvoid: 'Must avoid',
      mustAvoidPlaceholder: 'e.g. no face close-up, no English text',
      optimize: 'Optimize prompt',
      optimizeHint: 'Ctrl / ⌘ + Enter',
      stop: 'Stop',
      result: 'Result',
      resultEmpty: 'Write the idea on the left, then hit Optimize',
      resultEmptyHint: 'You get a prompt you can paste into an image model, plus a field-by-field breakdown of the scene.',
      prompt: 'Final prompt',
      negative: 'Negative prompt',
      variants: 'Alternates',
      notes: 'Tip',
      breakdown: 'Breakdown',
      history: 'History',
      historyEmpty: 'Nothing generated yet',
      copy: 'Copy',
      copied: 'Copied',
      copyField: 'Copy this field',
      again: 'Reuse as idea',
      clear: 'Clear',
      clearIdeaHint: 'Clear the brief',
      removeHistory: 'Delete this entry',
      clearHistory: 'Clear history',
      gallery: 'Reference library',
      galleryHint: '4,345 curated Chinese references: the pose library carries depth maps, so whatever you pick is exactly what the model writes',
      galleryAll: 'All',
      gallerySearch: 'Search, e.g. "squat side", "knit sweater", "long hair"',
      galleryLoading: 'Searching… the first run downloads a 2 MB index, then it is offline',
      galleryEmpty: 'No hit — try a shorter keyword',
      galleryPick: 'Click to add as reference',
      gallerySelected: 'Selected references',
      galleryAny: 'Any',
      galleryKinds: 'Categories',
      kindsMore: 'more',
      kindsLess: 'less',
      galleryMore: 'load more',
      shotAdd: 'add a reference image',
      shotHint: 'Paste with Ctrl+V. The first image is the subject, the rest are references (max 4).',
      usePoseRefs: 'also send the pose references',
      shotLoadedNoModel: 'Image loaded — ready for image-to-image.',
      renderEdit: 'image-to-image',
      model: 'Optimizer model',
      provider: 'Provider',
      noModel: 'No model selected',
      chooseModel: 'Choose a model',
      needModel: 'Pick an optimizer model at the top first',
      needIdea: 'Write what you want to see first',
      loadingCatalog: 'Loading model catalog…',
      catalogEmpty: 'No models available; add one in model settings',
      elapsed: 'Elapsed',
      chars: 'chars',
      footnote: 'Keys stay on the Host; optimization runs through a loopback route.',
      settings: 'Settings',
      close: 'Close',
      untitled: 'Untitled prompt',
      stopDone: 'Stopped',
      describe: 'Read image',
      describeHint: 'Upload a reference image and reverse it into a prompt',
      pickImage: 'Pick an image',
      dropImage: 'Drop an image here, or click “Pick an image”',
      imageReady: 'Image ready',
      imageListening: 'Drop to reverse it',
      describing: 'Reading the image…',
      describeDone: 'Reversed',
      fromImage: 'from image',
      patch: 'Tweak',
      patchPlaceholder: 'e.g. switch the light to dusk, lower the camera',
      patchHint: 'Only what you name changes; everything else stays verbatim',
      patchApply: 'Apply',
      patching: 'Applying…',
      needInstruction: 'Write the change first',
      fromPatch: 'tweaked',
      preview: 'Try one',
      previewHint: 'Render one image from this prompt with the local image plugin',
      generating: 'Rendering…',
      previewTitle: 'Preview',
      noImagegen: 'No local image plugin (dsh-imagegen) found; install it to render from here',
      hostStale: 'The host is still running the previous build of this plugin — quit and reopen the desktop app once.',
      imageChannel: 'Image channel',
      imageModel: 'Image model',
      imageModelHint: 'Rendering uses the channel and model configured in the local image plugin; the chat model above is unrelated.',
      imageSize: 'Size',
      imageQuality: 'Quality',
      sizeAuto: 'Follow aspect',
      qualityAuto: 'Channel default',
      zoomHint: 'Click to enlarge',
      zoomWheel: 'Scroll to zoom · drag to pan · double-click to reset',
      zoomIn: 'Zoom in',
      zoomOut: 'Zoom out',
      zoomReset: 'Reset to 100%',
      save: 'Save',
      previewFailed: 'Render failed',
      regenerate: 'Render another',
    };

    const css = `
.dpf-backdrop{position:fixed;inset:0;z-index:10000;background:#0009;backdrop-filter:blur(5px);display:flex;align-items:center;justify-content:center;padding:22px;box-sizing:border-box}
.dpf-embed{position:relative;display:flex;flex:1 1 auto;width:100%;height:100%;min-height:520px;overflow:hidden}
.dpf-embed .dpf-panel{width:100%;height:100%;border:0;border-radius:0;box-shadow:none;background:var(--dsw-alias-bg-primary,#141416)}

.dpf-panel{width:min(1180px,100%);height:min(860px,100%);display:flex;flex-direction:column;background:var(--dsw-alias-bg-elevated,#1c1c1e);color:var(--dsw-alias-text-primary,#eee);border:1px solid var(--dsw-alias-border-default,#ffffff18);border-radius:16px;box-shadow:0 26px 96px #000a;overflow:hidden;font-size:13px;line-height:1.55;color-scheme:dark}
.dpf-panel *{box-sizing:border-box}
.dpf-head{display:flex;align-items:center;gap:12px;padding:18px 20px 15px;border-bottom:1px solid var(--dsw-alias-border-default,#ffffff12);flex-wrap:wrap}
.dpf-head>svg{width:24px;height:24px;flex:none;color:var(--dsw-alias-interactive-primary,#c9b6ff)}
.dpf-title{font-size:17px;font-weight:650;letter-spacing:.01em}
.dpf-subtitle{font-size:12px;color:var(--dsw-alias-text-secondary,#8b8b90);margin-top:4px}
.dpf-spacer{flex:1}
.dpf-picker{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.dpf-icon{width:32px;height:32px;border:0;border-radius:8px;background:transparent;color:inherit;cursor:pointer;font-size:19px;line-height:1}
.dpf-icon:hover{background:var(--dsw-alias-bg-hover,#ffffff10)}
.dpf-icon:disabled{opacity:.4;cursor:default}
.dpf-body{flex:1;min-height:0;display:grid;grid-template-columns:392px minmax(0,1fr)}
.dpf-left{min-height:0;overflow:auto;padding:16px 18px 20px;border-right:1px solid var(--dsw-alias-border-default,#ffffff10)}
.dpf-right{min-height:0;overflow:auto;padding:16px 20px 20px;display:flex;flex-direction:column;gap:12px}
.dpf-section{margin-bottom:16px}
.dpf-section-head{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.dpf-step{font:600 11px/1 ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--dsw-alias-text-secondary,#7d7d84);border:1px solid var(--dsw-alias-border-default,#ffffff1c);border-radius:5px;padding:3px 5px}
.dpf-section-title{font-weight:600;font-size:12.5px;letter-spacing:.02em;color:var(--dsw-alias-text-primary,#dededf)}
.dpf-section-note{margin-left:auto;font-size:11px;color:var(--dsw-alias-text-secondary,#7d7d84);font-variant-numeric:tabular-nums}
.dpf-section-head .dpf-clear{padding:3px 8px;font-size:11px;border-radius:6px}
.dpf-textarea,.dpf-input,.dpf-select{width:100%;color:inherit;background:var(--dsw-alias-bg-input,#ffffff07);border:1px solid var(--dsw-alias-border-default,#ffffff18);border-radius:8px;padding:9px 11px;font:inherit;outline:none;transition:border-color .12s}
.dpf-textarea:focus,.dpf-input:focus,.dpf-select:focus{border-color:var(--dsw-alias-border-focused,#8d8d95)}
.dpf-textarea{resize:vertical;min-height:132px;line-height:1.6}
.dpf-textarea.dpf-idea{min-height:150px}
.dpf-select{-webkit-appearance:none;appearance:none;background-image:linear-gradient(45deg,transparent 50%,#888 50%),linear-gradient(135deg,#888 50%,transparent 50%);background-position:calc(100% - 15px) 50%,calc(100% - 10px) 50%;background-size:5px 5px,5px 5px;background-repeat:no-repeat;padding-right:28px}
.dpf-select option{background:#222;color:#eee}
.dpf-grid2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.dpf-grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px}
.dpf-gallery{margin-top:12px;padding:10px;border:1px dashed var(--dsw-alias-border-default,#ffffff1c);border-radius:10px;background:var(--dsw-alias-bg-secondary,#ffffff05)}
.dpf-gallery-head{display:flex;align-items:center;gap:8px;margin-bottom:6px}
.dpf-gallery-count{font-size:11px;color:var(--dsw-alias-text-secondary,#8b8b90);font-variant-numeric:tabular-nums}
.dpf-gallery-hint{font-size:11px;color:var(--dsw-alias-text-secondary,#8b8b90);margin-bottom:8px;line-height:1.5}
.dpf-gallery-search{display:flex;gap:6px;margin-bottom:8px}
.dpf-gallery-search .dpf-input{flex:1;min-width:0}
.dpf-gallery-libs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px}
.dpf-chip{border:1px solid var(--dsw-alias-border-default,#ffffff1c);background:transparent;color:var(--dsw-alias-text-secondary,#9a9aa0);border-radius:999px;padding:4px 11px;font:inherit;font-size:11.5px;cursor:pointer}
.dpf-chip:hover{color:var(--dsw-alias-text-primary,#ddd);background:var(--dsw-alias-bg-hover,#ffffff10)}
.dpf-chip[data-on]{background:var(--dsw-alias-interactive-primary,#ededf0);color:var(--dsw-alias-text-on-primary,#141416);border-color:transparent;font-weight:600}
.dpf-gallery-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(64px,1fr));gap:6px;max-height:min(46vh,420px);overflow:auto;padding:2px}
.dpf-gallery-more{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:6px}
.dpf-refshots{display:flex;flex-direction:column;gap:5px;margin-top:7px}
.dpf-refshots-row{display:flex;flex-wrap:wrap;gap:5px;align-items:center}
.dpf-refshot{position:relative;width:44px;height:44px;border-radius:8px;overflow:hidden;border:1px solid var(--dsw-alias-border-default,#ffffff1c);background:#00000040}
.dpf-refshot img{width:100%;height:100%;object-fit:cover;display:block}
.dpf-refshot-x{position:absolute;top:1px;right:1px;width:15px;height:15px;padding:0;border:0;border-radius:50%;background:#000000b0;color:#fff;font-size:11px;line-height:15px;cursor:pointer}
.dpf-refshot-add{width:44px;height:44px;border:1px dashed var(--dsw-alias-border-default,#ffffff2a);border-radius:8px;background:transparent;color:var(--dsw-alias-text-secondary,#8e8e94);font-size:17px;line-height:1;cursor:pointer}
.dpf-refshot-add:hover{color:var(--dsw-alias-text-primary,#eee);border-color:var(--dsw-alias-text-secondary,#8e8e94)}
.dpf-refshots-hint{font-size:10.5px;line-height:1.5;color:var(--dsw-alias-text-secondary,#8b8b90)}
.dpf-check{display:inline-flex;align-items:center;gap:5px;font-size:11px;color:var(--dsw-alias-text-secondary,#a0a0a6);cursor:pointer}
.dpf-check input{accent-color:#6b8afd}
.dpf-gallery-card{position:relative;padding:0;border:1px solid var(--dsw-alias-border-default,#ffffff18);border-radius:8px;background:#00000030;overflow:hidden;cursor:pointer;display:flex;flex-direction:column}
.dpf-gallery-card img{width:100%;height:96px;object-fit:contain;display:block;background:radial-gradient(circle at 50% 42%,#ffffff12,#00000000 72%)}
.dpf-gallery-card[data-on]{border-color:var(--dsw-alias-interactive-primary,#c9b6ff);box-shadow:0 0 0 1px var(--dsw-alias-interactive-primary,#c9b6ff) inset}
.dpf-gallery-name{display:block;font-size:10px;line-height:1.3;padding:3px 4px;color:var(--dsw-alias-text-secondary,#9a9aa0);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left}
.dpf-gallery-card[data-on] .dpf-gallery-name{color:var(--dsw-alias-text-primary,#ddd)}
.dpf-gallery-note{font-size:11px;color:var(--dsw-alias-text-secondary,#8b8b90);margin:4px 0 0}
.dpf-selected{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:8px}
.dpf-selected-item{display:inline-flex;align-items:center;gap:5px;max-width:100%;border:1px solid var(--dsw-alias-border-default,#ffffff1c);border-radius:999px;padding:3px 6px 3px 3px;font-size:11px;background:#00000030}
.dpf-selected-item img{width:20px;height:20px;border-radius:50%;object-fit:cover;flex:none}
.dpf-selected-item span{max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dpf-selected-x{border:0;background:transparent;color:var(--dsw-alias-text-secondary,#9a9aa0);cursor:pointer;font-size:13px;line-height:1;padding:0 2px}
.dpf-selected-x:hover{color:var(--dsw-alias-text-danger,#ef767a)}
.dpf-gallery-kinds{display:flex;flex-direction:column;gap:7px;margin-bottom:8px;padding-top:8px;border-top:1px dashed var(--dsw-alias-border-default,#ffffff14)}
.dpf-kinds-row{display:flex;align-items:flex-start;gap:8px}
.dpf-kinds-label{flex:none;min-width:40px;padding-top:4px;font-size:11px;color:var(--dsw-alias-text-secondary,#8b8b90)}
.dpf-kinds-values{display:flex;flex-wrap:wrap;gap:5px;flex:1;min-width:0;max-height:104px;overflow-y:auto;padding-right:2px}
.dpf-chip-more{border-style:dashed;opacity:.75}
.dpf-chip-more:hover{opacity:1}
.dpf-label{display:block;font-size:11px;color:var(--dsw-alias-text-secondary,#86868c);margin-bottom:5px;letter-spacing:.02em}
.dpf-actions{display:flex;gap:8px;position:sticky;bottom:0;padding:10px 0 4px;background:linear-gradient(to top,var(--dsw-alias-bg-elevated,#1c1c1e) 62%,transparent)}
.dpf-btn{border:1px solid var(--dsw-alias-border-default,#ffffff20);border-radius:8px;background:var(--dsw-alias-bg-secondary,#ffffff08);color:inherit;padding:8px 14px;cursor:pointer;font:inherit;white-space:nowrap;display:inline-flex;align-items:center;gap:6px}
.dpf-btn:hover:not(:disabled){background:var(--dsw-alias-bg-hover,#ffffff12)}
.dpf-btn:disabled{opacity:.42;cursor:default}
.dpf-btn-primary{background:var(--dsw-alias-interactive-primary,#ededf0);color:var(--dsw-alias-text-on-primary,#141416);border-color:transparent;font-weight:600;flex:1;justify-content:center}
.dpf-btn-primary:hover:not(:disabled){filter:brightness(1.06);background:var(--dsw-alias-interactive-primary,#ededf0)}
.dpf-btn-ghost{border-color:transparent;background:transparent;color:var(--dsw-alias-text-secondary,#8b8b90);padding:6px 8px}
.dpf-btn-ghost:hover:not(:disabled){color:var(--dsw-alias-text-primary,#ddd);background:var(--dsw-alias-bg-hover,#ffffff0d)}
.dpf-btn-small{padding:5px 9px;font-size:11.5px;border-radius:7px}
.dpf-error{margin:0;padding:9px 12px;border-radius:8px;color:var(--dsw-alias-text-danger,#ef767a);background:#ef767a14;font-size:12px;white-space:pre-wrap;word-break:break-word}
.dpf-warn{color:var(--dsw-alias-text-warning,#dfb66c);background:#dfb66c14}
.dpf-empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;color:var(--dsw-alias-text-secondary,#86868c);gap:8px;padding:40px 20px;min-height:280px}
.dpf-empty svg{width:44px;height:44px;opacity:.35}
.dpf-empty-title{font-size:14px;color:var(--dsw-alias-text-primary,#ccc)}
.dpf-empty-hint{font-size:12px;max-width:340px;line-height:1.65}
.dpf-card{border:1px solid var(--dsw-alias-border-default,#ffffff14);border-radius:11px;background:var(--dsw-alias-bg-secondary,#ffffff05);padding:12px 13px}
.dpf-card-head{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.dpf-card-title{font-size:11.5px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--dsw-alias-text-secondary,#8b8b90)}
.dpf-card-head .dpf-spacer{flex:1}
.dpf-prompt{width:100%;min-height:168px;resize:vertical;font:12.5px/1.75 ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace;color:var(--dsw-alias-text-primary,#ededf0);background:#00000026;border:1px solid var(--dsw-alias-border-default,#ffffff14);border-radius:8px;padding:10px 11px;outline:none;white-space:pre-wrap;word-break:break-word}
.dpf-prompt:focus{border-color:var(--dsw-alias-border-focused,#8d8d95)}
.dpf-meta{display:flex;flex-wrap:wrap;gap:6px;margin-top:9px}
.dpf-pill{font-size:11px;padding:3px 8px;border-radius:999px;border:1px solid var(--dsw-alias-border-default,#ffffff1a);color:var(--dsw-alias-text-secondary,#a0a0a6);white-space:nowrap}
.dpf-pill-accent{color:var(--dsw-alias-interactive-primary,#c9b6ff);border-color:#c9b6ff44}
.dpf-fields{display:flex;flex-direction:column;gap:2px}
.dpf-field{display:flex;gap:10px;padding:7px 8px;border-radius:7px;cursor:pointer;border:0;background:transparent;color:inherit;font:inherit;text-align:left;width:100%}
.dpf-field:hover{background:var(--dsw-alias-bg-hover,#ffffff0d)}
.dpf-field-key{flex:none;width:84px;font-size:11.5px;color:var(--dsw-alias-text-secondary,#86868c);padding-top:1px}
.dpf-field-value{flex:1;min-width:0;font-size:12.5px;line-height:1.62;word-break:break-word}
.dpf-list{margin:0;padding-left:18px;display:flex;flex-direction:column;gap:5px;font-size:12.5px;line-height:1.6}
.dpf-tabs{display:flex;gap:4px;border-bottom:1px solid var(--dsw-alias-border-default,#ffffff10);margin-bottom:4px}
.dpf-tab{border:0;background:transparent;color:var(--dsw-alias-text-secondary,#86868c);padding:7px 11px;cursor:pointer;font:inherit;font-size:12px;border-bottom:2px solid transparent;margin-bottom:-1px}
.dpf-tab:hover{color:var(--dsw-alias-text-primary,#ddd)}
.dpf-tab[data-active=true]{color:var(--dsw-alias-text-primary,#ededf0);border-bottom-color:var(--dsw-alias-interactive-primary,#c9b6ff)}
.dpf-history{display:flex;flex-direction:column;gap:6px}
.dpf-history-item{display:flex;align-items:flex-start;gap:8px;padding:9px 10px;border:1px solid var(--dsw-alias-border-default,#ffffff12);border-radius:9px;background:var(--dsw-alias-bg-secondary,#ffffff04);cursor:pointer;text-align:left;color:inherit;font:inherit;width:100%}
.dpf-history-item:hover{border-color:var(--dsw-alias-border-focused,#ffffff26);background:var(--dsw-alias-bg-hover,#ffffff09)}
.dpf-history-main{flex:1;min-width:0}
.dpf-history-title{font-size:12.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dpf-history-sub{font-size:11px;color:var(--dsw-alias-text-secondary,#86868c);margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dpf-foot{padding:9px 20px;border-top:1px solid var(--dsw-alias-border-default,#ffffff10);color:var(--dsw-alias-text-secondary,#7d7d84);font-size:11px;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}
.dpf-spin{display:inline-block;width:12px;height:12px;border:2px solid currentColor;border-top-color:transparent;border-radius:50%;animation:dpf-spin .7s linear infinite}
@keyframes dpf-spin{to{transform:rotate(360deg)}}
.dpf-dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-text-success,#62c992);flex:none}
.dpf-drop{margin-top:8px;padding:13px 12px;border:1px dashed var(--dsw-alias-border-default,#ffffff22);border-radius:10px;text-align:center;font-size:11.5px;color:var(--dsw-alias-text-secondary,#8b8b92);cursor:pointer;line-height:1.5;transition:border-color .16s ease,background .16s ease,color .16s ease}
.dpf-drop:hover{border-color:var(--dsw-alias-border-focused,#ffffff3a);color:var(--dsw-alias-text-primary,#cfcfd6)}
.dpf-drop[data-over="1"]{border-color:#8a9cff;background:#8a9cff14;color:var(--dsw-alias-text-primary,#e6e6ee)}
.dpf-thumb{display:flex;gap:10px;align-items:center;margin-top:8px;padding:7px 9px;border:1px solid var(--dsw-alias-border-default,#ffffff12);border-radius:10px;background:var(--dsw-alias-bg-secondary,#ffffff04)}
.dpf-thumb img{width:44px;height:44px;object-fit:cover;border-radius:7px;flex:none;border:1px solid var(--dsw-alias-border-default,#ffffff14)}
.dpf-thumb-main{flex:1;min-width:0}
.dpf-thumb-title{font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dpf-thumb-sub{font-size:11px;color:var(--dsw-alias-text-secondary,#86868c);margin-top:2px}
.dpf-patch{display:flex;gap:8px;align-items:center;margin-top:10px}
.dpf-patch input{flex:1;min-width:0;padding:8px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-default,#ffffff1c);background:var(--dsw-alias-bg-secondary,#ffffff06);color:inherit;font:inherit;font-size:12.5px}
.dpf-patch input:focus{outline:none;border-color:var(--dsw-alias-border-focused,#ffffff3a)}
.dpf-patch-hint{font-size:11px;color:var(--dsw-alias-text-secondary,#7d7d84);margin-top:6px}
.dpf-preview{display:flex;gap:10px;flex-wrap:wrap;margin-top:10px}
.dpf-preview img{max-width:100%;max-height:420px;border-radius:10px;border:1px solid var(--dsw-alias-border-default,#ffffff14);display:block}
.dpf-shot{position:relative;display:inline-flex;max-width:100%}
.dpf-shot img{cursor:zoom-in}
.dpf-shot-save{position:absolute;top:8px;right:8px;padding:4px 10px;border-radius:999px;border:1px solid #ffffff2b;background:#000000b3;color:#fff;font-size:11px;line-height:1.6;cursor:pointer;opacity:0;transition:opacity .15s}
.dpf-shot:hover .dpf-shot-save,.dpf-shot-save:focus-visible{opacity:1}
.dpf-lightbox{position:fixed;inset:0;z-index:10100;background:#000000e6;display:flex;align-items:center;justify-content:center;padding:40px 40px 72px;cursor:zoom-out}
.dpf-lightbox img{max-width:100%;max-height:100%;object-fit:contain;border-radius:10px;box-shadow:0 30px 90px #000c;cursor:grab;transition:transform .09s linear;will-change:transform;user-select:none;touch-action:none}
.dpf-lightbox img[data-zoomed="0"]{cursor:zoom-in}
.dpf-lightbox img:active{cursor:grabbing}
.dpf-lightbox-hint{position:absolute;top:18px;left:0;right:0;text-align:center;font-size:11.5px;color:#ffffff8a;pointer-events:none}
.dpf-zoom-level{min-width:64px;justify-content:center;font-variant-numeric:tabular-nums}
.dpf-lightbox-bar{position:absolute;bottom:22px;left:0;right:0;display:flex;justify-content:center;gap:10px;cursor:default}
.dpf-lightbox-bar .dpf-btn{background:#ffffff1a;border-color:#ffffff33;color:#fff}
.dpf-lightbox-bar .dpf-btn:hover{background:#ffffff2b}
.dpf-preview-empty{font-size:12px;color:var(--dsw-alias-text-secondary,#86868c);padding:10px 0}
@media(max-width:960px){.dpf-backdrop{padding:0}.dpf-panel{height:100%;border-radius:0}.dpf-body{grid-template-columns:1fr;overflow:auto}.dpf-left{border-right:0;border-bottom:1px solid var(--dsw-alias-border-default,#ffffff10);overflow:visible}.dpf-right{overflow:visible}.dpf-picker{width:100%}}
`;

    // locale 的 translate 是扁平查表（lib/client.js:1433 用 dict[key] 直接取值），
    // 不做点路径展开，所以嵌套词典必须先拍平成 'meta.title' 这样的键。
    function flattenDict(source, prefix = '', out = {}) {
      for (const [key, value] of Object.entries(source)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (value && typeof value === 'object' && !Array.isArray(value)) flattenDict(value, path, out);
        else out[path] = value;
      }
      return out;
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(
          () => ctx.locale.register(NS, { zh: flattenDict(zh), en: flattenDict(en) }),
          'dsh-image-prompt-forge: dictionaries',
        );

        const { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } = React;
        const h = React.createElement;

        const icon = h(
          'svg',
          { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
          h('path', { d: 'M4 20.5 4.9 16 16.2 4.7a2.1 2.1 0 0 1 3 3L8 19.6l-4 0.9Z' }),
          h('path', { d: 'm14.5 6.4 3.1 3.1' }),
          h('path', { d: 'M18.5 15.5h4M20.5 13.5v4' }),
        );

        const emptyIcon = h(
          'svg',
          { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
          h('rect', { x: 3, y: 4, width: 18, height: 16, rx: 2.5 }),
          h('circle', { cx: 8.6, cy: 9.4, r: 1.6 }),
          h('path', { d: 'm3.6 17.4 4.6-4.3 3.6 3.2 3.4-3 5.2 5.1' }),
        );

        async function post(path, body, signal) {
          const response = await fetch(`${API}/${path}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body ?? {}),
            signal,
          });
          // The panel bundle can update on a page refresh while the host half still
          // runs the previous build; a 404 here almost always means exactly that.
          if (response.status === 404) throw new Error(HOST_STALE);
          let payload;
          try {
            payload = await response.json();
          } catch {
            throw new Error(`HTTP ${response.status}`);
          }
          if (!payload || payload.ok !== true) throw new Error(payload?.message || `HTTP ${response.status}`);
          return payload;
        }

        /**
         * 读一张本地图片并压到长边 1280 以内。
         * 原图往往几 MB，直接上传既慢又容易顶到宿主上限；这里先在 canvas 里缩一次，
         * 缩不动（解码失败）就退回原始 data URL，让宿主去判断。
         */
        async function readImageFile(file, maxEdge = IMAGE_MAX_EDGE) {
          const raw = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(new Error('读取图片失败'));
            reader.readAsDataURL(file);
          });
          if (raw.length < 900000) return raw;
          try {
            const bitmap = await createImageBitmap(file);
            const scale = Math.min(1, maxEdge / Math.max(bitmap.width || 1, bitmap.height || 1));
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round((bitmap.width || 1) * scale));
            canvas.height = Math.max(1, Math.round((bitmap.height || 1) * scale));
            const context = canvas.getContext('2d');
            if (!context) throw new Error('no 2d context');
            context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
            bitmap.close?.();
            return canvas.toDataURL('image/jpeg', 0.86);
          } catch {
            return raw;
          }
        }

        /**
         * 把远程图链（参考库的深度图/白模）抓成 data URL。
         * 生图后端要的是内联 base64，不能让它自己回源——那既慢又容易被上游网关拦。
         * 跨域失败就返回空串，调用方跳过这张，不阻断整次生成。
         */
        async function remoteImageToDataUrl(url, maxEdge) {
          try {
            const response = await fetch(url, { mode: 'cors' });
            if (!response.ok) return '';
            const blob = await response.blob();
            if (!blob.type.startsWith('image/')) return '';
            const file = new File([blob], 'ref.webp', { type: blob.type });
            return await readImageFile(file, maxEdge);
          } catch {
            return '';
          }
        }

        function readStore() {
          try {
            const raw = localStorage.getItem(STORE_KEY);
            const value = raw ? JSON.parse(raw) : {};
            return value && typeof value === 'object' ? value : {};
          } catch {
            return {};
          }
        }

        function writeStore(patch) {
          try {
            localStorage.setItem(STORE_KEY, JSON.stringify({ ...readStore(), ...patch }));
          } catch {
            /* storage is best-effort */
          }
        }

        function useCopy() {
          const [copied, setCopied] = useState('');
          const timer = useRef(0);
          const copy = useCallback((text, tag = 'main') => {
            const value = String(text ?? '');
            if (!value) return;
            const done = () => {
              setCopied(tag);
              clearTimeout(timer.current);
              timer.current = setTimeout(() => setCopied(''), 1400);
            };
            if (navigator.clipboard?.writeText) {
              navigator.clipboard.writeText(value).then(done).catch(() => fallback(value, done));
            } else {
              fallback(value, done);
            }
          }, []);
          useEffect(() => () => clearTimeout(timer.current), []);
          return [copied, copy];
        }

        function fallback(value, done) {
          try {
            const area = document.createElement('textarea');
            area.value = value;
            area.style.position = 'fixed';
            area.style.opacity = '0';
            document.body.appendChild(area);
            area.select();
            document.execCommand('copy');
            document.body.removeChild(area);
            done();
          } catch {
            /* clipboard is unavailable; the user can still select the text */
          }
        }

        function timeLabel(value) {
          try {
            const date = new Date(value);
            const pad = (n) => String(n).padStart(2, '0');
            return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
          } catch {
            return '';
          }
        }

        function Panel({ onClose, wide, embedded }) {
          useSyncExternalStore(
            useCallback((listener) => ctx.locale.subscribe(listener), []),
            () => ctx.locale.getSnapshot().revision,
          );
          const t = ctx.locale.bind(NS);
          // 404 只可能意味着宿主还是旧构建：面板能随刷新更新，宿主半要重启进程。
          const explain = (failure) => {
            const message = failure?.message || String(failure);
            return message === HOST_STALE ? t('hostStale') : message;
          };
          const panelRef = useRef(null);

          const stored = useMemo(readStore, []);
          const [catalog, setCatalog] = useState(FALLBACK);
          const [groups, setGroups] = useState([]);
          const [catalogLoading, setCatalogLoading] = useState(true);
          const [catalogError, setCatalogError] = useState('');

          const [provider, setProvider] = useState(typeof stored.provider === 'string' ? stored.provider : '');
          const [model, setModel] = useState(typeof stored.model === 'string' ? stored.model : '');
          const [dialect, setDialect] = useState(stored.dialect || 'natural-en');
          const [style, setStyle] = useState(stored.style || 'auto');
          const [aspect, setAspect] = useState(stored.aspect || 'auto');
          const [language, setLanguage] = useState(stored.language || 'en');
          const [mode, setMode] = useState(stored.mode || 'create');
          const [candidates, setCandidates] = useState(Number(stored.candidates) || 1);

          const [idea, setIdea] = useState(typeof stored.idea === 'string' ? stored.idea : '');
          const [purpose, setPurpose] = useState(typeof stored.purpose === 'string' ? stored.purpose : '');
          const [mustInclude, setMustInclude] = useState(typeof stored.mustInclude === 'string' ? stored.mustInclude : '');
          const [mustAvoid, setMustAvoid] = useState(typeof stored.mustAvoid === 'string' ? stored.mustAvoid : '');
          const [styleHint, setStyleHint] = useState(typeof stored.styleHint === 'string' ? stored.styleHint : '');
          const [advanced, setAdvanced] = useState(false);
          // 参考库：选中项只保留展示用的轻量字段，提交时只发 {lib, id}。
          const [refs, setRefs] = useState(Array.isArray(stored.refs) ? stored.refs : []);
          const [refLib, setRefLib] = useState('auto');
          const [refQuery, setRefQuery] = useState('');
          const [refWorks, setRefWorks] = useState([]);
          // 服务端报的命中总数，用来显示「24 / 1439」并决定还要不要给「加载更多」。
          const [refTotal, setRefTotal] = useState(0);
          const [refLoading, setRefLoading] = useState(false);
          const [refError, setRefError] = useState('');
          // 种类维度：{pose:[{key,values}], costume:[...], portrait:[...]}，切库时按需拉取。
          const [refKinds, setRefKinds] = useState({});
          const [refFilters, setRefFilters] = useState({});
          // 哪个维度展开了全部取值（26 类动作、51 种发型默认折叠）。
          const [refKindsOpen, setRefKindsOpen] = useState({});

          const [result, setResult] = useState(null);
          const [editedPrompt, setEditedPrompt] = useState('');
          const [error, setError] = useState('');
          const [notice, setNotice] = useState('');
          const [running, setRunning] = useState(false);
          const [tab, setTab] = useState('breakdown');
          const [history, setHistory] = useState(Array.isArray(stored.history) ? stored.history.slice(0, HISTORY_LIMIT) : []);

          // 反推图片 / 差量修改 / 直接出图 三块的局部状态
          const [image, setImage] = useState(null);
          // 图生图的附加参考（最多 4 张）：主图放在 image 里，其余进这里。
          const [refShots, setRefShots] = useState([]);
          // 是否把参考库里勾选的姿势/服装图一起当作图像条件发过去。
          const [usePoseRefs, setUsePoseRefs] = useState(false);
          const [describing, setDescribing] = useState(false);
          const [dragOver, setDragOver] = useState(false);
          const [patchText, setPatchText] = useState('');
          const [patching, setPatching] = useState(false);
          const [preview, setPreview] = useState([]);
          const [previewError, setPreviewError] = useState('');
          const [generating, setGenerating] = useState(false);
          // 出图尺寸与清晰度：'auto' 时尺寸跟随结果的画面比例，清晰度交给渠道默认。
          const [imageSize, setImageSize] = useState(stored.imageSize || 'auto');
          const [imageQuality, setImageQuality] = useState(stored.imageQuality || 'auto');
          const [lightbox, setLightbox] = useState(null);
          // 大图的缩放状态：滚轮以指针为中心缩放，按住拖动平移，双击复位。
          const [zoom, setZoom] = useState({ scale: 1, x: 0, y: 0 });
          const lightboxRef = useRef(null);
          const dragRef = useRef(null);
          // 出图渠道/模型：来自本机 dsh-imagegen 的设置视图，没装插件时整块不显示。
          const [imageChannels, setImageChannels] = useState([]);
          const [imageChannelId, setImageChannelId] = useState(typeof stored.imageChannelId === 'string' ? stored.imageChannelId : '');
          const [imageModel, setImageModel] = useState(typeof stored.imageModel === 'string' ? stored.imageModel : '');
          const fileRef = useRef(null);
          const extraRef = useRef(null);
          const probeModelsRef = useRef(null);
          const [copied, copy] = useCopy();

          const mounted = useRef(true);
          const runIdRef = useRef('');
          const ideaRef = useRef(null);
          useEffect(() => {
            mounted.current = true;
            return () => {
              mounted.current = false;
            };
          }, []);

          // 大图的打开/关闭/缩放：lightbox 存图片对象，zoom 存 transform 三件。
          const openLightbox = (shot) => {
            setZoom({ scale: 1, x: 0, y: 0 });
            setLightbox(shot);
          };
          const closeLightbox = () => {
            setLightbox(null);
            setZoom({ scale: 1, x: 0, y: 0 });
          };
          const zoomBy = (factor) => {
            setZoom((prev) => {
              const scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prev.scale * factor));
              if (scale === prev.scale) return prev;
              const ratio = scale / prev.scale;
              return { scale, x: prev.x * ratio, y: prev.y * ratio };
            });
          };
          const startDrag = (event) => {
            if (event.button !== 0) return;
            dragRef.current = { px: event.clientX, py: event.clientY, x: zoom.x, y: zoom.y, moved: false };
            event.currentTarget.setPointerCapture?.(event.pointerId);
          };
          const moveDrag = (event) => {
            const drag = dragRef.current;
            if (!drag) return;
            const dx = event.clientX - drag.px;
            const dy = event.clientY - drag.py;
            if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
            setZoom((prev) => ({ scale: prev.scale, x: drag.x + dx, y: drag.y + dy }));
          };
          const endDrag = (event) => {
            const drag = dragRef.current;
            dragRef.current = null;
            event.currentTarget.releasePointerCapture?.(event.pointerId);
            // 没拖动就是一次点击，点图即关闭。
            if (drag && !drag.moved) closeLightbox();
          };

          // 嵌入主区时的关闭路径：layout.selectPanel(null) 把中央面板切回会话
          // （dsh-client-ui-layout/lib/client.js:468，传 null 即回到 Conversation）。
          const closePanel = () => {
            if (onClose) {
              onClose();
              return;
            }
            try {
              const layout = ctx.get ? ctx.get('layout') : undefined;
              if (layout && typeof layout.selectPanel === 'function') layout.selectPanel(null);
            } catch {
              /* 布局服务不在时不阻塞面板本身 */
            }
          };

          useEffect(() => {
            const onKey = (event) => {
              if (event.key === 'Escape') {
                event.stopPropagation();
                // 大图开着就先收大图，再按一次才关面板。
                if (lightbox) {
                  closeLightbox();
                  return;
                }
                closePanel();
              }
            };
            window.addEventListener('keydown', onKey, true);
            return () => window.removeEventListener('keydown', onKey, true);
          }, [onClose, lightbox]);

          // 滚轮缩放必须用非 passive 的原生监听，React 的 onWheel 无法 preventDefault。
          useEffect(() => {
            const node = lightboxRef.current;
            if (!lightbox || !node) return undefined;
            const onWheel = (event) => {
              event.preventDefault();
              const rect = node.getBoundingClientRect();
              const cx = event.clientX - rect.left - rect.width / 2;
              const cy = event.clientY - rect.top - rect.height / 2;
              setZoom((prev) => {
                const factor = event.deltaY < 0 ? 1.14 : 1 / 1.14;
                const scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prev.scale * factor));
                if (scale === prev.scale) return prev;
                // 让指针下的那一点在缩放前后保持不动。
                const ratio = scale / prev.scale;
                return { scale, x: cx - (cx - prev.x) * ratio, y: cy - (cy - prev.y) * ratio };
              });
            };
            node.addEventListener('wheel', onWheel, { passive: false });
            return () => node.removeEventListener('wheel', onWheel);
          }, [lightbox]);

          useEffect(() => {
            panelRef.current?.focus?.();
          }, []);

          useEffect(() => {
            let cancelled = false;
            setCatalogLoading(true);
            post('catalog', {})
              .then((payload) => {
                if (cancelled) return;
                if (payload.catalog) setCatalog(payload.catalog);
                setGroups(Array.isArray(payload.groups) ? payload.groups : []);
                const saved = payload.config || {};
                setProvider((current) => current || saved.provider || '');
                setModel((current) => current || saved.model || '');
                setCatalogError('');
              })
              .catch((failure) => {
                if (!cancelled) setCatalogError(failure.message || String(failure));
              })
              .finally(() => {
                if (!cancelled) setCatalogLoading(false);
              });
            return () => {
              cancelled = true;
            };
          }, []);

          useEffect(() => {
            writeStore({ provider, model, dialect, style, aspect, language, mode, candidates, idea, purpose, mustInclude, mustAvoid, styleHint, refs });
          }, [provider, model, dialect, style, aspect, language, mode, candidates, idea, purpose, mustInclude, mustAvoid, styleHint, refs]);

          const modelOptions = useMemo(() => {
            const flat = [];
            for (const group of groups) for (const item of group.models) flat.push({ provider: group.provider, groupName: group.name, ...item });
            return flat;
          }, [groups]);

          const modelReady = Boolean(provider && model);

          // 参考库检索：命中的条目带 CDN 图（姿势库是深度图），点一下进 selected，提交时只发 lib+id。
          // 一页 24 张，底部「加载更多」按 offset 续，总共能翻到多少由服务端的 total 决定。
          const REF_PAGE = 24;
          const searchRefs = useCallback(async (query, lib, filters, append) => {
            const at = append ? (Array.isArray(append) ? append.length : 0) : 0;
            if (!append) setRefWorks([]);
            setRefLoading(true);
            setRefError('');
            try {
              const payload = await post('gallery', {
                action: 'search',
                query: query || '',
                lib,
                limit: REF_PAGE,
                offset: at,
                filters: filters && Object.keys(filters).length > 0 ? filters : undefined,
              });
              if (payload && payload.ok === false) {
                setRefError(payload.message || t('galleryEmpty'));
                if (!append) setRefWorks([]);
                setRefTotal(0);
              } else {
                const batch = Array.isArray(payload?.works) ? payload.works : [];
                setRefWorks((previous) => {
                  if (!append) return batch;
                  const seen = new Set(previous.map((item) => `${item.lib}:${item.id}`));
                  return [...previous, ...batch.filter((item) => !seen.has(`${item.lib}:${item.id}`))];
                });
                setRefTotal(Number(payload?.total) || batch.length);
              }
            } catch (failure) {
              setRefError(explain(failure));
            } finally {
              setRefLoading(false);
            }
          }, [t]);

          // 拉某个库的种类清单（体系/角度/分类 之类）。服务端有内存缓存，切回来也不重复读盘。
          const loadKinds = useCallback(async (lib) => {
            if (!lib || lib === 'auto') return;
            try {
              const payload = await post('gallery', { action: 'kinds', lib });
              if (payload?.kinds?.[lib]) {
                const dims = payload.kinds[lib];
                setRefKinds((previous) => ({ ...previous, [lib]: dims }));
              }
            } catch {
              // 种类拉不到不影响搜索，静默降级
            }
          }, []);

          // 点种类：带上新筛选立刻重查。state 是异步的，所以本地先算好 next 再发请求。
          const applyFilter = useCallback((key, value) => {
            const next = { ...refFilters, [key]: value };
            setRefFilters(next);
            if (refLib !== 'auto') void searchRefs(refQuery, refLib, next);
          }, [refFilters, refLib, refQuery, searchRefs]);

          const switchLib = useCallback((key) => {
            setRefLib(key);
            setRefFilters({});
            setRefKindsOpen({});
            if (key !== 'auto') void loadKinds(key);
            void searchRefs(refQuery, key, {});
          }, [loadKinds, refQuery, searchRefs]);

          const toggleRef = useCallback((work) => {
            setRefs((previous) => {
              const exists = previous.some((item) => item.lib === work.lib && item.id === work.id);
              if (exists) return previous.filter((item) => !(item.lib === work.lib && item.id === work.id));
              return [
                ...previous,
                { lib: work.lib, id: work.id, name: work.name, tags: work.tags || [], thumbUrl: work.thumbUrl, imageUrl: work.imageUrl },
              ].slice(0, 6);
            });
          }, []);

          // 参考库面板：搜索 → 缩略图网格 → 选中的条目挂在输入框下面。
          // 种类维度只在选定单个库时出现（auto 混三库没有统一维度）。
          // 全部用胶囊按钮而不是原生 select：原生下拉的选项列表由系统绘制，
          // 深色主题下会变成白底浅字，改 CSS 也压不住。
          const kindDims = refLib === 'auto' ? [] : refKinds[refLib] || [];
          const kindsPending = refLib !== 'auto' && !refKinds[refLib];
          const kindsBox = kindDims.length > 0
            ? h(
                'div',
                { className: 'dpf-gallery-kinds' },
                kindDims.map((dim) => {
                  const active = refFilters[dim.key] || '';
                  const open = refKindsOpen[dim.key] === true;
                  const CHIP_LIMIT = 8;
                  // 选中的那个永远排在最前，折叠时也不会被藏起来。
                  const ordered = active
                    ? [...dim.values.filter((item) => item.value === active), ...dim.values.filter((item) => item.value !== active)]
                    : dim.values;
                  const shown = open ? ordered : ordered.slice(0, CHIP_LIMIT);
                  const rest = ordered.length - shown.length;
                  return h(
                    'div',
                    { className: 'dpf-kinds-row', key: dim.key },
                    h('span', { className: 'dpf-kinds-label' }, dim.key),
                    h(
                      'div',
                      { className: 'dpf-kinds-values' },
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'dpf-chip',
                          'data-on': active ? undefined : '1',
                          onClick: () => applyFilter(dim.key, ''),
                        },
                        `${t('galleryAny')} ${dim.values.reduce((sum, item) => sum + item.count, 0)}`,
                      ),
                      shown.map((item) =>
                        h(
                          'button',
                          {
                            key: item.value,
                            type: 'button',
                            className: 'dpf-chip',
                            'data-on': active === item.value ? '1' : undefined,
                            onClick: () => applyFilter(dim.key, item.value),
                          },
                          `${item.value} ${item.count}`,
                        ),
                      ),
                      (rest > 0 || open) &&
                        h(
                          'button',
                          {
                            type: 'button',
                            className: 'dpf-chip dpf-chip-more',
                            onClick: () =>
                              setRefKindsOpen((previous) => ({ ...previous, [dim.key]: !open })),
                          },
                          open ? t('kindsLess') : `+${rest} ${t('kindsMore')}`,
                        ),
                    ),
                  );
                }),
              )
            : null;
          const galleryBox = h(
            'div',
            { className: 'dpf-gallery' },
            h(
              'div',
              { className: 'dpf-gallery-head' },
              h('span', { className: 'dpf-label', style: { margin: 0, flex: 1 } }, t('gallery')),
              refs.length > 0 && h('span', { className: 'dpf-gallery-count' }, `${refs.length}/6`),
            ),
            h('div', { className: 'dpf-gallery-hint' }, t('galleryHint')),
            h(
              'div',
              { className: 'dpf-gallery-search' },
              h('input', {
                className: 'dpf-input',
                value: refQuery,
                maxLength: 40,
                placeholder: t('gallerySearch'),
                onChange: (event) => setRefQuery(event.target.value),
                onKeyDown: (event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void searchRefs(refQuery, refLib, refFilters);
                  }
                },
              }),
              h(
                'button',
                { className: 'dpf-btn dpf-btn-small', type: 'button', disabled: refLoading, onClick: () => void searchRefs(refQuery, refLib, refFilters) },
                refLoading ? t('galleryLoading') : '搜索',
              ),
            ),
            h(
              'div',
              { className: 'dpf-gallery-libs' },
              [
                ['auto', t('galleryAll')],
                ['pose', '姿势'],
                ['costume', '服装'],
                ['portrait', '人像'],
              ].map(([key, label]) =>
                h(
                  'button',
                  {
                    key,
                    type: 'button',
                    className: 'dpf-chip',
                    'data-on': refLib === key ? '1' : undefined,
                    onClick: () => switchLib(key),
                  },
                  label,
                ),
              ),
            ),
            kindsPending && h('div', { className: 'dpf-gallery-note' }, `${t('galleryKinds')}…`),
            kindsBox,
            refError && h('div', { className: 'dpf-gallery-note dpf-warn' }, refError),
            refWorks.length > 0 &&
              h(
                'div',
                { className: 'dpf-gallery-grid' },
                refWorks.map((work) =>
                  h(
                    'button',
                    {
                      key: `${work.lib}:${work.id}`,
                      type: 'button',
                      className: 'dpf-gallery-card',
                      'data-on': refs.some((item) => item.lib === work.lib && item.id === work.id) ? '1' : undefined,
                      title: `${work.name}\n${(work.tags || []).join('・')}`,
                      onClick: () => toggleRef(work),
                    },
                    h('img', { src: work.thumbUrl, alt: '', loading: 'lazy' }),
                    h('span', { className: 'dpf-gallery-name' }, work.name),
                  ),
                ),
              ),
            // 一页只来 24 张，超过这个数的类别不会凭空补齐：明示总数，再给一个续页按钮。
            refTotal > 0 &&
              h(
                'div',
                { className: 'dpf-gallery-more' },
                h(
                  'span',
                  { className: 'dpf-gallery-note', style: { margin: 0 } },
                  `${refWorks.length} / ${refTotal}`,
                ),
                refWorks.length < refTotal &&
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dpf-chip',
                      disabled: refLoading,
                      onClick: () => searchRefs(refQuery, refLib, refFilters, refWorks),
                    },
                    refLoading ? `${t('galleryLoading')}` : `${t('galleryMore')} ${Math.min(24, refTotal - refWorks.length)}`,
                  ),
              ),
            refs.length > 0 &&
              h(
                'div',
                { className: 'dpf-selected' },
                h('span', { className: 'dpf-label', style: { margin: 0 } }, t('gallerySelected')),
                refs.map((item) =>
                  h(
                    'span',
                    { key: `${item.lib}:${item.id}`, className: 'dpf-selected-item' },
                    h('img', { src: item.thumbUrl, alt: '' }),
                    h('span', null, item.name),
                    h('button', { type: 'button', className: 'dpf-selected-x', onClick: () => toggleRef(item) }, '×'),
                  ),
                ),
              ),
          );

          const run = useCallback(async () => {
            if (running) return;
            if (!idea.trim()) {
              setError(t('needIdea'));
              return;
            }
            if (!modelReady) {
              setError(t('needModel'));
              return;
            }
            setError('');
            setNotice('');
            setRunning(true);
            const runId = globalThis.crypto?.randomUUID?.() || `run-${Date.now()}-${Math.random().toString(16).slice(2)}`;
            runIdRef.current = runId;
            try {
              const payload = await post('optimize', {
                runId,
                provider,
                model,
                idea: idea.trim(),
                dialect,
                style,
                aspect,
                language,
                mode,
                candidates,
                purpose,
                mustInclude,
                mustAvoid,
                styleHint,
                refs: refs.map((item) => ({ lib: item.lib, id: item.id })),
                remember: true,
              });
              if (!mounted.current || runIdRef.current !== runId) return;
              setResult(payload);
              setEditedPrompt(payload.prompt || '');
              setTab('breakdown');
              setPreview([]);
              setPreviewError('');
              const entry = {
                id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
                at: payload.createdAt || Date.now(),
                title: payload.title || t('untitled'),
                prompt: payload.prompt || '',
                negative: payload.negative || '',
                fields: payload.fields || {},
                variants: payload.variants || [],
                notes: payload.notes || '',
                dialect: payload.dialect,
                style: payload.style,
                aspect: payload.params?.aspect_ratio || '',
                model: payload.model || '',
                idea: payload.idea || '',
                elapsedMs: payload.elapsedMs || 0,
              };
              setHistory((previous) => {
                const next = [entry, ...previous].slice(0, HISTORY_LIMIT);
                writeStore({ history: next });
                return next;
              });
            } catch (failure) {
              if (!mounted.current || runIdRef.current !== runId) return;
              setError(explain(failure));
            } finally {
              if (mounted.current && runIdRef.current === runId) {
                setRunning(false);
                runIdRef.current = '';
              }
            }
          }, [running, idea, modelReady, provider, model, dialect, style, aspect, language, mode, candidates, purpose, mustInclude, mustAvoid, styleHint, refs, t]);

          const stop = useCallback(() => {
            const runId = runIdRef.current;
            if (!runId) return;
            runIdRef.current = '';
            void post('stop', { runId }).catch(() => undefined);
            setRunning(false);
            setNotice(t('stopDone'));
          }, [t]);

          const onKeyDownIdea = useCallback(
            (event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault();
                void run();
              }
            },
            [run],
          );

          // 把一次结果塞进历史，反推与改一句共用
          const remember = useCallback((payload) => {
            const entry = {
              id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
              at: payload.createdAt || Date.now(),
              title: payload.title || t('untitled'),
              prompt: payload.prompt || '',
              negative: payload.negative || '',
              fields: payload.fields || {},
              variants: payload.variants || [],
              notes: payload.notes || '',
              dialect: payload.dialect,
              style: payload.style,
              aspect: payload.params?.aspect_ratio || '',
              model: payload.model || '',
              idea: payload.idea || '',
              elapsedMs: payload.elapsedMs || 0,
            };
            setHistory((previous) => {
              const next = [entry, ...previous].slice(0, HISTORY_LIMIT);
              writeStore({ history: next });
              return next;
            });
          }, [t]);

          const newRunId = () => globalThis.crypto?.randomUUID?.() || `run-${Date.now()}-${Math.random().toString(16).slice(2)}`;

          // ── 图 → 词 ─────────────────────────────────────────────────
          const describeFile = useCallback(
            async (file) => {
              if (!file || describing) return;
              if (!file.type || !file.type.startsWith('image/')) {
                setError(t('previewFailed'));
                return;
              }
              // 图先落地：即便没配对话模型，这张图也能直接拿来图生图，
              // 所以「没选模型」只是跳过读图，不该把导入也一起拦掉。
              if (!modelReady) {
                try {
                  const data = await readImageFile(file);
                  const shot = { data, name: file.name || 'reference.png' };
                  imageRef.current = shot;
                  setImage(shot);
                  setNotice(t('shotLoadedNoModel'));
                } catch {
                  setError(t('previewFailed'));
                }
                return;
              }
              setError('');
              setNotice('');
              setDescribing(true);
              const runId = newRunId();
              runIdRef.current = runId;
              try {
                const data = await readImageFile(file);
                const shot = { data, name: file.name || 'reference.png' };
                imageRef.current = shot;
                setImage(shot);
                const mediaType = (/^data:([^;]+);/.exec(data) || [])[1] || file.type || 'image/png';
                const payload = await post('describe', {
                  runId,
                  provider,
                  model,
                  dialect,
                  style,
                  aspect,
                  language,
                  idea: idea.trim(),
                  image: { data, mediaType, name: file.name || '' },
                });
                if (!mounted.current || runIdRef.current !== runId) return;
                setResult(payload);
                setEditedPrompt(payload.prompt || '');
                setTab('breakdown');
                setPreview([]);
                setPreviewError('');
                remember(payload);
                setNotice(t('describeDone'));
              } catch (failure) {
                if (!mounted.current || runIdRef.current !== runId) return;
                setError(explain(failure));
              } finally {
                if (mounted.current && runIdRef.current === runId) {
                  setDescribing(false);
                  runIdRef.current = '';
                }
              }
            },
            [describing, modelReady, provider, model, dialect, style, aspect, language, idea, t, remember],
          );

          const pickImage = useCallback(() => {
            fileRef.current?.click?.();
          }, []);

          /**
           * 统一的图片入口：主图槽空着就填主图，已经有主图就进附加参考（最多 4 张）。
           * 生图后端只接受一张 image + 最多四张 images，所以这里先按这个上限收。
           */
          const imageRef = useRef(null);
          const loadShot = useCallback(async (file, forceExtra) => {
            if (!file || !String(file.type || '').startsWith('image/')) return;
            let data = '';
            try {
              data = await readImageFile(file);
            } catch {
              setError(t('previewFailed'));
              return;
            }
            if (!data) return;
            const shot = { data, name: file.name || 'reference.png' };
            if (!forceExtra && !imageRef.current) {
              imageRef.current = shot;
              setImage(shot);
              return;
            }
            setRefShots((previous) => (previous.length >= 4 ? previous : [...previous, shot]));
          }, [t]);

          // 记一份 image 的实时值，避免粘贴回调拿到上一帧的闭包。
          useEffect(() => {
            imageRef.current = image;
          }, [image]);

          // 面板打开时，直接 Ctrl+V 就能把剪贴板里的图塞进来——这是最顺手的一条路。
          useEffect(() => {
            const onPaste = (event) => {
              const items = event.clipboardData?.items;
              if (!items) return;
              for (const item of items) {
                if (item.kind !== 'file' || !String(item.type || '').startsWith('image/')) continue;
                const file = item.getAsFile();
                if (!file) continue;
                event.preventDefault();
                void loadShot(file);
                return;
              }
            };
            window.addEventListener('paste', onPaste);
            return () => window.removeEventListener('paste', onPaste);
          }, [loadShot]);

          const removeRefShot = useCallback((index) => {
            setRefShots((previous) => previous.filter((_, at) => at !== index));
          }, []);

          // ── 词 → 改词 ───────────────────────────────────────────────
          const applyPatch = useCallback(async () => {
            if (!result || patching) return;
            const instruction = patchText.trim();
            if (!instruction) {
              setError(t('needInstruction'));
              return;
            }
            if (!modelReady) {
              setError(t('needModel'));
              return;
            }
            setError('');
            setNotice('');
            setPatching(true);
            const runId = newRunId();
            runIdRef.current = runId;
            const base = editedPrompt || result.prompt || '';
            try {
              const payload = await post('patch', {
                runId,
                provider,
                model,
                instruction,
                prompt: base,
                fields: result.fields,
                negative: result.negative,
                dialect: result.dialect || dialect,
                aspect: result.params?.aspect_ratio || aspect,
                language: result.language || language,
              });
              if (!mounted.current || runIdRef.current !== runId) return;
              setResult(payload);
              setEditedPrompt(payload.prompt || '');
              setPatchText('');
              setPreview([]);
              setPreviewError('');
              remember(payload);
            } catch (failure) {
              if (!mounted.current || runIdRef.current !== runId) return;
              setError(explain(failure));
            } finally {
              if (mounted.current && runIdRef.current === runId) {
                setPatching(false);
                runIdRef.current = '';
              }
            }
          }, [result, patching, patchText, modelReady, provider, model, editedPrompt, dialect, aspect, language, t, remember]);

          // ── 词 → 图（走本机 dsh-imagegen 的代理接口）─────────────────
          // 出图渠道与模型：读本机 dsh-imagegen 的设置视图，只取渠道名与模型名。
          useEffect(() => {
            let alive = true;
            (async () => {
              try {
                const response = await fetch(IMAGE_CHANNELS_API, {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: '{}',
                });
                if (!response.ok) return;
                const payload = await response.json().catch(() => null);
                const namespaces = payload?.value?.namespaces;
                const view = Array.isArray(namespaces) ? namespaces[0]?.value : null;
                const list = Array.isArray(view?.channels) ? view.channels : [];
                const normalized = list
                  .map((channel) => ({
                    id: String(channel?.id ?? ''),
                    name: String(channel?.name ?? channel?.label ?? channel?.id ?? ''),
                    models: (Array.isArray(channel?.models) ? channel.models : [])
                      .map((entry) => (typeof entry === 'string' ? entry.trim() : String(entry?.id ?? entry?.name ?? '').trim()))
                      .filter(Boolean),
                  }))
                  .filter((channel) => channel.id !== '' && channel.models.length > 0);
                if (!alive || normalized.length === 0) return;
                const saved = readStore();
                const channel = normalized.find((item) => item.id === saved.imageChannelId) ?? normalized[0];
                const wanted = typeof saved.imageModel === 'string' ? saved.imageModel : '';
                setImageChannels(normalized);
                setImageChannelId(channel.id);
                setImageModel(channel.models.includes(wanted) ? wanted : channel.models[0]);
                void probeModelsRef.current(channel.id);
              } catch {
                /* 没装 imagegen，或当前会话读不到设置：这一块就不显示 */
              }
            })();
            return () => {
              alive = false;
            };
          }, []);

          const activeChannel = imageChannels.find((item) => item.id === imageChannelId) ?? imageChannels[0] ?? null;
          const imageModelOptions = activeChannel ? activeChannel.models : [];
          const effectiveImageModel = imageModelOptions.includes(imageModel) ? imageModel : imageModelOptions[0] ?? '';

          // 设置里的 models 是用户配置的目录，上游未必都认；探一次真实可用列表再校正。
          const probeModels = async (channelId) => {
            try {
              const response = await fetch(IMAGE_MODELS_API, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ channelId }),
              });
              if (!response.ok) return;
              const payload = await response.json().catch(() => null);
              const models = (Array.isArray(payload?.models) ? payload.models : [])
                .map((item) => (typeof item === 'string' ? item.trim() : String(item?.id ?? item?.name ?? '').trim()))
                .filter(Boolean);
              if (payload?.ok !== true || models.length === 0) return;
              setImageChannels((prev) => prev.map((item) => (item.id === channelId ? { ...item, models } : item)));
              setImageModel((current) => (models.includes(current) ? current : models[0]));
            } catch {
              /* 探测失败不影响出图，沿用设置里的目录 */
            }
          };

          const pickImageChannel = (nextId) => {
            const next = imageChannels.find((item) => item.id === nextId);
            const nextModel = next?.models?.[0] ?? '';
            setImageChannelId(nextId);
            setImageModel(nextModel);
            writeStore({ imageChannelId: nextId, imageModel: nextModel });
            void probeModels(nextId);
          };
          // 首次挂载的 effect 早于下面这行取值，用 ref 拿最新实现避免闭包取不到。
          probeModelsRef.current = probeModels;

          const pickImageModel = (nextModel) => {
            setImageModel(nextModel);
            writeStore({ imageModel: nextModel });
          };

          const pickImageSize = (nextSize) => {
            setImageSize(nextSize);
            writeStore({ imageSize: nextSize });
          };

          const pickImageQuality = (nextQuality) => {
            setImageQuality(nextQuality);
            writeStore({ imageQuality: nextQuality });
          };

          // 预览图另存为：data URL 直接触发浏览器下载，不经过宿主。
          const saveShot = (shot, index) => {
            try {
              const ext = shot.mime.includes('jpeg') ? 'jpg' : shot.mime.includes('webp') ? 'webp' : 'png';
              const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
              const link = document.createElement('a');
              link.href = `data:${shot.mime};base64,${shot.b64}`;
              link.download = `prompt-forge-${stamp}-${index + 1}.${ext}`;
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);
            } catch {
              /* 下载被拦截时预览仍可右键另存 */
            }
          };

          const renderOne = useCallback(async () => {
            const prompt = (editedPrompt || result?.prompt || '').trim();
            if (!prompt || generating) return;
            setGenerating(true);
            setPreviewError('');
            try {
              // 图生图：导入的主图作为 image，附加参考与姿势图作为 images（上限四张）。
              const primary = imageRef.current?.data || '';
              const gallery = refShots.map((shot) => shot?.data).filter(Boolean).slice(0, 4);
              if (usePoseRefs && refs.length > 0 && gallery.length < 4) {
                for (const item of refs) {
                  if (gallery.length >= 4) break;
                  if (!item?.imageUrl) continue;
                  const data = await remoteImageToDataUrl(item.imageUrl, 768);
                  if (data) gallery.push(data);
                }
              }
              const response = await fetch(GENERATE_API, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                  mode: primary ? 'edit' : 'text',
                  prompt: primary ? `${EDIT_PREFIX[language] || EDIT_PREFIX.en}${prompt}` : prompt,
                  size:
                    imageSize !== 'auto'
                      ? imageSize
                      : result?.params?.aspect_ratio && result.params.aspect_ratio !== 'auto'
                        ? result.params.aspect_ratio
                        : 'auto',
                  quality: imageQuality,
                  n: 1,
                  ...(primary ? { image: primary } : {}),
                  ...(gallery.length > 0 ? { images: gallery } : {}),
                  ...(activeChannel ? { channelId: activeChannel.id } : {}),
                  ...(effectiveImageModel ? { model: effectiveImageModel } : {}),
                }),
              });
              const body = await response.json().catch(() => null);
              if (!response.ok) {
                if (response.status === 404) throw new Error(t('noImagegen'));
                throw new Error((body && body.message) || `HTTP ${response.status}`);
              }
              if (!body || body.ok === false) throw new Error((body && body.message) || t('previewFailed'));
              const shots = (Array.isArray(body.images) ? body.images : [])
                .filter((item) => item && typeof item.b64 === 'string' && item.b64)
                .map((item) => ({ b64: item.b64, mime: item.mime || 'image/png' }));
              if (shots.length === 0) throw new Error(t('previewFailed'));
              setPreview(shots);
            } catch (failure) {
              const message = failure?.message || String(failure);
              setPreviewError(/404|Failed to fetch|not found|NetworkError/i.test(message) ? t('noImagegen') : message);
            } finally {
              setGenerating(false);
            }
          }, [editedPrompt, result, generating, t, activeChannel, effectiveImageModel, imageSize, imageQuality, refShots, usePoseRefs, refs, language]);

          const onDropImage = useCallback(
            (event) => {
              event.preventDefault();
              setDragOver(false);
              const file = event.dataTransfer?.files?.[0];
              if (file) void describeFile(file);
            },
            [describeFile],
          );

          const restore = useCallback(
            (entry) => {
              setResult({
                ok: true,
                title: entry.title,
                prompt: entry.prompt,
                negative: entry.negative,
                fields: entry.fields,
                variants: entry.variants,
                notes: entry.notes,
                params: { aspect_ratio: entry.aspect },
                dialect: entry.dialect,
                style: entry.style,
                model: entry.model,
                elapsedMs: entry.elapsedMs,
                idea: entry.idea,
                createdAt: entry.at,
              });
              setEditedPrompt(entry.prompt || '');
              setTab('breakdown');
              setError('');
              setPreview([]);
              setPreviewError('');
            },
            [],
          );

          const reuse = useCallback(() => {
            if (!result) return;
            setIdea(result.prompt || '');
            setMode('refine');
          }, [result]);

          const clearHistory = useCallback(() => {
            setHistory([]);
            writeStore({ history: [] });
          }, []);

          const submitOnEnter = useCallback(
            (event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void run();
              }
            },
            [run],
          );

          const dialectLabel = (key) => catalog.dialects?.find((item) => item.key === key)?.label || key || '—';
          const styleLabel = (key) => catalog.styles?.find((item) => item.key === key)?.label || key || '—';
          const modeLabel = (key) => catalog.modes?.find((item) => item.key === key)?.label || key || '—';
          const languageLabel = (key) => catalog.languages?.find((item) => item.key === key)?.label || key || '—';

          const fields = catalog.fields || FALLBACK.fields;
          const fieldRows = result ? fields.filter((field) => result.fields?.[field.key]) : [];

          const pickModel = (value) => {
            const found = modelOptions.find((item) => `${item.provider}\u0000${item.id}` === value);
            if (!found) {
              setProvider('');
              setModel('');
              return;
            }
            setProvider(found.provider);
            setModel(found.id);
          };

          return h(
            'div',
            embedded
              ? { className: 'dpf-embed' }
              : {
                  className: 'dpf-backdrop',
                  onMouseDown: (event) => {
                    if (event.target === event.currentTarget) onClose();
                  },
                },
            h(
              'section',
              { className: 'dpf-panel', ref: panelRef, tabIndex: -1, role: 'dialog', 'aria-modal': !embedded, 'aria-label': t('meta.title') },
              h('style', null, css),
              h(
                'header',
                { className: 'dpf-head' },
                icon,
                h('div', null, h('div', { className: 'dpf-title' }, t('meta.title')), h('div', { className: 'dpf-subtitle' }, t('subtitle'))),
                h('div', { className: 'dpf-spacer' }),
                h(
                  'div',
                  { className: 'dpf-picker' },
                  catalogLoading
                    ? h('span', { className: 'dpf-pill' }, t('loadingCatalog'))
                    : h(
                        'select',
                        {
                          className: 'dpf-select',
                          style: { width: 'auto', maxWidth: 320 },
                          value: model ? `${provider}\u0000${model}` : '',
                          title: t('model'),
                          onChange: (event) => pickModel(event.target.value),
                        },
                        h('option', { value: '' }, modelOptions.length ? t('chooseModel') : t('catalogEmpty')),
                        groups
                          .filter((group) => group.models.length)
                          .map((group) =>
                            h(
                              'optgroup',
                              { key: group.provider, label: group.name },
                              group.models.map((item) => h('option', { key: `${group.provider}\u0000${item.id}`, value: `${group.provider}\u0000${item.id}` }, item.name)),
                            ),
                          ),
                      ),
                  h('button', { className: 'dpf-icon', type: 'button', title: t('close'), onClick: closePanel }, '×'),
                ),
              ),
              h(
                'div',
                { className: 'dpf-body' },
                h(
                  'div',
                  { className: 'dpf-left' },
                  h(
                    'div',
                    { className: 'dpf-section' },
                    h(
                      'div',
                      { className: 'dpf-section-head' },
                      h('span', { className: 'dpf-step' }, '01'),
                      h('span', { className: 'dpf-section-title' }, t('idea')),
                      h('span', { className: 'dpf-section-note' }, `${idea.length} ${t('ideaCount')}`),
                      idea.length > 0 &&
                        h(
                          'button',
                          {
                            className: 'dpf-btn dpf-btn-ghost dpf-btn-small dpf-clear',
                            type: 'button',
                            title: t('clearIdeaHint'),
                            onClick: () => {
                              setIdea('');
                              setError('');
                              ideaRef.current?.focus?.();
                            },
                          },
                          t('clear'),
                        ),
                    ),
                    h('textarea', {
                      className: 'dpf-textarea dpf-idea',
                      ref: ideaRef,
                      value: idea,
                      maxLength: 6000,
                      placeholder: t('ideaPlaceholder'),
                      onKeyDown: onKeyDownIdea,
                      onChange: (event) => setIdea(event.target.value),
                    }),
                    h('input', {
                      type: 'file',
                      accept: 'image/*',
                      ref: fileRef,
                      style: { display: 'none' },
                      onChange: (event) => {
                        const file = event.target.files && event.target.files[0];
                        event.target.value = '';
                        if (file) void describeFile(file);
                      },
                    }),
                    h('input', {
                      type: 'file',
                      accept: 'image/*',
                      multiple: true,
                      ref: extraRef,
                      style: { display: 'none' },
                      onChange: (event) => {
                        const files = Array.from(event.target.files || []);
                        event.target.value = '';
                        for (const file of files.slice(0, 4)) void loadShot(file, true);
                      },
                    }),
                    image
                      ? h(
                          'div',
                          { className: 'dpf-thumb' },
                          h('img', { src: image.data, alt: '' }),
                          h(
                            'div',
                            { className: 'dpf-thumb-main' },
                            h('div', { className: 'dpf-thumb-title' }, image.name || t('imageReady')),
                            h('div', { className: 'dpf-thumb-sub' }, describing ? t('describing') : t('describeDone')),
                          ),
                          h('button', { className: 'dpf-btn dpf-btn-ghost dpf-btn-small', type: 'button', onClick: () => setImage(null) }, t('clear')),
                        )
                      : h(
                          'div',
                          {
                            className: 'dpf-drop',
                            'data-over': dragOver ? '1' : undefined,
                            role: 'button',
                            tabIndex: 0,
                            title: t('describeHint'),
                            onClick: pickImage,
                            onKeyDown: (event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                pickImage();
                              }
                            },
                            onDragOver: (event) => {
                              event.preventDefault();
                              setDragOver(true);
                            },
                            onDragLeave: () => setDragOver(false),
                            onDrop: onDropImage,
                          },
                          describing ? t('describing') : dragOver ? t('imageListening') : t('dropImage'),
                        ),
                    // 附加参考槽：主图之外最多再塞四张，生成时一起作为图像条件。
                    h(
                      'div',
                      { className: 'dpf-refshots' },
                      h(
                        'div',
                        { className: 'dpf-refshots-row' },
                        refShots.map((shot, index) =>
                          h(
                            'div',
                            { className: 'dpf-refshot', key: `${index}-${shot.name || ''}` },
                            h('img', { src: shot.data, alt: '' }),
                            h(
                              'button',
                              { type: 'button', className: 'dpf-refshot-x', onClick: () => removeRefShot(index), title: t('clear') },
                              '×',
                            ),
                          ),
                        ),
                        refShots.length < 4 &&
                          h(
                            'button',
                            {
                              type: 'button',
                              className: 'dpf-refshot-add',
                              title: t('shotAdd'),
                              onClick: () => extraRef.current?.click?.(),
                              onDragOver: (event) => {
                                event.preventDefault();
                                setDragOver(true);
                              },
                              onDragLeave: () => setDragOver(false),
                              onDrop: (event) => {
                                event.preventDefault();
                                setDragOver(false);
                                const file = event.dataTransfer?.files?.[0];
                                if (file) void loadShot(file, true);
                              },
                            },
                            '+',
                          ),
                      ),
                      h('div', { className: 'dpf-refshots-hint' }, t('shotHint')),
                      refs.length > 0 &&
                        h(
                          'label',
                          { className: 'dpf-check' },
                          h('input', {
                            type: 'checkbox',
                            checked: usePoseRefs,
                            onChange: (event) => setUsePoseRefs(event.target.checked),
                          }),
                          h('span', null, `${t('usePoseRefs')}（${refs.length}）`),
                        ),
                    ),
                    galleryBox,
                  ),
                  h(
                    'div',
                    { className: 'dpf-section' },
                    h('div', { className: 'dpf-section-head' }, h('span', { className: 'dpf-step' }, '02'), h('span', { className: 'dpf-section-title' }, t('target'))),
                    h(
                      'div',
                      { style: { marginBottom: 8 } },
                      h('label', { className: 'dpf-label' }, t('dialect')),
                      h(
                        'select',
                        { className: 'dpf-select', value: dialect, onChange: (event) => setDialect(event.target.value) },
                        (catalog.dialects || FALLBACK.dialects).map((item) => h('option', { key: item.key, value: item.key }, item.label)),
                      ),
                    ),
                    h(
                      'div',
                      { style: { marginBottom: 8 } },
                      h('label', { className: 'dpf-label' }, t('style')),
                      h(
                        'select',
                        { className: 'dpf-select', value: style, onChange: (event) => setStyle(event.target.value) },
                        (catalog.styles || FALLBACK.styles).map((item) => h('option', { key: item.key, value: item.key }, item.label)),
                      ),
                    ),
                    style === 'custom' &&
                      h(
                        'div',
                        { style: { marginBottom: 8 } },
                        h('label', { className: 'dpf-label' }, t('styleHint')),
                        h('textarea', {
                          className: 'dpf-textarea',
                          style: { minHeight: 64 },
                          value: styleHint,
                          maxLength: 600,
                          placeholder: t('styleHintPlaceholder'),
                          onChange: (event) => setStyleHint(event.target.value),
                        }),
                      ),
                    h(
                      'div',
                      { className: 'dpf-grid3' },
                      h(
                        'div',
                        null,
                        h('label', { className: 'dpf-label' }, t('aspect')),
                        h(
                          'select',
                          { className: 'dpf-select', value: aspect, onChange: (event) => setAspect(event.target.value) },
                          (catalog.aspects || FALLBACK.aspects).map((item) => h('option', { key: item, value: item }, item === 'auto' ? '自动' : item)),
                        ),
                      ),
                      h(
                        'div',
                        null,
                        h('label', { className: 'dpf-label' }, t('language')),
                        h(
                          'select',
                          { className: 'dpf-select', value: language, onChange: (event) => setLanguage(event.target.value) },
                          (catalog.languages || FALLBACK.languages).map((item) => h('option', { key: item.key, value: item.key }, item.label)),
                        ),
                      ),
                      h(
                        'div',
                        null,
                        h('label', { className: 'dpf-label' }, t('mode')),
                        h(
                          'select',
                          { className: 'dpf-select', value: mode, onChange: (event) => setMode(event.target.value) },
                          (catalog.modes || FALLBACK.modes).map((item) => h('option', { key: item.key, value: item.key }, item.label)),
                        ),
                      ),
                    ),
                    h(
                      'div',
                      { style: { marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 } },
                      h('label', { className: 'dpf-label', style: { margin: 0, flex: 1 } }, t('candidates')),
                      h(
                        'select',
                        { className: 'dpf-select', style: { width: 84 }, value: candidates, onChange: (event) => setCandidates(Number(event.target.value)) },
                        [1, 2, 3].map((value) => h('option', { key: value, value }, String(value))),
                      ),
                    ),
                    imageChannels.length > 0 &&
                      h(
                        'div',
                        { className: 'dpf-grid2', style: { marginTop: 8 }, title: t('imageModelHint') },
                        h(
                          'div',
                          null,
                          h('label', { className: 'dpf-label' }, t('imageChannel')),
                          h(
                            'select',
                            {
                              className: 'dpf-select',
                              value: activeChannel ? activeChannel.id : '',
                              onChange: (event) => pickImageChannel(event.target.value),
                            },
                            imageChannels.map((item) => h('option', { key: item.id, value: item.id }, item.name)),
                          ),
                        ),
                        h(
                          'div',
                          null,
                          h('label', { className: 'dpf-label' }, t('imageModel')),
                          h(
                            'select',
                            {
                              className: 'dpf-select',
                              value: effectiveImageModel,
                              onChange: (event) => pickImageModel(event.target.value),
                            },
                            imageModelOptions.map((item) => h('option', { key: item, value: item }, item)),
                          ),
                        ),
                      ),
                    imageChannels.length > 0 &&
                      h(
                        'div',
                        { className: 'dpf-grid2', style: { marginTop: 8 } },
                        h(
                          'div',
                          null,
                          h('label', { className: 'dpf-label' }, t('imageSize')),
                          h(
                            'select',
                            {
                              className: 'dpf-select',
                              value: imageSize,
                              onChange: (event) => pickImageSize(event.target.value),
                            },
                            IMAGE_SIZES.map((value) =>
                              h('option', { key: value, value }, value === 'auto' ? t('sizeAuto') : value),
                            ),
                          ),
                        ),
                        h(
                          'div',
                          null,
                          h('label', { className: 'dpf-label' }, t('imageQuality')),
                          h(
                            'select',
                            {
                              className: 'dpf-select',
                              value: imageQuality,
                              onChange: (event) => pickImageQuality(event.target.value),
                            },
                            IMAGE_QUALITIES.map((value) =>
                              h('option', { key: value, value }, value === 'auto' ? t('qualityAuto') : value.toUpperCase()),
                            ),
                          ),
                        ),
                      ),
                  ),
                  h(
                    'div',
                    { className: 'dpf-section' },
                    h(
                      'button',
                      {
                        className: 'dpf-btn dpf-btn-ghost',
                        type: 'button',
                        onClick: () => setAdvanced((value) => !value),
                        style: { padding: '4px 0', marginBottom: advanced ? 8 : 0 },
                      },
                      h('span', { style: { width: 10, display: 'inline-block' } }, advanced ? '▾' : '▸'),
                      h('span', { className: 'dpf-section-title' }, t('advanced')),
                    ),
                    advanced &&
                      h(
                        'div',
                        { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
                        h(
                          'div',
                          null,
                          h('label', { className: 'dpf-label' }, t('purpose')),
                          h('input', { className: 'dpf-input', value: purpose, maxLength: 200, placeholder: t('purposePlaceholder'), onChange: (event) => setPurpose(event.target.value), onKeyDown: submitOnEnter }),
                        ),
                        h(
                          'div',
                          null,
                          h('label', { className: 'dpf-label' }, t('mustInclude')),
                          h('textarea', { className: 'dpf-textarea', style: { minHeight: 56 }, value: mustInclude, maxLength: 400, placeholder: t('mustIncludePlaceholder'), onChange: (event) => setMustInclude(event.target.value) }),
                        ),
                        h(
                          'div',
                          null,
                          h('label', { className: 'dpf-label' }, t('mustAvoid')),
                          h('textarea', { className: 'dpf-textarea', style: { minHeight: 56 }, value: mustAvoid, maxLength: 400, placeholder: t('mustAvoidPlaceholder'), onChange: (event) => setMustAvoid(event.target.value) }),
                        ),
                      ),
                  ),
                  (error || notice) && h('div', { className: `dpf-error${notice ? ' dpf-warn' : ''}`, style: { marginBottom: 10 } }, error || notice),
                  h(
                    'div',
                    { className: 'dpf-actions' },
                    h(
                      'button',
                      { className: 'dpf-btn dpf-btn-primary', type: 'button', disabled: running || !idea.trim() || !modelReady, onClick: () => void run(), title: t('optimizeHint') },
                      running && h('span', { className: 'dpf-spin' }),
                      running ? '…' : t('optimize'),
                    ),
                    running && h('button', { className: 'dpf-btn', type: 'button', onClick: stop }, t('stop')),
                  ),
                  !modelReady && !catalogLoading && h('div', { className: 'dpf-error dpf-warn', style: { marginTop: 10 } }, catalogError || t('needModel')),
                ),
                h(
                  'div',
                  { className: 'dpf-right' },
                  !result &&
                    h(
                      'div',
                      { className: 'dpf-empty' },
                      emptyIcon,
                      h('div', { className: 'dpf-empty-title' }, t('resultEmpty')),
                      h('div', { className: 'dpf-empty-hint' }, t('resultEmptyHint')),
                    ),
                  result &&
                    h(
                      'div',
                      { className: 'dpf-card' },
                      h(
                        'div',
                        { className: 'dpf-card-head' },
                        h('span', { className: 'dpf-card-title' }, t('prompt')),
                        h('div', { className: 'dpf-spacer' }),
                        h('button', { className: 'dpf-btn dpf-btn-ghost dpf-btn-small', type: 'button', onClick: reuse }, t('again')),
                        h(
                          'button',
                          {
                            className: 'dpf-btn dpf-btn-ghost dpf-btn-small',
                            type: 'button',
                            disabled: generating,
                            title: t('previewHint'),
                            onClick: () => void renderOne(),
                          },
                          generating ? t('generating') : image ? t('renderEdit') : t('preview'),
                        ),
                        h('button', { className: 'dpf-btn dpf-btn-small', type: 'button', onClick: () => copy(editedPrompt || result.prompt, 'main') }, copied === 'main' ? t('copied') : t('copy')),
                      ),
                      h('textarea', {
                        className: 'dpf-prompt',
                        value: editedPrompt,
                        spellCheck: false,
                        onChange: (event) => setEditedPrompt(event.target.value),
                      }),
                      h(
                        'div',
                        null,
                        h(
                          'div',
                          { className: 'dpf-patch' },
                          h('input', {
                            value: patchText,
                            maxLength: 600,
                            placeholder: t('patchPlaceholder'),
                            onChange: (event) => setPatchText(event.target.value),
                            onKeyDown: (event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault();
                                void applyPatch();
                              }
                            },
                          }),
                          h(
                            'button',
                            { className: 'dpf-btn dpf-btn-small', type: 'button', disabled: patching, onClick: () => void applyPatch() },
                            patching ? '…' : t('patchApply'),
                          ),
                        ),
                        h('div', { className: 'dpf-patch-hint' }, t('patchHint')),
                      ),
                      h(
                        'div',
                        { className: 'dpf-meta' },
                        h('span', { className: 'dpf-pill dpf-pill-accent' }, dialectLabel(result.dialect)),
                        h('span', { className: 'dpf-pill' }, styleLabel(result.style)),
                        result.params?.aspect_ratio && h('span', { className: 'dpf-pill' }, result.params.aspect_ratio),
                        h('span', { className: 'dpf-pill' }, languageLabel(result.language)),
                        h('span', { className: 'dpf-pill' }, modeLabel(result.mode)),
                        h('span', { className: 'dpf-pill' }, `${(editedPrompt || result.prompt || '').length} ${t('chars')}`),
                        result.elapsedMs ? h('span', { className: 'dpf-pill' }, `${t('elapsed')} ${(result.elapsedMs / 1000).toFixed(1)}s`) : null,
                        result.model ? h('span', { className: 'dpf-pill' }, result.model) : null,
                      ),
                    ),
                  (preview.length > 0 || previewError || generating) &&
                    h(
                      'div',
                      { className: 'dpf-card' },
                      h(
                        'div',
                        { className: 'dpf-card-head' },
                        h('span', { className: 'dpf-card-title' }, t('previewTitle')),
                        h('div', { className: 'dpf-spacer' }),
                        h(
                          'button',
                          { className: 'dpf-btn dpf-btn-ghost dpf-btn-small', type: 'button', disabled: generating, onClick: () => void renderOne() },
                          generating ? t('generating') : t('regenerate'),
                        ),
                      ),
                      previewError ? h('div', { className: 'dpf-error' }, previewError) : null,
                      generating && preview.length === 0 ? h('div', { className: 'dpf-preview-empty' }, t('generating')) : null,
                      preview.length > 0 &&
                        h(
                          'div',
                          { className: 'dpf-preview' },
                          preview.map((shot, index) =>
                            h(
                              'div',
                              { className: 'dpf-shot', key: index },
                              h('img', {
                                src: `data:${shot.mime};base64,${shot.b64}`,
                                alt: '',
                                title: t('zoomHint'),
                                onClick: () => openLightbox(shot),
                              }),
                              h(
                                'button',
                                {
                                  className: 'dpf-shot-save',
                                  type: 'button',
                                  onClick: () => saveShot(shot, index),
                                },
                                t('save'),
                              ),
                            ),
                          ),
                        ),
                    ),
                  result?.negative &&
                    h(
                      'div',
                      { className: 'dpf-card' },
                      h(
                        'div',
                        { className: 'dpf-card-head' },
                        h('span', { className: 'dpf-card-title' }, t('negative')),
                        h('div', { className: 'dpf-spacer' }),
                        h('button', { className: 'dpf-btn dpf-btn-ghost dpf-btn-small', type: 'button', onClick: () => copy(result.negative, 'negative') }, copied === 'negative' ? t('copied') : t('copy')),
                      ),
                      h('div', { style: { fontSize: 12.5, lineHeight: 1.7, color: 'var(--dsw-alias-text-secondary,#c4c4ca)', wordBreak: 'break-word' } }, result.negative),
                    ),
                  result?.notes &&
                    h(
                      'div',
                      { className: 'dpf-card' },
                      h('div', { className: 'dpf-card-head' }, h('span', { className: 'dpf-card-title' }, t('notes'))),
                      h('div', { style: { fontSize: 12.5, lineHeight: 1.7 } }, result.notes),
                    ),
                  result &&
                    h(
                      'div',
                      { className: 'dpf-card', style: { flex: 1, minHeight: 0 } },
                      h(
                        'div',
                        { className: 'dpf-tabs' },
                        h(
                          'button',
                          { className: 'dpf-tab', type: 'button', 'data-active': tab === 'breakdown' || undefined, onClick: () => setTab('breakdown') },
                          `${t('breakdown')} · ${fieldRows.length}`,
                        ),
                        h(
                          'button',
                          { className: 'dpf-tab', type: 'button', 'data-active': tab === 'variants' || undefined, onClick: () => setTab('variants') },
                          `${t('variants')} · ${(result.variants || []).length}`,
                        ),
                        h(
                          'button',
                          { className: 'dpf-tab', type: 'button', 'data-active': tab === 'history' || undefined, onClick: () => setTab('history') },
                          `${t('history')} · ${history.length}`,
                        ),
                      ),
                      tab === 'breakdown' &&
                        (fieldRows.length
                          ? h(
                              'div',
                              { className: 'dpf-fields' },
                              fieldRows.map((field) =>
                                h(
                                  'button',
                                  {
                                    key: field.key,
                                    className: 'dpf-field',
                                    type: 'button',
                                    title: t('copyField'),
                                    onClick: () => copy(result.fields[field.key], `field:${field.key}`),
                                  },
                                  h('span', { className: 'dpf-field-key' }, copied === `field:${field.key}` ? t('copied') : field.label),
                                  h('span', { className: 'dpf-field-value' }, result.fields[field.key]),
                                ),
                              ),
                            )
                          : h('div', { className: 'dpf-empty-hint', style: { padding: '14px 4px' } }, '—')),
                      tab === 'variants' &&
                        ((result.variants || []).length
                          ? h(
                              'ol',
                              { className: 'dpf-list' },
                              result.variants.map((variant, index) =>
                                h(
                                  'li',
                                  { key: index, style: { cursor: 'pointer' }, title: t('copyField'), onClick: () => copy(variant, `variant:${index}`) },
                                  copied === `variant:${index}` ? t('copied') : variant,
                                ),
                              ),
                            )
                          : h('div', { className: 'dpf-empty-hint', style: { padding: '14px 4px' } }, '—')),
                      tab === 'history' &&
                        (history.length
                          ? h(
                              'div',
                              null,
                              h(
                                'div',
                                { style: { display: 'flex', justifyContent: 'flex-end', marginBottom: 6 } },
                                h('button', { className: 'dpf-btn dpf-btn-ghost dpf-btn-small', type: 'button', onClick: clearHistory }, t('clearHistory')),
                              ),
                              h(
                                'div',
                                { className: 'dpf-history' },
                                history.map((entry) =>
                                  h(
                                    'button',
                                    { key: entry.id, className: 'dpf-history-item', type: 'button', onClick: () => restore(entry) },
                                    h('span', { className: 'dpf-dot', style: entry.id === history[0].id ? undefined : { background: 'transparent' } }),
                                    h(
                                      'span',
                                      { className: 'dpf-history-main' },
                                      h('span', { className: 'dpf-history-title' }, entry.title || t('untitled')),
                                      h('span', { className: 'dpf-history-sub' }, `${timeLabel(entry.at)} · ${dialectLabel(entry.dialect)} · ${(entry.prompt || '').length} ${t('chars')}`),
                                    ),
                                  ),
                                ),
                              ),
                            )
                          : h('div', { className: 'dpf-empty-hint', style: { padding: '14px 4px' } }, t('historyEmpty'))),
                    ),
                ),
              ),
              h(
                'footer',
                { className: 'dpf-foot' },
                h('span', null, t('footnote')),
                h('span', null, modelReady ? `${provider} · ${model} · v${BUILD}` : `${t('noModel')} · v${BUILD}`),
              ),
            ),
            lightbox &&
              h(
                'div',
                {
                  className: 'dpf-lightbox',
                  ref: lightboxRef,
                  role: 'dialog',
                  'aria-modal': 'true',
                  'aria-label': t('zoomHint'),
                  onMouseDown: (event) => {
                    if (event.target === event.currentTarget) closeLightbox();
                  },
                },
                h('img', {
                  src: `data:${lightbox.mime};base64,${lightbox.b64}`,
                  alt: '',
                  'data-zoomed': zoom.scale > 1 ? '1' : '0',
                  draggable: false,
                  style: { transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})` },
                  onPointerDown: startDrag,
                  onPointerMove: moveDrag,
                  onPointerUp: endDrag,
                  onPointerCancel: endDrag,
                  onDoubleClick: () => setZoom((prev) => (prev.scale === 1 ? { scale: 2, x: 0, y: 0 } : { scale: 1, x: 0, y: 0 })),
                }),
                h('div', { className: 'dpf-lightbox-hint' }, t('zoomWheel')),
                h(
                  'div',
                  { className: 'dpf-lightbox-bar' },
                  h('button', { className: 'dpf-btn dpf-btn-ghost dpf-btn-small', type: 'button', 'aria-label': t('zoomOut'), onClick: () => zoomBy(1 / 1.25) }, '−'),
                  h('button', { className: 'dpf-btn dpf-btn-ghost dpf-btn-small dpf-zoom-level', type: 'button', title: t('zoomReset'), onClick: () => setZoom({ scale: 1, x: 0, y: 0 }) }, `${Math.round(zoom.scale * 100)}%`),
                  h('button', { className: 'dpf-btn dpf-btn-ghost dpf-btn-small', type: 'button', 'aria-label': t('zoomIn'), onClick: () => zoomBy(1.25) }, '+'),
                  h('button', { className: 'dpf-btn dpf-btn-ghost dpf-btn-small', type: 'button', onClick: () => saveShot(lightbox, 0) }, t('save')),
                  h('button', { className: 'dpf-btn dpf-btn-ghost dpf-btn-small', type: 'button', onClick: closeLightbox }, t('close')),
                ),
              ),
          );
        }

        // 侧边栏 panellist 的每行由外壳绘制（按钮、文字、tooltip、rail 几何），
        // 这里只交一个 glyph；size/active 由外壳传入，data-dsh-panel-entry 供皮肤契约定位。
        function PanelEntry({ size }) {
          return h(
            'svg',
            {
              'data-dsh-panel-entry': NS,
              viewBox: '0 0 16 16',
              width: size,
              height: size,
              fill: 'none',
              stroke: 'currentColor',
              strokeWidth: 1.3,
              strokeLinecap: 'round',
              strokeLinejoin: 'round',
              'aria-hidden': 'true',
            },
            h('path', { d: 'M2.6 13.4 3.3 10.4 10.4 3.3a1.65 1.65 0 0 1 2.33 2.33L5.6 12.7l-3 .7Z' }),
            h('path', { d: 'm9.55 4.15 2.3 2.3' }),
            h('path', { d: 'M12.3 10.4h3.1M13.85 8.85v3.1' }),
          );
        }

        // 点侧边栏该行后主区渲染的页面：直接铺满，不再套浮层遮罩。
        function PanelPage({ wide }) {
          return h(Panel, { wide, embedded: true });
        }

        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: NS,
              order: 40,
              label: () => ctx.locale.bind(NS)('meta.title'),
            },
            PanelEntry,
          ),
        );

        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: NS }, PanelPage),
        );
      },
    };
  },
});
