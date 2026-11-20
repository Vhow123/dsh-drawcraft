/**
 * dsh-drawcraft engine: the pure, testable half of the plugin.
 *
 * It owns three things and nothing else:
 *   1. the catalog (styles, dialects, modes, aspect ratios, field layout) that the
 *      browser panel renders and the host validates against;
 *   2. the system/user prompt that turns a rough idea into a structured
 *      image-generation brief;
 *   3. the parser that turns whatever the model said back into one final
 *      prompt string, with a deterministic stitch as the fallback.
 *
 * No cordis, no fs, no network: `runOptimize` takes an `llm` object that
 * exposes `stream()` and a signal, so tests can pass a fake.
 */

export const FIELD_ORDER = [
  'subject',
  'action',
  'environment',
  'composition',
  'lighting',
  'camera',
  'style',
  'palette',
  'materials',
  'mood',
  'details',
];

export const FIELD_LABELS = {
  subject: '主体',
  action: '动作 / 状态',
  environment: '环境 / 背景',
  composition: '构图 / 机位',
  lighting: '光线',
  camera: '镜头 / 画质',
  style: '风格 / 媒介',
  palette: '色彩 / 影调',
  materials: '材质 / 细节',
  mood: '氛围',
  details: '关键细节',
};

/** Style presets. `hint` is injected verbatim into the system prompt. */
export const STYLES = [
  {
    key: 'auto',
    label: '自动判断',
    hint: 'Infer the most fitting visual language from the idea itself and say so in the style field.',
  },
  {
    key: 'photo',
    label: '写实摄影',
    hint: 'Photorealistic photography: real lens behaviour, truthful skin and fabric texture, natural imperfection, documentary framing.',
  },
  {
    key: 'cinematic',
    label: '电影感',
    hint: 'Cinematic still: anamorphic widescreen framing, motivated practical light, filmic contrast, shallow depth of field, subtle grain.',
  },
  {
    key: 'editorial',
    label: '商业广告',
    hint: 'Commercial advertising key visual: one dominant product or subject, controlled studio light, immaculate surfaces, space reserved for copy.',
  },
  {
    key: 'product',
    label: '电商产品图',
    hint: 'E-commerce product shot: clean seamless backdrop, soft gradient light, precise edges, believable contact shadow, catalogue-grade sharpness.',
  },
  {
    key: 'illustration',
    label: '插画绘本',
    hint: 'Editorial illustration or picture-book art: hand-drawn line quality, layered flat colour, tactile paper grain, expressive shapes over realism.',
  },
  {
    key: 'anime',
    label: '日系动画',
    hint: 'Anime key frame: clean cel shading, two-tone shadows, expressive eyes and silhouette, painted background plate, consistent perspective.',
  },
  {
    key: 'concept',
    label: '游戏原画',
    hint: 'Game concept art: strong silhouette design, production-ready material callouts, atmospheric depth, worldbuilding detail in the background.',
  },
  {
    key: '3d',
    label: '3D 渲染',
    hint: '3D render: physically based shading, soft global illumination, procedural micro-detail, ray-traced reflections, Cinematic RenderEngine look.',
  },
  {
    key: 'cyberpunk',
    label: '赛博朋克',
    hint: 'Cyberpunk: neon on wet asphalt, high-rise density, holographic signage, magenta-cyan light duel, atmospheric haze and bloom.',
  },
  {
    key: 'minimal',
    label: '极简海报',
    hint: 'Minimal graphic poster: one focal shape, generous negative space, restricted two-or-three colour palette, typographic grid awareness.',
  },
  {
    key: 'watercolor',
    label: '水彩手绘',
    hint: 'Watercolour: wet-on-wet bleeding edges, granulating pigment, visible cold-press paper tooth, restrained washes with one saturated accent.',
  },
  {
    key: 'ink',
    label: '国风水墨',
    hint: 'Chinese ink painting: brush pressure variation, dry-brush texture, deliberate empty space (留白), ink wash gradients, minimal seal-red accent.',
  },
  {
    key: 'clay',
    label: '黏土玩具',
    hint: 'Clay / vinyl toy render: rounded chamfered forms, fingerprint-level surface imperfection, soft studio softbox light, tilt-shift miniature feel.',
  },
  {
    key: 'pixel',
    label: '像素复古',
    hint: 'Pixel art: strict limited palette, readable 1–2 px outlines, dithering for gradients, isometric or side-view consistency.',
  },
  {
    key: 'architecture',
    label: '建筑可视化',
    hint: 'Architectural visualisation: correct perspective and scale, material truth (concrete, timber, glass), balanced daylight, human scale cues.',
  },
  {
    key: 'icon',
    label: '图标矢量',
    hint: 'Flat vector icon: geometric construction on a grid, uniform stroke weight, no gradients unless requested, high contrast at small size.',
  },
  { key: 'custom', label: '自定义风格', hint: '' },
];

