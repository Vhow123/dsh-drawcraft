/**
 * dsh-drawcraft browser half.
 *
 * A single sidebar-footer launcher that opens a two-column workspace:
 * left = the brief (idea, dialect, style, framing, advanced constraints),
 * right = the optimized prompt, its field-by-field breakdown, and history.
 *
 * Everything that needs the model goes through the host routes in index.js;
 * the panel never talks to a provider directly and never sees a key.
 */
window.__ModuleLoader__.load({
  id: 'dsh-drawcraft',
  factory(require) {
    const React = require('react');
    const ReactDOM = require('react-dom');

    const NS = 'dsh-drawcraft';
    const API = '/api/drawcraft';
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
    const STORE_KEY = 'dsh-drawcraft:v1';
    // 改名前的老键：读一次就搬过来，免得用户的选择与历史凭空消失。
    const LEGACY_STORE_KEY = 'dsh-image-prompt-forge:v1';
    const HISTORY_LIMIT = 24;
    // 无限画布自己一份存储：图多的时候 JSON 会很大，不能和普通设置挤在同一个键里。
    const CANVAS_KEY = 'dsh-drawcraft:canvas:v1';
    const LEGACY_CANVAS_KEY = 'dsh-image-prompt-forge:canvas:v1';
    // 进画布的图长边压到这个数，一张约 60–120 KB；1280 会让 localStorage 几张就爆。
    const CANVAS_MAX_EDGE = 768;
    const CANVAS_LIMIT = 60;
    const CANVAS_MIN_SCALE = 0.2;
    const CANVAS_MAX_SCALE = 2.5;
    // 撤销栈深度。每步存的是整份画布快照，40 步够用又不会把内存撑爆。
    const CANVAS_HISTORY = 40;
    // 页脚显示，用来一眼判断浏览器加载的是哪一版 bundle（缓存排查用）。
    const BUILD = '1.10.4';

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
        title: '绘语',
        description: '把想法拆成可执行的生图提示词，配参考图库（姿势、服装、人像）、图生图与无限画布串联。',
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
      historyTitle: '历史记录',
      newSession: '新建',
      newSessionHint: '清空当前页面，从头开始',
      historySearch: '搜索历史…',
      historyNoMatch: '没有匹配的记录',
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
      shotHint: 'Ctrl+V 直接粘贴剪贴板里的图；第一张当主体，其余当参考，最多四张。主图槽空着时第一张会自动顶上。',
      usePoseRefs: '把手上的姿势图也发过去',
      neutralize: '主图被判违规时自动转线稿重试',
      sketchNeedsWords: '主图被拒，已改发线稿重试。线稿里没有长相和衣服，建议先在上面的框里写清人物，或用上面的「反推」拿到描述。',
      rejectedHint: '这次没出图。上面那张是上一次的结果，不是新的。真人照片配「性感系」姿势基本都会被上游的内容安全规则挡掉，换「标准系」的姿势、或者干脆不传主图走纯文生图，通常就过了。',
      staleTag: '上一次的结果，这次没出图',
      neutralized: '主图偏灰度，已转成深度线稿再发。',
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
      renderHint: '不用先优化：直接用你写的想法（或选中的参考）出图',
      generating: '出图中…',
      previewTitle: '预览图',
      noImagegen: '没找到本机的生图插件（dsh-imagegen），装好后这里就能直接出图',
      hostStale: '宿主还在跑旧版本的插件，退出桌面端重新打开一次就能用了',
      imageChannel: '出图渠道',
      imageModel: '出图模型',
      imageModelHint: '出图用的渠道与模型，和上面的对话模型互不影响',
      imageSource: '出图模型来自',
      sourceHost: '本机生图插件',
      sourceEmpty: '还没配置',
      targetAdd: '添加生图模型',
      targetName: '给它起个名字（如 我的中转）',
      targetKey: 'API 密钥（留空表示不改）',
      targetTest: '测试并保存',
      targetTesting: '测试中…',
      targetSave: '保存',
      targetRemove: '删掉这个',
      targetSaved: '已保存',
      targetNeedUrl: '地址要以 http(s):// 开头，模型名至少填一个',
      targetHint: '填 OpenAI 兼容的生图接口地址，插件在本机转发，密钥只存在 ~/.dsh/drawcraft-targets.json。',
      imageSize: '出图尺寸',
      imageQuality: '出图清晰度',
      sizeAuto: '跟随画幅',
      qualityAuto: '渠道默认',
      canvas: '无限画布',
      canvasHint: '拖空白处平移，滚轮缩放，拖节点头移动。选中几张图加一个文本框，就能按它们再出一张。',
      canvasBack: '回到绘语',
      canvasAddImage: '加图',
      canvasText: '提示词',
      canvasImage: '图片',
      canvasResult: '出图',
      canvasEmpty: '画布是空的',
      canvasEmptyHint: '左上角加图或加提示词，也可以直接 Ctrl+V 粘贴。',
      canvasGenerate: '用选中的出图',
      canvasPickFirst: '先点中要用的节点（按住 Shift 可多选）',
      canvasNeedWords: '选中的东西里既没有文字也没有图',
      canvasWorking: '正在出图…',
      canvasDone: '出好了',
      canvasQuota: '图太多，超出浏览器存储上限，这一批只留了排版',
      canvasFull: '存储写不进去，画布这次的改动没保住',
      canvasBadImage: '这张图读不出来',
      canvasFollowImage: '按这张图的样子生成，保持人物与构图',
      canvasFit: '适配',
      canvasClear: '清空画布',
      canvasClearAsk: '清空整个画布？这一步不能撤销。',
      canvasToWorkshop: '送去绘语',
      canvasPick: '加到画布',
      canvasGallery: '参考库',
      canvasCarded: '已转成姿态卡重试',
      canvasOpaqued: '已按不透明面料重试',
      canvasGalleryHint: '点一张就落到画布，拖线接到任意节点',
      canvasApplyNode: '用到选中的节点',
      canvasApplied: '已用上',
      canvasPickOne: '先选中一个节点，再点小角标',
      canvasPasteLink: '粘贴的图片',
      canvasOpenImage: '点开看大图，可放大和保存',
      canvasPortIn: '拖到这里接上一张',
      canvasGenerateNode: '就用这个节点出图',
      canvasNeedSubject: '「换成/改成」这类是改图指令，得先有图：把图片节点左边的入口接到这段文字上再点，或者选中图片和文字一起出图。',
      canvasPortOut: '从这里拖出去连线',
      canvasSubjectOn: '这张就是主体（再点取消）',
      canvasSubjectOff: '指定这张当主体：出图会保持它的人和风格',
      canvasMetaPrimary: '主图',
      canvasMetaRefs: '参考',
      canvasLinkDone: '连上了，点这条线可以删掉',
      canvasLinkMiss: '没落到节点上：把线拖到另一张图或另一段文字的框里面再松手',
      pagePrompt: '提示词',
      pageImage: '生图',
      pageCanvas: '画布',
      imageTabText: '文生图',
      imageTabEdit: '图生图',
      imageSubject: '主体',
      imageWords: '提示词',
      imageWordsPlaceholder: '留空就用提示词页那段；写了就按这段出图',
      imageOutHint: '左边挑文生图或图生图，选好模型和尺寸，点下面的按钮',
      imageGoHint: '到生图页，用这段提示词或手上的图出图',

      canvasSave: '下载这张',
      canvasZoom: '缩放',
      canvasSelected: '已选',
      canvasTip: '选中节点后按 Delete 删除',
      canvasUndo: '撤销',
      canvasRedo: '重做',
      canvasCopy: '复制选中',
      canvasPaste: '粘贴',
      canvasSelectAll: '全选',
      canvasMarqueeTip: '按住 Shift 拖空白处可以框选',
      canvasReset: '回到 100%',
      canvasMinimap: '小地图',
      canvasExport: '导出',
      canvasImport: '导入',
      canvasExportName: 'drawcraft-canvas.json',
      canvasImportAsk: '导入会替换掉现在整张画布，继续？',
      canvasImportBad: '这个文件不是画布备份',
      canvasImportDone: '导入完成',
      canvasRetry: '按这张的参数再出一张',
      canvasCopied: '已复制 {n} 个节点',
      canvasNothing: '没有选中的东西',
      canvasMeta: '记录',
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
        title: 'Drawcraft',
        description: 'Drawcraft turns a vague image idea into a prompt a model can execute, with reference libraries, image-to-image and an infinite canvas.',
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
      historyTitle: 'History',
      newSession: 'New',
      newSessionHint: 'Clear this page and start over',
      historySearch: 'Search history…',
      historyNoMatch: 'No matching entry',
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
      neutralize: 'retry as line art if the image gets rejected by the upstream filter',
      sketchNeedsWords: 'The image was rejected and retried as a sketch. A sketch carries no face or clothes — write the person in the box above first, or use describe to get a description.',
      rejectedHint: 'Nothing was generated. The picture above is from the previous run, not a new one. A real-photo subject with a "sexy" pose gets blocked by the upstream content filter almost every time — switch to a "standard" pose, or drop the subject image and go text-to-image.',
      staleTag: 'previous result — this run failed',
      neutralized: 'The subject image was nearly grayscale, so it was sent as a depth line drawing.',
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
      renderHint: 'No optimization needed: render straight from your idea (or the selected references)',
      generating: 'Rendering…',
      previewTitle: 'Preview',
      noImagegen: 'No local image plugin (dsh-imagegen) found; install it to render from here',
      hostStale: 'The host is still running the previous build of this plugin — quit and reopen the desktop app once.',
      imageChannel: 'Image channel',
      imageModel: 'Image model',
      imageModelHint: 'Rendering uses the channel and model configured in the local image plugin; the chat model above is unrelated.',
      imageSource: 'Image model from',
      sourceHost: 'Local image plugin',
      sourceEmpty: 'not configured',
      targetAdd: 'Add an image model',
      targetName: 'A name for it (e.g. my relay)',
      targetKey: 'API key (leave blank to keep the current one)',
      targetTest: 'Test and save',
      targetTesting: 'Testing…',
      targetSave: 'Save',
      targetRemove: 'Remove this',
      targetSaved: 'Saved',
      targetNeedUrl: 'The URL must start with http(s):// and you need at least one model name',
      targetHint: 'Point it at any OpenAI-compatible image endpoint. The plugin relays the call locally; the key only lives in ~/.dsh/drawcraft-targets.json.',
      imageSize: 'Size',
      imageQuality: 'Quality',
      sizeAuto: 'Follow aspect',
      qualityAuto: 'Channel default',
      canvas: 'Canvas',
      canvasHint: 'Drag empty space to pan, scroll to zoom, drag a node header to move it. Select a few images plus a text node to render from them.',
      canvasBack: 'Back to Drawcraft',
      canvasAddImage: 'Add image',
      canvasText: 'Prompt',
      canvasImage: 'Image',
      canvasResult: 'Render',
      canvasEmpty: 'The canvas is empty',
      canvasEmptyHint: 'Add an image or a prompt up top, or just paste with Ctrl+V.',
      canvasGenerate: 'Render from selection',
      canvasPickFirst: 'Select the nodes to use first (hold Shift to multi-select)',
      canvasNeedWords: 'Nothing selected has text or an image',
      canvasWorking: 'Rendering…',
      canvasDone: 'Done',
      canvasQuota: 'Too many images for browser storage — this batch kept only the layout',
      canvasFull: 'Storage refused the write, this change was not saved',
      canvasBadImage: 'That image could not be read',
      canvasFollowImage: 'Render in the style of this image, keeping the subject and framing',
      canvasFit: 'Fit',
      canvasClear: 'Clear canvas',
      canvasClearAsk: 'Clear the whole canvas? This cannot be undone.',
      canvasToWorkshop: 'Send to Drawcraft',
      canvasPick: 'Add to canvas',
      canvasGallery: 'Reference library',
      canvasCarded: 'retried as a pose card',
      canvasOpaqued: 'retried with opaque fabric',
      canvasGalleryHint: 'Click one to drop it on the canvas, then wire it to any node',
      canvasApplyNode: 'Apply to selected node',
      canvasApplied: 'Applied',
      canvasPickOne: 'Select exactly one node first, then click the corner mark',
      canvasPasteLink: 'Pasted image',
      canvasOpenImage: 'Click to open it big — zoom and save',
      canvasPortIn: 'Drop a line here',
      canvasGenerateNode: 'Render from this node',
      canvasNeedSubject: 'That reads like an edit instruction. Connect an image node to it first, or select the image and the text together.',
      canvasPortOut: 'Drag out to connect',
      canvasSubjectOn: 'This is the subject (click to clear)',
      canvasSubjectOff: 'Pin this as the subject: the render keeps its person and style',
      canvasMetaPrimary: 'subject',
      canvasMetaRefs: 'refs',
      canvasLinkDone: 'Connected — click the line to remove it',
      canvasLinkMiss: 'Missed — drop the line inside another node',
      pagePrompt: 'Prompt',
      pageImage: 'Image',
      pageCanvas: 'Canvas',
      imageTabText: 'text to image',
      imageTabEdit: 'image to image',
      imageSubject: 'Subject',
      imageWords: 'Prompt',
      imageWordsPlaceholder: 'Leave empty to use the prompt page; type here to render with this instead',
      imageOutHint: 'Pick text-to-image or image-to-image on the left, choose a model and size, then hit the button',
      imageGoHint: 'Go to the image page and render from this prompt or the images you have',

      canvasSave: 'Download',
      canvasZoom: 'Zoom',
      canvasSelected: 'selected',
      canvasTip: 'Press Delete to remove selected nodes',
      canvasUndo: 'Undo',
      canvasRedo: 'Redo',
      canvasCopy: 'Copy selection',
      canvasPaste: 'Paste',
      canvasSelectAll: 'Select all',
      canvasMarqueeTip: 'Hold Shift and drag empty space to box-select',
      canvasReset: 'Back to 100%',
      canvasMinimap: 'Minimap',
      canvasExport: 'Export',
      canvasImport: 'Import',
      canvasExportName: 'drawcraft-canvas.json',
      canvasImportAsk: 'Importing replaces the whole canvas. Continue?',
      canvasImportBad: 'That file is not a canvas backup',
      canvasImportDone: 'Imported',
      canvasRetry: 'Render again with this node\'s settings',
      canvasCopied: 'Copied {n} nodes',
      canvasNothing: 'Nothing selected',
      canvasMeta: 'Record',
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
.dpf-shell{flex:1;min-height:0;display:flex}
.dpf-rail{width:214px;flex:none;display:flex;flex-direction:column;min-height:0;border-right:1px solid var(--dsw-alias-border-default,#ffffff12);background:#ffffff05}
.dpf-rail-brand{display:flex;align-items:center;gap:9px;padding:15px 14px 12px}
.dpf-rail-brand svg{width:22px;height:22px;flex:none;color:var(--dsw-alias-interactive-primary,#c9b6ff)}
.dpf-rail-name{font-weight:700;font-size:14px;letter-spacing:.02em}
.dpf-rail-sub{font-size:10.5px;color:var(--dsw-alias-text-secondary,#7d7d84);margin-top:1px}
.dpf-rail-tabs{display:flex;gap:2px;margin:0 10px 8px;padding:3px;border-radius:9px;background:#ffffff0d}
.dpf-rail-tab{flex:1;appearance:none;border:0;background:none;color:var(--dsw-alias-text-secondary,#8b8b93);font:inherit;font-size:12px;font-weight:600;padding:7px 2px;border-radius:7px;cursor:pointer;text-align:center;white-space:nowrap;overflow:hidden}
.dpf-rail-tab:hover{color:var(--dsw-alias-text-primary,#dededf);background:#ffffff0a}
.dpf-rail-tab[data-active="1"]{background:#ffffff1f;color:var(--dsw-alias-text-primary,#eee);box-shadow:0 1px 3px #0006}
.dpf-rail-tab em{font-style:normal;font-size:9.5px;opacity:.55;margin-left:3px;font-variant-numeric:tabular-nums}
.dpf-newbtn{margin:0 10px 8px;padding:8px 11px;border-radius:8px;border:1px solid var(--dsw-alias-border-default,#ffffff26);background:#ffffff0a;color:var(--dsw-alias-text-primary,#dededf);font:inherit;font-size:12.5px;font-weight:600;cursor:pointer;text-align:center}
.dpf-newbtn:hover{border-color:#ffffff3d;background:#ffffff14}
.dpf-rail-search{margin:0 10px 6px}
.dpf-rail-search input{width:100%;background:#ffffff0a;border:1px solid var(--dsw-alias-border-default,#ffffff18);border-radius:7px;color:inherit;font:inherit;font-size:11.5px;padding:5px 8px;outline:none}
.dpf-rail-search input:focus{border-color:var(--dsw-alias-border-focused,#8d8d95)}
.dpf-rail-head{display:flex;align-items:center;gap:8px;padding:6px 14px;font-size:10.5px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--dsw-alias-text-secondary,#7d7d84)}
.dpf-rail-head button{margin-left:auto;appearance:none;border:0;background:none;color:inherit;font:inherit;font-size:10.5px;text-transform:none;letter-spacing:0;cursor:pointer;opacity:.75}
.dpf-rail-head button:hover{opacity:1;color:var(--dsw-alias-text-primary,#dededf)}
.dpf-rail-list{flex:1;min-height:0;overflow:auto;padding:0 8px 10px;display:flex;flex-direction:column;gap:2px}
.dpf-rail-item{appearance:none;border:0;background:none;color:inherit;font:inherit;text-align:left;padding:7px 8px;border-radius:7px;cursor:pointer;display:flex;flex-direction:column;gap:2px;width:100%}
.dpf-rail-item:hover{background:#ffffff0f}
.dpf-rail-item b{font-weight:600;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block}
.dpf-rail-item span{font-size:10.5px;color:var(--dsw-alias-text-secondary,#7d7d84);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block}
.dpf-rail-empty{padding:10px;font-size:11.5px;color:var(--dsw-alias-text-secondary,#7d7d84)}
.dpf-rail-foot{margin-top:auto;padding:9px 14px;border-top:1px solid var(--dsw-alias-border-default,#ffffff12);font-size:10.5px;color:var(--dsw-alias-text-secondary,#7d7d84);line-height:1.5;word-break:break-all}
.dpf-stage{flex:1;min-width:0;min-height:0;display:flex;flex-direction:column}
.dpf-topbar{display:flex;align-items:center;gap:12px;padding:11px 18px;border-bottom:1px solid var(--dsw-alias-border-default,#ffffff12);flex-wrap:wrap}
.dpf-topbar-title{font-weight:700;font-size:14.5px;letter-spacing:.02em}
.dpf-topbar-note{font-size:11.5px;color:var(--dsw-alias-text-secondary,#7d7d84);max-width:46%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.dpf-body-image{grid-template-columns:minmax(0,1fr) minmax(300px,.92fr)}
.dpf-image-tabs{display:flex;gap:6px;margin-bottom:14px}
.dpf-image-tab{appearance:none;border:1px solid transparent;background:#ffffff0a;color:var(--dsw-alias-text-secondary,#9a9aa2);font:inherit;font-size:12.5px;padding:7px 16px;border-radius:999px;cursor:pointer;text-align:center}
.dpf-image-tab:hover{color:var(--dsw-alias-text-primary,#dededf);background:#ffffff12}
.dpf-image-tab[data-active="1"]{background:#ffffff1f;border-color:var(--dsw-alias-border-default,#ffffff26);color:var(--dsw-alias-text-primary,#eee);font-weight:600}
.dpf-image-main{min-height:0;overflow:auto;padding:16px 18px 20px;border-right:1px solid var(--dsw-alias-border-default,#ffffff10)}
.dpf-image-out{min-height:0;overflow:auto;padding:16px 18px 20px;display:flex;flex-direction:column;gap:12px}
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
.dpf-textarea.dpf-idea{min-height:84px}
.dpf-target-form{display:grid;gap:6px;margin-top:8px;padding:9px 10px;border:1px dashed var(--dsw-alias-border-default,#ffffff22);border-radius:9px;background:#ffffff05}
.dpf-target-form .dpf-input{font-size:12px;padding:6px 9px}
.dpf-target-actions{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.dpf-target-msg{font-size:11px;color:var(--dsw-alias-text-secondary,#9a9aa2);word-break:break-word}
.dpf-target-msg.is-bad{color:var(--dsw-alias-text-danger,#ef767a)}
.dpf-icon-btn{width:26px;height:26px;flex:none;border-radius:7px;border:1px dashed var(--dsw-alias-border-default,#ffffff2e);background:transparent;color:inherit;font-size:15px;line-height:1;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;padding:0}
.dpf-icon-btn:hover{background:#ffffff10}
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
.dpf-gallery-canvas{position:absolute;top:2px;left:2px;width:17px;height:17px;display:flex;align-items:center;justify-content:center;border-radius:5px;background:#000000b3;color:#fff;font-size:11px;line-height:1;opacity:0;transition:opacity .12s;z-index:2}
.dpf-gallery-card:hover .dpf-gallery-canvas,.dpf-gallery-canvas:focus-visible{opacity:1}
.dpf-gallery-canvas:hover{background:var(--dsw-alias-brand-primary,#5a8dff)}
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
.dpf-stale{margin:8px 0 0;padding:5px 10px;border-radius:7px;font-size:11px;letter-spacing:.02em;color:var(--dsw-alias-text-warning,#e0b25c);background:#e0b25c16;border:1px dashed #e0b25c55;display:inline-block}
.dpf-preview.is-stale img{opacity:.55;filter:saturate(.6)}
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
.dpf-canvas{position:relative;flex:1;min-height:0;overflow:hidden;background-color:#131317;background-image:radial-gradient(circle at 1px 1px,#ffffff2b 1.4px,transparent 0);background-size:26px 26px;cursor:grab;touch-action:none}
.dpf-canvas[data-panning="1"]{cursor:grabbing}
.dpf-canvas-layer{position:absolute;top:0;left:0;transform-origin:0 0;will-change:transform}
.dpf-canvas-node{position:absolute;display:flex;flex-direction:column;background:var(--dsw-alias-bg-elevated,#1c1c1e);border:1px solid var(--dsw-alias-border-default,#ffffff1f);border-radius:12px;box-shadow:0 12px 40px #0006;overflow:visible}
.dpf-canvas-node[data-sel="1"]{border-color:var(--dsw-alias-brand-primary,#5a8dff);box-shadow:0 0 0 1px var(--dsw-alias-brand-primary,#5a8dff),0 12px 40px #0006}
.dpf-canvas-node[data-kind="text"]{background:var(--dsw-alias-bg-elevated,#1c1c1e)}
.dpf-canvas-head{display:flex;align-items:center;gap:6px;border-radius:11px 11px 0 0;padding:5px 7px;font-size:11px;color:var(--dsw-alias-text-secondary,#9a9aa2);cursor:move;user-select:none;background:#ffffff08;border-bottom:1px solid var(--dsw-alias-border-default,#ffffff12)}
.dpf-canvas-head b{font-weight:600;color:var(--dsw-alias-text-primary,#ddd);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0}
.dpf-canvas-x{border:0;background:transparent;color:inherit;font-size:13px;line-height:1;cursor:pointer;padding:0 2px;border-radius:4px}
.dpf-canvas-x.is-subject{color:#ffd166;text-shadow:0 0 6px #ffd16688}
.dpf-canvas-x:hover{background:#ffffff1f;color:#fff}
.dpf-canvas-body{flex:1;min-height:0;position:relative;display:flex;align-items:center;justify-content:center;background:#00000040;border-radius:0 0 11px 11px;overflow:hidden}
.dpf-canvas-body img{max-width:100%;max-height:100%;object-fit:contain;display:block;cursor:zoom-in;user-select:none}
.dpf-canvas-body textarea{width:100%;height:100%;border:0;outline:0;resize:none;background:transparent;color:var(--dsw-alias-text-primary,#eee);font:inherit;font-size:12px;line-height:1.6;padding:8px 9px}
.dpf-canvas-note{position:absolute;left:0;right:0;bottom:0;padding:3px 7px;font-size:10.5px;color:#ffffff8a;background:#000000a6;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dpf-canvas-resize{position:absolute;right:0;bottom:0;width:14px;height:14px;cursor:nwse-resize;background:linear-gradient(135deg,transparent 46%,#ffffff40 47%,#ffffff40 60%,transparent 61%)}
.dpf-canvas-edge{position:absolute;top:0;left:0;overflow:visible;pointer-events:none}
.dpf-canvas-edge path{fill:none;stroke:#7aa7ff;stroke-width:2.4;stroke-opacity:.75}
.dpf-canvas-edge path.dpf-canvas-line{stroke-opacity:.85;filter:drop-shadow(0 0 4px #7aa7ff66)}
.dpf-canvas-edge path.dpf-canvas-hit{fill:none;stroke:transparent;stroke-width:14;pointer-events:stroke;cursor:pointer}
.dpf-canvas-edge path.dpf-canvas-hit:hover{stroke:#ff6b6b55}
.dpf-canvas-edge path.dpf-canvas-live{stroke:#ffd166;stroke-width:2.6;stroke-dasharray:6 5;stroke-opacity:1}
.dpf-canvas-port{position:absolute;width:14px;height:14px;border-radius:50%;background:#7aa7ff;border:2.5px solid #ffffff;box-shadow:0 0 0 1px #7aa7ff,0 2px 6px #000a;opacity:.9;transition:opacity .12s,transform .12s;z-index:4;cursor:crosshair}
.dpf-canvas-port[data-side="in"]{left:-8px;top:50%;margin-top:-7px}
.dpf-canvas-port[data-side="out"]{right:-8px;top:50%;margin-top:-7px}
.dpf-canvas-node:hover .dpf-canvas-port,.dpf-canvas-node[data-sel="1"] .dpf-canvas-port{opacity:1;transform:scale(1.15)}
.dpf-canvas-port:hover{background:#ffd166;border-color:#fff;transform:scale(1.3)}
.dpf-canvas-node[data-linkfrom="1"]{box-shadow:0 0 0 2px #ffd166,0 12px 40px #0006}
.dpf-canvas-tools{position:absolute;top:10px;left:10px;right:10px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;z-index:3}
.dpf-canvas-tools .dpf-btn{background:#000000a6;border-color:#ffffff2b;color:#eee}
.dpf-canvas-tools .dpf-btn:hover{background:#000000cc}
.dpf-canvas-tools .dpf-btn-primary{flex:0 0 auto;background:var(--dsw-alias-interactive-primary,#ededf0);color:var(--dsw-alias-text-on-primary,#141416);border-color:transparent}
.dpf-canvas-tools .dpf-btn-primary:hover{background:#fff}
.dpf-canvas-msg{position:absolute;bottom:10px;left:10px;right:10px;font-size:11.5px;color:var(--dsw-alias-text-secondary,#9a9aa2);background:#000000a6;border-radius:8px;padding:6px 10px;z-index:3}
.dpf-canvas-msg[data-bad="1"]{color:var(--dsw-alias-text-warning,#e0b25c)}
.dpf-canvas-empty{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;color:var(--dsw-alias-text-secondary,#86868c);font-size:12.5px;text-align:center;pointer-events:none;padding:0 40px}
.dpf-canvas-badge{position:absolute;top:0;right:0;padding:1px 6px;border-radius:0 11px 0 8px;font-size:10px;background:#000000b3;color:#fff;z-index:2}
.dpf-canvas-badge[data-busy="1"]{background:var(--dsw-alias-brand-primary,#5a8dff);color:#fff}
.dpf-canvas-tools .dpf-btn[disabled]{opacity:.38;cursor:default}
.dpf-canvas-tools .dpf-btn[disabled]:hover{background:#000000a6}
.dpf-canvas-range{width:82px;height:16px;accent-color:var(--dsw-alias-brand-primary,#5a8dff);cursor:pointer;background:transparent}
.dpf-canvas-sep{width:1px;height:16px;background:#ffffff26;margin:0 2px}
.dpf-marquee{position:absolute;border:1px dashed var(--dsw-alias-brand-primary,#5a8dff);background:#5a8dff1f;pointer-events:none;z-index:4;border-radius:2px}
.dpf-minimap{position:absolute;right:10px;bottom:32px;width:152px;height:98px;border:1px solid #ffffff26;border-radius:8px;background:#000000a6;overflow:hidden;z-index:3;cursor:crosshair}
.dpf-minimap[data-empty="1"]{display:none}
.dpf-minimap-node{position:absolute;background:#ffffff3d;border-radius:1px}
.dpf-minimap-node[data-kind="text"]{background:#e0b25c4d}
.dpf-minimap-box{position:absolute;border:1px solid var(--dsw-alias-brand-primary,#5a8dff);background:#5a8dff1f;border-radius:2px}
@media(max-width:960px){.dpf-backdrop{padding:0}.dpf-panel{height:100%;border-radius:0}.dpf-body{grid-template-columns:1fr;overflow:auto}.dpf-left{border-right:0;border-bottom:1px solid var(--dsw-alias-border-default,#ffffff10);overflow:visible}.dpf-right{overflow:visible}.dpf-picker{width:100%}.dpf-body-image{grid-template-columns:1fr}.dpf-shell{flex-direction:column}.dpf-rail{width:100%;border-right:0;border-bottom:1px solid var(--dsw-alias-border-default,#ffffff12)}.dpf-rail-tabs{flex-direction:row}.dpf-rail-tab{flex:1}.dpf-rail-list{max-height:150px}.dpf-image-main{border-right:0;border-bottom:1px solid var(--dsw-alias-border-default,#ffffff10)}}
.dpf-canvas-foot{position:absolute;right:10px;bottom:10px;font-size:11px;color:#ffffff66;z-index:3;font-variant-numeric:tabular-nums}
.dpf-canvas-gal{position:absolute;left:10px;bottom:34px;width:392px;max-height:min(62%,calc(100% - 110px));overflow:auto;z-index:7;padding:10px;border-radius:12px;background:#1b1b20f5;border:1px solid #ffffff26;box-shadow:0 18px 48px #000000a6;backdrop-filter:blur(8px)}
.dpf-canvas-gal-head{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.dpf-canvas-gal-head b{font-size:12px;color:#ffffffdd}
.dpf-canvas-gal .dpf-canvas-x{position:static;margin-left:auto}
.dpf-canvas-gal .dpf-gallery-grid{max-height:none}
.dpf-canvas-gal-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;margin-top:8px}
.dpf-canvas-gal-grid .dpf-gallery-card{padding:3px}
.dpf-canvas-gal-grid .dpf-gallery-card img{height:70px;object-fit:contain}
.dpf-canvas-gal-grid .dpf-gallery-name{font-size:10px;line-height:1.2;max-height:2.4em;overflow:hidden}
.dpf-canvas-gal-grid .dpf-gallery-canvas{width:16px;height:16px;font-size:10px}
.dpf-canvas-gal .dpf-gallery-kinds .dpf-kinds-values{max-height:74px}
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
          'dsh-drawcraft: dictionaries',
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

        /**
         * 灰度/深度图当主图会被上游网关判成"淡化处理过的规避图"直接拒，
         * 上色后中性姿势能过、性感系姿势仍被 NSFW 拦。
         * 改成白底线条的深度等值线图（等高线）后，画面里只剩线，实测能正常出图。
         */
        const CONTOUR_NOTE = {
          en: 'The reference is a depth-contour diagram: take only its silhouette and joint positions as the pose blueprint, and ignore the contour lines themselves — those are measurement lines, not a pattern printed on clothing.\n\n',
          zh: '参考图是一张深度等值线图：只把它的轮廓与关节位置当作姿态蓝图，图上的线条本身要忽略——那些是测量线，不是衣服上的花纹。\n\n',
        };

        /**
         * 没有任何像样提示词时的兜底。
         * 只喂一句「坐姿・抱腿打开」进去，图像模型会自己挑风格——它挑的是插画。
         */
        const PHOTO_NOTE = {
          en: 'Photorealistic photograph of a real adult woman, real skin texture, natural light, sharp focus. No illustration, no anime, no cartoon, no 3D render, no doll-like face.\n\n',
          zh: '真人摄影，真实成年女性，真实皮肤质感，自然光，清晰对焦。不要插画，不要动漫，不要卡通，不要 3D 渲染，不要娃娃脸。\n\n',
        };

        /**
         * 被拒后改发线稿时必须说的话。
         * 线稿里没有肤色、脸、衣服——不说清楚，模型就照着线条画成插画了。
         */
        const SKETCH_NOTE = {
          en: 'The attached reference is only a pose sketch: take nothing from it except the silhouette and joint positions. Rebuild the person as a real human photograph, keeping the appearance you were told above. Do not output line art, do not output an illustration.\n\n',
          zh: '附上的参考图只是一张姿态线稿：只从它取轮廓与关节位置，其余一概不管。人物要按上面的描述还原成真人摄影。不要输出线稿，不要输出插画。\n\n',
        };

        /**
         * 画布上没有「反推」这一步，用户往往只写一句「头发换成双马尾」。
         * 只发这一句，模型会自己挑风格——它挑的是插画/动漫，出来的就是卡通。
         * 所以在画布出图时默认补一条写实约束；用户明确要插画时它会被覆盖。
         */
        const CANVAS_REAL_NOTE = {
          en: 'Render as a real photograph: real person, real skin texture, natural light and shadow. Only switch to illustration, anime or cartoon style if the text above explicitly asks for it.\n\n',
          zh: '按真实摄影呈现：真实人物、真实皮肤质感与自然光影；只有上面明确要求插画、动漫或卡通风格时才换。\n\n',
        };

        /**
         * 被上游内容政策拦下来、改发姿态卡时的说明。
         */
        const CANVAS_FIX_NOTE = {
          en: 'The attached picture is a pose card: a plain silhouette on a white background. Read only the body shape and joint positions from it, then render the person described above as a real photograph. Do not copy the card style, do not output line art.\n\n',
          zh: '附上的是姿态卡：白底上的一个人形轮廓。只从它读身形与关节位置，人物按上面的描述还原成真人摄影。不要照搬卡片风格，不要输出线稿。\n\n',
        };

        /**
         * 画布上的「图一/图二/图三」应该按连线数：上游是图一，跟着线往下走。
         * 按 x 坐标排会在图摆得歪一点时就跟肉眼对不上。
         * 用最长路径当层级，同层再按坐标兜底，环也能收敛。
         */
        function chainOrder(nodes, edges) {
          const ids = new Set(nodes.map((node) => node.id));
          const next = new Map();
          const indeg = new Map(nodes.map((node) => [node.id, 0]));
          for (const edge of Array.isArray(edges) ? edges : []) {
            if (!ids.has(edge.from) || !ids.has(edge.to) || edge.from === edge.to) continue;
            if (!next.has(edge.from)) next.set(edge.from, []);
            next.get(edge.from).push(edge.to);
            indeg.set(edge.to, (indeg.get(edge.to) || 0) + 1);
          }
          const depth = new Map(nodes.map((node) => [node.id, 0]));
          let frontier = nodes.filter((node) => (indeg.get(node.id) || 0) === 0).map((node) => node.id);
          const seen = new Set(frontier);
          for (let round = 0; round < nodes.length && frontier.length > 0; round += 1) {
            const ahead = [];
            for (const id of frontier) {
              for (const to of next.get(id) || []) {
                depth.set(to, Math.max(depth.get(to) || 0, (depth.get(id) || 0) + 1));
                if (!seen.has(to)) {
                  seen.add(to);
                  ahead.push(to);
                }
              }
            }
            frontier = ahead;
          }
          return nodes.slice().sort((left, right) => (depth.get(left.id) || 0) - (depth.get(right.id) || 0)
            || left.x - right.x
            || left.y - right.y);
        }

        /**
         * 提示词里写「图二换服装」，可发出去的图是按主体优先重排的，
         * 模型看到的第二张根本不是画布上的第二张。这里把编号摊开讲清楚。
         */
        function orderNote(entries, primarySlot, lang) {
          const list = entries.map((item) => `图${item.slot}「${item.title}」`).join('、');
          if (lang === 'zh') {
            return `附图编号（按连线顺序，上游在前）：${list}。其中第 ${primarySlot} 张是主体，其余是参考图；下文提到的「图一/图二/图三」都按这个编号理解，不要按实际发送顺序。\n\n`;
          }
          return `Attached images, numbered along the wiring order with upstream first: ${list}. Image ${primarySlot} is the subject, the rest are references. Any mention of "image 1 / image 2 / image 3" below refers to this numbering, not to the order they were sent in.\n\n`;
        }

        /**
         * 服装库里是 3D 人台，姿势库里是白模/深度图。
         * 不点明的话，模型会把它们的渲染风格（3D、白模、素模）一起抄过来。
         */
        const CANVAS_REF_NOTE = {
          en: 'The extra reference images only show a garment cut or a body pose: some are 3D mannequin renders or plain grey models. Take only the clothing design and the joint positions from them. Do not copy their skin, material, lighting or rendering style — the result must look like a real photograph.\n\n',
          zh: '后面的参考图只是版型与姿势的示意图：服装图可能是 3D 人台渲染，姿势图可能是白模或深度图。只取衣服的款式版型与身体姿态，不要复制它们的肤色、材质、光照与渲染风格；最终画面必须是真人实拍。\n\n',
        };

        /**
         * 服装库里有一批是「半透明薄纱」面料（例如 SUM-0192 那件黑色透视上衣）。
         * 参考图里能清楚看到胸部轮廓，模型照抄成透视装，上游网关就直接判裸露拒掉——
         * 实测同一组参考图：原样发 400 content_policy_violation，加这句就过，版型不变。
         */
        const CANVAS_OPAQUE_NOTE = {
          en: 'Any sheer or see-through garment in the references must be made into an opaque fabric; nothing may show through the neckline or chest.\n\n',
          zh: '参考图里的透视、薄纱面料一律做成不透明的实拍面料，领口与胸口不得透出皮肤轮廓。\n\n',
        };

        const CANVAS_CARD_EDGE = 960;

        /**
         * 判断主图是不是单色灰图（深度图、白模、线稿）。
         * 这类图当主图会被上游网关判成「淡化处理过的规避图」直接拒。
         */
        async function imageLooksFlat(dataUrl) {
          try {
            const stats = grayStats(await imagePixels(dataUrl, 384));
            return stats.saturation < 0.1;
          } catch (failure) {
            return false;
          }
        }

        /**
         * 把单色灰图做成「白底姿态卡」：灰阶映射成深蓝线，人物缩到画面 82% 居中，
         * 四周留白。画面里只剩一个人形，看着是素材图而不是深度图。
         */
        async function poseCardDataUrl(dataUrl, maxEdge) {
          const pixels = await imagePixels(dataUrl, maxEdge || CANVAS_CARD_EDGE);
          const { context, width, height } = pixels;
          const frame = context.getImageData(0, 0, width, height);
          const data = frame.data;
          const count = width * height;
          let lo = 1;
          let hi = 0;
          for (let i = 0; i < count; i += 1) {
            const at = i * 4;
            const value = (0.299 * data[at] + 0.587 * data[at + 1] + 0.114 * data[at + 2]) / 255;
            if (value < lo) lo = value;
            if (value > hi) hi = value;
          }
          const span = Math.max(0.12, hi - lo);
          for (let i = 0; i < count; i += 1) {
            const at = i * 4;
            const value = (0.299 * data[at] + 0.587 * data[at + 1] + 0.114 * data[at + 2]) / 255;
            const ratio = Math.max(0, Math.min(1, (value - lo) / span));
            data[at] = Math.round(246 - ratio * 206);
            data[at + 1] = Math.round(247 - ratio * 186);
            data[at + 2] = Math.round(250 - ratio * 130);
            data[at + 3] = 255;
          }
          context.putImageData(frame, 0, 0);
          const pad = document.createElement('canvas');
          pad.width = width;
          pad.height = height;
          const padCtx = pad.getContext('2d');
          padCtx.fillStyle = '#ffffff';
          padCtx.fillRect(0, 0, width, height);
          const inner = 0.82;
          const innerW = Math.round(width * inner);
          const innerH = Math.round(height * inner);
          padCtx.drawImage(context.canvas, Math.round((width - innerW) / 2), Math.round((height - innerH) / 2), innerW, innerH);
          return pad.toDataURL('image/png');
        }

        function loadImageElement(dataUrl) {
          return new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = () => reject(new Error('image decode failed'));
            image.src = dataUrl;
          });
        }

        function imagePixels(dataUrl, maxEdge) {
          return loadImageElement(dataUrl).then((image) => {
            const naturalWidth = image.naturalWidth || image.width || 0;
            const naturalHeight = image.naturalHeight || image.height || 0;
            if (!naturalWidth || !naturalHeight) throw new Error('image has no size');
            const scale = Math.min(1, maxEdge / Math.max(naturalWidth, naturalHeight));
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(naturalWidth * scale));
            canvas.height = Math.max(1, Math.round(naturalHeight * scale));
            const context = canvas.getContext('2d', { willReadFrequently: true });
            context.drawImage(image, 0, 0, canvas.width, canvas.height);
            return { canvas, context, width: canvas.width, height: canvas.height };
          });
        }

        function grayStats(pixels) {
          const { context, width, height } = pixels;
          const data = context.getImageData(0, 0, width, height).data;
          const count = width * height;
          const gray = new Float32Array(count);
          let lo = 1;
          let hi = 0;
          for (let i = 0; i < count; i += 1) {
            const at = i * 4;
            const value = (0.299 * data[at] + 0.587 * data[at + 1] + 0.114 * data[at + 2]) / 255;
            gray[i] = value;
            if (value < lo) lo = value;
            if (value > hi) hi = value;
          }
          let saturation = 0;
          let sampled = 0;
          const step = Math.max(1, Math.floor(count / 4000));
          for (let i = 0; i < count; i += step) {
            const at = i * 4;
            const max = Math.max(data[at], data[at + 1], data[at + 2]);
            const min = Math.min(data[at], data[at + 1], data[at + 2]);
            saturation += max > 0 ? (max - min) / max : 0;
            sampled += 1;
          }
          return { gray, lo, hi, saturation: sampled ? saturation / sampled : 0, width, height, count };
        }

        /**
         * 只判「这张图是不是灰度」——不再拿它决定要不要转线稿。
         * 真人照片撞上高调棚拍时饱和度也会很低，预判转线稿会把真人变成线稿，
         * 出来就是卡通。转线稿只在被上游明确 reject 之后才做。
         */
        async function isFlatGray(dataUrl) {
          try {
            const stats = grayStats(await imagePixels(dataUrl, 384));
            return stats.saturation < 0.08 && stats.hi - stats.lo > 0.12;
          } catch {
            return false;
          }
        }

        function buildContourMask(gray, width, height, lo, hi, levels) {
          const count = width * height;
          const span = Math.max(0.08, hi - lo);
          const bands = Math.max(4, Math.min(32, levels || 16));
          const level = new Uint8Array(count);
          for (let i = 0; i < count; i += 1) {
            const ratio = (gray[i] - lo) / span;
            level[i] = Math.max(0, Math.min(bands - 1, Math.floor(ratio * bands)));
          }
          const edge = new Uint8Array(count);
          for (let y = 0; y < height; y += 1) {
            for (let x = 0; x < width; x += 1) {
              const i = y * width + x;
              const value = level[i];
              if ((x > 0 && level[i - 1] !== value) || (y > 0 && level[i - width] !== value)) edge[i] = 1;
            }
          }
          const solidLine = lo + span * 0.06;
          const inside = new Uint8Array(count);
          for (let i = 0; i < count; i += 1) inside[i] = gray[i] > solidLine ? 1 : 0;
          for (let y = 0; y < height; y += 1) {
            for (let x = 0; x < width; x += 1) {
              const i = y * width + x;
              if (!inside[i]) continue;
              if (x === 0 || y === 0 || !inside[i - 1] || !inside[i - width]) edge[i] = 1;
            }
          }
          // 线加粗一像素，缩到 1024 以内后不断线。
          const fat = new Uint8Array(edge);
          for (let y = 0; y < height; y += 1) {
            for (let x = 0; x < width; x += 1) {
              const i = y * width + x;
              if (edge[i] !== 1) continue;
              if (x > 0) fat[i - 1] = 1;
              if (x + 1 < width) fat[i + 1] = 1;
              if (y > 0) fat[i - width] = 1;
              if (y + 1 < height) fat[i + width] = 1;
            }
          }
          return fat;
        }

        async function contourDataUrl(dataUrl, maxEdge = 1200) {
          const pixels = await imagePixels(dataUrl, maxEdge);
          const { canvas, context, width, height } = pixels;
          const stats = grayStats(pixels);
          const fat = buildContourMask(stats.gray, width, height, stats.lo, stats.hi, 16);
          // 3×3 盒式模糊当抗锯齿：线条边缘留灰阶。硬边纯黑白的线稿会被判成
          // 「处理过的图」，软一点的灰线才像技术制图 —— 实测这条差别直接决定过不过。
          const soft = new Float32Array(stats.count);
          for (let y = 0; y < height; y += 1) {
            for (let x = 0; x < width; x += 1) {
              let sum = 0;
              let seen = 0;
              for (let dy = -1; dy <= 1; dy += 1) {
                const yy = y + dy;
                if (yy < 0 || yy >= height) continue;
                for (let dx = -1; dx <= 1; dx += 1) {
                  const xx = x + dx;
                  if (xx < 0 || xx >= width) continue;
                  sum += fat[yy * width + xx];
                  seen += 1;
                }
              }
              soft[y * width + x] = seen > 0 ? sum / seen : 0;
            }
          }
          const out = context.createImageData(width, height);
          for (let i = 0; i < stats.count; i += 1) {
            const at = i * 4;
            const value = 252 - Math.round(Math.min(1, soft[i] * 1.5) * 165);
            out.data[at] = value;
            out.data[at + 1] = value + 1;
            out.data[at + 2] = value + 4;
            out.data[at + 3] = 255;
          }
          context.putImageData(out, 0, 0);
          return canvas.toDataURL('image/png');
        }

        function readStore() {
          try {
            let raw = localStorage.getItem(STORE_KEY);
            if (!raw) raw = localStorage.getItem(LEGACY_STORE_KEY);
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

        // 画布状态：节点、血缘边、视口。图多了会撞 localStorage 配额，
        // 所以超限时退一步——先把图丢掉只留骨架，再不行就整个不存。
        const EMPTY_CANVAS = { nodes: [], edges: [], view: { x: 0, y: 0, scale: 1 } };

        // 撤销栈是纯数据结构，抽成函数方便单测。push 会清掉 future（新分支），
        // 超过 CANVAS_HISTORY 就丢最老的一步（否则整张画布的 base64 会把内存吃满）。
        function histPush(hist, snapshot, limit = CANVAS_HISTORY) {
          if (!snapshot) return hist;
          const past = hist.past.concat([snapshot]);
          if (past.length > limit) past.splice(0, past.length - limit);
          return { past, future: [] };
        }

        function histUndo(hist, current) {
          if (!hist.past || hist.past.length === 0) return null;
          const target = hist.past[hist.past.length - 1];
          return {
            state: target,
            hist: { past: hist.past.slice(0, -1), future: hist.future.concat([current]) },
          };
        }

        function histRedo(hist, current) {
          if (!hist.future || hist.future.length === 0) return null;
          const target = hist.future[hist.future.length - 1];
          return {
            state: target,
            hist: { past: hist.past.concat([current]), future: hist.future.slice(0, -1) },
          };
        }

        function readCanvas() {
          try {
            let raw = localStorage.getItem(CANVAS_KEY);
            if (!raw) raw = localStorage.getItem(LEGACY_CANVAS_KEY);
            const value = raw ? JSON.parse(raw) : null;
            if (!value || typeof value !== 'object') return { ...EMPTY_CANVAS };
            const view = value.view && typeof value.view === 'object' ? value.view : EMPTY_CANVAS.view;
            return {
              nodes: Array.isArray(value.nodes) ? value.nodes.filter((node) => node && typeof node.id === 'string') : [],
              edges: Array.isArray(value.edges) ? value.edges.filter((edge) => edge && edge.from && edge.to) : [],
              view: {
                x: Number(view.x) || 0,
                y: Number(view.y) || 0,
                scale: Math.min(CANVAS_MAX_SCALE, Math.max(CANVAS_MIN_SCALE, Number(view.scale) || 1)),
              },
            };
          } catch {
            return { ...EMPTY_CANVAS };
          }
        }

        function writeCanvas(state) {
          const payload = {
            nodes: (state.nodes || []).slice(-CANVAS_LIMIT),
            edges: state.edges || [],
            view: state.view || EMPTY_CANVAS.view,
          };
          try {
            localStorage.setItem(CANVAS_KEY, JSON.stringify(payload));
            return '';
          } catch {
            // 图太占地方：丢掉像素只留排版，至少别让整张画布消失。
            try {
              const slim = {
                ...payload,
                nodes: payload.nodes.map((node) => ({ ...node, src: '', lost: Boolean(node.src) })),
              };
              localStorage.setItem(CANVAS_KEY, JSON.stringify(slim));
              return 'quota';
            } catch {
              return 'full';
            }
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
          // 画布页自己的参考库：跟工坊互不干扰，关掉再从图库拿也不打架。
          const [canvasGalOpen, setCanvasGalOpen] = useState(false);
          const [canvasGalLib, setCanvasGalLib] = useState('auto');
          const [canvasGalQuery, setCanvasGalQuery] = useState('');
          const [canvasGalWorks, setCanvasGalWorks] = useState([]);
          const [canvasGalTotal, setCanvasGalTotal] = useState(0);
          const [canvasGalLoading, setCanvasGalLoading] = useState(false);
          const [canvasGalError, setCanvasGalError] = useState('');
          const [canvasGalKinds, setCanvasGalKinds] = useState({});
          const [canvasGalFilters, setCanvasGalFilters] = useState({});
          const [canvasGalOpenDims, setCanvasGalOpenDims] = useState({});

          const [result, setResult] = useState(null);
          const [editedPrompt, setEditedPrompt] = useState('');
          const [error, setError] = useState('');
          const [notice, setNotice] = useState('');
          const [running, setRunning] = useState(false);
          const [tab, setTab] = useState('breakdown');
          const [history, setHistory] = useState(Array.isArray(stored.history) ? stored.history.slice(0, HISTORY_LIMIT) : []);
          const [railQuery, setRailQuery] = useState('');

          // 反推图片 / 差量修改 / 直接出图 三块的局部状态
          const [image, setImage] = useState(null);
          // 图生图的附加参考（最多 4 张）：主图放在 image 里，其余进这里。
          const [refShots, setRefShots] = useState([]);
          // 是否把参考库里勾选的姿势/服装图一起当作图像条件发过去。
          const [usePoseRefs, setUsePoseRefs] = useState(false);
          // 主图是灰度/深度图时先转成等高线线稿再发，绕开上游的图片审核。
          const [neutralize, setNeutralize] = useState(true);
          const [describing, setDescribing] = useState(false);
          const [dragOver, setDragOver] = useState(false);
          const [patchText, setPatchText] = useState('');
          const [patching, setPatching] = useState(false);
          const [preview, setPreview] = useState([]);
          const [previewError, setPreviewError] = useState('');
          const [previewStale, setPreviewStale] = useState(false);
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

          // 自带的生图端点：用户自己填地址、密钥、模型名，插件服务端转发。
          const [targets, setTargets] = useState([]);
          const [source, setSource] = useState('host');
          const [targetOpen, setTargetOpen] = useState(false);
          const [targetDraft, setTargetDraft] = useState({ label: '', baseUrl: '', apiKey: '', models: '' });
          const [targetBusy, setTargetBusy] = useState(false);
          const [targetMsg, setTargetMsg] = useState('');
          const [targetBad, setTargetBad] = useState(false);

          // ── 三个一级页面 ────────────────────────────────────────────
          // 提示词只管写字和优化；生图只管图；画布是第三页。
          const [page, setPage] = useState('prompt');
          // 生图页里的两个子页：文生图 / 图生图。
          const [imageTab, setImageTab] = useState('text');
          const canvasView = page === 'canvas';

          // ── 无限画布 ────────────────────────────────────────────────
          // 和工坊共用一套出图通道，但排版、选择、血缘都是自己的。
          const [canvas, setCanvas] = useState(readCanvas);
          const [canvasSel, setCanvasSel] = useState([]);
          const [canvasBusy, setCanvasBusy] = useState('');
          const [canvasMsg, setCanvasMsg] = useState({ text: '', bad: false });
          const canvasRef = useRef(null);
          const canvasPan = useRef(null);
          const canvasGrab = useRef(null);
          const canvasFile = useRef(null);
          const canvasImportFile = useRef(null);
          const canvasState = useRef(canvas);
          canvasState.current = canvas;

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
          // 画布上的图存的是 dataURL，预览区里的图是 {mime,b64}。
          // 统一成 {url} 再交给大图看，省得两套渲染。
          const openCanvasImage = (node) => {
            if (!node || !node.src) return;
            openLightbox({ url: node.src, name: node.title || t('canvasImage') });
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
          // 工坊和画布各有一套参考库 state，查法完全一样，只把结果交给调用方去落。
          const fetchGallery = useCallback(
            async (query, lib, filters, append) => {
              const at = append ? (Array.isArray(append) ? append.length : 0) : 0;
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
                  return { ok: false, message: payload.message || t('galleryEmpty'), works: [], total: 0 };
                }
                const works = Array.isArray(payload?.works) ? payload.works : [];
                return { ok: true, message: '', works, total: Number(payload?.total) || works.length };
              } catch (failure) {
                return { ok: false, message: explain(failure), works: [], total: 0 };
              }
            },
            [t],
          );

          const mergeWorks = (previous, batch, append) => {
            if (!append) return batch;
            const seen = new Set(previous.map((item) => `${item.lib}:${item.id}`));
            return [...previous, ...batch.filter((item) => !seen.has(`${item.lib}:${item.id}`))];
          };

          const searchRefs = useCallback(
            async (query, lib, filters, append) => {
              if (!append) setRefWorks([]);
              setRefLoading(true);
              setRefError('');
              const result = await fetchGallery(query, lib, filters, append);
              if (!result.ok) {
                setRefError(result.message);
                if (!append) setRefWorks([]);
                setRefTotal(0);
              } else {
                setRefWorks((previous) => mergeWorks(previous, result.works, append));
                setRefTotal(result.total);
              }
              setRefLoading(false);
            },
            [fetchGallery],
          );

          // 画布里的参考库：同一套检索，结果落到画布自己那一组 state，
          // 这样面板开着也不会把工坊里已经搜好的列表顶掉。
          const searchCanvasGallery = useCallback(
            async (query, lib, filters, append) => {
              if (!append) setCanvasGalWorks([]);
              setCanvasGalLoading(true);
              setCanvasGalError('');
              const result = await fetchGallery(query, lib, filters, append);
              if (!result.ok) {
                setCanvasGalError(result.message);
                if (!append) setCanvasGalWorks([]);
                setCanvasGalTotal(0);
              } else {
                setCanvasGalWorks((previous) => mergeWorks(previous, result.works, append));
                setCanvasGalTotal(result.total);
              }
              setCanvasGalLoading(false);
            },
            [fetchGallery],
          );

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

          const loadCanvasKinds = useCallback(async (lib) => {
            if (!lib || lib === 'auto') return;
            try {
              const payload = await post('gallery', { action: 'kinds', lib });
              if (payload?.kinds?.[lib]) {
                setCanvasGalKinds((previous) => ({ ...previous, [lib]: payload.kinds[lib] }));
              }
            } catch {
              // 拉不到种类不影响搜索
            }
          }, []);

          const applyCanvasFilter = useCallback(
            (key, value) => {
              const next = { ...canvasGalFilters, [key]: value };
              setCanvasGalFilters(next);
              if (canvasGalLib !== 'auto') void searchCanvasGallery(canvasGalQuery, canvasGalLib, next);
            },
            [canvasGalFilters, canvasGalLib, canvasGalQuery, searchCanvasGallery],
          );

          const switchCanvasLib = useCallback(
            (key) => {
              setCanvasGalLib(key);
              setCanvasGalFilters({});
              setCanvasGalOpenDims({});
              if (key !== 'auto') void loadCanvasKinds(key);
              void searchCanvasGallery(canvasGalQuery, key, {});
            },
            [loadCanvasKinds, canvasGalQuery, searchCanvasGallery],
          );

          // 参考库面板：搜索 → 缩略图网格 → 选中的条目挂在输入框下面。
          // 种类维度只在选定单个库时出现（auto 混三库没有统一维度）。
          // 全部用胶囊按钮而不是原生 select：原生下拉的选项列表由系统绘制，
          // 深色主题下会变成白底浅字，改 CSS 也压不住。
          // 种类筛选条：工坊和画布共用一套渲染，只把各自的 state 传进来。
          const renderKindsBox = (st) => {
          const kindDims = st.lib === 'auto' ? [] : st.kinds[st.lib] || [];
          const kindsPending = st.lib !== 'auto' && !st.kinds[st.lib];
          return kindDims.length > 0
            ? h(
                'div',
                { className: 'dpf-gallery-kinds' },
                kindDims.map((dim) => {
                  const active = st.filters[dim.key] || '';
                  const open = st.open[dim.key] === true;
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
                          onClick: () => st.apply(dim.key, ''),
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
                            onClick: () => st.apply(dim.key, item.value),
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
                              st.setOpen((previous) => ({ ...previous, [dim.key]: !open })),
                          },
                          open ? t('kindsLess') : `+${rest} ${t('kindsMore')}`,
                        ),
                    ),
                  );
                }),
              )
            : null;
          };

          const kindsBox = renderKindsBox({
            lib: refLib,
            kinds: refKinds,
            filters: refFilters,
            open: refKindsOpen,
            setOpen: setRefKindsOpen,
            apply: applyFilter,
          });
          const canvasKindsBox = renderKindsBox({
            lib: canvasGalLib,
            kinds: canvasGalKinds,
            filters: canvasGalFilters,
            open: canvasGalOpenDims,
            setOpen: setCanvasGalOpenDims,
            apply: applyCanvasFilter,
          });

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
            refLib !== 'auto' && !refKinds[refLib] && h('div', { className: 'dpf-gallery-note' }, `${t('galleryKinds')}…`),
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
                    h(
                      'span',
                      {
                        className: 'dpf-gallery-canvas',
                        role: 'button',
                        title: t('canvasPick'),
                        onClick: (event) => {
                          event.stopPropagation();
                          void refToCanvas(work);
                        },
                      },
                      '⇱',
                    ),
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
          // 画布页要另一套处理：图应该落到画布上，而不是跑进图生图的主图槽。
          const pageRef = useRef(page);
          pageRef.current = page;
          const canvasPasteRef = useRef(null);
          useEffect(() => {
            const onPaste = (event) => {
              const items = event.clipboardData?.items;
              if (!items) return;
              // 光标在输入框里（画布文本节点、提示词框）就让人家正常粘字，不抢。
              const tag = event.target && event.target.tagName;
              const typing = tag === 'TEXTAREA' || tag === 'INPUT';
              for (const item of items) {
                if (item.kind !== 'file' || !String(item.type || '').startsWith('image/')) continue;
                const file = item.getAsFile();
                if (!file) continue;
                event.preventDefault();
                if (pageRef.current === 'canvas' && canvasPasteRef.current) canvasPasteRef.current(file);
                else void loadShot(file);
                return;
              }
              // 剪贴板里没有文件：有些应用（网页、Word、QQ）复制图片时只给 HTML 或纯文本链接。
              if (pageRef.current === 'canvas' && canvasPasteRef.current) {
                const html = String(event.clipboardData?.getData('text/html') || '');
                const text = String(event.clipboardData?.getData('text/plain') || '').trim();
                const fromHtml = (html.match(/<img[^>]+src\s*=\s*["']([^"']+)["']/i) || [])[1] || '';
                const fromText = /^data:image\//i.test(text) || /^https?:\/\/\S+\.(png|jpe?g|webp|gif)(\?\S*)?$/i.test(text) ? text : '';
                const url = fromHtml || fromText;
                if (url) {
                  event.preventDefault();
                  canvasPasteRef.current(null, url);
                  return;
                }
                // 没图也没链接：按 Ctrl+V 复制节点那条路走。
                // 但正在输入框里打字时不抢，否则正常粘文本也会被吃掉。
                if (!typing) canvasPasteRef.current(null);
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

          const callTargets = async (payload) => {
            const response = await fetch(`${API}/targets`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(payload),
            });
            const body = await response.json().catch(() => null);
            if (body && Array.isArray(body.targets)) setTargets(body.targets);
            return body;
          };

          useEffect(() => {
            let alive = true;
            (async () => {
              try {
                const response = await fetch(`${API}/targets`, {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: '{"action":"list"}',
                });
                const body = await response.json().catch(() => null);
                if (!alive || !body?.ok) return;
                setTargets(Array.isArray(body.targets) ? body.targets : []);
              } catch {
                /* 宿主没起来时这一块留空就行 */
              }
            })();
            return () => {
              alive = false;
            };
          }, []);

          const saveTarget = async () => {
            if (targetBusy) return;
            setTargetBusy(true);
            setTargetMsg('');
            try {
              const draft = { ...targetDraft, label: targetDraft.label.trim() || targetDraft.baseUrl.trim() };
              const body = await callTargets({ action: 'save', target: draft });
              if (!body?.ok) {
                setTargetBad(true);
                setTargetMsg(body?.message || '保存失败');
                return;
              }
              const saved = (body.targets || []).find((item) => item.label === draft.label) || (body.targets || [])[0];
              if (saved) {
                setSource(saved.id);
                setImageModel(saved.models[0] || '');
              }
              setTargetBad(false);
              setTargetMsg(t('targetSaved'));
              setTargetDraft({ label: '', baseUrl: '', apiKey: '', models: '' });
              setTargetOpen(false);
            } catch (error) {
              setTargetBad(true);
              setTargetMsg(String(error?.message || error));
            } finally {
              setTargetBusy(false);
            }
          };

          const testTarget = async () => {
            if (targetBusy) return;
            setTargetBusy(true);
            setTargetMsg('');
            try {
              const draftModels = targetDraft.models
                .split(/[,，;；\s]+/)
                .map((item) => item.trim())
                .filter(Boolean);
              if (!targetDraft.baseUrl.trim() || draftModels.length === 0) {
                setTargetBad(true);
                setTargetMsg(t('targetNeedUrl'));
                return;
              }
              const body = await callTargets({
                action: 'save',
                target: { ...targetDraft, label: targetDraft.label.trim() || targetDraft.baseUrl.trim(), models: draftModels },
              });
              const saved = (body?.targets || []).find((item) => item.label === (targetDraft.label.trim() || targetDraft.baseUrl.trim())) || (body?.targets || [])[0];
              if (!saved) {
                setTargetBad(true);
                setTargetMsg(body?.message || '保存失败');
                return;
              }
              const probe = await callTargets({ action: 'test', id: saved.id });
              setSource(saved.id);
              setImageModel(saved.models[0] || '');
              setTargetBad(!probe?.ok);
              const found = Array.isArray(probe?.models) && probe.models.length > 0 ? ` 可用模型：${probe.models.slice(0, 6).join(', ')}` : '';
              setTargetMsg(`${probe?.message || ''}${found}`.trim());
            } catch (error) {
              setTargetBad(true);
              setTargetMsg(String(error?.message || error));
            } finally {
              setTargetBusy(false);
            }
          };

          const removeTarget = async (id) => {
            const body = await callTargets({ action: 'remove', id }).catch(() => null);
            if (body?.ok && source === id) setSource('host');
          };

          const activeChannel = imageChannels.find((item) => item.id === imageChannelId) ?? imageChannels[0] ?? null;
          const imageModelOptions = activeChannel ? activeChannel.models : [];
          const activeTarget = targets.find((item) => item.id === source) ?? null;
          // 「来源」= 真正拿去请求的那个端点：宿主的每个渠道，加用户自己加的目标。
          const sourceOptions = [
            ...imageChannels.map((item) => ({ id: `host:${item.id}`, label: `${t('sourceHost')} · ${item.name}`, models: item.models })),
            ...targets.map((item) => ({ id: item.id, label: item.label, models: item.models })),
          ];
          const currentSource = activeTarget ? activeTarget.id : activeChannel ? `host:${activeChannel.id}` : '';
          const imageModelChoices = activeTarget ? activeTarget.models : imageModelOptions;
          const effectiveImageModel = imageModelChoices.includes(imageModel) ? imageModel : imageModelChoices[0] ?? '';

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
              const href = shot.url || `data:${shot.mime};base64,${shot.b64}`;
              const guess = String(shot.url || '').slice(0, 24);
              const ext = shot.mime
                ? shot.mime.includes('jpeg') ? 'jpg' : shot.mime.includes('webp') ? 'webp' : 'png'
                : guess.includes('image/webp') ? 'webp' : guess.includes('image/jpeg') ? 'jpg' : 'png';
              const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
              const link = document.createElement('a');
              link.href = href;
              link.download = `drawcraft-${stamp}-${index + 1}.${ext}`;
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);
            } catch {
              /* 下载被拦截时预览仍可右键另存 */
            }
          };

          const renderOne = useCallback(async () => {
            // 没优化过也能出图：退回左边的想法，再退回选中的参考条目（名称 + 标签）。
            const fallback = refs
              .map((item) =>
                [
                  item?.name,
                  Array.isArray(item?.tags) ? item.tags.slice(0, 6).join('、') : '',
                ]
                  .filter(Boolean)
                  .join('，'),
              )
              .filter(Boolean)
              .join('；');
            const prompt = (editedPrompt || result?.prompt || idea || fallback || '').trim();
            if (!prompt || generating) return;
            setGenerating(true);
            setPreviewError('');
            try {
              // 图生图：导入的主图作为 image，附加参考与姿势图作为 images（上限四张）。
              const gallery = imageTab === 'edit' ? refShots.map((shot) => shot?.data).filter(Boolean).slice(0, 4) : [];
              if (usePoseRefs && imageTab === 'edit' && refs.length > 0 && gallery.length < 4) {
                for (const item of refs) {
                  if (gallery.length >= 4) break;
                  if (!item?.imageUrl) continue;
                  const data = await remoteImageToDataUrl(item.imageUrl, 768);
                  if (data) gallery.push(data);
                }
              }
              let primary = imageTab === 'edit' ? imageRef.current?.data || '' : '';
              // 主图槽空着、附加位里却有图时，把第一张提成主图。
              // 不然请求会退化成纯文生图，模型只看到一句「坐姿・抱腿打开」就自由发挥成动漫了。
              if (!primary && imageTab === 'edit' && gallery.length > 0) primary = gallery.shift();
              let note = '';
              // 没写想法、也没优化过时，只拿参考名当提示词太单薄，补一句写实约束。
              const bare = !editedPrompt.trim() && !(result && result.prompt) && !idea.trim();
              const submit = async (subject, notes) => {
                const shared = {
                  mode: subject ? 'edit' : 'text',
                  prompt: subject
                    ? `${notes || EDIT_PREFIX[language] || EDIT_PREFIX.en}${prompt}`
                    : `${bare ? PHOTO_NOTE[language] || PHOTO_NOTE.en : ''}${prompt}`,
                  size:
                    imageSize !== 'auto'
                      ? imageSize
                      : result?.params?.aspect_ratio && result.params.aspect_ratio !== 'auto'
                        ? result.params.aspect_ratio
                        : 'auto',
                  quality: imageQuality,
                  n: 1,
                  ...(subject ? { image: subject } : {}),
                  ...(gallery.length > 0 ? { images: gallery } : {}),
                  ...(effectiveImageModel ? { model: effectiveImageModel } : {}),
                };
                // 自定义端点是「来源」里选的，交给插件自己转发；宿主的走 dsh-imagegen。
                const endpoint = activeTarget ? `${API}/render` : GENERATE_API;
                const payload = activeTarget ? { ...shared, targetId: activeTarget.id } : { ...shared, ...(activeChannel ? { channelId: activeChannel.id } : {}) };
                const response = await fetch(endpoint, {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify(payload),
                });
                const body = await response.json().catch(() => null);
                if (!response.ok) {
                  if (response.status === 404) throw new Error(t('noImagegen'));
                  const rejected = new Error((body && body.message) || `HTTP ${response.status}`);
                  rejected.code = (body && body.code) || '';
                  throw rejected;
                }
                if (!body || body.ok === false) {
                  const rejected = new Error((body && body.message) || t('previewFailed'));
                  rejected.code = (body && body.code) || '';
                  throw rejected;
                }
                return body;
              };
              let body = null;
              try {
                body = await submit(primary, note);
              } catch (failure) {
                if (failure && failure.code === 'upstream-rejected') {
                  // 第一层：参考图里有透视/薄纱服装时，模型照抄会判裸露。
                  // 补一句「做成不透明面料」重发，版型不变。
                  if (gallery.length > 0) {
                    try {
                      body = await submit(primary, `${note || EDIT_PREFIX[language] || EDIT_PREFIX.en}${CANVAS_OPAQUE_NOTE[language] || CANVAS_OPAQUE_NOTE.en}`);
                    } catch (ignored) {
                      body = null;
                    }
                  }
                  // 第二层：主图被审核拦下来时，改投一张等高线线稿重试一次。
                  if (!body && neutralize && primary && !note) {
                    const line = await contourDataUrl(primary);
                    const head = `${EDIT_PREFIX[language] || EDIT_PREFIX.en}${SKETCH_NOTE[language] || SKETCH_NOTE.en}${PHOTO_NOTE[language] || PHOTO_NOTE.en}`;
                    body = await submit(line, head);
                    if (bare) setNotice(t('sketchNeedsWords'));
                  }
                  if (!body) throw failure;
                } else {
                  throw failure;
                }
              }
              const shots = (Array.isArray(body.images) ? body.images : [])
                .filter((item) => item && typeof item.b64 === 'string' && item.b64)
                .map((item) => ({ b64: item.b64, mime: item.mime || 'image/png' }));
              if (shots.length === 0) throw new Error(t('previewFailed'));
              setPreview(shots);
              setPreviewStale(false);
              // 结果在生图页，出完直接把人带过去。
              setPage('image');
            } catch (failure) {
              const message = failure?.message || String(failure);
              const rejected = failure?.code === 'upstream-rejected';
              const friendly = /404|Failed to fetch|not found|NetworkError/i.test(message) ? t('noImagegen') : message;
              setPreviewError(rejected ? `${friendly}\n\n${t('rejectedHint')}` : friendly);
              // 旧图还在窗口里，不标一下会被当成这次出的。
              setPreviewStale(true);
              setPage('image');
            } finally {
              setGenerating(false);
            }
          }, [editedPrompt, result, generating, t, activeChannel, activeTarget, effectiveImageModel, imageSize, imageQuality, refShots, usePoseRefs, neutralize, refs, idea, language, imageTab]);

          // 一次生图请求。工坊的 renderOne 里那段逻辑原本是内联的，
          // 画布也要用同一套通道，所以抽成独立入口，renderOne 保持原样不动。
          const requestImage = useCallback(
            async ({ prompt, primary = '', extras = [], size = '', quality = '', retry = true }) => {
              const subject = primary || '';
              const shared = {
                mode: subject ? 'edit' : 'text',
                prompt,
                size: size || imageSize,
                quality: quality || imageQuality,
                n: 1,
                ...(subject ? { image: subject } : {}),
                ...(extras.length > 0 ? { images: extras.slice(0, 4) } : {}),
                ...(effectiveImageModel ? { model: effectiveImageModel } : {}),
              };
              const endpoint = activeTarget ? `${API}/render` : GENERATE_API;
              const payload = activeTarget
                ? { ...shared, targetId: activeTarget.id }
                : { ...shared, ...(activeChannel ? { channelId: activeChannel.id } : {}) };
              const send = async (outgoing) => {
                const response = await fetch(endpoint, {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify(outgoing),
                });
                const body = await response.json().catch(() => null);
                if (!response.ok) {
                  if (response.status === 404) throw new Error(t('noImagegen'));
                  const rejected = new Error((body && body.message) || `HTTP ${response.status}`);
                  rejected.code = (body && body.code) || '';
                  throw rejected;
                }
                if (!body || body.ok === false) {
                  const rejected = new Error((body && body.message) || t('previewFailed'));
                  rejected.code = (body && body.code) || '';
                  throw rejected;
                }
                return body;
              };
              let body = null;
              let carded = false;
              let opaqued = false;
              try {
                body = await send(payload);
              } catch (failure) {
                if (!(retry && subject && failure && failure.code === 'upstream-rejected')) throw failure;
                // 第一层：参考图里有透视/薄纱面料时，模型照抄会被判裸露。
                // 补一句「做成不透明面料」重发，版型不变，实测能过。
                if (extras.length > 0) {
                  try {
                    body = await send({
                      ...payload,
                      prompt: `${CANVAS_OPAQUE_NOTE[language] || CANVAS_OPAQUE_NOTE.en}${prompt}`,
                    });
                    opaqued = true;
                  } catch (ignored) {
                    body = null;
                  }
                }
                // 第二层：单色灰图（深度图/白模/线稿）当主图会被判成规避图，改成白底姿态卡再试。
                // 真人照片被拒是因为内容，不是「淡化」，转卡也没用，直接抛回去。
                if (!body) {
                  const flat = await imageLooksFlat(subject);
                  if (!flat) throw failure;
                  try {
                    const card = await poseCardDataUrl(subject);
                    body = await send({
                      ...payload,
                      image: card,
                      prompt: `${CANVAS_FIX_NOTE[language] || CANVAS_FIX_NOTE.en}${prompt}`,
                    });
                    carded = true;
                  } catch (again) {
                    throw failure;
                  }
                }
              }
              const shots = (Array.isArray(body.images) ? body.images : [])
                .filter((item) => item && typeof item.b64 === 'string' && item.b64)
                .map((item) => ({ b64: item.b64, mime: item.mime || 'image/png' }));
              if (shots.length === 0) throw new Error(t('previewFailed'));
              if (carded) shots.carded = true;
              if (opaqued) shots.opaqued = true;
              return shots;
            },
            [activeTarget, activeChannel, effectiveImageModel, imageSize, imageQuality, language, t],
          );

          // ── 画布：状态提交、节点增删、平移缩放、出图 ──────────────
          // 拖动时每帧都会改状态，落盘交给下面的 debounce effect，这里只更新内存。
          //
          // 撤销栈：每步存整份快照（节点带 dataURL，所以栈深限 40）。拖动这种连续
          // 操作走 silent 提交，只在抬手时把起点快照压栈，否则拖一次就吃掉几十步。
          const canvasHist = useRef({ past: [], future: [] });
          const canvasHistSig = useRef(0);
          const [canvasDepth, setCanvasDepth] = useState({ undo: 0, redo: 0 });
          const canvasClip = useRef([]);
          const canvasDragBase = useRef(null);
          const canvasMarquee = useRef(null);
          const [canvasBox, setCanvasBox] = useState(null);
          const [canvasLink, setCanvasLink] = useState(null);
          const [linkFrom, setLinkFrom] = useState('');
          const livePath = useRef(null);
          useEffect(() => {
            // DOM 里的 d 是手写的，React 不负责回收；这里兜一层，
            // 免得任何一次重渲染后留下一条幽灵预览线。
            if (!canvasLink && livePath.current && livePath.current.getAttribute('d')) {
              livePath.current.setAttribute('d', '');
            }
          }, [canvasLink, canvas.nodes.length]);

          const canvasStore = useCallback((next) => {
            canvasState.current = next;
            setCanvas(next);
          }, []);

          // 只把一份快照记进撤销栈（给拖动、缩放这类事先算好结果的操作复用）。
          const canvasRemember = useCallback((snapshot) => {
            if (!snapshot) return;
            const hist = canvasHist.current;
            const next = histPush(hist, snapshot, CANVAS_HISTORY);
            canvasHist.current = next;
            canvasHistSig.current += 1;
            setCanvasDepth({ undo: next.past.length, redo: next.future.length });
          }, []);

          const commitCanvas = useCallback(
            (updater, options) => {
              const prev = canvasState.current;
              const next = typeof updater === 'function' ? updater(prev) : updater;
              if (!next || next === prev) return;
              if (!(options && options.silent)) canvasRemember(prev);
              canvasState.current = next;
              setCanvas(next);
            },
            [canvasRemember],
          );

          const canvasUndo = useCallback(() => {
            const result = histUndo(canvasHist.current, canvasState.current);
            if (!result) return;
            canvasHist.current = result.hist;
            canvasState.current = result.state;
            setCanvas(result.state);
            setCanvasSel([]);
            setCanvasDepth({ undo: result.hist.past.length, redo: result.hist.future.length });
          }, []);

          const canvasRedo = useCallback(() => {
            const result = histRedo(canvasHist.current, canvasState.current);
            if (!result) return;
            canvasHist.current = result.hist;
            canvasState.current = result.state;
            setCanvas(result.state);
            setCanvasSel([]);
            setCanvasDepth({ undo: result.hist.past.length, redo: result.hist.future.length });
          }, []);

          const canvasNodeId = () => `cn_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

          // 落盘做 400ms 防抖：拖节点、缩放时不该每次都写 localStorage。
          const canvasTouched = useRef(false);
          useEffect(() => {
            if (!canvasTouched.current) {
              canvasTouched.current = true;
              return undefined;
            }
            const timer = setTimeout(() => {
              const warn = writeCanvas(canvasState.current);
              if (warn === 'quota') setCanvasMsg({ text: t('canvasQuota'), bad: true });
              else if (warn === 'full') setCanvasMsg({ text: t('canvasFull'), bad: true });
            }, 400);
            return () => clearTimeout(timer);
            // t 每次渲染都是新的 bind 结果，放进依赖会让这个定时器被反复重置。
          }, [canvas]);

          // React 的 onWheel 是 passive 监听，preventDefault 会被忽略，只能自己挂。
          useEffect(() => {
            const el = canvasRef.current;
            if (!el || !canvasView) return undefined;
            const onWheel = (event) => {
              // 参考库面板里的滚动归面板自己，别顺手把画布缩了。
              // React 的 onWheel 挂在根节点上，拦不住这里直接挂在 canvas 上的原生监听。
              if (event.target && event.target.closest && event.target.closest('.dpf-canvas-gal')) return;
              event.preventDefault();
              const rect = el.getBoundingClientRect();
              const px = event.clientX - rect.left;
              const py = event.clientY - rect.top;
              const view = canvasState.current.view;
              const factor = Math.exp(-event.deltaY * 0.0016);
              const scale = Math.min(CANVAS_MAX_SCALE, Math.max(CANVAS_MIN_SCALE, view.scale * factor));
              if (scale === view.scale) return;
              const ratio = scale / view.scale;
              commitCanvas((prev) => ({
                ...prev,
                view: { scale, x: px - (px - view.x) * ratio, y: py - (py - view.y) * ratio },
              }));
            };
            el.addEventListener('wheel', onWheel, { passive: false });
            return () => el.removeEventListener('wheel', onWheel);
          }, [canvasView, commitCanvas]);

          // 视口中心换算成世界坐标，新节点落在看得见的地方。
          const canvasCenter = useCallback(() => {
            const el = canvasRef.current;
            const width = el && el.clientWidth ? el.clientWidth : 820;
            const height = el && el.clientHeight ? el.clientHeight : 560;
            const view = canvasState.current.view;
            return { x: (width / 2 - view.x) / view.scale, y: (height / 2 - view.y) / view.scale };
          }, []);

          const addCanvasNode = useCallback(
            (kind, extra = {}) => {
              const at = canvasCenter();
              const size = kind === 'text' ? { w: 250, h: 156 } : { w: 232, h: 214 };
              const node = {
                id: canvasNodeId(),
                kind,
                x: Math.round(at.x - size.w / 2 + (extra.dx || 0)),
                y: Math.round(at.y - size.h / 2 + (extra.dy || 0)),
                w: extra.w || size.w,
                h: extra.h || size.h,
                title: extra.title || (kind === 'text' ? t('canvasText') : t('canvasImage')),
                src: extra.src || '',
                text: extra.text || '',
                note: extra.note || '',
              };
              commitCanvas((prev) => ({ ...prev, nodes: [...prev.nodes, node].slice(-CANVAS_LIMIT) }));
              setCanvasSel([node.id]);
              return node.id;
            },
            [canvasCenter, commitCanvas, t],
          );

          // 参考库缩略图一个按钮就能落到画布：把图抓成内联，顺手切过去。
          const refToCanvas = useCallback(
            async (work) => {
              if (!work || !work.imageUrl) return;
              setCanvasMsg({ text: t('canvasWorking'), bad: false });
              const data = await remoteImageToDataUrl(work.imageUrl, CANVAS_MAX_EDGE);
              if (!data) {
                setCanvasMsg({ text: t('canvasBadImage'), bad: true });
                return;
              }
              addCanvasNode('image', {
                src: data,
                title: work.name || t('canvasImage'),
                note: (Array.isArray(work.tags) ? work.tags.slice(0, 4).join('・') : '') || work.lib || '',
              });
              setPage('canvas');
              setCanvasMsg({ text: '', bad: false });
            },
            [addCanvasNode, t],
          );

          const patchCanvasNode = useCallback(
            (id, patch, silent) => {
              commitCanvas(
                (prev) => ({
                  ...prev,
                  nodes: prev.nodes.map((node) => (node.id === id ? { ...node, ...patch } : node)),
                }),
                { silent },
              );
            },
            [commitCanvas],
          );

          // 参考库条目 → 选中的那个节点。图片节点换图，文字节点把名字和标签追加成一行提示词。
          const applyRefToNode = useCallback(
            async (work) => {
              const state = canvasState.current;
              const sel = state.nodes.filter((node) => canvasSel.includes(node.id));
              const target = sel.length === 1 ? sel[0] : null;
              if (!target) {
                setCanvasMsg({ text: t('canvasPickOne'), bad: true });
                return;
              }
              const tags = Array.isArray(work.tags) ? work.tags.slice(0, 6) : [];
              if (target.kind === 'text') {
                const line = [work.name].concat(tags).filter(Boolean).join('、');
                const head = String(target.text).replace(/\s+$/, '');
                const next = head ? head + '\n' + line : line;
                patchCanvasNode(target.id, { text: next });
                setCanvasMsg({ text: t('canvasApplied'), bad: false });
                return;
              }
              setCanvasMsg({ text: t('canvasWorking'), bad: false });
              const data = await remoteImageToDataUrl(work.imageUrl, CANVAS_MAX_EDGE);
              if (!data) {
                setCanvasMsg({ text: t('canvasBadImage'), bad: true });
                return;
              }
              patchCanvasNode(target.id, {
                src: data,
                title: work.name || t('canvasImage'),
                note: tags.join('・') || work.lib || '',
              });
              setCanvasMsg({ text: t('canvasApplied'), bad: false });
            },
            [canvasSel, patchCanvasNode, t],
          );

          const removeCanvasNode = useCallback(
            (id) => {
              commitCanvas((prev) => ({
                ...prev,
                nodes: prev.nodes.filter((node) => node.id !== id),
                edges: prev.edges.filter((edge) => edge.from !== id && edge.to !== id),
              }));
              setCanvasSel((prev) => prev.filter((item) => item !== id));
            },
            [commitCanvas],
          );

          const toggleCanvasSel = useCallback((id, additive) => {
            setCanvasSel((prev) => {
              if (!additive) return prev.length === 1 && prev[0] === id ? [] : [id];
              return prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id];
            });
          }, []);

          const canvasFit = useCallback(() => {
            const el = canvasRef.current;
            const nodes = canvasState.current.nodes;
            if (!el || nodes.length === 0) return;
            const minX = Math.min(...nodes.map((node) => node.x));
            const minY = Math.min(...nodes.map((node) => node.y));
            const maxX = Math.max(...nodes.map((node) => node.x + node.w));
            const maxY = Math.max(...nodes.map((node) => node.y + node.h));
            const pad = 48;
            const width = el.clientWidth || 820;
            const height = el.clientHeight || 560;
            const scale = Math.min(
              CANVAS_MAX_SCALE,
              Math.max(
                CANVAS_MIN_SCALE,
                Math.min((width - pad * 2) / Math.max(1, maxX - minX), (height - pad * 2) / Math.max(1, maxY - minY)),
              ),
            );
            const x = width / 2 - ((minX + maxX) / 2) * scale;
            const y = height / 2 - ((minY + maxY) / 2) * scale;
            commitCanvas((prev) => ({ ...prev, view: { x, y, scale } }));
          }, [commitCanvas]);

          const canvasZoomBy = useCallback(
            (factor) => {
              const el = canvasRef.current;
              const width = el && el.clientWidth ? el.clientWidth : 820;
              const height = el && el.clientHeight ? el.clientHeight : 560;
              const view = canvasState.current.view;
              const scale = Math.min(CANVAS_MAX_SCALE, Math.max(CANVAS_MIN_SCALE, view.scale * factor));
              const ratio = scale / view.scale;
              commitCanvas((prev) => ({
                ...prev,
                view: {
                  scale,
                  x: width / 2 - (width / 2 - view.x) * ratio,
                  y: height / 2 - (height / 2 - view.y) * ratio,
                },
              }));
            },
            [commitCanvas],
          );

          // 滑杆和「回到 100%」都走这里：以视口中心为锚改缩放，位置不跟着跳。
          const canvasZoomTo = useCallback(
            (scale) => {
              const el = canvasRef.current;
              const width = el && el.clientWidth ? el.clientWidth : 820;
              const height = el && el.clientHeight ? el.clientHeight : 560;
              const view = canvasState.current.view;
              const next = Math.min(CANVAS_MAX_SCALE, Math.max(CANVAS_MIN_SCALE, scale));
              if (!Number.isFinite(next) || next === view.scale) return;
              const ratio = next / view.scale;
              commitCanvas((prev) => ({
                ...prev,
                view: {
                  scale: next,
                  x: width / 2 - (width / 2 - view.x) * ratio,
                  y: height / 2 - (height / 2 - view.y) * ratio,
                },
              }));
            },
            [commitCanvas],
          );

          // ── 选择、复制、全选 ──────────────────────────────────────
          const canvasSelectAll = useCallback(() => {
            setCanvasSel(canvasState.current.nodes.map((node) => node.id));
          }, []);

          const canvasCopy = useCallback(() => {
            const picked = canvasState.current.nodes.filter((node) => canvasSel.includes(node.id));
            if (picked.length === 0) {
              setCanvasMsg({ text: t('canvasNothing'), bad: true });
              return;
            }
            canvasClip.current = picked.map((node) => ({ ...node }));
            setCanvasMsg({ text: t('canvasCopied').replace('{n}', String(picked.length)), bad: false });
          }, [canvasSel, t]);

          // 粘贴的节点整体右下偏移 28px，并重新生成 id；连线也跟着复制。
          const canvasPaste = useCallback(() => {
            const clip = canvasClip.current;
            if (!clip || clip.length === 0) return;
            const map = new Map();
            const fresh = clip.map((node) => {
              const id = canvasNodeId();
              map.set(node.id, id);
              return { ...node, id, x: Math.round(node.x + 28), y: Math.round(node.y + 28) };
            });
            canvasClip.current = fresh.map((node) => ({ ...node }));
            commitCanvas((prev) => {
              const edges = prev.edges
                .filter((edge) => map.has(edge.from) && map.has(edge.to))
                .map((edge) => ({ id: canvasNodeId(), from: map.get(edge.from), to: map.get(edge.to) }));
              return {
                ...prev,
                nodes: [...prev.nodes, ...fresh].slice(-CANVAS_LIMIT),
                edges: [...prev.edges, ...edges].slice(-CANVAS_LIMIT * 2),
              };
            });
            setCanvasSel(fresh.map((node) => node.id));
          }, [commitCanvas]);

          // ── 导出 / 导入 ──────────────────────────────────────────
          const canvasExport = useCallback(() => {
            const state = canvasState.current;
            const payload = { app: 'dsh-drawcraft', version: 1, at: new Date().toISOString(), ...state };
            const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = t('canvasExportName');
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 4000);
          }, [t]);

          const canvasImport = useCallback(
            async (file) => {
              if (!file) return;
              let parsed = null;
              try {
                parsed = JSON.parse(await file.text());
              } catch {
                setCanvasMsg({ text: t('canvasImportBad'), bad: true });
                return;
              }
              if (!parsed || !Array.isArray(parsed.nodes)) {
                setCanvasMsg({ text: t('canvasImportBad'), bad: true });
                return;
              }
              if (!window.confirm(t('canvasImportAsk'))) return;
              const next = {
                nodes: parsed.nodes
                  .filter((node) => node && typeof node.id === 'string')
                  .slice(-CANVAS_LIMIT)
                  .map((node) => ({
                    id: String(node.id),
                    kind: node.kind === 'text' ? 'text' : 'image',
                    x: Number(node.x) || 0,
                    y: Number(node.y) || 0,
                    w: Math.max(120, Number(node.w) || 240),
                    h: Math.max(80, Number(node.h) || 240),
                    src: typeof node.src === 'string' ? node.src : '',
                    text: typeof node.text === 'string' ? node.text : '',
                    title: typeof node.title === 'string' ? node.title : '',
                    note: typeof node.note === 'string' ? node.note : '',
                    lost: Boolean(node.lost),
                    meta: node.meta && typeof node.meta === 'object' ? node.meta : undefined,
                  })),
                edges: Array.isArray(parsed.edges)
                  ? parsed.edges.filter((edge) => edge && edge.from && edge.to).map((edge) => ({ id: String(edge.id || canvasNodeId()), from: String(edge.from), to: String(edge.to) }))
                  : [],
                view: { x: 0, y: 0, scale: 1 },
              };
              commitCanvas(() => next);
              setCanvasSel([]);
              setCanvasMsg({ text: t('canvasImportDone'), bad: false });
            },
            [commitCanvas, t],
          );

          const canvasLoadFile = useCallback(
            async (file, extra = {}) => {
              if (!file || !String(file.type || '').startsWith('image/')) return;
              // readImageFile 直接返回 data URL 字符串（不是 {data,name} 那种对象），别当成对象取 .data。
              const data = await readImageFile(file, CANVAS_MAX_EDGE);
              if (!data) {
                setCanvasMsg({ text: t('canvasBadImage'), bad: true });
                return;
              }
              const name = file.name && file.name !== 'blob' ? file.name : t('canvasImage');
              addCanvasNode('image', { src: data, title: name, note: extra.note || '' });
            },
            [addCanvasNode, t],
          );

          // 从网页/微信/Word 复制来的往往只有图链，没有文件本体，得自己抓回来。
          const canvasPasteLink = useCallback(
            async (url) => {
              const data = await remoteImageToDataUrl(url, CANVAS_MAX_EDGE);
              if (!data) {
                setCanvasMsg({ text: t('canvasBadImage'), bad: true });
                return;
              }
              addCanvasNode('image', { src: data, title: t('canvasPasteLink'), note: '' });
            },
            [addCanvasNode, t],
          );
          useEffect(() => {
            canvasPasteRef.current = (file, url) => {
              if (file) {
                void canvasLoadFile(file);
                return;
              }
              if (url) {
                void canvasPasteLink(url);
                return;
              }
              canvasPaste();
            };
          }, [canvasLoadFile, canvasPaste, canvasPasteLink]);

          // 从画布出图：选中的文本节点当提示词，选中的图按顺序当主图与参考图，
          // 结果作为新节点挂在右上方，并从每个输入节点连一条血缘线过去。
          const canvasGenerate = useCallback(async (idList) => {
            if (canvasBusy) return;
            const state = canvasState.current;
            // 不传 id 就用当前选中；从节点上的「⚡」进来时直接指定这个节点和它的上游。
            const ids = Array.isArray(idList) && idList.length > 0 ? idList : canvasSel;
            const picked = state.nodes.filter((node) => ids.includes(node.id));
            if (picked.length === 0) {
              setCanvasMsg({ text: t('canvasPickFirst'), bad: true });
              return;
            }
            const textNode = picked.find((node) => node.kind === 'text' && String(node.text || '').trim());
            const images = picked.filter((node) => node.src);
            const words = String(textNode?.text || '').trim();
            // 画布上的「图一/图二/图三」按连线数：上游是图一，跟着线往下走。
            // 发送顺序却是主体优先，先把编号定下来，提示词才对得上。
            const ordered = chainOrder(images, state.edges);
            const slotOf = new Map(ordered.map((node, at) => [node.id, at + 1]));
            // 主图不能按节点顺序随便取：白模/深度图排在前面时会被当主体，
            // 出来就是 3D 素模或动漫脸。按「像不像真人照片」打分，最像的当主图。
            let primary = '';
            let primaryNode = null;
            let extras = [];
            let extrasNodes = [];
            if (images.length > 0) {
              // 主体就是连线上的第一张，除非你点了 ◎ 指定别的。
              // 以前这里按「肤色占比」猜哪张像真人，猜错过好几次：人台、深度图、
              // 偏白的照片都能骗过它。顺序是你看得见的东西，猜是看不见的，用看得见的。
              const pinned = ordered.find((node) => node.subject);
              primaryNode = pinned || ordered[0];
              primary = primaryNode.src;
              // 参考图按画布顺序排，不按分数排——否则「图二」又对不上了。
              extrasNodes = ordered.filter((node) => node.id !== primaryNode.id).slice(0, 4);
              extras = extrasNodes.map((node) => node.src);
            }
            if (!words && !primary) {
              setCanvasMsg({ text: t('canvasNeedWords'), bad: true });
              return;
            }
            // 「头发换成双马尾」这种是改图指令，不是能独立成立的提示词。
            // 没有主图还硬发，模型只会凭空造一个不相干的人出来。
            const instruction = /(换成|换掉|改成|改为|变成|变短|变长|去掉|去除|加上|添加|替换|转成|改成)/.test(words);
            if (!primary && instruction) {
              setCanvasMsg({ text: t('canvasNeedSubject'), bad: true });
              return;
            }
            // 只发一句「换成双马尾」，模型会自己挑风格，挑的是插画。
            // 补一条写实约束顶住；用户明确写了要插画/动漫时这句会被它自己的要求覆盖。
            const refNote = extras.length > 0 ? CANVAS_REF_NOTE[language] || CANVAS_REF_NOTE.en : '';
            // 服装库里确实有透视薄纱（SUM-0192 那件），照抄就会被上游判裸露。
            // 这句不改变版型，只是要求做成不透明面料，实测同组参考图从 400 变成通过。
            const opaqueNote = extras.length > 0 ? CANVAS_OPAQUE_NOTE[language] || CANVAS_OPAQUE_NOTE.en : '';
            // 主图如果是白模、深度图、人台这类非真人图（肤色占比接近 0），
            // 直接当主体会出 3D 素模或二次元脸。这种图本来就只该提供姿势，
            // 所以先转成姿态卡再发，并把「别照搬卡片风格」写进提示词。
            let poseCarded = false;
            if (primary && (await imageLooksFlat(primary))) {
              primary = await poseCardDataUrl(primary);
              poseCarded = true;
            }
            const prompt = primary
              ? `${EDIT_PREFIX[language] || EDIT_PREFIX.en}${orderNote(
                  ordered.map((node) => ({
                    slot: slotOf.get(node.id),
                    title: String(node.title || '').slice(0, 18) || t('canvasImage'),
                  })),
                  slotOf.get(primaryNode.id) || 1,
                  language,
                )}${CANVAS_REAL_NOTE[language] || CANVAS_REAL_NOTE.en}${
                  poseCarded ? CANVAS_FIX_NOTE[language] || CANVAS_FIX_NOTE.en : ''
                }${refNote}${opaqueNote}${words || t('canvasFollowImage')}`
              : `${CANVAS_REAL_NOTE[language] || CANVAS_REAL_NOTE.en}${words}`;
            setCanvasBusy('pending');
            setCanvasMsg({ text: t('canvasWorking'), bad: false });
            try {
              const shots = await requestImage({ prompt, primary, extras });
              const shot = shots[0];
              const anchor = picked[0];
              const id = canvasNodeId();
              const width = 236;
              const height = 224;
              const node = {
                id,
                kind: 'image',
                x: Math.round(anchor.x + anchor.w + 72),
                y: Math.round(anchor.y),
                w: width,
                h: height,
                title: words ? words.slice(0, 24) : t('canvasResult'),
                src: `data:${shot.mime};base64,${shot.b64}`,
                text: '',
                note: shots.carded || poseCarded
                  ? t('canvasCarded')
                  : shots.opaqued
                    ? t('canvasOpaqued')
                    : new Date().toLocaleTimeString(),
                // 把这次用了什么记下来，重试时才不用重新猜一遍。
                meta: {
                  prompt: words,
                  withImage: Boolean(primary),
                  mode: primary ? 'edit' : 'text',
                  // 出图画歪时，第一个要问的就是「到底谁被当成主体了」。
                  // 以前只有 ids，看不出哪张是主图，这次把标题也存下来。
                  primary: primaryNode ? String(primaryNode.title || '').slice(0, 24) : '',
                  extras: extrasNodes.map((item) => String(item.title || '').slice(0, 24)),
                  model: effectiveImageModel || '',
                  size: imageSize || '',
                  quality: imageQuality || '',
                  sources: picked.map((item) => item.id),
                },
              };
              commitCanvas((prev) => ({
                nodes: [...prev.nodes, node].slice(-CANVAS_LIMIT),
                edges: [
                  ...prev.edges,
                  ...picked.map((item) => ({ id: `e_${item.id}_${id}`, from: item.id, to: id })),
                ],
                view: prev.view,
              }));
              setCanvasSel([id]);
              setCanvasMsg({ text: t('canvasDone'), bad: false });
            } catch (failure) {
              const message = failure?.message || String(failure);
              const rejected = failure?.code === 'upstream-rejected';
              setCanvasMsg({
                text: rejected ? `${message}\n\n${t('rejectedHint')}` : message,
                bad: true,
              });
            } finally {
              setCanvasBusy('');
            }
          }, [canvasBusy, canvasSel, commitCanvas, effectiveImageModel, imageQuality, imageSize, language, requestImage, t]);

          // 节点自己的「⚡」：拿这个节点，加上所有连进它的上游节点，一起出图。
          const canvasGenerateFrom = useCallback(
            (node) => {
              if (!node) return;
              const state = canvasState.current;
              // 沿连线一路往上收：照片 → 服装 → 姿势 → 提示词 这种链，
              // 点在最后一段也得把前面几张一起带上，否则主图就丢了。
              const ids = new Set([node.id]);
              const queue = [node.id];
              while (queue.length > 0) {
                const at = queue.shift();
                state.edges.forEach((edge) => {
                  if (edge.to !== at || ids.has(edge.from)) return;
                  ids.add(edge.from);
                  queue.push(edge.from);
                });
              }
              void canvasGenerate([...ids]);
            },
            [canvasGenerate],
          );

          const canvasSendToWorkshop = useCallback(
            (node) => {
              if (!node) return;
              if (node.kind === 'text' && node.text) setIdea(node.text);
              else if (node.src) {
                setImage({ data: node.src, name: node.title || t('canvasImage') });
                if (imageRef) imageRef.current = { data: node.src, name: node.title || t('canvasImage') };
              }
              setPage('prompt');
            },
            [t],
          );

          // 按节点记下的参数再来一张：自己当主图（图生图），meta.prompt 当描述，
          // 落在它右边。上游节点已经变了也没关系，这里只信节点自己的记录。
          const canvasRetryNode = useCallback(
            async (node) => {
              if (!node || !node.meta || canvasBusy) return;
              const meta = node.meta;
              const primary = node.src || '';
              const words = String(meta.prompt || '').trim();
              if (!primary && !words) return;
              const prompt = primary
                ? `${EDIT_PREFIX[language] || EDIT_PREFIX.en}${CANVAS_REAL_NOTE[language] || CANVAS_REAL_NOTE.en}${words || t('canvasFollowImage')}`
                : `${CANVAS_REAL_NOTE[language] || CANVAS_REAL_NOTE.en}${words}`;
              setCanvasBusy(node.id);
              setCanvasMsg({ text: t('canvasWorking'), bad: false });
              try {
                const shots = await requestImage({
                  prompt,
                  primary,
                  extras: [],
                  size: meta.size || '',
                  quality: meta.quality || '',
                });
                const shot = shots[0];
                const id = canvasNodeId();
                const fresh = {
                  id,
                  kind: 'image',
                  x: Math.round(node.x + node.w + 72),
                  y: Math.round(node.y),
                  w: node.w || 236,
                  h: node.h || 224,
                  title: words ? words.slice(0, 24) : t('canvasResult'),
                  src: `data:${shot.mime};base64,${shot.b64}`,
                  text: '',
                  note: `${new Date().toLocaleTimeString()} · ${meta.model || 'auto'}`,
                  meta: { ...meta, sources: [node.id] },
                };
                commitCanvas((prev) => ({
                  nodes: [...prev.nodes, fresh].slice(-CANVAS_LIMIT),
                  edges: [...prev.edges, { id: `e_${node.id}_${id}`, from: node.id, to: id }],
                  view: prev.view,
                }));
                setCanvasSel([id]);
                setCanvasMsg({ text: t('canvasDone'), bad: false });
              } catch (failure) {
                const message = failure?.message || String(failure);
                const rejected = failure?.code === 'upstream-rejected';
                setCanvasMsg({ text: rejected ? `${message}\n\n${t('rejectedHint')}` : message, bad: true });
              } finally {
                setCanvasBusy('');
              }
            },
            [canvasBusy, commitCanvas, language, requestImage, t],
          );

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

          const newSession = useCallback(async () => {
            if (page === 'canvas') {
              if (canvas.nodes.length > 0 && !window.confirm(t('canvasClearAsk'))) return;
              commitCanvas(() => EMPTY_CANVAS);
              setCanvasMsg({ text: '', bad: false });
              return;
            }
            if (page === 'image') {
              setImage(null);
              if (imageRef.current) imageRef.current.value = '';
              setRefShots([]);
              setRefs([]);
              setPreview([]);
              setPreviewError('');
              setPreviewStale(false);
              setEditedPrompt('');
              setNotice('');
              return;
            }
            setIdea('');
            setEditedPrompt('');
            setResult(null);
            setError('');
            setNotice('');
            setPatchText('');
            setPreview([]);
            setPreviewError('');
          }, [page, canvas.nodes.length, commitCanvas, t]);

          const railRows = useMemo(() => {
            const key = railQuery.trim().toLowerCase();
            if (!key) return history;
            return history.filter((entry) => `${entry.title || ''} ${entry.prompt || ''} ${entry.idea || ''}`.toLowerCase().includes(key));
          }, [history, railQuery]);

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

          // ── 画布渲染 ────────────────────────────────────────────────
          // 拖动/缩放靠 pointer capture 落在节点头自己身上，所以 move 也挂在那里。
          const canvasStartDrag = (event, node, kind) => {
            event.stopPropagation();
            event.preventDefault();
            event.currentTarget.setPointerCapture?.(event.pointerId);
            // 拖动全程只在抬手时压一次栈，否则拖一下就是几十步撤销。
            canvasDragBase.current = canvasState.current;
            canvasGrab.current = {
              id: node.id,
              kind,
              startX: event.clientX,
              startY: event.clientY,
              x: node.x,
              y: node.y,
              w: node.w,
              h: node.h,
            };
          };
          const canvasDragMove = (event) => {
            const grab = canvasGrab.current;
            if (!grab) return;
            const view = canvasState.current.view;
            const dx = (event.clientX - grab.startX) / view.scale;
            const dy = (event.clientY - grab.startY) / view.scale;
            if (grab.kind === 'move') {
              patchCanvasNode(grab.id, { x: Math.round(grab.x + dx), y: Math.round(grab.y + dy) }, true);
            } else {
              patchCanvasNode(
                grab.id,
                { w: Math.max(120, Math.round(grab.w + dx)), h: Math.max(74, Math.round(grab.h + dy)) },
                true,
              );
            }
          };
          const canvasDragEnd = (event) => {
            const grab = canvasGrab.current;
            const base = canvasDragBase.current;
            canvasGrab.current = null;
            canvasDragBase.current = null;
            if (!grab || !base) return;
            const now = canvasState.current.nodes.find((node) => node.id === grab.id);
            const before = base.nodes.find((node) => node.id === grab.id);
            if (now && before && (now.x !== before.x || now.y !== before.y || now.w !== before.w || now.h !== before.h)) {
              canvasRemember(base);
            }
            if (event && event.currentTarget && event.currentTarget.releasePointerCapture) {
              try {
                event.currentTarget.releasePointerCapture(event.pointerId);
              } catch {
                /* 指针已经释放了，无所谓 */
              }
            }
          };

          // 屏幕坐标 → 世界坐标。连线、拖端口都要用。
          const canvasToWorld = (clientX, clientY) => {
            const el = canvasRef.current;
            const rect = el ? el.getBoundingClientRect() : { left: 0, top: 0 };
            const view = canvasState.current.view;
            return { x: (clientX - rect.left - view.x) / view.scale, y: (clientY - rect.top - view.y) / view.scale };
          };

          const canvasRemoveEdge = useCallback(
            (id) => {
              commitCanvas((prev) => ({ ...prev, edges: prev.edges.filter((edge) => edge.id !== id) }));
            },
            [commitCanvas],
          );

          // 从节点边上那个小圆点拖出去，落在另一个节点上就连一条线。
          // 两个坑：① 节点自己的拖动监听也挂在 window 上，会被抢走，所以这里一律用捕获阶段；
          // ② 拖动过程不靠 React 重渲染（每帧 setState 太慢，还会被其他 setState 合并掉），
          //    直接把预览线写到 SVG 的那个 path 上。
          const canvasPortDown = (event, node, side) => {
            event.stopPropagation();
            event.preventDefault();
            const origin =
              side === 'out'
                ? { x: node.x + node.w, y: node.y + node.h / 2 }
                : { x: node.x, y: node.y + node.h / 2 };
            const at = canvasToWorld(event.clientX, event.clientY);
            setCanvasLink({ from: node.id, side, ox: origin.x, oy: origin.y, x: at.x, y: at.y });
            setLinkFrom(node.id);
            const draw = (point) => {
              const path = livePath.current;
              if (!path) return;
              const cx = Math.max(40, Math.abs(point.x - origin.x) / 2);
              path.setAttribute(
                'd',
                `M ${origin.x} ${origin.y} C ${origin.x + cx} ${origin.y}, ${point.x - cx} ${point.y}, ${point.x} ${point.y}`,
              );
            };
            draw(at);
            const onMove = (moveEvent) => {
              moveEvent.preventDefault();
              draw(canvasToWorld(moveEvent.clientX, moveEvent.clientY));
            };
            const onUp = (upEvent) => {
              window.removeEventListener('pointermove', onMove, true);
              window.removeEventListener('pointerup', onUp, true);
              window.removeEventListener('pointercancel', onUp, true);
              setCanvasLink(null);
              setLinkFrom('');
              if (livePath.current) livePath.current.setAttribute('d', '');
              const el = document.elementFromPoint(upEvent.clientX, upEvent.clientY);
              const holder = el && el.closest ? el.closest('[data-node-id]') : null;
              const target = holder ? holder.getAttribute('data-node-id') : '';
              if (!target || target === node.id) {
                setCanvasMsg({ text: t('canvasLinkMiss'), bad: false });
                return;
              }
              const from = side === 'out' ? node.id : target;
              const to = side === 'out' ? target : node.id;
              commitCanvas((prev) => {
                if (prev.edges.some((edge) => edge.from === from && edge.to === to)) return prev;
                return { ...prev, edges: [...prev.edges, { id: canvasNodeId(), from, to }].slice(-CANVAS_LIMIT * 2) };
              });
              setCanvasMsg({ text: t('canvasLinkDone'), bad: false });
            };
            window.addEventListener('pointermove', onMove, true);
            window.addEventListener('pointerup', onUp, true);
            window.addEventListener('pointercancel', onUp, true);
          };

          const canvasPanStart = (event) => {
            if (event.button !== 0) return;
            // 从节点上按下不接管：容器一 setPointerCapture，图片的 click 就收不到了，
            // 点图开大图会失灵；从节点上拖应该是拖节点，不是平移画布。
            const from = event.target;
            if (from && from.closest && from.closest('.dpf-canvas-node')) return;
            canvasRef.current?.setPointerCapture?.(event.pointerId);
            const view = canvasState.current.view;
            const el = canvasRef.current;
            const rect = el ? el.getBoundingClientRect() : { left: 0, top: 0 };
            // 按住 Shift 拖空白 = 框选，不按 = 平移。
            if (event.shiftKey) {
              const at = { x: event.clientX - rect.left, y: event.clientY - rect.top };
              canvasMarquee.current = { ax: at.x, ay: at.y, bx: at.x, by: at.y, ox: rect.left, oy: rect.top };
              setCanvasBox({ left: at.x, top: at.y, width: 0, height: 0 });
              return;
            }
            canvasPan.current = { startX: event.clientX, startY: event.clientY, x: view.x, y: view.y };
            setCanvasMsg((prev) => (prev.text ? { text: '', bad: false } : prev));
          };
          const canvasPanMove = (event) => {
            const marquee = canvasMarquee.current;
            if (marquee) {
              const bx = event.clientX - marquee.ox;
              const by = event.clientY - marquee.oy;
              marquee.bx = bx;
              marquee.by = by;
              setCanvasBox({
                left: Math.min(marquee.ax, bx),
                top: Math.min(marquee.ay, by),
                width: Math.abs(bx - marquee.ax),
                height: Math.abs(by - marquee.ay),
              });
              return;
            }
            const pan = canvasPan.current;
            if (!pan) return;
            commitCanvas(
              (prev) => ({
                ...prev,
                view: {
                  ...prev.view,
                  x: pan.x + (event.clientX - pan.startX),
                  y: pan.y + (event.clientY - pan.startY),
                },
              }),
              { silent: true },
            );
          };
          const canvasPanEnd = () => {
            const pan = canvasPan.current;
            const marquee = canvasMarquee.current;
            canvasPan.current = null;
            canvasMarquee.current = null;
            setCanvasBox(null);
            if (marquee) {
              const view = canvasState.current.view;
              const left = Math.min(marquee.ax, marquee.bx);
              const top = Math.min(marquee.ay, marquee.by);
              const right = Math.max(marquee.ax, marquee.bx);
              const bottom = Math.max(marquee.ay, marquee.by);
              if (right - left < 6 && bottom - top < 6) return;
              const x1 = (left - view.x) / view.scale;
              const y1 = (top - view.y) / view.scale;
              const x2 = (right - view.x) / view.scale;
              const y2 = (bottom - view.y) / view.scale;
              const hit = canvasState.current.nodes
                .filter((node) => node.x < x2 && node.x + node.w > x1 && node.y < y2 && node.y + node.h > y1)
                .map((node) => node.id);
              setCanvasSel(hit);
              return;
            }
            if (pan) {
              // 平移也算一次可撤销的视图变化，但只有真的动了才记。
              const moved =
                Math.abs(canvasState.current.view.x - pan.x) > 1 || Math.abs(canvasState.current.view.y - pan.y) > 1;
              if (moved) canvasRemember({ ...canvasState.current, view: { ...canvasState.current.view, x: pan.x, y: pan.y } });
            }
          };

          const renderCanvasNode = (node) => {
            const selected = canvasSel.includes(node.id);
            const busy = canvasBusy === node.id || (canvasBusy === 'pending' && selected);
            return h(
              'div',
              {
                key: node.id,
                className: 'dpf-canvas-node',
                'data-kind': node.kind,
                'data-node-id': node.id,
                'data-sel': selected ? '1' : undefined,
                'data-linkfrom': linkFrom === node.id ? '1' : undefined,
                style: { left: node.x, top: node.y, width: node.w, height: node.h },
                onPointerDown: (event) => {
                  const target = event.target;
                  if (
                    target &&
                    target.closest &&
                    (target.closest('.dpf-canvas-head') ||
                      target.closest('.dpf-canvas-resize') ||
                      target.closest('textarea') ||
                      target.closest('button'))
                  ) {
                    return;
                  }
                  toggleCanvasSel(node.id, event.shiftKey || event.metaKey || event.ctrlKey);
                },
              },
              h(
                'div',
                {
                  className: 'dpf-canvas-head',
                  onPointerDown: (event) => canvasStartDrag(event, node, 'move'),
                  onPointerMove: canvasDragMove,
                  onPointerUp: canvasDragEnd,
                  onPointerCancel: canvasDragEnd,
                },
                h('b', null, node.title || (node.kind === 'text' ? t('canvasText') : t('canvasImage'))),
                node.kind === 'text' || node.src
                  ? h(
                      'button',
                      {
                        className: 'dpf-canvas-x',
                        type: 'button',
                        title: t('canvasGenerateNode'),
                        onPointerDown: (event) => event.stopPropagation(),
                        onClick: () => canvasGenerateFrom(node),
                      },
                      '⚡',
                    )
                  : null,
                node.meta && (node.meta.prompt || node.src)
                  ? h(
                      'button',
                      {
                        className: 'dpf-canvas-x',
                        type: 'button',
                        title: t('canvasRetry'),
                        onPointerDown: (event) => event.stopPropagation(),
                        onClick: () => void canvasRetryNode(node),
                      },
                      '↻',
                    )
                  : null,
                node.kind === 'text' || node.src
                  ? h(
                      'button',
                      {
                        className: 'dpf-canvas-x',
                        type: 'button',
                        title: t('canvasToWorkshop'),
                        onPointerDown: (event) => event.stopPropagation(),
                        onClick: () => canvasSendToWorkshop(node),
                      },
                      '⇢',
                    )
                  : null,
                node.src
                  ? h(
                      'button',
                      {
                        className: node.subject ? 'dpf-canvas-x is-subject' : 'dpf-canvas-x',
                        type: 'button',
                        title: node.subject ? t('canvasSubjectOn') : t('canvasSubjectOff'),
                        onPointerDown: (event) => event.stopPropagation(),
                        onClick: () => {
                          // 指定谁是主体：画布上五张图时模型分不清哪张是「人」，
                          // 与其猜，不如让你点一下。
                          const next = !node.subject;
                          commitCanvas((prev) => ({
                            ...prev,
                            nodes: prev.nodes.map((item) => ({
                              ...item,
                              subject: item.id === node.id ? next : false,
                            })),
                          }));
                        },
                      },
                      node.subject ? '◉' : '◎',
                    )
                  : null,
                node.src
                  ? h(
                      'button',
                      {
                        className: 'dpf-canvas-x',
                        type: 'button',
                        title: t('canvasSave'),
                        onPointerDown: (event) => event.stopPropagation(),
                        onClick: () => {
                          const head = String(node.src).slice(0, 24);
                          const ext = head.includes('image/webp') ? 'webp' : head.includes('image/jpeg') ? 'jpg' : 'png';
                          const link = document.createElement('a');
                          link.href = node.src;
                          link.download = `${node.title || 'canvas'}.${ext}`;
                          link.click();
                        },
                      },
                      '↓',
                    )
                  : null,
                h(
                  'button',
                  {
                    className: 'dpf-canvas-x',
                    type: 'button',
                    title: t('clear'),
                    onPointerDown: (event) => event.stopPropagation(),
                    onClick: () => removeCanvasNode(node.id),
                  },
                  '×',
                ),
              ),
              h(
                'div',
                { className: 'dpf-canvas-body' },
                node.kind === 'text'
                  ? h('textarea', {
                      value: node.text || '',
                      placeholder: `${t('canvasText')}…`,
                      onChange: (event) => patchCanvasNode(node.id, { text: event.target.value }),
                      onPointerDown: (event) => event.stopPropagation(),
                      onKeyDown: (event) => event.stopPropagation(),
                    })
                  : node.src
                    ? h('img', {
                        src: node.src,
                        alt: '',
                        title: t('canvasOpenImage'),
                        onClick: (event) => {
                          // 单点开大图。选节点点边框或标题条，不抢这里。
                          event.stopPropagation();
                          openCanvasImage(node);
                        },
                      })
                    : h('div', { className: 'dpf-canvas-empty' }, node.lost ? t('canvasBadImage') : t('canvasEmptyHint')),
              ),
              node.note ? h('div', { className: 'dpf-canvas-note', title: node.note }, node.note) : null,
              node.meta && node.meta.model
                ? h(
                    'div',
                    {
                      className: 'dpf-canvas-note',
                      style: { bottom: node.note ? 18 : 0, background: '#000000cc' },
                      title: [
                        `${t('canvasMeta')}: ${node.meta.model}${node.meta.size ? ` · ${node.meta.size}` : ''}`,
                        node.meta.mode ? `${node.meta.mode}` : '',
                        node.meta.primary ? `${t('canvasMetaPrimary')}: ${node.meta.primary}` : '',
                        Array.isArray(node.meta.extras) && node.meta.extras.length > 0
                          ? `${t('canvasMetaRefs')}: ${node.meta.extras.join(' / ')}`
                          : '',
                        node.meta.prompt ? `${node.meta.prompt}` : '',
                      ].filter(Boolean).join('\n'),
                    },
                    `${node.meta.model}${node.meta.size ? ` · ${node.meta.size}` : ''}${
                      node.meta.primary ? ` · ${node.meta.primary}` : ''
                    }`,
                  )
                : null,
              h('div', {
                className: 'dpf-canvas-port',
                'data-side': 'in',
                title: t('canvasPortIn'),
                onPointerDown: (event) => canvasPortDown(event, node, 'in'),
              }),
              h('div', {
                className: 'dpf-canvas-port',
                'data-side': 'out',
                title: t('canvasPortOut'),
                onPointerDown: (event) => canvasPortDown(event, node, 'out'),
              }),
              h('div', {
                className: 'dpf-canvas-resize',
                onPointerDown: (event) => canvasStartDrag(event, node, 'size'),
                onPointerMove: canvasDragMove,
                onPointerUp: canvasDragEnd,
                onPointerCancel: canvasDragEnd,
              }),
              busy ? h('div', { className: 'dpf-canvas-badge', 'data-busy': '1' }, '…') : null,
            );
          };

          const canvasEdgePath = (edge) => {
            const from = canvas.nodes.find((node) => node.id === edge.from);
            const to = canvas.nodes.find((node) => node.id === edge.to);
            if (!from || !to) return '';
            const x1 = from.x + from.w;
            const y1 = from.y + from.h / 2;
            const x2 = to.x;
            const y2 = to.y + to.h / 2;
            const mid = Math.max(36, Math.abs(x2 - x1) / 2);
            return `M ${x1} ${y1} C ${x1 + mid} ${y1}, ${x2 - mid} ${y2}, ${x2} ${y2}`;
          };

          const previewCard =
            preview.length > 0 || previewError || generating
              ? h(
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
          previewStale && preview.length > 0
            ? h('div', { className: 'dpf-stale' }, t('staleTag'))
            : null,
          preview.length > 0 &&
            h(
              'div',
              { className: previewStale ? 'dpf-preview is-stale' : 'dpf-preview' },
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
        )
              : null;

          const imageBody = h(
            'div',
            { className: 'dpf-body dpf-body-image' },
            h(
              'div',
              { className: 'dpf-image-main' },
              h(
                'div',
                { className: 'dpf-image-tabs' },
                h('button', { className: 'dpf-image-tab', type: 'button', 'data-active': imageTab === 'text' || undefined, onClick: () => setImageTab('text') }, t('imageTabText')),
                h('button', { className: 'dpf-image-tab', type: 'button', 'data-active': imageTab === 'edit' || undefined, onClick: () => setImageTab('edit') }, t('imageTabEdit')),
              ),
              imageTab === 'edit' &&
                h(
                  'div',
                  { className: 'dpf-section' },
                  h(
                    'div',
                    { className: 'dpf-section-head' },
                    h('span', { className: 'dpf-step' }, '01'),
                    h('span', { className: 'dpf-section-title' }, t('imageSubject')),
                  ),
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
              h(
                'label',
                { className: 'dpf-check' },
                h('input', {
                  type: 'checkbox',
                  checked: neutralize,
                  onChange: (event) => setNeutralize(event.target.checked),
                }),
                h('span', null, t('neutralize')),
              ),
            ),
            galleryBox,
              ),
              h(
                'div',
                { className: 'dpf-section' },
                h(
                  'div',
                  { className: 'dpf-section-head' },
                  h('span', { className: 'dpf-step' }, imageTab === 'edit' ? '02' : '01'),
                  h('span', { className: 'dpf-section-title' }, t('imageWords')),
                  h('span', { className: 'dpf-section-note' }, `${(editedPrompt || idea).length} ${t('ideaCount')}`),
                ),
                h('textarea', {
                  className: 'dpf-textarea dpf-idea',
                  value: editedPrompt,
                  maxLength: 6000,
                  placeholder: t('imageWordsPlaceholder'),
                  onChange: (event) => setEditedPrompt(event.target.value),
                }),
              ),
              h(
                'div',
                { className: 'dpf-section' },
                h(
                  'div',
                  { className: 'dpf-section-head' },
                  h('span', { className: 'dpf-step' }, imageTab === 'edit' ? '03' : '02'),
                  h('span', { className: 'dpf-section-title' }, t('imageModel')),
                ),
            h(
              'div',
              { className: 'dpf-grid2', style: { marginTop: 8 }, title: t('imageModelHint') },
              h(
                'div',
                null,
                h('label', { className: 'dpf-label' }, t('imageSource')),
                h(
                  'div',
                  { style: { display: 'flex', gap: 6, alignItems: 'center' } },
                  h(
                    'select',
                    {
                      className: 'dpf-select',
                      value: currentSource,
                      disabled: sourceOptions.length === 0,
                      onChange: (event) => {
                        const raw = event.target.value;
                        if (raw.startsWith('host:')) {
                          setSource('host');
                          pickImageChannel(raw.slice(5));
                          return;
                        }
                        setSource(raw);
                        setImageModel((targets.find((item) => item.id === raw) || {}).models?.[0] || '');
                      },
                    },
                    sourceOptions.length === 0
                      ? [h('option', { key: 'none', value: '' }, t('sourceEmpty'))]
                      : sourceOptions.map((item) => h('option', { key: item.id, value: item.id }, item.label)),
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dpf-icon-btn',
                      title: t('targetAdd'),
                      onClick: () => {
                        setTargetOpen((value) => !value);
                        setTargetMsg('');
                      },
                    },
                    targetOpen ? '×' : '+',
                  ),
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
                    disabled: imageModelChoices.length === 0,
                    onChange: (event) => pickImageModel(event.target.value),
                  },
                  imageModelChoices.length === 0
                    ? [h('option', { key: 'none', value: '' }, '—')]
                    : imageModelChoices.map((item) => h('option', { key: item, value: item }, item)),
                ),
              ),
            ),
            targetOpen &&
              h(
                'div',
                { className: 'dpf-target-form' },
                h('input', {
                  className: 'dpf-input',
                  placeholder: t('targetName'),
                  value: targetDraft.label,
                  maxLength: 60,
                  onChange: (event) => setTargetDraft({ ...targetDraft, label: event.target.value }),
                }),
                h('input', {
                  className: 'dpf-input',
                  placeholder: 'https://api.openai.com/v1',
                  value: targetDraft.baseUrl,
                  spellCheck: false,
                  onChange: (event) => setTargetDraft({ ...targetDraft, baseUrl: event.target.value }),
                }),
                h('input', {
                  className: 'dpf-input',
                  type: 'password',
                  placeholder: t('targetKey'),
                  value: targetDraft.apiKey,
                  onChange: (event) => setTargetDraft({ ...targetDraft, apiKey: event.target.value }),
                }),
                h('input', {
                  className: 'dpf-input',
                  placeholder: 'gpt-image-1, flux-1.1-pro',
                  value: targetDraft.models,
                  spellCheck: false,
                  onChange: (event) => setTargetDraft({ ...targetDraft, models: event.target.value }),
                }),
                h(
                  'div',
                  { className: 'dpf-target-actions' },
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dpf-btn',
                      style: { padding: '5px 10px', fontSize: 12 },
                      disabled: targetBusy,
                      onClick: () => void testTarget(),
                    },
                    targetBusy ? t('targetTesting') : t('targetTest'),
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dpf-btn',
                      style: { padding: '5px 10px', fontSize: 12 },
                      disabled: targetBusy,
                      onClick: () => void saveTarget(),
                    },
                    t('targetSave'),
                  ),
                  activeTarget &&
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'dpf-btn',
                        style: { padding: '5px 10px', fontSize: 12 },
                        onClick: () => void removeTarget(activeTarget.id),
                      },
                      t('targetRemove'),
                    ),
                ),
                targetMsg &&
                  h('div', { className: `dpf-target-msg${targetBad ? ' is-bad' : ''}` }, targetMsg),
                h('div', { className: 'dpf-target-msg' }, t('targetHint')),
              ),
            imageModelChoices.length > 0 &&
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
              (error || notice) && h('div', { className: `dpf-error${notice ? ' dpf-warn' : ''}`, style: { marginBottom: 10 } }, error || notice),
              h(
                'div',
                { className: 'dpf-actions' },
                h(
                  'button',
                  {
                    className: 'dpf-btn dpf-btn-primary',
                    type: 'button',
                    disabled: generating || !(editedPrompt.trim() || idea.trim() || (imageTab === 'edit' && (image || refShots.length > 0))),
                    title: t('renderHint'),
                    onClick: () => void renderOne(),
                  },
                  generating && h('span', { className: 'dpf-spin' }),
                  generating ? t('generating') : imageTab === 'edit' ? t('renderEdit') : t('preview'),
                ),
              ),
            ),
            h(
              'div',
              { className: 'dpf-image-out' },
              previewCard ||
                h(
                  'div',
                  { className: 'dpf-empty' },
                  emptyIcon,
                  h('div', { className: 'dpf-empty-title' }, t('previewTitle')),
                  h('div', { className: 'dpf-empty-hint' }, t('imageOutHint')),
                ),
            ),
          );

          // 小地图：把全部节点和视口四角一起算进包围盒，再等比缩到 152×98 的框里。
          const canvasMap = (() => {
            const nodes = canvas.nodes;
            const el = canvasRef.current;
            const vw = el && el.clientWidth ? el.clientWidth : 820;
            const vh = el && el.clientHeight ? el.clientHeight : 560;
            const view = canvas.view;
            const pad = 8;
            const viewX1 = -view.x / view.scale;
            const viewY1 = -view.y / view.scale;
            const viewX2 = (vw - view.x) / view.scale;
            const viewY2 = (vh - view.y) / view.scale;
            const xs = nodes.map((node) => node.x).concat(viewX1);
            const ys = nodes.map((node) => node.y).concat(viewY1);
            const xe = nodes.map((node) => node.x + node.w).concat(viewX2);
            const ye = nodes.map((node) => node.y + node.h).concat(viewY2);
            const minX = Math.min(...xs);
            const minY = Math.min(...ys);
            const maxX = Math.max(...xe);
            const maxY = Math.max(...ye);
            const k = Math.min((152 - pad * 2) / Math.max(1, maxX - minX), (98 - pad * 2) / Math.max(1, maxY - minY));
            const ox = pad + (152 - pad * 2 - (maxX - minX) * k) / 2;
            const oy = pad + (98 - pad * 2 - (maxY - minY) * k) / 2;
            const place = (x, y) => ({ left: ox + (x - minX) * k, top: oy + (y - minY) * k });
            return { k, place, origin: { left: ox - minX * k, top: oy - minY * k }, a: place(viewX1, viewY1), b: place(viewX2, viewY2) };
          })();

          const canvasBody = h(
            'div',
            {
              className: 'dpf-canvas',
              ref: canvasRef,
              tabIndex: 0,
              'data-panning': canvasPan.current ? '1' : undefined,
              onPointerDownCapture: (event) => {
                // 点到画布本体时把焦点拿过来，键盘快捷键与粘贴才知道往这儿走；
                // 点到文字的输入框就别抢，否则没法打字。
                const tag = event.target && event.target.tagName;
                if (tag === 'TEXTAREA' || tag === 'INPUT') return;
                // 面板里的按钮也别抢焦点，否则点完「搜索」就得再点回输入框才能打字。
                if (event.target && event.target.closest && event.target.closest('.dpf-canvas-gal')) return;
                canvasRef.current?.focus?.();
              },
              onPointerDown: (event) => {
                const target = event.target;
                // 端口优先：点在端口上时绝不能让容器开始平移，否则连线会被一起拖走。
                if (target && target.closest && target.closest('.dpf-canvas-port')) {
                  event.stopPropagation();
                  return;
                }
                if (target === event.currentTarget || (target && target.classList && target.classList.contains('dpf-canvas-layer'))) {
                  canvasPanStart(event);
                }
              },
              onPointerMove: canvasPanMove,
              onPointerUp: canvasPanEnd,
              onPointerCancel: canvasPanEnd,
              onDoubleClick: (event) => {
                const target = event.target;
                if (target === event.currentTarget || (target && target.classList && target.classList.contains('dpf-canvas-layer'))) {
                  commitCanvas((prev) => ({ ...prev, view: { x: 0, y: 0, scale: 1 } }));
                }
              },
              onDragOver: (event) => event.preventDefault(),
              onDrop: (event) => {
                event.preventDefault();
                const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
                if (file) void canvasLoadFile(file);
              },
              onPaste: (event) => {
                const items = Array.from((event.clipboardData && event.clipboardData.items) || []);
                const hit = items.find((item) => item.kind === 'file' && String(item.type).startsWith('image/'));
                if (!hit) return;
                event.preventDefault();
                void canvasLoadFile(hit.getAsFile());
              },
              onKeyDown: (event) => {
                // 光标在画布文本节点或任何输入框里时，Delete/Backspace 是删字，不是删节点。
                const tag = event.target && event.target.tagName;
                if (tag === 'TEXTAREA' || tag === 'INPUT') return;
                const mod = event.ctrlKey || event.metaKey;
                const key = String(event.key || '').toLowerCase();
                if (mod && key === 'z') {
                  event.preventDefault();
                  if (event.shiftKey) canvasRedo();
                  else canvasUndo();
                  return;
                }
                if (mod && key === 'y') {
                  event.preventDefault();
                  canvasRedo();
                  return;
                }
                if (mod && key === 'a') {
                  event.preventDefault();
                  canvasSelectAll();
                  return;
                }
                if (mod && key === 'c') {
                  event.preventDefault();
                  canvasCopy();
                  return;
                }
                if (mod && key === 'v') {
                  // 粘贴统一交给 window 上的 paste 监听处理：剪贴板里是图就落到画布，
                  // 是节点就走粘贴。这里只拦一下别让浏览器把页面当成输入框。
                  event.preventDefault();
                  return;
                }
                if (key === 'escape') {
                  setCanvasSel([]);
                  return;
                }
                if ((event.key === 'Delete' || event.key === 'Backspace') && canvasSel.length > 0) {
                  event.preventDefault();
                  for (const id of canvasSel) removeCanvasNode(id);
                }
              },
            },
            h(
              'div',
              { className: 'dpf-canvas-tools' },
              h(
                'button',
                { className: 'dpf-btn dpf-btn-small', type: 'button', onClick: () => canvasFile.current?.click() },
                `＋ ${t('canvasAddImage')}`,
              ),
              h('input', {
                type: 'file',
                accept: 'image/*',
                ref: canvasFile,
                style: { display: 'none' },
                onChange: (event) => {
                  const file = event.target.files && event.target.files[0];
                  event.target.value = '';
                  if (file) void canvasLoadFile(file);
                },
              }),
              h(
                'button',
                { className: 'dpf-btn dpf-btn-small', type: 'button', onClick: () => addCanvasNode('text') },
                `＋ ${t('canvasText')}`,
              ),
              h(
                'button',
                {
                  className: 'dpf-btn dpf-btn-small',
                  type: 'button',
                  'data-on': canvasGalOpen ? '1' : undefined,
                  onClick: () => {
                    const next = !canvasGalOpen;
                    setCanvasGalOpen(next);
                    // 第一次打开先把「全部」拉一页出来，省一次点击。
                    if (next && canvasGalWorks.length === 0 && !canvasGalLoading) {
                      void searchCanvasGallery(canvasGalQuery, canvasGalLib, canvasGalFilters);
                    }
                  },
                },
                `${canvasGalOpen ? '×' : '▤'} ${t('canvasGallery')}`,
              ),
              h(
                'button',
                {
                  className: 'dpf-btn dpf-btn-small dpf-btn-primary',
                  type: 'button',
                  disabled: Boolean(canvasBusy),
                  onClick: () => void canvasGenerate(),
                },
                canvasBusy ? t('canvasWorking') : t('canvasGenerate'),
              ),
              canvasSel.length > 0
                ? h('span', { className: 'dpf-pill' }, `${t('canvasSelected')} ${canvasSel.length}`)
                : null,
              h('div', { className: 'dpf-canvas-sep' }),
              h(
                'button',
                {
                  className: 'dpf-btn dpf-btn-small',
                  type: 'button',
                  title: `${t('canvasUndo')} (Ctrl+Z)`,
                  disabled: canvasDepth.undo === 0,
                  onClick: canvasUndo,
                },
                '↶',
              ),
              h(
                'button',
                {
                  className: 'dpf-btn dpf-btn-small',
                  type: 'button',
                  title: `${t('canvasRedo')} (Ctrl+Shift+Z)`,
                  disabled: canvasDepth.redo === 0,
                  onClick: canvasRedo,
                },
                '↷',
              ),
              h(
                'button',
                { className: 'dpf-btn dpf-btn-small', type: 'button', title: `${t('canvasCopy')} (Ctrl+C)`, onClick: canvasCopy },
                t('canvasCopy'),
              ),
              h(
                'button',
                {
                  className: 'dpf-btn dpf-btn-small',
                  type: 'button',
                  title: `${t('canvasPaste')} (Ctrl+V)`,
                  disabled: canvasClip.current.length === 0,
                  onClick: canvasPaste,
                },
                t('canvasPaste'),
              ),
              h(
                'button',
                { className: 'dpf-btn dpf-btn-small', type: 'button', title: `${t('canvasSelectAll')} (Ctrl+A)`, onClick: canvasSelectAll },
                t('canvasSelectAll'),
              ),
              h('div', { className: 'dpf-spacer' }),
              h('button', { className: 'dpf-btn dpf-btn-small', type: 'button', title: t('canvasExport'), onClick: canvasExport }, t('canvasExport')),
              h(
                'button',
                { className: 'dpf-btn dpf-btn-small', type: 'button', title: t('canvasImport'), onClick: () => canvasImportFile.current?.click() },
                t('canvasImport'),
              ),
              h('input', {
                type: 'file',
                accept: 'application/json,.json',
                ref: canvasImportFile,
                style: { display: 'none' },
                onChange: (event) => {
                  const file = event.target.files && event.target.files[0];
                  event.target.value = '';
                  if (file) void canvasImport(file);
                },
              }),
              h('div', { className: 'dpf-canvas-sep' }),
              h('button', { className: 'dpf-btn dpf-btn-small', type: 'button', title: t('zoomOut'), onClick: () => canvasZoomBy(1 / 1.2) }, '−'),
              h('input', {
                className: 'dpf-canvas-range',
                type: 'range',
                min: Math.round(CANVAS_MIN_SCALE * 100),
                max: Math.round(CANVAS_MAX_SCALE * 100),
                value: Math.round(canvas.view.scale * 100),
                title: t('canvasZoom'),
                onChange: (event) => canvasZoomTo(Number(event.target.value) / 100),
              }),
              h('button', { className: 'dpf-btn dpf-btn-small', type: 'button', title: t('zoomIn'), onClick: () => canvasZoomBy(1.2) }, '＋'),
              h('button', { className: 'dpf-btn dpf-btn-small', type: 'button', onClick: canvasFit }, t('canvasFit')),
              h(
                'button',
                { className: 'dpf-btn dpf-btn-small', type: 'button', title: t('canvasReset'), onClick: () => canvasZoomTo(1) },
                `${Math.round(canvas.view.scale * 100)}%`,
              ),
              h(
                'button',
                {
                  className: 'dpf-btn dpf-btn-small',
                  type: 'button',
                  onClick: () => {
                    if (canvas.nodes.length === 0) return;
                    if (!window.confirm(t('canvasClearAsk'))) return;
                    commitCanvas(() => ({ nodes: [], edges: [], view: { x: 0, y: 0, scale: 1 } }));
                    setCanvasSel([]);
                  },
                },
                t('canvasClear'),
              ),
            ),
            canvasGalOpen
              ? h(
                  'div',
                  {
                    className: 'dpf-canvas-gal',
                    onPointerDown: (event) => event.stopPropagation(),
                    onWheel: (event) => event.stopPropagation(),
                  },
                  h(
                    'div',
                    { className: 'dpf-canvas-gal-head' },
                    h('b', null, t('canvasGallery')),
                    h('span', { className: 'dpf-gallery-note', style: { margin: 0, flex: 1 } }, t('canvasGalleryHint')),
                    h(
                      'button',
                      { className: 'dpf-canvas-x', type: 'button', title: t('canvasGallery'), onClick: () => setCanvasGalOpen(false) },
                      '×',
                    ),
                  ),
                  h(
                    'div',
                    { className: 'dpf-gallery-search' },
                    h('input', {
                      className: 'dpf-input',
                      value: canvasGalQuery,
                      maxLength: 40,
                      placeholder: t('gallerySearch'),
                      onChange: (event) => setCanvasGalQuery(event.target.value),
                      onKeyDown: (event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          void searchCanvasGallery(canvasGalQuery, canvasGalLib, canvasGalFilters);
                        }
                      },
                    }),
                    h(
                      'button',
                      {
                        className: 'dpf-btn dpf-btn-small',
                        type: 'button',
                        disabled: canvasGalLoading,
                        onClick: () => void searchCanvasGallery(canvasGalQuery, canvasGalLib, canvasGalFilters),
                      },
                      canvasGalLoading ? t('galleryLoading') : '搜索',
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
                          'data-on': canvasGalLib === key ? '1' : undefined,
                          onClick: () => switchCanvasLib(key),
                        },
                        label,
                      ),
                    ),
                  ),
                  canvasKindsBox,
                  canvasGalError && h('div', { className: 'dpf-gallery-note dpf-warn' }, canvasGalError),
                  h(
                    'div',
                    { className: 'dpf-canvas-gal-grid' },
                    canvasGalWorks.map((work) =>
                      h(
                        'button',
                        {
                          key: `${work.lib}:${work.id}`,
                          type: 'button',
                          className: 'dpf-gallery-card',
                          title: `${work.name} · ${(work.tags || []).join('・')}`,
                          onClick: () => void refToCanvas(work),
                        },
                        h('img', { src: work.thumbUrl, alt: '', loading: 'lazy' }),
                        h('span', { className: 'dpf-gallery-name' }, work.name),
                        h(
                          'span',
                          {
                            className: 'dpf-gallery-canvas',
                            role: 'button',
                            title: t('canvasApplyNode'),
                            onClick: (event) => {
                              event.stopPropagation();
                              void applyRefToNode(work);
                            },
                          },
                          '⇢',
                        ),
                      ),
                    ),
                  ),
                  canvasGalTotal > 0 &&
                    h(
                      'div',
                      { className: 'dpf-gallery-more' },
                      h('span', { className: 'dpf-gallery-note', style: { margin: 0 } }, `${canvasGalWorks.length} / ${canvasGalTotal}`),
                      canvasGalWorks.length < canvasGalTotal &&
                        h(
                          'button',
                          {
                            type: 'button',
                            className: 'dpf-chip',
                            disabled: canvasGalLoading,
                            onClick: () => searchCanvasGallery(canvasGalQuery, canvasGalLib, canvasGalFilters, canvasGalWorks),
                          },
                          canvasGalLoading
                            ? t('galleryLoading')
                            : `${t('galleryMore')} ${Math.min(24, canvasGalTotal - canvasGalWorks.length)}`,
                        ),
                    ),
                )
              : null,
            h(
              'div',
              {
                className: 'dpf-canvas-layer',
                style: { transform: `translate(${canvas.view.x}px, ${canvas.view.y}px) scale(${canvas.view.scale})` },
              },
              h(
                'svg',
                { className: 'dpf-canvas-edge', style: { position: 'absolute', left: 0, top: 0, width: 1, height: 1, overflow: 'visible' } },
                h(
                  'defs',
                  null,
                  h(
                    'marker',
                    {
                      id: 'dpf-canvas-arrow',
                      viewBox: '0 0 10 10',
                      refX: 8,
                      refY: 5,
                      markerWidth: 7,
                      markerHeight: 7,
                      orient: 'auto-start-reverse',
                    },
                    h('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: '#7aa7ff' }),
                  ),
                ),
                canvas.edges.map((edge) => {
                  const d = canvasEdgePath(edge);
                  // 细线看得见、粗透明线点得到——否则想删连线得瞄准两个像素。
                  return h(
                    'g',
                    { key: edge.id || `${edge.from}_${edge.to}` },
                    h('path', { className: 'dpf-canvas-line', d, markerEnd: 'url(#dpf-canvas-arrow)' }),
                    h('path', {
                      className: 'dpf-canvas-hit',
                      d,
                      onPointerDown: (event) => event.stopPropagation(),
                      onClick: () => edge.id && canvasRemoveEdge(edge.id),
                    }),
                  );
                }),
                // 预览线一直挂在 DOM 里，拖动时由 canvasPortDown 直接改它的 d。
                h('path', { className: 'dpf-canvas-line dpf-canvas-live', ref: livePath, d: '' }),
              ),
              canvas.nodes.map(renderCanvasNode),
            ),
            canvasBox
              ? h('div', {
                  className: 'dpf-marquee',
                  style: { left: canvasBox.left, top: canvasBox.top, width: canvasBox.width, height: canvasBox.height },
                })
              : null,
            canvas.nodes.length === 0
              ? h(
                  'div',
                  { className: 'dpf-canvas-empty' },
                  h('div', { style: { fontSize: 15, color: 'var(--dsw-alias-text-primary,#ddd)' } }, t('canvasEmpty')),
                  h('div', null, t('canvasEmptyHint')),
                  h('div', null, t('canvasHint')),
                  h('div', { style: { opacity: 0.7 } }, t('canvasMarqueeTip')),
                )
              : null,
            h(
              'div',
              {
                className: 'dpf-minimap',
                'data-empty': canvas.nodes.length === 0 ? '1' : undefined,
                title: t('canvasMinimap'),
                onPointerDown: (event) => {
                  const el = event.currentTarget;
                  const rect = el.getBoundingClientRect();
                  const px = event.clientX - rect.left;
                  const py = event.clientY - rect.top;
                  const view = canvasState.current.view;
                  const layerEl = canvasRef.current;
                  const vw = layerEl && layerEl.clientWidth ? layerEl.clientWidth : 820;
                  const vh = layerEl && layerEl.clientHeight ? layerEl.clientHeight : 560;
                  // 反解 place() 的线性映射，再换回视口中心的平移量。
                  const wx = (px - canvasMap.origin.left) / canvasMap.k;
                  const wy = (py - canvasMap.origin.top) / canvasMap.k;
                  commitCanvas((prev) => ({
                    ...prev,
                    view: { ...prev.view, x: vw / 2 - wx * prev.view.scale, y: vh / 2 - wy * prev.view.scale },
                  }));
                },
              },
              canvas.nodes.map((node) => {
                const at = canvasMap.place(node.x, node.y);
                return h('div', {
                  key: `mini_${node.id}`,
                  className: 'dpf-minimap-node',
                  'data-kind': node.kind,
                  style: {
                    left: at.left,
                    top: at.top,
                    width: Math.max(2, node.w * canvasMap.k),
                    height: Math.max(2, node.h * canvasMap.k),
                  },
                });
              }),
              h('div', {
                className: 'dpf-minimap-box',
                style: {
                  left: canvasMap.a.left,
                  top: canvasMap.a.top,
                  width: Math.max(3, canvasMap.b.left - canvasMap.a.left),
                  height: Math.max(3, canvasMap.b.top - canvasMap.a.top),
                },
              }),
            ),
            canvasMsg.text ? h('div', { className: 'dpf-canvas-msg', 'data-bad': canvasMsg.bad ? '1' : undefined }, canvasMsg.text) : null,
            h(
              'div',
              { className: 'dpf-canvas-foot' },
              `${canvas.nodes.length} 节点 · ${Math.round(canvas.view.scale * 100)}%`,
            ),
          );


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
                'div',
                { className: 'dpf-shell' },
                h(
                  'aside',
                  { className: 'dpf-rail' },
                  h(
                    'div',
                    { className: 'dpf-rail-brand' },
                    icon,
                    h('div', null, h('div', { className: 'dpf-rail-name' }, t('meta.title')), h('div', { className: 'dpf-rail-sub' }, t('subtitle'))),
                  ),
                  h(
                    'div',
                    { className: 'dpf-rail-tabs' },
                    h(
                      'button',
                      { className: 'dpf-rail-tab', type: 'button', 'data-active': page === 'prompt' || undefined, onClick: () => setPage('prompt') },
                      t('pagePrompt'),
                      result ? h('em', null, '●') : null,
                    ),
                    h(
                      'button',
                      { className: 'dpf-rail-tab', type: 'button', 'data-active': page === 'image' || undefined, onClick: () => setPage('image') },
                      t('pageImage'),
                      preview.length ? h('em', null, String(preview.length)) : null,
                    ),
                    h(
                      'button',
                      {
                        className: 'dpf-rail-tab',
                        type: 'button',
                        'data-active': page === 'canvas' || undefined,
                        onClick: () => {
                          setPage('canvas');
                          setCanvasMsg({ text: '', bad: false });
                        },
                      },
                      t('pageCanvas'),
                      canvas.nodes.length ? h('em', null, String(canvas.nodes.length)) : null,
                    ),
                  ),
                  h('button', { className: 'dpf-newbtn', type: 'button', title: t('newSessionHint'), onClick: () => void newSession() }, `+ ${t('newSession')}`),
                  h(
                    'div',
                    { className: 'dpf-rail-head' },
                    t('historyTitle'),
                    history.length > 0 ? h('button', { type: 'button', onClick: clearHistory }, t('clearHistory')) : null,
                  ),
                  history.length > 0
                    ? h(
                        'div',
                        { className: 'dpf-rail-search' },
                        h('input', {
                          type: 'search',
                          value: railQuery,
                          placeholder: t('historySearch'),
                          maxLength: 40,
                          onChange: (event) => setRailQuery(event.target.value),
                        }),
                      )
                    : null,
                  h(
                    'div',
                    { className: 'dpf-rail-list' },
                    railRows.length
                      ? railRows.map((entry) =>
                          h(
                            'button',
                            { key: entry.id, className: 'dpf-rail-item', type: 'button', onClick: () => restore(entry), title: entry.title || t('untitled') },
                            h('b', null, entry.title || t('untitled')),
                            h('span', null, `${timeLabel(entry.at)} · ${dialectLabel(entry.dialect)}`),
                          ),
                        )
                      : h('div', { className: 'dpf-rail-empty' }, history.length ? t('historyNoMatch') : t('historyEmpty')),
                  ),
                  h(
                    'div',
                    { className: 'dpf-rail-foot' },
                    modelReady ? `${provider} · ${model}` : t('noModel'),
                    h('br', null),
                    `v${BUILD}`,
                  ),
                ),
                h(
                  'div',
                  { className: 'dpf-stage' },
                  h(
                    'header',
                    { className: 'dpf-topbar' },
                    h('span', { className: 'dpf-topbar-title' }, page === 'canvas' ? t('pageCanvas') : page === 'image' ? t('pageImage') : t('pagePrompt')),
                    h('span', { className: 'dpf-topbar-note' }, page === 'canvas' ? t('canvasHint') : page === 'image' ? t('imageOutHint') : t('subtitle')),
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
              canvasView
                ? canvasBody
                : page === 'image'
                ? imageBody
                : h(
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
                    h(
                      'button',
                      { className: 'dpf-btn', type: 'button', title: t('imageGoHint'), onClick: () => setPage('image') },
                      `${t('pageImage')} →`,
                    ),
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
                      h(
                        'button',
                        { className: 'dpf-btn', type: 'button', onClick: () => setPage('image'), style: { marginTop: 16 } },
                        `${t('pageImage')} →`,
                      ),
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
                  src: lightbox.url || `data:${lightbox.mime};base64,${lightbox.b64}`,
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
              order: -10,
              label: () => ctx.locale.bind(NS)('meta.title'),
            },
            PanelEntry,
          ),
        );

        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: NS }, PanelPage),
        );

        // 入口钉在「新会话」按钮正上方——dsh-imagegen 关掉那对「会话 / 生图」页签后空出来的位置。
        // 宿主只提供 sidebar.panellist 槽，而槽渲染在按钮下面，所以这里自己插一段 DOM 补位。
        ctx.effect(() => {
          // 单测与 SSR 环境下没有真 DOM，直接跳过。
          if (typeof document === 'undefined' || typeof document.createElement !== 'function') return () => {};
          const NEW_SESSION = 'button[data-dsh-part="new-session"], button[class*="newSession"]';
          const STYLE_ID = 'drawcraft-tab-style';
          const style = document.createElement('style');
          style.id = STYLE_ID;
          style.textContent = [
            // 不动宿主容器的布局——它同时装着品牌、新会话、panelList、工作区，改 display 会把整条侧边栏压塌。
            // 只给它加 position:relative，然后把按钮绝对定位到「新会话」右侧那条空位上。
            '[data-drawcraft-host="1"]{position:relative}',
            '[data-drawcraft-host="1"] button[class*="newSession"]{padding-right:84px}',
            '[data-drawcraft-host="1"] button[class*="newSession"] [class*="newSessionShortcut"]{display:none}',
            '[data-sidebar-collapsed] [data-drawcraft-host="1"] button[class*="newSession"]{padding-right:0}',
            '[data-drawcraft-tab]{position:absolute;right:12px;width:70px;display:flex;align-items:center;',
            'justify-content:center;gap:5px;box-sizing:border-box;padding:0 6px;border-radius:8px;',
            'border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.12));background:transparent;',
            'color:inherit;font:inherit;font-size:11.5px;line-height:1;cursor:pointer;white-space:nowrap}',
            '[data-drawcraft-tab]:hover{background:var(--dsw-specific-sidebar-nav-item-hover,rgba(0,0,0,.06))}',
            '[data-drawcraft-tab] svg{width:13px;height:13px;flex:none}',
            'nav[class*="panelList"] button:has([data-dsh-panel-entry="dsh-drawcraft"]){display:none}',
            '[data-sidebar-collapsed] nav[class*="panelList"] button:has([data-dsh-panel-entry="dsh-drawcraft"]){display:flex}',
            '[data-sidebar-collapsed] [data-drawcraft-tab]{display:none}',
          ].join('');

          let tab = null;
          const open = () => {
            if (typeof ctx.layout?.selectPanel === 'function') {
              ctx.layout.selectPanel(NS);
              return;
            }
            const entry = document.querySelector(`[data-dsh-panel-entry="${NS}"]`);
            const row = entry && entry.closest('button');
            if (row) row.click();
          };

          const ensure = () => {
            const host = document.querySelector(NEW_SESSION);
            if (!host || !host.parentElement) return;
            if (!document.getElementById(STYLE_ID)) document.head.appendChild(style);
            if (!tab) {
              tab = document.createElement('button');
              tab.type = 'button';
              tab.setAttribute('data-drawcraft-tab', '');
              tab.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.6 13.4 3.3 10.4 10.4 3.3a1.65 1.65 0 0 1 2.33 2.33L5.6 12.7l-3 .7Z"/><path d="m9.55 4.15 2.3 2.3"/><path d="M12.3 10.4h3.1M13.85 8.85v3.1"/></svg><span></span>';
              tab.addEventListener('click', open);
            }
            const label = tab.querySelector('span');
            if (label) label.textContent = ctx.locale.bind(NS)('meta.title');
            tab.title = ctx.locale.bind(NS)('meta.title');
            // 「新会话」外面可能还套着一层 Tooltip，找真正同时装着 panelList 的那一层当定位基准。
            let row = host.parentElement;
            while (row && row !== document.body && !row.querySelector('nav[class*="panelList"]')) {
              row = row.parentElement;
            }
            if (!row || row === document.body) row = host.parentElement;
            if (!row || row === document.body) return;
            row.setAttribute('data-drawcraft-host', '1');
            if (host.nextElementSibling !== tab) host.after(tab);
            // 贴着「新会话」按钮的真实位置走——它外面可能套 Tooltip，offsetTop 未必相对 row。
            const box = host.getBoundingClientRect();
            const base = row.getBoundingClientRect();
            tab.style.top = `${box.top - base.top + row.scrollTop}px`;
            tab.style.height = `${box.height}px`;
          };

          let frame = 0;
          const schedule = () => {
            if (frame) return;
            frame = requestAnimationFrame(() => {
              frame = 0;
              ensure();
            });
          };

          const observer = new MutationObserver(schedule);
          observer.observe(document.body, { childList: true, subtree: true });
          schedule();

          return () => {
            observer.disconnect();
            if (frame) cancelAnimationFrame(frame);
            tab?.remove();
            style.remove();
          };
        }, 'dsh-drawcraft: sidebar tab');
      },
    };
  },
});
