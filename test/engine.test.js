import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CATALOG,
  buildDescribeSystemPrompt,
  buildDescribeUserPrompt,
  buildPatchSystemPrompt,
  buildPatchUserPrompt,
  buildSystemPrompt,
  buildUserPrompt,
  extractJson,
  findDialect,
  normalizeResult,
  runDescribe,
  runOptimize,
  runPatch,
  stitch,
  stripFiller,
  stripMidjourneyParams,
} from '../engine.js';

function fakeLlm(reply, options = {}) {
  const calls = [];
  return {
    calls,
    stream(request) {
      calls.push(request);
      if (options.throwOnStream) throw new Error(options.throwOnStream);
      const chunks = options.chunks ?? [
        { type: 'reasoning-delta', text: 'thinking…' },
        ...(Array.isArray(reply) ? reply : [reply]).map((text) => ({ type: 'text-delta', text })),
        { type: 'finish', reason: { kind: options.finishKind ?? 'stop' } },
      ];
      return (async function* run() {
        for (const chunk of chunks) yield chunk;
      })();
    },
  };
}

const GOOD = JSON.stringify({
  title: '雨天便利店',
  fields: {
    subject: 'a girl in a yellow raincoat',
    action: 'turning her head to look back',
    environment: 'a convenience store front on a rainy night',
    composition: 'medium shot, subject left of frame',
    lighting: 'cold fluorescent spill from the window, one warm street lamp',
    camera: '35mm, f/2, shallow depth of field',
    style: 'photorealistic photography',
    palette: 'sodium amber against deep blue',
    materials: 'wet vinyl raincoat, plastic bag',
    mood: 'quiet, slightly lonely',
    details: 'rain beads on the coat, a cat under the awning',
  },
  prompt: 'A girl in a yellow raincoat turns to look back outside a rainy convenience store at night.',
  negative: 'blurry, extra limbs',
  params: { aspect_ratio: '3:4', quality: 'high' },
  variants: ['Same scene as a watercolour illustration', 'Same scene in 1990s film grain'],
  notes: 'Ask for 3:4 to keep the storefront sign in frame.',
});

test('stripFiller removes empty praise tokens but keeps real detail', () => {
  assert.equal(stripFiller('masterpiece, best quality, a rusty bicycle, 8k'), 'a rusty bicycle');
  assert.equal(stripFiller('ultra detailed portrait of an old fisherman'), 'portrait of an old fisherman');
  assert.equal(stripFiller('trending on artstation'), '');
});

test('extractJson survives fences, prose prefixes and trailing commentary', () => {
  assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('Sure! Here it is:\n{"a":1}\nHope that helps.'), { a: 1 });
  assert.equal(extractJson('no json at all'), null);
  assert.equal(extractJson(''), null);
});

test('stripMidjourneyParams hands parameter ownership to the host', () => {
  assert.equal(stripMidjourneyParams('a lighthouse at dusk --ar 3:2 --v 6 --style raw'), 'a lighthouse at dusk');
});

test('stripMidjourneyParams consumes a complete --no list until the next parameter', () => {
  assert.equal(
    stripMidjourneyParams('a portrait --no blurry, extra limbs, watermark --ar 3:4 --style raw'),
    'a portrait',
  );
});

test('stitch builds a usable prompt without the model', () => {
  const fields = { subject: 'a brass diving helmet', lighting: 'single hard key light' };
  assert.equal(stitch(fields, { dialect: 'stable-diffusion' }), 'a brass diving helmet, single hard key light');
  assert.equal(
    stitch(fields, { dialect: 'midjourney', aspect: '1:1' }),
    'a brass diving helmet, single hard key light --ar 1:1 --style raw',
  );
  assert.equal(stitch(fields, { dialect: 'natural-zh' }), 'a brass diving helmet，single hard key light。');
  assert.equal(stitch({}, { dialect: 'natural-en' }), '');
});