/** Target-model dialects. Each one rewrites how the final `prompt` reads. */
export const DIALECTS = [
  {
    key: 'natural-en',
    label: '自然英文（通用）',
    hint:
      'Write `prompt` as flowing English prose in two to four sentences: subject and action first, then environment, light, lens, style. No tag soup, no parameters, no markdown.',
  },
  {
    key: 'natural-zh',
    label: '自然中文',
    hint:
      '用两到四句自然中文书写 `prompt`：先主体与动作，再环境、光线、镜头、风格。不要逗号标签堆砌，不要写参数，不要 markdown。',
  },
  {
    key: 'gpt-image',
    label: 'GPT-Image / DALL·E',
    hint:
      'Target GPT-Image-class models. `prompt` is English natural language: one dense scene paragraph, then one short constraints sentence such as "No text, no watermark, no duplicated limbs". These models ignore negative prompts, so state avoidances as positive constraints inside `prompt` and return an empty `negative` string.',
  },
  {
    key: 'midjourney',
    label: 'Midjourney',
    hint:
      'Target Midjourney. `prompt` is comma-separated visual phrases, 20–40 words, no sentences, no parameters — the host appends `--ar` and `--style raw` itself. Keep `negative` to three or four comma-separated items; the host appends `--no <negative>`.',
  },
  {
    key: 'stable-diffusion',
    label: 'Stable Diffusion',
    hint:
      'Target Stable Diffusion / SDXL. `prompt` is comma-separated tags ordered by importance, 30–50 words, weights allowed in the form `(soft rim light:1.2)`. `negative` is required: comma-separated unwanted artifacts such as blur, extra fingers, watermark, text.',
  },
  {
    key: 'nano-banana',
    label: 'Nano Banana / 改图',
    hint:
      'Target Gemini nano-banana image generation and editing. `prompt` is a short plain-English narrative paragraph that states what to keep, what to change and what to avoid, phrased as an edit instruction when the idea starts from an existing image.',
  },
];

export const MODES = [
  { key: 'create', label: '从零创作', hint: 'The input is a rough idea. Invent the missing visual decisions and commit to one coherent direction.' },
  { key: 'refine', label: '精修改写', hint: 'The input already is a prompt. Keep its subject, composition and intent; replace vague words with concrete, photographable detail and fix ordering.' },
  { key: 'variation', label: '换方向', hint: 'The input already is a prompt. Keep the subject, but propose clearly different visual directions (light, era, medium, palette) — one per variant.' },
];

export const ASPECTS = ['auto', '1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9'];
export const LANGUAGES = [
  { key: 'en', label: '英文' },
  { key: 'zh', label: '中文' },
];
export const MAX_PROMPT_CHARS = 2500;
export const MAX_IDEA_CHARS = 6000;

/** Banned filler: models love these and they carry no visual information. */
const FILLER = [
  'masterpiece',
  'best quality',
  'ultra detailed',
  'ultra-detailed',
  'highly detailed',
  'award winning',
  'award-winning',
  'trending on artstation',
  '8k',
  '4k resolution',
  'hyper realistic',
  'hyperrealistic',
];

