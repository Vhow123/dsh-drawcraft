/**
 * dsh-drawcraft host half.
 *
 * Registers loopback-only JSON routes for the browser panel and two agent tools,
 * all of them delegating the actual prompt work to engine.js:
 *   POST /api/drawcraft/catalog  → styles/dialects/modes + live model list + saved config
 *   POST /api/drawcraft/optimize → one structured optimization run (idea → prompt)
 *   POST /api/drawcraft/describe → one image → prompt run (needs a vision model)
 *   POST /api/drawcraft/patch    → one-line delta edit applied to an existing result
 *   POST /api/drawcraft/stop     → abort a running optimization by runId
 *   POST /api/drawcraft/config   → persist the default provider/model and last-used options
 *
 * The saved config lives in ~/.dsh/drawcraft.json so the agent tool can run
 * without the panel being open.
 */
import { appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import {
  buildDescribeUserPrompt,
  CATALOG,
  FIELD_LABELS,
  FIELD_ORDER,
  findDialect,
  findStyle,
  normalizeCandidates,
  runDescribe,
  runOptimize,
  runPatch,
} from './engine.js';
import {
  buildReferenceBlock,
  findEntry,
  GALLERY_LIBS,
  listKinds,
  parseKindFilters,
  randomGallery,
  searchGallery,
} from './gallery.js';

export { CATALOG, runDescribe, runOptimize, runPatch } from './engine.js';

export const name = 'drawcraft';
export const inject = ['webServer', 'llm'];

const API = '/api/drawcraft';
const CONFIG_VERSION = 1;

const TRACE_PATH = join(homedir(), '.dsh', 'drawcraft-load.log');

function trace(line) {
  try {
    appendFileSync(TRACE_PATH, `${new Date().toISOString()} ${line}\n`);
  } catch {
    // 诊断日志写不了不能影响插件加载
  }
}

/*
 * 本插件用 junction 链接进 profile，真实路径在 DSH 安装目录之外，Node 的 ESM
 * 解析会从真实路径向上找 node_modules，够不到 @deepseek-ai/*。所以这里不 import
 * 宿主包，而是自带一份 defineTool 的最小实现：把声明式参数表编译成 JSON Schema，
 * 并在 execute 前做同等的必填与类型校验，产出对象与宿主 register() 期望的一致。
 */
const JSON_SCHEMA_TYPES = {
  string: 'string',
  integer: 'integer',
  number: 'number',
  boolean: 'boolean',
};

function parametersToSchema(spec) {
  const properties = {};
  const required = [];
  for (const [key, field] of Object.entries(spec || {})) {
    const node = { type: JSON_SCHEMA_TYPES[field?.type] || 'string' };
    if (typeof field?.description === 'string' && field.description) node.description = field.description;
    if (Array.isArray(field?.enum) && field.enum.length > 0) node.enum = field.enum.slice();
    if (Array.isArray(field?.items)) node.items = { type: JSON_SCHEMA_TYPES[field.items[0]?.type] || 'string' };
    properties[key] = node;
    if (field?.required === true) required.push(key);
  }
  const schema = { type: 'object', properties };
  if (required.length > 0) schema.required = required;
  return schema;
}

function validateArgs(schema, args) {
  const violations = [];
  const input = args && typeof args === 'object' ? args : {};
  for (const key of schema.required || []) {
    const value = input[key];
    if (value === undefined || value === null || value === '') violations.push(`${key}: 必填参数缺失`);
  }
  for (const [key, node] of Object.entries(schema.properties || {})) {
    const value = input[key];
    if (value === undefined || value === null) continue;
    if (node.type === 'string' && typeof value !== 'string') violations.push(`${key}: 应为字符串`);
    if (node.type === 'integer' && !Number.isInteger(value)) violations.push(`${key}: 应为整数`);
    if (node.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) violations.push(`${key}: 应为数字`);
    if (node.type === 'boolean' && typeof value !== 'boolean') violations.push(`${key}: 应为布尔值`);
    if (Array.isArray(node.enum) && !node.enum.includes(value)) violations.push(`${key}: 取值必须是 ${node.enum.join(' / ')} 之一`);
  }
  return violations;
}

function defineTool(options) {
  const parameters = parametersToSchema(options.parameters);
  const userExecute = options.execute;
  const userRender = options.output.render;
  return {
    name: options.name,
    description: options.description,
    parameters,
    output: {
      schema: options.output.schema,
      render: (args, value) => userRender(args, value),
    },
    async execute(args, exec) {
      const violations = validateArgs(parameters, args);
      if (violations.length > 0) throw new Error(`invalid arguments: ${violations.join('; ')}`);
      return userExecute(args, exec);
    },
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

function writeJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'referrer-policy': 'no-referrer' });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 65536) throw new Error('请求内容过大');
    chunks.push(chunk);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('请求内容不是合法 JSON');
  }
}

