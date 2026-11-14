/**
 * dsh-prompt-forge host half.
 *
 * Registers three loopback-only JSON routes for the browser panel and one agent
 * tool, all of them delegating the actual prompt work to engine.js:
 *   POST /api/prompt-forge/catalog  → styles/dialects/modes + live model list + saved config
 *   POST /api/prompt-forge/optimize → one structured optimization run
 *   POST /api/prompt-forge/stop     → abort a running optimization by runId
 *   POST /api/prompt-forge/config   → persist the default provider/model and last-used options
 *
 * The saved config lives in ~/.dsh/prompt-forge.json so the agent tool can run
 * without the panel being open.
 */
import { appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import {
  CATALOG,
  FIELD_LABELS,
  FIELD_ORDER,
  findDialect,
  findStyle,
  normalizeCandidates,
  runOptimize,
} from './engine.js';

export { CATALOG, runOptimize } from './engine.js';

export const name = 'prompt-forge';
export const inject = ['webServer', 'llm'];

const API = '/api/prompt-forge';
const CONFIG_VERSION = 1;

const TRACE_PATH = join(homedir(), '.dsh', 'prompt-forge-load.log');

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
  return join(homedir(), '.dsh', 'prompt-forge.json');
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
  lines.push('', `（由提示词工坊 · ${result.model} 生成）`);
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
  return ctx.tools.register(
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
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      async execute(args, exec) {
        const config = await resolveConfig();
        if (!config.provider || !config.model) {
          throw new Error('提示词工坊还没有选择优化用的对话模型：请在侧边栏打开「提示词工坊」面板，在顶部选择 provider 与 model 并保存。');
        }
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
          },
          exec?.signal,
        );
        return formatToolResult(result);
      },
    }),
  );
}

// ── plugin entry ─────────────────────────────────────────────────────────────

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
        route(`${API}/optimize`, async (req, res) => {
          const body = await readJson(req);
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
  }, 'prompt-forge: routes');

  ctx.inject(['tools'], (toolCtx) => {
    toolCtx.effect(() => {
      const disposeTool = registerTools(toolCtx, ctx.llm, readConfig);
      return () => disposeTool();
    }, 'prompt-forge: agent tool');
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