export function stripFiller(text) {
  let out = String(text ?? '');
  for (const word of FILLER) {
    const pattern = new RegExp(`(^|[,\\s])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=[,\\s.。]|$)`, 'gi');
    out = out.replace(pattern, '$1');
  }
  return out
    .replace(/[,，](\s*[,，])+/g, ',')
    .replace(/^[\s,，.。]+|[\s,，]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function oneLine(value, limit) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return limit && text.length > limit ? `${text.slice(0, limit - 1).trim()}…` : text;
}

export function findStyle(key) {
  return STYLES.find((style) => style.key === key) ?? STYLES[0];
}

export function findDialect(key) {
  return DIALECTS.find((dialect) => dialect.key === key) ?? DIALECTS[0];
}

export function findMode(key) {
  return MODES.find((mode) => mode.key === key) ?? MODES[0];
}

/** Strip user- or model-supplied MJ parameters so the host owns them. */
export function stripMidjourneyParams(prompt) {
  return String(prompt ?? '')
    .replace(
      /\s--no\b(?:\s+(?!--)[^\s]+)*|\s--(?:aspect|ar|version|v|stylize|style|chaos|quality|q|seed|weird|tile|niji|s|c)\b(?:\s+[^\s-][^\s]*)?/gi,
      '',
    )
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Deterministic fallback: build a prompt from fields without the model's help. */
export function stitch(fields, options = {}) {
  const dialect = findDialect(options.dialect);
  const aspect = ASPECTS.includes(options.aspect) && options.aspect !== 'auto' ? options.aspect : '16:9';
  const values = FIELD_ORDER.map((key) => stripFiller(oneLine(fields?.[key], 400))).filter(Boolean);
  if (values.length === 0) return '';
  if (dialect.key === 'midjourney') {
    return `${values.join(', ')} --ar ${aspect} --style raw`;
  }
  if (dialect.key === 'stable-diffusion') {
    return values.join(', ');
  }
  if (dialect.key === 'natural-zh') {
    return values.map((value) => value.replace(/[。.\s]+$/, '')).join('，') + '。';
  }
  return values.map((value) => value.replace(/[。.\s]+$/, '')).join('. ') + '.';
}

export function buildSystemPrompt(input = {}) {
  const style = findStyle(input.style);
  const dialect = findDialect(input.dialect);
  const mode = findMode(input.mode);
  const language = input.language === 'zh' ? 'zh' : 'en';
  const aspect = ASPECTS.includes(input.aspect) ? input.aspect : 'auto';
  const candidates = normalizeCandidates(input.candidates);
  const languageRule =
    language === 'zh'
      ? 'Write every field value, `prompt`, `negative`, `title`, `variants` and `notes` in Simplified Chinese. Keep well-known proper nouns and technical terms in English when the Chinese would be ambiguous (for example "rim light" may stay English).'
      : 'Write every field value, `prompt`, `negative`, `title`, `variants` and `notes` in English.';

  return [
    'You are a senior AI image prompt engineer. You turn one rough idea into one production-ready image-generation prompt that a diffusion or multimodal image model can execute directly.',
    '',
    'HARD RULES',
    '1. Be concrete and visual. Name the subject and how many, the pose or action, the environment, time of day, camera position and lens, lighting setup, materials, palette and mood. Every clause must be something a photographer or art director could actually stage.',
    '2. Never pad with empty praise tokens. Banned: masterpiece, best quality, ultra detailed, 8k, award winning, trending on artstation, hyper realistic, "highly detailed". Quality comes from specificity, not from adjectives.',
    '3. Respect the user intent. Do not swap the subject, do not add people when nobody was asked for, do not change the story of the scene. You fill in missing visual decisions; you do not redesign the request.',
    '4. No repetition across fields. Each field must add new information; a fact stated in `lighting` must not be restated in `details`.',
    '5. Only include in-image text when the user asked for text, and then quote it exactly with quotation marks.',
    '6. Keep `prompt` under 1800 characters. Keep each field under 220 characters.',
    '7. Return exactly ONE JSON object and nothing else: no markdown fence, no explanation before or after, no trailing commentary.',
    '',
    'JSON SHAPE',
    '{',
    '  "title": "short label, at most 24 characters",',
    '  "fields": {',
    '    "subject": "who or what, with count and identifying detail",',
    '    "action": "pose, gesture, motion or state",',
    '    "environment": "place, background layers, weather or time",',
    '    "composition": "framing, camera angle, subject placement, negative space",',
    '    "lighting": "key/fill/rim or practical sources, direction, quality, colour temperature",',
    '    "camera": "lens, aperture, distance, depth of field, film or sensor feel",',
    '    "style": "medium and visual language actually chosen",',
    '    "palette": "dominant colours and overall tonal range",',
    '    "materials": "surface and texture truth: fabric, metal, skin, paint",',
    '    "mood": "emotional register and atmosphere",',
    '    "details": "two or three small story-bearing details that reward a close look"',
    '  },',
    '  "prompt": "the final prompt, written exactly for the target dialect below",',
    '  "negative": "comma-separated things to avoid; empty string when the dialect ignores negatives",',
    '  "params": { "aspect_ratio": "16:9", "quality": "high" },',
    '  "variants": ["one-line alternate direction", "another alternate direction"],',
    '  "notes": "one short practical tip about this prompt or the model that will run it"',
    '}',
    '',
    `OUTPUT LANGUAGE — ${languageRule}`,
    `STYLE PRESET — ${style.label}: ${style.key === 'custom' ? (identityHint(input.styleHint) || 'Follow the visual language the user described explicitly.') : style.hint}`,
    `TARGET DIALECT — ${dialect.label}: ${dialect.hint}`,
    `FRAMING — ${aspect === 'auto' ? 'choose the aspect ratio that best serves the subject and report it in params.aspect_ratio; do not default to 16:9 out of habit.' : `the image will be rendered at ${aspect}; compose for it and report it in params.aspect_ratio.`}`,
    `TASK MODE — ${mode.label}: ${mode.hint}`,
    candidates > 1
      ? `The user asked for ${candidates} candidate prompts. Put the strongest direction in the top-level fields and \`prompt\`; each extra candidate goes into \`variants\` as one dense paragraph (80–160 characters) that could be used on its own.`
      : 'Return one single direction. `variants` may hold one or two genuinely different alternates in one line each, or an empty array.',
    input.negative
      ? 'Return a real `negative` list even when the dialect ignores it: the host hides it for dialects that cannot use it.'
      : 'Set `negative` to an empty string unless the dialect rules require one.',
    ...(input.referenceBlock
      ? [
          '8. A REFERENCE LIBRARY block may arrive in the user message. Its posture, garment and hair descriptions are binding facts: reuse the matching Chinese wording verbatim in the matching field, never contradict it, and never mention the library, its IDs, or that a reference set exists.',
        ]
      : []),
    '',
    'Before you answer, silently check: does every field add information? is there any banned filler word? does `prompt` obey the dialect rules exactly? is the JSON valid with double quotes?',
  ].join('\n');
}

function identityHint(value) {
  const hint = oneLine(value, 600);
  return hint;
}

export function normalizeCandidates(value) {
  const count = Number(value);
  if (!Number.isFinite(count)) return 1;
  return Math.max(1, Math.min(3, Math.round(count)));
}

export function buildUserPrompt(input = {}) {
  const idea = oneLine(input.idea, MAX_IDEA_CHARS);
  const mode = findMode(input.mode);
  const lines = [`USER REQUEST:\n${idea}`];
  if (mode.key !== 'create') {
    lines.push(
      '',
      mode.key === 'refine'
        ? 'The text above is an existing prompt. Keep its subject and intent, then raise the density of concrete visual information and fix the ordering.'
        : 'The text above is an existing prompt. Keep the subject, then give clearly different visual directions.',
    );
  }
  if (input.purpose) lines.push('', `INTENDED USE: ${oneLine(input.purpose, 200)}`);
  if (input.mustInclude) lines.push('', `MUST KEEP (verbatim elements): ${oneLine(input.mustInclude, 400)}`);
  if (input.mustAvoid) lines.push('', `MUST AVOID: ${oneLine(input.mustAvoid, 400)}`);
  // 参考库块由 index.js 从 gallery.js 拼好传进来；engine 只当作普通文本，保持纯函数。
  if (input.referenceBlock) lines.push('', String(input.referenceBlock).slice(0, 2000));
  if (input.aspect && input.aspect !== 'auto') lines.push('', `ASPECT RATIO: ${input.aspect}`);
  if (input.styleHint && findStyle(input.style).key === 'custom') lines.push('', `CUSTOM STYLE: ${oneLine(input.styleHint, 600)}`);
  lines.push('', 'Return the JSON object now.');
  return lines.join('\n');
}

/** Pull the first JSON object out of whatever the model produced. */
export function extractJson(text) {
  const source = String(text ?? '').replace(/^\uFEFF/, '').trim();
  if (!source) return null;
  const candidates = [];
  const fenced = source.match(/```(?:json|JSON)?\s*([\s\S]*?)```/);
  if (fenced) candidates.push(fenced[1].trim());
  candidates.push(source);
  const first = source.indexOf('{');
  const last = source.lastIndexOf('}');
  if (first !== -1 && last > first) candidates.push(source.slice(first, last + 1));
  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate);
      if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    } catch {
      /* try the next slice */
    }
  }
  return null;
}