function loopback(req) {
  const address = req.socket?.remoteAddress;
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address)) return false;
  const host = req.headers.host;
  if (typeof host !== 'string') return false;
  let local;
  try {
    local = new URL(`http://${host}`);
  } catch {
    return false;
  }
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(local.hostname)) return false;
  if (req.headers['sec-fetch-site'] === 'cross-site') return false;
  if (req.headers.origin === undefined) return true;
  try {
    return new URL(req.headers.origin).host === local.host;
  } catch {
    return false;
  }
}

function guard(req, res) {
  if (!loopback(req)) {
    writeJson(res, 403, { ok: false, message: '仅允许本机同源请求' });
    return false;
  }
  if (req.method !== 'POST') {
    writeJson(res, 405, { ok: false, message: '仅支持 POST' });
    return false;
  }
  return true;
}

function route(path, handler) {
  return {
    kind: 'exact',
    path,
    handler: async (req, res) => {
      if (!guard(req, res)) return;
      try {
        await handler(req, res);
      } catch (error) {
        writeJson(res, 200, { ok: false, code: error?.code || 'PLUGIN_ERROR', message: redact(textOf(error)) });
      }
    },
  };
}

// ── reference gallery ────────────────────────────────────────────────────────

/**
 * 面板传 refs（`[{lib,id}]` 或 `"pose:ID"` 字符串），换成交给引擎的中文描述块。
 * 任何失败都降级成空串：图库不可用不该拖垮提示词优化。
 */
async function resolveReferenceBlock(refs) {
  const list = typeof refs === 'string' ? refs.split(/[,;\s]+/).filter(Boolean) : refs;
  if (!Array.isArray(list) || list.length === 0) return '';
  const entries = [];
  for (const ref of list.slice(0, 8)) {
    let lib = 'auto';
    let id = '';
    if (typeof ref === 'string') {
      const cut = ref.indexOf(':');
      if (cut > 0) {
        lib = ref.slice(0, cut);
        id = ref.slice(cut + 1);
      } else {
        id = ref;
      }
    } else if (ref && typeof ref === 'object') {
      lib = typeof ref.lib === 'string' ? ref.lib : 'auto';
      id = String(ref.id ?? '');
    }
    if (!id) continue;
    const entry = await findEntry(id, lib).catch(() => null);
    if (entry) entries.push(entry);
  }
  return buildReferenceBlock(entries);
}

// ── model catalog ────────────────────────────────────────────────────────────

async function readCatalog(llm) {
  let providers = [];
  try {
    providers = llm.listProviders() ?? [];
  } catch {
    providers = [];
  }
  const groups = await Promise.all(
    providers.map(async (provider) => {
      try {
        const models = await llm.listModels(provider.id);
        return {
          provider: provider.id,
          name: provider.name || provider.displayName || provider.id,
          models: (models ?? []).map((model) => ({ id: model.id, name: model.name || model.id })),
        };
      } catch (error) {
        return {
          provider: provider.id,
          name: provider.name || provider.displayName || provider.id,
          models: [],
          error: redact(textOf(error)),
        };
      }
    }),
  );
  return { groups, total: groups.reduce((sum, group) => sum + group.models.length, 0) };
}

// ── config persistence ───────────────────────────────────────────────────────

const CONFIG_KEYS = ['provider', 'model', 'dialect', 'style', 'language', 'aspect', 'mode', 'candidates', 'styleHint', 'purpose', 'mustInclude', 'mustAvoid'];

function defaults() {
  return {
    version: CONFIG_VERSION,
    provider: '',
    model: '',
    dialect: 'natural-en',
    style: 'auto',
    language: 'en',
    aspect: 'auto',
    mode: 'create',
    candidates: 1,
    styleHint: '',
    purpose: '',
    mustInclude: '',
    mustAvoid: '',
  };
}

function configPath() {
  return join(homedir(), '.dsh', 'drawcraft.json');
}

function pickConfig(value) {
  const base = defaults();
  if (!value || typeof value !== 'object') return base;
  for (const key of CONFIG_KEYS) {
    const raw = value[key];
    if (key === 'candidates') {
      base.candidates = normalizeCandidates(raw ?? 1);
      continue;
    }
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim().slice(0, 600);
    base[key] = trimmed;
  }
  if (!CATALOG.dialects.some((item) => item.key === base.dialect)) base.dialect = 'natural-en';
  if (!CATALOG.styles.some((item) => item.key === base.style)) base.style = 'auto';
  if (!CATALOG.modes.some((item) => item.key === base.mode)) base.mode = 'create';
  if (!CATALOG.aspects.includes(base.aspect)) base.aspect = 'auto';
  if (!['en', 'zh'].includes(base.language)) base.language = 'en';
  return base;
}

async function readConfig() {
  try {
    const raw = await readFile(configPath(), 'utf8');
    return pickConfig(JSON.parse(raw));
  } catch {
    return defaults();
  }
}

