/**
 * Contract test for the host half.
 *
 * The plugin imports `@deepseek-ai/dsh-tools`, which only exists inside a real
 * DeepSeekRuntime installation. Outside one we redirect those bare specifiers to
 * the installed runtime's node_modules through a module resolve hook; when no
 * runtime is found the whole file skips instead of failing.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire, registerHooks } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const RUNTIME_CANDIDATES = [
  process.env.DSH_RUNTIME_HOME,
  'D:/deepseek/resources/app/dsh',
  '/usr/lib/dsh',
  '/opt/dsh',
].filter(Boolean);

const runtime = RUNTIME_CANDIDATES.find(
  (candidate) => existsSync(join(candidate, 'node_modules', '@deepseek-ai', 'dsh-tools', 'package.json')),
);
const skip = runtime === undefined ? 'no DeepSeekRuntime installation with @deepseek-ai/dsh-tools' : false;

const home = mkdtempSync(join(tmpdir(), 'prompt-forge-home-'));

let mod;
let routes;
let tools;
let disposers;
let fakeLlm;

function makeLlm(reply) {
  return {
    listProviders: () => [{ id: 'demo', name: 'Demo 渠道' }],
    listModels: async () => [{ id: 'demo-model', name: 'demo-model' }],
    stream() {
      return (async function* run() {
        yield { type: 'text-delta', text: typeof reply === 'string' ? reply : JSON.stringify(reply) };
        yield { type: 'finish', reason: { kind: 'stop' } };
      })();
    },
  };
}

const GOOD_REPLY = {
  title: '自检',
  fields: { subject: 'a brass diving helmet', lighting: 'one hard key light', style: 'photorealistic' },
  prompt: 'A brass diving helmet on wet sand, one hard key light --ar 3:2',
  negative: 'blurry',
  params: { aspect_ratio: '1:1', quality: 'high' },
  variants: ['the same helmet underwater'],
  notes: 'keep 1:1 for icon use',
};

before(async () => {
  if (skip) return;
  // Keep the plugin's config file inside a throwaway home directory.
  process.env.USERPROFILE = home;
  process.env.HOME = home;
  assert.equal(homedir(), home, 'home override must take effect');

  const runtimeRequire = createRequire(join(runtime, 'package.json'));
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier.startsWith('@deepseek-ai/')) {
        try {
          return { url: pathToFileURL(runtimeRequire.resolve(specifier)).href, shortCircuit: true };
        } catch {
          /* fall through to the default resolver */
        }
      }
      return nextResolve(specifier, context);
    },
  });

  mod = await import(pathToFileURL(join(root, 'index.js')).href);

  routes = new Map();
  tools = new Map();
  disposers = [];
  fakeLlm = makeLlm(GOOD_REPLY);

  const record = (label, dispose) => {
    assert.equal(typeof dispose, 'function', `${label} must return a disposer`);
    disposers.push(dispose);
  };

  const services = new Map();
  services.set('attachments', {
    async saveImages(inputs) {
      return inputs.map((input, index) => ({
        attachmentId: `att-${index}`,
        mediaType: input.mediaType,
        bytes: input.data.length,
        ...(input.name ? { name: input.name } : {}),
      }));
    },
  });

  const ctx = {
    llm: fakeLlm,
    get: (serviceName) => services.get(serviceName),
    webServer: {
      register: (route) => {
        routes.set(route.path, route);
        return () => routes.delete(route.path);
      },
    },
    effect: (fn, label) => record(label, fn()),
    inject: (names, callback) => {
      callback({
        tools: {
          register: (tool) => {
            tools.set(tool.name, tool);
            return () => tools.delete(tool.name);
          },
        },
        effect: (fn, label) => record(label, fn()),
        inject: () => {},
      });
    },
  };

  mod.apply(ctx);
});

after(() => {
  for (const dispose of disposers ?? []) dispose();
  rmSync(home, { recursive: true, force: true });
});

function fakeRequest(body) {
  const text = JSON.stringify(body ?? {});
  return {
    method: 'POST',
    socket: { remoteAddress: '127.0.0.1' },
    headers: { host: '127.0.0.1:64600', 'content-type': 'application/json', origin: 'http://127.0.0.1:64600' },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(text, 'utf8');
    },
  };
}