/** Coerce model output into the shape the panel and the tool expect. */
export function normalizeResult(raw, input = {}) {
  const dialect = findDialect(input.dialect);
  const style = findStyle(input.style);
  const language = input.language === 'zh' ? 'zh' : 'en';
  const aspect = ASPECTS.includes(input.aspect) ? input.aspect : 'auto';
  const fields = {};
  for (const key of FIELD_ORDER) {
    const value = raw?.fields?.[key];
    if (typeof value === 'string' && value.trim()) fields[key] = stripFiller(oneLine(value, 400));
  }
  let prompt = typeof raw?.prompt === 'string' ? stripFiller(oneLine(raw.prompt, MAX_PROMPT_CHARS)) : '';
  if (!prompt) prompt = stitch(fields, { dialect: dialect.key, aspect });
  let negative = typeof raw?.negative === 'string' ? stripFiller(oneLine(raw.negative, 600)) : '';
  if (!prompt && negative) prompt = negative;

  // An explicit aspect is the user's decision; only when they left it on auto
  // does the model get to report the ratio it composed for.
  const ratio =
    aspect !== 'auto'
      ? aspect
      : ASPECTS.includes(raw?.params?.aspect_ratio)
        ? raw.params.aspect_ratio
        : '16:9';

  if (dialect.key === 'midjourney') {
    const base = stripMidjourneyParams(prompt);
    const noParam = negative ? ` --no ${negative}` : '';
    prompt = `${base} --ar ${ratio === 'auto' ? '16:9' : ratio} --style raw${noParam}`;
  } else {
    // Midjourney switches are never valid anywhere else; drop them even if the
    // model emitted them by habit.
    prompt = stripMidjourneyParams(prompt);
  }
  if (dialect.key === 'gpt-image') negative = '';

  const variants = Array.isArray(raw?.variants)
    ? raw.variants
        .filter((item) => typeof item === 'string' && item.trim())
        .map((item) => stripFiller(oneLine(item, 400)))
        .slice(0, 3)
    : [];

  return {
    ok: true,
    title: oneLine(raw?.title, 60) || (prompt || '未命名提示词').slice(0, 24),
    fields,
    prompt: prompt.slice(0, MAX_PROMPT_CHARS),
    negative: negative.slice(0, 800),
    params: {
      aspect_ratio: ratio,
      quality: typeof raw?.params?.quality === 'string' ? oneLine(raw.params.quality, 24) : '',
    },
    variants,
    notes: typeof raw?.notes === 'string' ? oneLine(raw.notes, 400) : '',
    dialect: dialect.key,
    style: style.key,
    language,
    mode: findMode(input.mode).key,
    styleHint: input.styleHint ? oneLine(input.styleHint, 600) : '',
    idea: oneLine(input.idea, MAX_IDEA_CHARS),
    createdAt: Date.now(),
  };
}