test('normalizeResult enforces dialect rules', () => {
  const raw = JSON.parse(GOOD);
  raw.prompt = 'a girl in a raincoat --ar 3:2 --style raw --no blurry';

  const mj = normalizeResult(raw, { dialect: 'midjourney', style: 'photo', language: 'en', aspect: '3:4' });
  assert.equal(mj.prompt, 'a girl in a raincoat --ar 3:4 --style raw --no blurry, extra limbs');
  assert.equal(mj.dialect, 'midjourney');

  const gpt = normalizeResult(raw, { dialect: 'gpt-image', style: 'photo', language: 'en', aspect: 'auto' });
  assert.equal(gpt.negative, '', 'gpt-image ignores negative prompts');

  const noPrompt = { fields: { subject: 'only a subject' } };
  const stitched = normalizeResult(noPrompt, { dialect: 'natural-en', style: 'auto', language: 'en', aspect: '16:9' });
  assert.equal(stitched.prompt, 'only a subject.');
});

test('system prompt carries the dialect, style and language rules', () => {
  const system = buildSystemPrompt({ dialect: 'stable-diffusion', style: 'anime', language: 'zh', candidates: 2 });
  assert.match(system, /Stable Diffusion/);
  assert.match(system, /日系动画|anime/i);
  assert.match(system, /Simplified Chinese/);
  assert.match(system, /2 candidate/);
  assert.match(system, /JSON object/);
});

test('user prompt keeps the idea and every explicit constraint', () => {
  const user = buildUserPrompt({ idea: 'a girl in a raincoat', mustAvoid: 'no faces', mustInclude: 'yellow raincoat', mode: 'refine' });
  assert.match(user, /a girl in a raincoat/);
  assert.match(user, /no faces/);
  assert.match(user, /yellow raincoat/);
  assert.match(user, /existing prompt/);
});

test('catalog exposes the full style and dialect surface', () => {
  assert.equal(CATALOG.dialects.length, 6);
  assert.ok(CATALOG.styles.length >= 17);
  assert.equal(CATALOG.fields.length, 11);
  assert.ok(findDialect('nope').key === 'natural-en');
});

test('runOptimize parses a good reply end to end', async () => {
  const llm = fakeLlm(GOOD);
  const result = await runOptimize(llm, {
    provider: 'demo',
    model: 'demo-model',
    idea: 'rainy convenience store',
    dialect: 'natural-en',
    style: 'photo',
    language: 'en',
    mode: 'create',
  });
  assert.equal(result.ok, true);
  assert.match(result.prompt, /yellow raincoat/);
  assert.equal(result.fields.subject, 'a girl in a yellow raincoat');
  assert.equal(result.params.aspect_ratio, '3:4');
  assert.equal(result.variants.length, 2);
  assert.equal(llm.calls.length, 1);
  assert.equal(llm.calls[0].temperature, 0.75);
  assert.match(llm.calls[0].system, /prompt engineer/);
});

test('runOptimize rejects a reply that is not JSON', async () => {
  const llm = fakeLlm('I think this prompt is already good enough.');
  await assert.rejects(
    runOptimize(llm, { provider: 'demo', model: 'demo-model', idea: 'anything', dialect: 'natural-en' }),
    (error) => error.code === 'BAD_OUTPUT',
  );
});

test('runOptimize refuses to start without a model or an idea', async () => {
  const llm = fakeLlm(GOOD);
  await assert.rejects(runOptimize(llm, { idea: 'x' }), (error) => error.code === 'MODEL_REQUIRED');
  await assert.rejects(runOptimize(llm, { provider: 'p', model: 'm', idea: '' }), (error) => error.code === 'IDEA_REQUIRED');
  assert.equal(llm.calls.length, 0);
});

test('runOptimize surfaces upstream failures instead of hanging', async () => {
  const llm = {
    stream() {
      return (async function* run() {
        yield {
          type: 'finish',
          reason: { kind: 'error', failure: { code: 'auth_failed', status: 401, message: 'Bad key sk-abcdef123456' } },
        };
      })();
    },
  };
  await assert.rejects(
    runOptimize(llm, { provider: 'p', model: 'm', idea: 'anything' }),
    (error) => error.code === 'auth_failed' && !error.message.includes('sk-abcdef123456'),
  );
});