async function call(path, body) {
  const route = routes.get(path);
  assert.ok(route, `route ${path} must be registered`);
  let status = 0;
  let payload = '';
  await route.handler(fakeRequest(body), {
    writeHead(code) {
      status = code;
    },
    end(chunk) {
      payload += chunk ?? '';
    },
  });
  return { status, body: JSON.parse(payload) };
}

test('exposes the plugin identity and services it needs', { skip }, () => {
  assert.equal(mod.name, 'drawcraft');
  assert.deepEqual(mod.inject, ['webServer', 'llm']);
  assert.equal(typeof mod.apply, 'function');
});

test('registers every route and all agent tools', { skip }, () => {
  assert.deepEqual([...routes.keys()].sort(), [
    '/api/drawcraft/catalog',
    '/api/drawcraft/config',
    '/api/drawcraft/describe',
    '/api/drawcraft/gallery',
    '/api/drawcraft/optimize',
    '/api/drawcraft/patch',
    '/api/drawcraft/render',
    '/api/drawcraft/stop',
    '/api/drawcraft/targets',
  ]);
  assert.deepEqual([...tools.keys()], [
    'optimize_image_prompt',
    'patch_image_prompt',
    'search_reference_gallery',
  ]);
});

test('catalog route reports models and the prompt catalog', { skip }, async () => {
  const { status, body } = await call('/api/drawcraft/catalog', {});
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.groups.length, 1);
  assert.equal(body.groups[0].models[0].id, 'demo-model');
  assert.equal(body.catalog.styles.length, 18);
  assert.equal(body.catalog.dialects.length, 6);
});

test('gallery route exposes library metadata without touching the network', { skip }, async () => {
  const { status, body } = await call('/api/drawcraft/gallery', { action: 'libraries' });
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  // 种类维度决定面板上能筛什么；姿势库三个维度都不能少。
  assert.deepEqual(body.libs.pose.kinds, ['体系', '角度', '分类']);
  assert.equal(body.libs.pose.depth, true);
  assert.deepEqual(body.libs.portrait.kinds, ['分区', '发长', '发型名称']);
});