function textOf(error) {
  return error instanceof Error ? error.message : String(error);
}

function redact(text) {
  return String(text ?? '')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer ***')
    .replace(/\bsk-[A-Za-z0-9_-]{6,}\b/g, 'sk-***')
    .slice(0, 1200);
}

/**
 * Shared streaming call: one system prompt, one user content array, raw text back.
 * Every run* helper funnels through here so timeouts, aborts, finish handling
 * and redaction behave identically no matter which direction the request goes.
 * @internal
 */
async function callModel(llm, spec, signal) {
  const provider = oneLine(spec.provider, 120);
  const model = oneLine(spec.model, 160);
  if (!provider || !model) {
    const error = new Error('请先在工作台顶部选择优化用的对话模型');
    error.code = 'MODEL_REQUIRED';
    throw error;
  }
  const label = spec.label || '优化';
  const timeoutMs = Math.max(8000, Math.min(180000, Number(spec.timeoutMs) || 90000));
  const controller = new AbortController();
  const abort = () => controller.abort(new Error(`已停止${label}`));
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(
    () => controller.abort(new Error(`${label}超时（${Math.round(timeoutMs / 1000)} 秒）`)),
    timeoutMs,
  );
  const startedAt = Date.now();
  let text = '';
  let finishKind;
  let failure;
  try {
    const stream = llm.stream({
      provider,
      model,
      system: spec.system,
      messages: [{ role: 'user', content: spec.content }],
      temperature: spec.temperature ?? 0.75,
      maxTokens: Math.max(1200, Math.min(6000, Number(spec.maxTokens) || 2600)),
      signal: controller.signal,
    });
    for await (const chunk of stream) {
      if (chunk.type === 'text-delta') text += chunk.text;
      if (chunk.type === 'finish') {
        finishKind = chunk.reason?.kind;
        if (chunk.reason?.kind === 'error' || chunk.reason?.kind === 'aborted') failure = chunk.reason.failure;
      }
    }
    if (failure) {
      const error = new Error(redact(failure.message || '模型请求失败'));
      error.code = failure.code || 'LLM_ERROR';
      throw error;
    }
    if (!['stop', 'max-tokens'].includes(finishKind)) {
      const error = new Error(`模型流未正常结束（${finishKind || '无 finish'}）`);
      error.code = 'INCOMPLETE_STREAM';
      throw error;
    }
    return { text, elapsedMs: Date.now() - startedAt, provider, model };
  } catch (error) {
    if (controller.signal.aborted && !signal?.aborted) {
      const timeout = new Error(`${label}超时（${Math.round(timeoutMs / 1000)} 秒）`);
      timeout.code = 'TIMEOUT';
      throw timeout;
    }
    if (typeof error?.code !== 'string') error.code = 'ENGINE_ERROR';
    error.message = redact(error.message);
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.('abort', abort);
  }
}