async function writeConfig(value) {
  const next = pickConfig({ ...(await readConfig()), ...value });
  const path = configPath();
  await mkdir(join(homedir(), '.dsh'), { recursive: true });
  const temp = `${path}.tmp`;
  await writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  await rename(temp, path);
  return next;
}

// ── bring-your-own image endpoint ────────────────────────────────────────────
//
// 面板可以完全不依赖 dsh-imagegen：这里允许用户自己填一个 OpenAI 兼容的
// 生图端点（地址 + 密钥 + 模型名），由插件服务端转发，密钥不出本机、不写前端。

const TARGETS_VERSION = 1;

function targetsPath() {
  return join(homedir(), '.dsh', 'drawcraft-targets.json');
}

function slug(text) {
  const flat = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return flat.slice(0, 40) || `target-${Date.now().toString(36)}`;
}

function maskKey(key) {
  const text = String(key || '').trim();
  if (!text) return '';
  if (text.length <= 8) return '****';
  return `${text.slice(0, 4)}****${text.slice(-4)}`;
}

function normalizeTarget(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const baseUrl = String(raw.baseUrl || '')
    .trim()
    .replace(/\/+$/, '')
    .slice(0, 400);
  if (!/^https?:\/\//i.test(baseUrl)) return null;
  const list = Array.isArray(raw.models) ? raw.models : String(raw.models || '').split(/[,，;；\s]+/);
  const models = list
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, 24);
  if (models.length === 0) return null;
  return {
    id: String(raw.id || slug(raw.label || baseUrl)).slice(0, 40),
    label: String(raw.label || baseUrl).slice(0, 60),
    baseUrl,
    apiKey: String(raw.apiKey || '').slice(0, 400),
    models,
  };
}

async function readTargets() {
  try {
    const raw = await readFile(targetsPath(), 'utf8');
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed?.targets) ? parsed.targets : [];
    return list.map(normalizeTarget).filter(Boolean);
  } catch {
    return [];
  }
}

async function writeTargets(list) {
  const next = {
    version: TARGETS_VERSION,
    targets: list.map(normalizeTarget).filter(Boolean).slice(0, 12),
  };
  const path = targetsPath();
  await mkdir(join(homedir(), '.dsh'), { recursive: true });
  const temp = `${path}.tmp`;
  await writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  await rename(temp, path);
  return next.targets;
}

/** 密钥只留在服务端，回给面板时打码。 */
function publicTarget(target) {
  return {
    id: target.id,
    label: target.label,
    baseUrl: target.baseUrl,
    models: target.models,
    keyHint: maskKey(target.apiKey),
    hasKey: target.apiKey.trim() !== '',
  };
}

async function readJsonLoose(req, maxBytes = 32 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw Object.assign(new Error('参考图太大，单次最多 32 MB'), { code: 'body-too-large' });
    chunks.push(chunk);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('请求内容不是合法 JSON'), { code: 'bad-json' });
  }
}

function dataUrlToBlob(dataUrl) {
  const text = String(dataUrl || '');
  const match = /^data:([^;,]+)?(?:;base64)?,(.*)$/s.exec(text);
  if (!match) return null;
  const mime = match[1] || 'image/png';
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length === 0) return null;
  return new Blob([bytes], { type: mime });
}

async function imagesFromPayload(payload) {
  const items = Array.isArray(payload?.data)
    ? payload.data
    : Array.isArray(payload?.images)
      ? payload.images
      : [];
  const shots = [];
  for (const item of items.slice(0, 8)) {
    const inline = item?.b64_json || item?.b64;
    if (typeof inline === 'string' && inline) {
      shots.push({ b64: inline, mime: 'image/png' });
      continue;
    }
    if (typeof item?.url === 'string' && item.url) {
      try {
        const remote = await fetch(item.url, { signal: AbortSignal.timeout(60000) });
        if (!remote.ok) continue;
        const bytes = Buffer.from(await remote.arrayBuffer());
        shots.push({ b64: bytes.toString('base64'), mime: remote.headers.get('content-type') || 'image/png' });
      } catch {
        /* 单张取不回来不影响别的 */
      }
    }
  }
  return shots;
}