test('image targets never echo the api key back to the panel', { skip }, async () => {
  const saved = await call('/api/drawcraft/targets', {
    action: 'save',
    target: { label: 'demo-target', baseUrl: 'http://127.0.0.1:9/v1', apiKey: 'sk-secret-value-1234', models: ['demo-image'] },
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.ok, true);
  const first = saved.body.targets.find((item) => item.label === 'demo-target');
  assert.ok(first, 'target should be saved');
  assert.equal(first.apiKey, undefined);
  assert.equal(first.keyHint, 'sk-s****1234');
  assert.equal(first.hasKey, true);
  assert.deepEqual(first.models, ['demo-image']);

  const removed = await call('/api/drawcraft/targets', { action: 'remove', id: first.id });
  assert.equal(removed.body.ok, true);
  assert.equal(removed.body.targets.some((item) => item.id === first.id), false);
});

test('render route refuses an unknown target instead of guessing', { skip }, async () => {
  const { status, body } = await call('/api/drawcraft/render', { targetId: 'nope', prompt: 'x' });
  assert.equal(status, 200);
  assert.equal(body.ok, false);
  assert.equal(body.code, 'target-missing');
});

test('render relays to the configured endpoint', { skip }, async () => {
  const { createServer } = await import('node:http');
  const seen = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      seen.push({ url: req.url, auth: req.headers.authorization, bytes: Buffer.concat(chunks).length });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ b64_json: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', mime: 'image/png' }] }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const saved = await call('/api/drawcraft/targets', {
      action: 'save',
      target: { label: 'relay-demo', baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: 'sk-relay', models: ['m1'] },
    });
    const id = (saved.body.targets.find((item) => item.label === 'relay-demo') || {}).id;
    assert.ok(id, 'target must exist before relaying');
    const out = await call('/api/drawcraft/render', { targetId: id, prompt: 'a paper boat', mode: 'text' });
    assert.equal(out.body.ok, true);
    assert.match(out.body.images[0].b64, /^iVBORw0KGgo/);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].url, '/v1/images/generations');
    assert.equal(seen[0].auth, 'Bearer sk-relay');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('render rejects non-json upstream responses', { skip }, async () => {
  const { createServer } = await import('node:http');
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('not json');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const saved = await call('/api/drawcraft/targets', {
      action: 'save',
      target: { label: 'content-type-demo', baseUrl: `http://127.0.0.1:${port}/v1`, models: ['m1'] },
    });
    const id = saved.body.targets.find((item) => item.label === 'content-type-demo').id;
    const out = await call('/api/drawcraft/render', { targetId: id, prompt: 'x' });
    assert.equal(out.body.ok, false);
    assert.equal(out.body.code, 'upstream-content-type');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('render drops oversized inline base64 images', { skip }, async () => {
  const { createServer } = await import('node:http');
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ data: [{ b64_json: 'A'.repeat(17 * 1024 * 1024) }] }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const saved = await call('/api/drawcraft/targets', {
      action: 'save',
      target: { label: 'size-demo', baseUrl: `http://127.0.0.1:${port}/v1`, models: ['m1'] },
    });
    const id = saved.body.targets.find((item) => item.label === 'size-demo').id;
    const out = await call('/api/drawcraft/render', { targetId: id, prompt: 'x' });
    assert.equal(out.body.ok, false);
    assert.equal(out.body.code, 'empty');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('render rejects inline data that is not an image', { skip }, async () => {
  const { createServer } = await import('node:http');
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ data: [{ b64_json: 'not-base64' }] }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const saved = await call('/api/drawcraft/targets', {
      action: 'save',
      target: { label: 'bad-base64-demo', baseUrl: `http://127.0.0.1:${port}/v1`, models: ['m1'] },
    });
    const id = saved.body.targets.find((item) => item.label === 'bad-base64-demo').id;
    const out = await call('/api/drawcraft/render', { targetId: id, prompt: 'x' });
    assert.equal(out.body.ok, false);
    assert.equal(out.body.code, 'empty');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('render rejects an upstream image URL that points to loopback', { skip }, async () => {
  const { createServer } = await import('node:http');
  let imageFetches = 0;
  const server = createServer((req, res) => {
    if (req.url === '/private.png') {
      imageFetches += 1;
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(Buffer.from('iVBORw0KGgo=', 'base64'));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ data: [{ url: `http://127.0.0.1:${server.address().port}/private.png` }] }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const saved = await call('/api/drawcraft/targets', {
      action: 'save',
      target: { label: 'private-url-demo', baseUrl: `http://127.0.0.1:${port}/v1`, models: ['m1'] },
    });
    const id = saved.body.targets.find((item) => item.label === 'private-url-demo').id;
    const out = await call('/api/drawcraft/render', { targetId: id, prompt: 'x' });
    assert.equal(out.body.ok, false);
    assert.equal(out.body.code, 'empty');
    assert.equal(imageFetches, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('render sends a multipart edit when a subject image is attached', { skip }, async () => {
  const { createServer } = await import('node:http');
  const seen = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      seen.push({ url: req.url, type: req.headers['content-type'] || '', hasImage: raw.includes('name="image"'), hasExtras: raw.includes('name="image[]"') });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ b64_json: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', mime: 'image/png' }] }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const px = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  try {
    const saved = await call('/api/drawcraft/targets', {
      action: 'save',
      target: { label: 'edit-demo', baseUrl: `http://127.0.0.1:${port}/v1`, models: ['m1'] },
    });
    const id = (saved.body.targets.find((item) => item.label === 'edit-demo') || {}).id;
    const out = await call('/api/drawcraft/render', { targetId: id, prompt: 'keep her, change the pose', mode: 'edit', image: px, images: [px] });
    assert.equal(out.body.ok, true);
    assert.equal(seen[0].url, '/v1/images/edits');
    assert.ok(seen[0].type.startsWith('multipart/form-data'), 'edit must be multipart');
    assert.equal(seen[0].hasImage, true);
    assert.equal(seen[0].hasExtras, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('optimize rewrites midjourney switches instead of trusting the model', { skip }, async () => {
  const { body } = await call('/api/drawcraft/optimize', {
    provider: 'demo',
    model: 'demo-model',
    idea: 'a diving helmet on the beach',
    dialect: 'midjourney',
    aspect: '1:1',
    language: 'en',
    candidates: 2,
    remember: true,
  });
  assert.equal(body.ok, true);
  assert.equal(body.prompt, 'A brass diving helmet on wet sand, one hard key light --ar 1:1 --style raw --no blurry');
  assert.equal(body.negative, 'blurry');
  assert.equal(body.dialect, 'midjourney');
  assert.equal(Object.keys(body.fields).length, 3);
  assert.equal(body.variants.length, 1);
});

test('a successful run with remember persists provider and model', { skip }, () => {
  const saved = JSON.parse(readFileSync(join(home, '.dsh', 'drawcraft.json'), 'utf8'));
  assert.equal(saved.provider, 'demo');
  assert.equal(saved.model, 'demo-model');
  assert.equal(saved.dialect, 'midjourney');
});

test('non-midjourney dialects never keep midjourney switches', { skip }, async () => {
  const { body } = await call('/api/drawcraft/optimize', {
    provider: 'demo',
    model: 'demo-model',
    idea: 'a diving helmet',
    dialect: 'stable-diffusion',
  });
  assert.equal(body.prompt, 'A brass diving helmet on wet sand, one hard key light');
});

test('optimize rejects an empty idea without calling the model', { skip }, async () => {
  const { body } = await call('/api/drawcraft/optimize', { provider: 'demo', model: 'demo-model', idea: '  ' });
  assert.equal(body.ok, false);
  assert.equal(body.code, 'IDEA_REQUIRED');
});

test('config route reads back what the last run saved', { skip }, async () => {
  const { body } = await call('/api/drawcraft/config', { action: 'read' });
  assert.equal(body.ok, true);
  assert.equal(body.config.provider, 'demo');
});

test('the agent tool renders a readable report', { skip }, async () => {
  const tool = tools.get('optimize_image_prompt');
  const text = await tool.execute({ idea: 'a diving helmet', dialect: 'stable-diffusion' }, {});
  assert.equal(typeof text, 'string');
  assert.ok(text.startsWith('【最终提示词】'), text.slice(0, 40));
  assert.ok(text.includes('【画面拆解】'));
});

test('describe admits the upload and forwards it as an image block', { skip }, async () => {
  const { body } = await call('/api/drawcraft/describe', {
    provider: 'demo',
    model: 'demo-model',
    dialect: 'natural-en',
    image: { data: `data:image/png;base64,${Buffer.from('fake-png-bytes').toString('base64')}`, mediaType: 'image/png', name: 'ref.png' },
  });
  assert.equal(body.ok, true);
  assert.equal(body.source, 'image');
  assert.ok(body.prompt.length > 0);
});

test('describe reports a missing image instead of calling the model', { skip }, async () => {
  const { body } = await call('/api/drawcraft/describe', { provider: 'demo', model: 'demo-model', image: { data: '' } });
  assert.equal(body.ok, false);
  assert.equal(body.code, 'IMAGE_REQUIRED');
});

test('patch rewrites the prompt and echoes the instruction', { skip }, async () => {
  const { body } = await call('/api/drawcraft/patch', {
    provider: 'demo',
    model: 'demo-model',
    prompt: 'a brass diving helmet',
    instruction: '光线换成黄昏',
    dialect: 'midjourney',
    aspect: '3:2',
  });
  assert.equal(body.ok, true);
  assert.equal(body.source, 'patch');
  assert.equal(body.instruction, '光线换成黄昏');
  assert.ok(body.prompt.includes('--ar 3:2'));
});

test('patch refuses to run without an instruction', { skip }, async () => {
  const { body } = await call('/api/drawcraft/patch', { provider: 'demo', model: 'demo-model', prompt: 'something' });
  assert.equal(body.ok, false);
  assert.equal(body.code, 'INSTRUCTION_REQUIRED');
});

test('disposing the plugin unregisters everything', { skip }, () => {
  for (const dispose of disposers.reverse()) dispose();
  assert.equal(routes.size, 0);
  assert.equal(tools.size, 0);
});