/**
 * Stream an optimization run through the harness LLM service.
 * @param llm - the cordis `llm` service (needs `stream`).
 * @param input - the panel/tool payload.
 * @param signal - caller-owned AbortSignal.
 */
export async function runOptimize(llm, input = {}, signal) {
  if (!oneLine(input.provider, 120) || !oneLine(input.model, 160)) {
    const error = new Error('请先在工作台顶部选择优化用的对话模型');
    error.code = 'MODEL_REQUIRED';
    throw error;
  }
  const idea = oneLine(input.idea, MAX_IDEA_CHARS);
  if (!idea) {
    const error = new Error('请先写下你想画的画面');
    error.code = 'IDEA_REQUIRED';
    throw error;
  }
  if (idea.length < 2) {
    const error = new Error('画面描述太短，至少写两个字符');
    error.code = 'IDEA_TOO_SHORT';
    throw error;
  }
  const candidates = normalizeCandidates(input.candidates ?? 1);
  const call = await callModel(
    llm,
    {
      provider: input.provider,
      model: input.model,
      system: buildSystemPrompt({ ...input, candidates }),
      content: [{ type: 'text', text: buildUserPrompt({ ...input, candidates }) }],
      temperature: 0.75,
      maxTokens: Number(input.maxTokens) || (candidates > 1 ? 3600 : 2600),
      timeoutMs: input.timeoutMs,
      label: '优化',
    },
    signal,
  );
  const parsed = extractJson(call.text);
  if (!parsed) {
    const error = new Error('模型没有按 JSON 契约回复，可再试一次或换个模型');
    error.code = 'BAD_OUTPUT';
    error.raw = redact(call.text);
    throw error;
  }
  const result = normalizeResult(parsed, { ...input, candidates });
  if (!result.prompt) {
    const error = new Error('模型返回的提示词为空，可再试一次或换个模型');
    error.code = 'EMPTY_PROMPT';
    throw error;
  }
  result.elapsedMs = call.elapsedMs;
  result.provider = call.provider;
  result.model = call.model;
  return result;
}

/* ------------------------------------------------------------------ */
/* image -> prompt                                                     */
/* ------------------------------------------------------------------ */

const DESCRIBE_SYSTEM = [
  'You are a senior AI image prompt engineer doing reverse engineering. You are shown ONE reference image and must describe it precisely enough that the same picture could be regenerated from your words alone.',
  '',
  'HARD RULES',
  '1. Describe what is actually there, not what you would have designed. Count the subjects, name the visible materials, quote any legible in-image text verbatim in quotation marks.',
  '2. Infer the camera: apparent focal length, height, distance, depth of field, and whether it reads as photograph, illustration, 3D render or painting.',
  '3. Infer the light: direction, quality (hard/soft), colour temperature, and whether the source is practical, daylit or studio.',
  '4. Never pad with empty praise tokens. Banned: masterpiece, best quality, ultra detailed, 8k, award winning, trending on artstation, hyper realistic, "highly detailed".',
  '5. No repetition across fields. Each field adds information; a fact stated in `lighting` is not restated in `details`.',
  '6. Keep `prompt` under 1800 characters, each field under 220 characters.',
  '7. Return exactly ONE JSON object and nothing else: no markdown fence, no explanation before or after.',
  '',
  'JSON SHAPE',
  '{',
  '  "title": "short label for the image, at most 24 characters",',
  '  "fields": {',
  '    "subject": "who or what, with count and identifying detail",',
  '    "action": "pose, gesture, motion or state",',
  '    "environment": "place, background layers, weather or time",',
  '    "composition": "framing, camera angle, subject placement, negative space",',
  '    "lighting": "key/fill/rim or practical sources, direction, quality, colour temperature",',
  '    "camera": "lens, aperture, distance, depth of field, film or sensor feel",',
  '    "style": "medium and visual language actually used",',
  '    "palette": "dominant colours and overall tonal range",',
  '    "materials": "surface and texture truth: fabric, metal, skin, paint",',
  '    "mood": "emotional register and atmosphere",',
  '    "details": "two or three small story-bearing details visible in the frame"',
  '  },',
  '  "prompt": "the final prompt, written exactly for the target dialect below",',
  '  "negative": "comma-separated things this image avoids; empty string when the dialect ignores negatives",',
  '  "params": { "aspect_ratio": "the ratio the image itself has", "quality": "high" },',
  '  "variants": ["one-line alternate direction that would also fit"],',
  '  "notes": "one short practical tip about reproducing this look"',
  '}',
  '',
  'Answer in English. The host translates field labels for display; the prompt text itself must follow the TARGET DIALECT rules below.',
].join('\n');

