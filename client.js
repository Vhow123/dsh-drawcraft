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
    const STORE_KEY = 'dsh-image-prompt-forge:v1';
    const HISTORY_LIMIT = 24;

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
    };

    const css = `
.dpf-backdrop{position:fixed;inset:0;z-index:10000;background:#0009;backdrop-filter:blur(5px);display:flex;align-items:center;justify-content:center;padding:22px;box-sizing:border-box}
.dpf-embed{position:relative;display:flex;flex:1 1 auto;width:100%;height:100%;min-height:520px;overflow:hidden}
.dpf-embed .dpf-panel{width:100%;height:100%;border:0;border-radius:0;box-shadow:none;background:var(--dsw-alias-bg-primary,#141416)}

.dpf-panel{width:min(1180px,100%);height:min(860px,100%);display:flex;flex-direction:column;background:var(--dsw-alias-bg-elevated,#1c1c1e);color:var(--dsw-alias-text-primary,#eee);border:1px solid var(--dsw-alias-border-default,#ffffff18);border-radius:16px;box-shadow:0 26px 96px #000a;overflow:hidden;font-size:13px;line-height:1.55}
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
.dpf-label{display:block;font-size:11px;color:var(--dsw-alias-text-secondary,#86868c);margin-bottom:5px;letter-spacing:.02em}
.dpf-actions{display:flex;gap:8px;position:sticky;bottom:-20px;padding:10px 0 0;background:linear-gradient(to top,var(--dsw-alias-bg-elevated,#1c1c1e) 62%,transparent)}
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
          let payload;
          try {
            payload = await response.json();
          } catch {
            throw new Error(`HTTP ${response.status}`);
          }
          if (!payload || payload.ok !== true) throw new Error(payload?.message || `HTTP ${response.status}`);
          return payload;
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

          const [result, setResult] = useState(null);
          const [editedPrompt, setEditedPrompt] = useState('');
          const [error, setError] = useState('');
          const [notice, setNotice] = useState('');
          const [running, setRunning] = useState(false);
          const [tab, setTab] = useState('breakdown');
          const [history, setHistory] = useState(Array.isArray(stored.history) ? stored.history.slice(0, HISTORY_LIMIT) : []);
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
                closePanel();
              }
            };
            window.addEventListener('keydown', onKey, true);
            return () => window.removeEventListener('keydown', onKey, true);
          }, [onClose]);

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
            writeStore({ provider, model, dialect, style, aspect, language, mode, candidates, idea, purpose, mustInclude, mustAvoid, styleHint });
          }, [provider, model, dialect, style, aspect, language, mode, candidates, idea, purpose, mustInclude, mustAvoid, styleHint]);

          const modelOptions = useMemo(() => {
            const flat = [];
            for (const group of groups) for (const item of group.models) flat.push({ provider: group.provider, groupName: group.name, ...item });
            return flat;
          }, [groups]);

          const modelReady = Boolean(provider && model);

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
                remember: true,
              });
              if (!mounted.current || runIdRef.current !== runId) return;
              setResult(payload);
              setEditedPrompt(payload.prompt || '');
              setTab('breakdown');
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
              setError(failure.message || String(failure));
            } finally {
              if (mounted.current && runIdRef.current === runId) {
                setRunning(false);
                runIdRef.current = '';
              }
            }
          }, [running, idea, modelReady, provider, model, dialect, style, aspect, language, mode, candidates, purpose, mustInclude, mustAvoid, styleHint, t]);

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
                h('span', null, modelReady ? `${provider} · ${model}` : t('noModel')),
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