async function relayRender(target, body) {
  const mode = body.mode === 'edit' ? 'edit' : 'text';
  const prompt = String(body.prompt || '').slice(0, 8000);
  if (!prompt) return { ok: false, code: 'bad-request', message: 'prompt is required' };
  const model = target.models.includes(String(body.model || '')) ? String(body.model) : target.models[0];
  const headers = {};
  if (target.apiKey.trim()) headers.authorization = `Bearer ${target.apiKey.trim()}`;
  let request;
  if (mode === 'edit') {
    const form = new FormData();
    form.append('model', model);
    form.append('prompt', prompt);
    if (body.size && body.size !== 'auto') form.append('size', String(body.size));
    if (body.n) form.append('n', String(body.n));
    const first = dataUrlToBlob(body.image);
    if (!first) return { ok: false, code: 'edit-image-missing', message: '图生图需要一张主图' };
    form.append('image', first, 'reference.png');
    const extras = Array.isArray(body.images) ? body.images.slice(0, 4) : [];
    for (const [index, extra] of extras.entries()) {
      const blob = dataUrlToBlob(extra);
      if (blob) form.append('image[]', blob, `extra-${index}.png`);
    }
    request = { headers, body: form };
  } else {
    const payload = { model, prompt, n: Number(body.n) || 1 };
    if (body.size && body.size !== 'auto') payload.size = String(body.size);
    request = { headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(payload) };
  }
  const url = `${target.baseUrl}${mode === 'edit' ? '/images/edits' : '/images/generations'}`;
  const started = Date.now();
  let response;
  try {
    response = await fetch(url, { method: 'POST', ...request, signal: AbortSignal.timeout(600000) });
  } catch (error) {
    return { ok: false, code: 'network', message: `连不上 ${target.baseUrl}：${redact(textOf(error))}` };
  }
  const text = await response.text().catch(() => '');
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const detail = payload?.error?.message || payload?.message || text.slice(0, 300) || `HTTP ${response.status}`;
    return {
      ok: false,
      code: response.status === 400 || response.status === 403 ? 'upstream-rejected' : 'upstream-error',
      message: redact(String(detail)),
      status: response.status,
      durationMs: Date.now() - started,
    };
  }
  const shots = await imagesFromPayload(payload);
  if (shots.length === 0) {
    return { ok: false, code: 'empty', message: '上游没有返回图片', durationMs: Date.now() - started };
  }
  return { ok: true, images: shots, model, durationMs: Date.now() - started };
}

// ── agent tool ───────────────────────────────────────────────────────────────

function formatToolResult(result) {
  const lines = [`【最终提示词】`, result.prompt];
  if (result.negative) lines.push('', '【负向提示词】', result.negative);
  const ratio = result.params?.aspect_ratio ? ` · 画幅 ${result.params.aspect_ratio}` : '';
  lines.push(
    '',
    `方言：${findDialect(result.dialect).label} · 风格：${findStyle(result.style).label}${ratio}${
      result.elapsedMs ? ` · 耗时 ${(result.elapsedMs / 1000).toFixed(1)}s` : ''
    }`,
  );
  const fields = FIELD_ORDER.filter((key) => result.fields?.[key]);
  if (fields.length > 0) {
    lines.push('', '【画面拆解】');
    for (const key of fields) lines.push(`- ${FIELD_LABELS[key]}：${result.fields[key]}`);
  }
  if (Array.isArray(result.variants) && result.variants.length > 0) {
    lines.push('', '【备选方向】');
    result.variants.forEach((variant, index) => lines.push(`${index + 1}. ${variant}`));
  }
  if (result.notes) lines.push('', `【建议】${result.notes}`);
  lines.push('', `（由绘语 · ${result.model} 生成）`);
  return lines.join('\n');
}

function describeTool() {
  return [
    'Turn a rough image idea (or an existing weak prompt) into one production-ready image-generation prompt, tuned for a specific target model dialect.',
    '',
    'Use this whenever the user wants an image but the wording is vague, mixes instructions with wishes, or targets a model with special syntax (Midjourney parameters, Stable Diffusion tags and negative prompt, GPT-Image natural language, nano-banana edit instructions).',
    '',
    'It returns the final prompt plus a field-by-field breakdown (subject, action, environment, composition, lighting, camera, style, palette, materials, mood, details), a negative prompt where the dialect supports one, alternate directions, and one practical tip.',
    '',
    'Do not hand-write image prompts when this tool is available: a vague prompt wastes the user\'s image generation budget.',
  ].join('\n');
}