/** System prompt for the image -> prompt direction. */
export function buildDescribeSystemPrompt(input = {}) {
  const dialect = findDialect(input.dialect);
  const aspect = ASPECTS.includes(input.aspect) && input.aspect !== 'auto' ? input.aspect : 'auto';
  return [
    DESCRIBE_SYSTEM,
    '',
    `TARGET DIALECT — ${dialect.label}: ${dialect.hint}`,
    aspect === 'auto'
      ? 'FRAMING — report the aspect ratio you actually observe in `params.aspect_ratio`; do not force 16:9.'
      : `FRAMING — the user wants a ${aspect} render of this image; report it in params.aspect_ratio.`,
    input.language === 'zh'
      ? 'FIELD VALUES — write every field value in Simplified Chinese; keep proper nouns and technical terms in English when Chinese would be ambiguous.'
      : 'FIELD VALUES — write every field value in English.',
    input.idea ? `EXTRA CONTEXT FROM THE USER: ${oneLine(input.idea, 600)}` : '',
    '',
    'Return the JSON object now.',
  ]
    .filter(Boolean)
    .join('\n');
}

/** User turn for the image -> prompt direction (the image block is added by the caller). */
export function buildDescribeUserPrompt(input = {}) {
  const lines = ['Please reverse-engineer the attached image into a generation prompt.'];
  if (input.mustAvoid) lines.push('', `MUST AVOID in your description: ${oneLine(input.mustAvoid, 400)}`);
  return lines.join('\n');
}

/**
 * Reverse-engineer one image into the same structured result shape.
 * @param llm - harness llm service.
 * @param input - needs `provider`, `model` and `image` (`{ attachment }` block or full content array).
 * @param signal - caller-owned AbortSignal.
 */
export async function runDescribe(llm, input = {}, signal) {
  if (!oneLine(input.provider, 120) || !oneLine(input.model, 160)) {
    const error = new Error('请先在工作台顶部选择能看图的对话模型');
    error.code = 'MODEL_REQUIRED';
    throw error;
  }
  const content = Array.isArray(input.content) ? input.content : null;
  if (!content || !content.some((part) => part?.type === 'image')) {
    const error = new Error('请先选一张参考图');
    error.code = 'IMAGE_REQUIRED';
    throw error;
  }
  const call = await callModel(
    llm,
    {
      provider: input.provider,
      model: input.model,
      system: buildDescribeSystemPrompt(input),
      content,
      temperature: 0.4,
      maxTokens: 2800,
      timeoutMs: input.timeoutMs,
      label: '反推',
    },
    signal,
  );
  const parsed = extractJson(call.text);
  if (!parsed) {
    const error = new Error('模型没有按 JSON 契约回复，换一个能看图的模型再试');
    error.code = 'BAD_OUTPUT';
    error.raw = redact(call.text);
    throw error;
  }
  const result = normalizeResult(parsed, { ...input, idea: input.idea || '(反推自参考图)' });
  if (!result.prompt) {
    const error = new Error('模型没能描述出这张图，换一个能看图的模型再试');
    error.code = 'EMPTY_PROMPT';
    throw error;
  }
  result.elapsedMs = call.elapsedMs;
  result.provider = call.provider;
  result.model = call.model;
  result.source = 'image';
  return result;
}

/* ------------------------------------------------------------------ */
/* prompt -> prompt (one-line delta edit)                              */
/* ------------------------------------------------------------------ */

const PATCH_SYSTEM_TAIL = [
  'You are editing an existing image-generation prompt. The user sends one short instruction naming what to change.',
  '',
  'HARD RULES',
  '1. Change ONLY what the instruction names. Every field the instruction does not touch must be copied back verbatim, character for character.',
  '2. If the instruction names a field, rewrite that field so it satisfies the instruction and still fits the scene.',
  '3. Never re-invent the subject. If the instruction is ambiguous, pick the reading that changes the least.',
  '4. No banned filler tokens: masterpiece, best quality, ultra detailed, 8k, award winning, trending on artstation, hyper realistic.',
  '5. Return exactly ONE JSON object with the SAME shape as the input: no markdown fence, no commentary.',
  '',
  'JSON SHAPE',
  '{',
  '  "title": "short label, at most 24 characters",',
  '  "fields": { "subject": "...", "action": "...", "environment": "...", "composition": "...", "lighting": "...", "camera": "...", "style": "...", "palette": "...", "materials": "...", "mood": "...", "details": "..." },',
  '  "prompt": "the complete rewritten final prompt for the target dialect",',
  '  "negative": "comma-separated things to avoid",',
  '  "params": { "aspect_ratio": "16:9", "quality": "high" },',
  '  "variants": [],',
  '  "notes": "one short line naming what you changed"',
  '}',
].join('\n');