test('runOptimize honours an already-aborted caller signal', async () => {
  const controller = new AbortController();
  controller.abort();
  const llm = {
    stream(options) {
      if (options.signal?.aborted) throw new Error('aborted before start');
      return (async function* run() {})();
    },
  };
  await assert.rejects(runOptimize(llm, { provider: 'p', model: 'm', idea: 'anything' }, controller.signal));
});

// ── image → prompt ───────────────────────────────────────────────────────────

test('buildDescribeSystemPrompt pins the dialect and the framing rules', () => {
  const system = buildDescribeSystemPrompt({ dialect: 'midjourney', aspect: '16:9', language: 'zh' });
  assert.match(system, /reverse engineering/i);
  assert.match(system, /TARGET DIALECT — Midjourney/);
  assert.match(system, /16:9/);
  assert.match(system, /Simplified Chinese/);
  assert.match(system, /masterpiece/);
  assert.equal(buildDescribeUserPrompt({}), 'Please reverse-engineer the attached image into a generation prompt.');
});

test('runDescribe needs a model and an image block', async () => {
  const llm = fakeLlm(GOOD);
  await assert.rejects(runDescribe(llm, { image: {} }), (error) => error.code === 'MODEL_REQUIRED');
  await assert.rejects(
    runDescribe(llm, { provider: 'p', model: 'm', content: [{ type: 'text', text: 'hi' }] }),
    (error) => error.code === 'IMAGE_REQUIRED',
  );
  assert.equal(llm.calls.length, 0);
});

test('runDescribe forwards the image block and returns a normalised result', async () => {
  const llm = fakeLlm(GOOD);
  const attachment = { attachmentId: 'att-1', mediaType: 'image/png' };
  const result = await runDescribe(llm, {
    provider: 'demo',
    model: 'vision-1',
    dialect: 'natural-en',
    content: [
      { type: 'text', text: 'reverse this' },
      { type: 'image', attachment },
    ],
  });
  const sent = llm.calls[0];
  assert.equal(sent.messages[0].content.length, 2);
  assert.equal(sent.messages[0].content[1].type, 'image');
  assert.equal(sent.messages[0].content[1].attachment.attachmentId, 'att-1');
  assert.equal(sent.temperature, 0.4);
  assert.equal(result.source, 'image');
  assert.ok(result.prompt.length > 0);
});

// ── prompt → prompt ──────────────────────────────────────────────────────────

test('buildPatchUserPrompt shows the current fields and the change request', () => {
  const prompt = buildPatchUserPrompt({
    fields: { subject: 'a brass helmet', lighting: 'one hard key light' },
    prompt: 'a brass helmet, one hard key light',
    instruction: 'switch the light to dusk',
  });
  assert.match(prompt, /CURRENT FIELDS/);
  assert.match(prompt, /a brass helmet/);
  assert.match(prompt, /CHANGE REQUEST: switch the light to dusk/);
  assert.match(buildPatchSystemPrompt({}), /verbatim/);
});

test('runPatch refuses to start without an instruction', async () => {
  const llm = fakeLlm(GOOD);
  await assert.rejects(
    runPatch(llm, { provider: 'p', model: 'm', prompt: 'something' }),
    (error) => error.code === 'INSTRUCTION_REQUIRED',
  );
  assert.equal(llm.calls.length, 0);
});

test('runPatch returns the rewritten prompt and keeps the instruction', async () => {
  const llm = fakeLlm(GOOD);
  const result = await runPatch(llm, {
    provider: 'demo',
    model: 'm',
    prompt: 'a brass helmet, one hard key light',
    instruction: '光线换成黄昏',
    dialect: 'midjourney',
    aspect: '3:2',
  });
  const sent = llm.calls[0];
  assert.equal(sent.temperature, 0.3);
  assert.match(sent.messages[0].content[0].text, /光线换成黄昏/);
  assert.match(result.prompt, /--ar 3:2/);
  assert.equal(result.source, 'patch');
  assert.equal(result.instruction, '光线换成黄昏');
});