function registerTools(ctx, llm, resolveConfig) {
  const disposeOptimize = ctx.tools.register(
    defineTool({
      name: 'optimize_image_prompt',
      description: describeTool(),
      parameters: {
        idea: {
          type: 'string',
          required: true,
          description:
            'The user intent: a rough idea, or the existing prompt to improve. Keep the subject and any quoted in-image text exactly as the user wrote them.',
        },
        dialect: {
          type: 'string',
          description:
            'Target model dialect: natural-en (default), natural-zh, gpt-image, midjourney, stable-diffusion, nano-banana. Pick by the image model the user will actually run.',
        },
        style: {
          type: 'string',
          description:
            'Visual preset: auto (default), photo, cinematic, editorial, product, illustration, anime, concept, 3d, cyberpunk, minimal, watercolor, ink, clay, pixel, architecture, icon, custom.',
        },
        aspect: {
          type: 'string',
          description: 'Aspect ratio such as 1:1, 4:3, 3:4, 16:9, 9:16, 3:2, 2:3, 21:9, or auto.',
        },
        language: {
          type: 'string',
          description: 'Output language for the prompt text: en (default) or zh.',
        },
        mode: {
          type: 'string',
          description: 'create (default) for a fresh idea, refine to upgrade an existing prompt, variation to keep the subject but change direction.',
        },
        negative: {
          type: 'string',
          description: 'Things to avoid, if the user named any.',
        },
        count: {
          type: 'integer',
          description: 'How many alternate directions to include, 1 to 3. Defaults to 1.',
        },
        refs: {
          type: 'string',
          description:
            'IDs returned by search_reference_gallery, comma separated and library-prefixed, for example "pose:full_sexy_P070_side,costume:SPR-0001". Their Chinese descriptions are then treated as binding facts for the posture, garment or hair fields.',
        },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      async execute(args, exec) {
        const config = await resolveConfig();
        if (!config.provider || !config.model) {
          throw new Error('绘语还没有选择优化用的对话模型：请在侧边栏打开「绘语」面板，在顶部选择 provider 与 model 并保存。');
        }
        const referenceBlock = args.refs ? await resolveReferenceBlock(args.refs) : '';
        const result = await runOptimize(
          llm,
          {
            provider: config.provider,
            model: config.model,
            idea: args.idea,
            dialect: args.dialect || config.dialect,
            style: args.style || config.style,
            aspect: args.aspect || config.aspect,
            language: args.language || config.language,
            mode: args.mode || config.mode,
            negative: args.negative || config.mustAvoid,
            candidates: args.count ?? config.candidates,
            referenceBlock,
          },
          exec?.signal,
        );
        return formatToolResult(result);
      },
    }),
  );
  const disposePatch = ctx.tools.register(
    defineTool({
      name: 'patch_image_prompt',
      description: [
        'Apply one short natural-language change to an existing image-generation prompt without regenerating the whole thing.',
        '',
        'Use this after optimize_image_prompt when the user says something like "make it dusk", "lower the camera", "remove the rain": the tool rewrites only the fields that instruction touches and copies the rest verbatim, so the scene does not drift.',
        '',
        'It returns the complete rewritten prompt, the changed field breakdown, and one line naming what changed.',
      ].join('\n'),
      parameters: {
        prompt: {
          type: 'string',
          required: true,
          description: 'The current final prompt to edit, verbatim.',
        },
        instruction: {
          type: 'string',
          required: true,
          description: 'The one change to make, in the user own words, for example "光线换成黄昏" or "camera lower, closer".',
        },
        dialect: {
          type: 'string',
          description: 'Target model dialect of the existing prompt: natural-en, natural-zh, gpt-image, midjourney, stable-diffusion, nano-banana.',
        },
        aspect: {
          type: 'string',
          description: 'Aspect ratio such as 1:1, 4:3, 16:9, 9:16, or auto.',
        },
        language: {
          type: 'string',
          description: 'Language of the existing prompt text: en or zh.',
        },
        negative: {
          type: 'string',
          description: 'The current negative prompt, if any.',
        },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      async execute(args, exec) {
        const config = await resolveConfig();
        if (!config.provider || !config.model) {
          throw new Error('绘语还没有选择优化用的对话模型：请在侧边栏打开「绘语」面板，在顶部选择 provider 与 model 并保存。');
        }
        const result = await runPatch(
          llm,
          {
            provider: config.provider,
            model: config.model,
            prompt: args.prompt,
            instruction: args.instruction,
            negative: args.negative || config.mustAvoid,
            dialect: args.dialect || config.dialect,
            aspect: args.aspect || config.aspect,
            language: args.language || config.language,
          },
          exec?.signal,
        );
        return formatToolResult(result);
      },
    }),
  );
  const disposeGallery = ctx.tools.register(
    defineTool({
      name: 'search_reference_gallery',
      description: [
        'Search a curated Chinese reference library (6,162 entries) for body poses, full outfits and portrait/hair references, and get ready-to-use image URLs.',
        '',
        'Use this before optimize_image_prompt whenever the user asks for a specific body pose, a whole outfit, or a hairstyle: the library returns the exact Chinese description plus a CDN image URL per entry, so the resulting prompt does not have to invent anatomy or garment details.',
        '',
        'Libraries: pose (1439 human poses, 4 body systems × 5 camera angles × 26 action types, each with a matching depth map), costume (1407 outfits, 8 season/occasion categories), portrait (1499 portrait and hair references, 2 sections × 4 hair lengths × 51 hairstyles). All keywords must match.',
        '',
        'Narrow by category with `kind` (KEY=VALUE, comma separated), for example "分类=蹲姿" or "体系=上半身单人,角度=侧面". Pass kind="list" to dump every category value with its count for a library.',
        '',
        'Pass the IDs you keep to optimize_image_prompt as `refs` (for example ["pose:full_sexy_P070_side"]) so the prompt reuses that exact wording.',
      ].join('\n'),
      parameters: {
        query: {
          type: 'string',
          description: 'Chinese keywords, all of which must match, for example "蹲 侧面", "针织衫", "长发". Leave empty when filtering only by kind.',
        },
        lib: {
          type: 'string',
          enum: ['auto', 'pose', 'costume', 'portrait'],
          description: 'Which library to search; auto (default) searches all three.',
        },
        kind: {
          type: 'string',
          description:
            'Category filter, KEY=VALUE with multiple values comma separated, for example "分类=蹲姿" or "角度=侧面,体系=全身单人・性感系". Use "list" to list all categories of the chosen library.',
        },
        limit: {
          type: 'integer',
          description: 'How many hits to return, 1 to 40. Defaults to 6.',
        },
        offset: {
          type: 'integer',
          description: 'Skip this many hits before returning, for paging through a large category (0 to 5000). Defaults to 0.',
        },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      async execute(args) {
        const lib = args.lib || 'auto';
        if (String(args.kind ?? '').trim() === 'list') {
          if (lib === 'auto') return '要列种类请指定 lib：pose / costume / portrait。';
          const dims = await listKinds(lib);
          const lines = dims.map((dim) => {
            const items = dim.values.map((v) => `${v.value}(${v.count})`).join('、');
            return `${dim.key}（${dim.values.length}）：${items}`;
          });
          return [`「${GALLERY_LIBS[lib].label}」的种类：`, '', ...lines, '', '筛选时用 kind="分类=蹲姿" 这种写法。'].join('\n');
        }
        const filters = parseKindFilters(args.kind);
        const result = await searchGallery({
          query: args.query ?? '',
          lib,
          limit: Math.max(1, Math.min(40, Number(args.limit) || 6)),
          filters,
          offset: args.offset ?? 0,
        });
        const works = result.works;
        if (works.length === 0) {
          const why = [args.query ? `「${args.query}」` : '', args.kind ? `kind=${args.kind}` : '']
            .filter(Boolean)
            .join(' + ');
          return `没有命中 ${why}。把关键词拆短（只写「蹲」「夏」「长发」），去掉 kind 层层筛，或把 lib 换成 auto；不确定有哪些种类就先调 kind="list"。`;
        }
        const lines = works.map((work, index) => {
          const bits = [
            `${index + 1}. [${work.lib}] ${work.name}`,
            `   分类：${work.tags.join('・') || '—'}`,
            `   ID：${work.id}`,
            `   图：${work.imageUrl}`,
          ];
          if (work.depthUrl) bits.push(`   深度图：${work.depthUrl}`);
          return bits.join('\n');
        });
        return [
          `命中 ${result.total} 条，本次返回第 ${result.offset + 1}-${result.offset + works.length} 条（${args.lib || 'auto'}）：`,
          '',
          ...lines,
          '',
          result.offset + works.length < result.total
            ? `还有 ${result.total - result.offset - works.length} 条，用 offset=${result.offset + works.length} 继续取。`
            : '已经是最后一批。',
          '要把其中一条写进提示词，就把它的 ID 传给 optimize_image_prompt 的 refs，例如 ["pose:xxx"]。',
        ].join('\n');
      },
    }),
  );
  return () => {
    disposeGallery();
    disposePatch();
    disposeOptimize();
  };
}

// ── plugin entry ─────────────────────────────────────────────────────────────

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const IMAGE_MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

/**
 * Turn one browser upload (`{ data, mediaType?, name? }`, base64 or data URL)
 * into a durable attachment reference the LLM message can carry.
 * The attachment service is read lazily: a host without it still loads this
 * plugin, and only the image → prompt direction reports a clear error.
 * @param ctx - plugin context.
 * @param image - the uploaded payload.
 * @returns the durable attachment reference.
 */
async function admitImage(ctx, image) {
  let attachments;
  try {
    attachments = typeof ctx?.get === 'function' ? ctx.get('attachments') : undefined;
  } catch {
    attachments = undefined;
  }
  if (!attachments || typeof attachments.saveImages !== 'function') {
    const error = new Error('当前宿主没有启用附件服务，暂时不能反推图片');
    error.code = 'ATTACHMENT_UNAVAILABLE';
    throw error;
  }
  const raw = typeof image?.data === 'string' ? image.data : '';
  const computed = /^data:([a-z]+)\/([a-z0-9.+-]+);base64,/i.exec(raw);
  const data = raw.replace(/^data:[^;]*;base64,/i, '').replace(/\s+/g, '');
  if (!data) {
    const error = new Error('请先选一张参考图');
    error.code = 'IMAGE_REQUIRED';
    throw error;
  }
  const mediaType = IMAGE_MEDIA_TYPES.has(image?.mediaType)
    ? image.mediaType
    : IMAGE_MEDIA_TYPES.has(computed ? `${computed[1]}/${computed[2]}`.toLowerCase() : '')
      ? `${computed[1]}/${computed[2]}`.toLowerCase()
      : 'image/png';
  const bytes = Buffer.from(data, 'base64');
  if (bytes.length === 0) {
    const error = new Error('这张图片没有内容，换一张再试');
    error.code = 'IMAGE_EMPTY';
    throw error;
  }
  if (bytes.length > MAX_IMAGE_BYTES) {
    const error = new Error(`图片太大（${(bytes.length / 1048576).toFixed(1)}MB），请压缩到 12MB 以内`);
    error.code = 'IMAGE_TOO_LARGE';
    throw error;
  }
  const refs = await attachments.saveImages([
    { data: bytes, mediaType, ...(typeof image?.name === 'string' && image.name ? { name: image.name.slice(0, 120) } : {}) },
  ]);
  const ref = Array.isArray(refs) ? refs[0] : refs;
  if (!ref) {
    const error = new Error('这张图片没能存进附件库，换一张再试');
    error.code = 'IMAGE_NOT_ADMITTED';
    throw error;
  }
  return ref;
}

export function apply(ctx) {
  const activeRuns = new Map();
  trace(`apply() 被调用，webServer=${typeof ctx?.webServer?.register === 'function'} llm=${typeof ctx?.llm?.stream === 'function'}`);

  ctx.effect(() => {
    const disposers = [
      ctx.webServer.register(
        route(`${API}/catalog`, async (_req, res) => {
          const [catalog, config] = await Promise.all([readCatalog(ctx.llm), readConfig()]);
          writeJson(res, 200, { ok: true, ...catalog, catalog: CATALOG, config });
        }),
      ),
      ctx.webServer.register(
        route(`${API}/gallery`, async (req, res) => {
          const body = await readJson(req);
          const action = typeof body.action === 'string' ? body.action : 'search';
          const lib = typeof body.lib === 'string' && body.lib ? body.lib : 'auto';
          if (action === 'libraries') {
            return writeJson(res, 200, { ok: true, libs: GALLERY_LIBS });
          }
          if (action === 'kinds') {
            // 种类清单一次拉全，面板据此渲染筛选器；按库缓存，切库不重复读盘。
            const targets = lib === 'auto' ? Object.keys(GALLERY_LIBS) : [lib];
            const kinds = {};
            for (const name of targets) kinds[name] = await listKinds(name);
            return writeJson(res, 200, { ok: true, action, libs: GALLERY_LIBS, kinds });
          }
          const filters = parseKindFilters(body.filters);
          if (action === 'random') {
            const count = Math.max(1, Math.min(12, Number(body.count) || 3));
            const works = await randomGallery({ lib, count, filters });
            return writeJson(res, 200, { ok: true, action, libs: GALLERY_LIBS, works });
          }
          const limit = Math.max(1, Math.min(60, Number(body.limit) || 8));
          const offset = Math.max(0, Math.min(5000, Number(body.offset) || 0));
          const result = await searchGallery({ query: body.query ?? '', lib, limit, filters, offset });
          writeJson(res, 200, {
            ok: true,
            action: 'search',
            libs: GALLERY_LIBS,
            works: result.works,
            total: result.total,
            offset: result.offset,
            limit: result.limit,
          });
        }),
      ),
      ctx.webServer.register(
        route(`${API}/optimize`, async (req, res) => {
          const body = await readJson(req);
          if (!body.referenceBlock && Array.isArray(body.refs) && body.refs.length > 0) {
            body.referenceBlock = await resolveReferenceBlock(body.refs);
          }
          const runId = typeof body.runId === 'string' ? body.runId.slice(0, 80) : '';
          const controller = runId ? beginRun(runId) : new AbortController();
          try {
            const result = await runOptimize(ctx.llm, body, controller.signal);
            if (body.remember === true) {
              await writeConfig({
                provider: result.provider,
                model: result.model,
                dialect: result.dialect,
                style: result.style,
                language: result.language,
                aspect: result.params?.aspect_ratio && body.aspect !== 'auto' ? body.aspect : body.aspect,
                mode: result.mode,
                candidates: normalizeCandidates(body.candidates ?? 1),
                styleHint: body.styleHint ?? '',
                purpose: body.purpose ?? '',
                mustInclude: body.mustInclude ?? '',
                mustAvoid: body.mustAvoid ?? '',
              }).catch(() => undefined);
            }
            writeJson(res, 200, result);
          } finally {
            if (runId && activeRuns.get(runId) === controller) activeRuns.delete(runId);
          }
        }),
      ),
      ctx.webServer.register(
        route(`${API}/describe`, async (req, res) => {
          const body = await readJson(req);
          const runId = typeof body.runId === 'string' ? body.runId.slice(0, 80) : '';
          const controller = runId ? beginRun(runId) : new AbortController();
          try {
            const attachment = await admitImage(ctx, body.image);
            const result = await runDescribe(
              ctx.llm,
              {
                ...body,
                content: [
                  { type: 'text', text: buildDescribeUserPrompt(body) },
                  { type: 'image', attachment },
                ],
              },
              controller.signal,
            );
            writeJson(res, 200, result);
          } finally {
            if (runId && activeRuns.get(runId) === controller) activeRuns.delete(runId);
          }
        }),
      ),
      ctx.webServer.register(
        route(`${API}/patch`, async (req, res) => {
          const body = await readJson(req);
          const runId = typeof body.runId === 'string' ? body.runId.slice(0, 80) : '';
          const controller = runId ? beginRun(runId) : new AbortController();
          try {
            const result = await runPatch(ctx.llm, body, controller.signal);
            writeJson(res, 200, result);
          } finally {
            if (runId && activeRuns.get(runId) === controller) activeRuns.delete(runId);
          }
        }),
      ),
      ctx.webServer.register(
        route(`${API}/stop`, async (req, res) => {
          const body = await readJson(req);
          const ids = [body.runId, ...(Array.isArray(body.runIds) ? body.runIds : [])].filter(
            (id) => typeof id === 'string' && activeRuns.has(id),
          );
          let stopped = 0;
          for (const runId of ids) {
            const controller = activeRuns.get(runId);
            activeRuns.delete(runId);
            if (!controller) continue;
            stopped += 1;
            controller.abort(new Error('优化已停止'));
          }
          writeJson(res, 200, { ok: true, stopped });
        }),
      ),
      ctx.webServer.register(
        route(`${API}/targets`, async (req, res) => {
          const body = await readJson(req);
          const action = String(body.action || 'list');
          const list = await readTargets();
          if (action === 'list') {
            writeJson(res, 200, { ok: true, targets: list.map(publicTarget) });
            return;
          }
          if (action === 'save') {
            const draft = normalizeTarget(body.target);
            if (!draft) {
              writeJson(res, 200, { ok: false, code: 'bad-target', message: '地址要以 http(s):// 开头，模型名至少填一个' });
              return;
            }
            const index = list.findIndex((item) => item.id === draft.id);
            // 表单里密钥留空表示「不改」，不要把已存的密钥抹掉。
            if (!draft.apiKey && index >= 0) draft.apiKey = list[index].apiKey;
            if (index >= 0) list[index] = draft;
            else list.push(draft);
            const saved = await writeTargets(list);
            writeJson(res, 200, { ok: true, targets: saved.map(publicTarget) });
            return;
          }
          if (action === 'remove') {
            const id = String(body.id || '');
            const saved = await writeTargets(list.filter((item) => item.id !== id));
            writeJson(res, 200, { ok: true, targets: saved.map(publicTarget) });
            return;
          }
          if (action === 'test') {
            const target = list.find((item) => item.id === String(body.id || ''));
            if (!target) {
              writeJson(res, 200, { ok: false, code: 'target-missing', message: '没有这个目标' });
              return;
            }
            const headers = {};
            if (target.apiKey.trim()) headers.authorization = `Bearer ${target.apiKey.trim()}`;
            try {
              const response = await fetch(`${target.baseUrl}/models`, { headers, signal: AbortSignal.timeout(30000) });
              const payload = await response.json().catch(() => null);
              const ids = (Array.isArray(payload?.data) ? payload.data : [])
                .map((item) => String(item?.id || '').trim())
                .filter(Boolean)
                .slice(0, 40);
              writeJson(res, 200, {
                ok: response.ok,
                status: response.status,
                models: ids,
                message: response.ok ? `连通，返回 ${ids.length} 个模型` : `HTTP ${response.status}`,
              });
            } catch (error) {
              writeJson(res, 200, { ok: false, message: `连不上：${redact(textOf(error))}` });
            }
            return;
          }
          writeJson(res, 200, { ok: false, code: 'bad-action', message: `未知操作 ${action}` });
        }),
      ),
      ctx.webServer.register(
        route(`${API}/render`, async (req, res) => {
          const body = await readJsonLoose(req);
          const list = await readTargets();
          const target = list.find((item) => item.id === String(body.targetId || ''));
          if (!target) {
            writeJson(res, 200, { ok: false, code: 'target-missing', message: '这个生图目标不在了，去「出图模型」里重新选一个' });
            return;
          }
          const result = await relayRender(target, body);
          writeJson(res, 200, result);
        }),
      ),
      ctx.webServer.register(
        route(`${API}/config`, async (req, res) => {
          const body = await readJson(req);
          const action = body.action === 'save' ? 'save' : 'read';
          if (action === 'read') {
            writeJson(res, 200, { ok: true, config: await readConfig() });
            return;
          }
          const config = await writeConfig(body.config ?? body);
          writeJson(res, 200, { ok: true, config });
        }),
      ),
    ];
    return () => {
      for (const controller of activeRuns.values()) controller.abort(new Error('插件正在重新加载'));
      activeRuns.clear();
      for (const dispose of disposers.reverse()) dispose();
    };
  }, 'drawcraft: routes');

  ctx.inject(['tools'], (toolCtx) => {
    toolCtx.effect(() => {
      const disposeTool = registerTools(toolCtx, ctx.llm, readConfig);
      return () => disposeTool();
    }, 'drawcraft: agent tool');
  });

  function beginRun(runId) {
    const previous = activeRuns.get(runId);
    if (previous) previous.abort(new Error('新的优化已开始'));
    const controller = new AbortController();
    activeRuns.set(runId, controller);
    return controller;
  }
}

trace('module evaluated');