/** System prompt for the one-line delta edit direction. */
export function buildPatchSystemPrompt(input = {}) {
  const dialect = findDialect(input.dialect);
  return [
    PATCH_SYSTEM_TAIL,
    '',
    `TARGET DIALECT — ${dialect.label}: ${dialect.hint}`,
    input.language === 'zh'
      ? 'FIELD VALUES — keep the language of the original field values.'
      : 'FIELD VALUES — keep the language of the original field values.',
  ].join('\n');
}

/** User turn carrying the original fields plus the instruction. */
export function buildPatchUserPrompt(input = {}) {
  const fields = input.fields && typeof input.fields === 'object' ? input.fields : {};
  const known = {};
  for (const key of FIELD_ORDER) {
    if (typeof fields[key] === 'string' && fields[key].trim()) known[key] = fields[key].trim();
  }
  const lines = [
    'CURRENT FIELDS (verbatim source of truth):',
    JSON.stringify(known, null, 2),
    '',
    'CURRENT FINAL PROMPT:',
    oneLine(input.prompt, MAX_PROMPT_CHARS) || '(empty)',
  ];
  if (input.negative) lines.push('', 'CURRENT NEGATIVE:', oneLine(input.negative, 600));
  lines.push('', `CHANGE REQUEST: ${oneLine(input.instruction, 600) || '(none)'}`);
  lines.push('', 'Return the full JSON object now, with untouched fields copied verbatim.');
  return lines.join('\n');
}

/**
 * Apply one short instruction to an existing result.
 * @param llm - harness llm service.
 * @param input - `{ provider, model, prompt, fields, negative, instruction, dialect, aspect, language }`.
 * @param signal - caller-owned AbortSignal.
 */
export async function runPatch(llm, input = {}, signal) {
  const instruction = oneLine(input.instruction, 600);
  if (!instruction) {
    const error = new Error('请先写下要改什么，例如「光线换成黄昏」');
    error.code = 'INSTRUCTION_REQUIRED';
    throw error;
  }
  if (!oneLine(input.prompt, MAX_PROMPT_CHARS) && !input.fields) {
    const error = new Error('没有可修改的提示词，先优化一版');
    error.code = 'PROMPT_REQUIRED';
    throw error;
  }
  if (!oneLine(input.provider, 120) || !oneLine(input.model, 160)) {
    const error = new Error('请先在工作台顶部选择优化用的对话模型');
    error.code = 'MODEL_REQUIRED';
    throw error;
  }
  const call = await callModel(
    llm,
    {
      provider: input.provider,
      model: input.model,
      system: buildPatchSystemPrompt(input),
      content: [{ type: 'text', text: buildPatchUserPrompt(input) }],
      temperature: 0.3,
      maxTokens: 2600,
      timeoutMs: input.timeoutMs,
      label: '修改',
    },
    signal,
  );
  const parsed = extractJson(call.text);
  if (!parsed) {
    const error = new Error('模型没有按 JSON 契约回复，可再试一次');
    error.code = 'BAD_OUTPUT';
    error.raw = redact(call.text);
    throw error;
  }
  const result = normalizeResult(parsed, { ...input, idea: input.idea || input.prompt || '' });
  if (!result.prompt) {
    const error = new Error('模型返回的提示词为空，可再试一次');
    error.code = 'EMPTY_PROMPT';
    throw error;
  }
  result.elapsedMs = call.elapsedMs;
  result.provider = call.provider;
  result.model = call.model;
  result.source = 'patch';
  result.instruction = instruction;
  return result;
}

export const CATALOG = {
  styles: STYLES,
  dialects: DIALECTS,
  modes: MODES,
  aspects: ASPECTS,
  languages: LANGUAGES,
  fields: FIELD_ORDER.map((key) => ({ key, label: FIELD_LABELS[key] })),
  limits: { idea: MAX_IDEA_CHARS, prompt: MAX_PROMPT_CHARS },
};

