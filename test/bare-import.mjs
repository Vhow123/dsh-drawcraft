/**
 * 裸加载验证：不重定向任何宿主包，直接用 Node 从插件真实路径 import。
 * 这一条能过，说明插件在「junction 链接进 profile、真实路径在 DSH 安装目录之外」
 * 的情况下依然能起来——这正是之前 bundle 被静默跳过的根因。
 *
 * 用法: node test/bare-import.mjs
 */
const routes = new Map();
const tools = new Map();

// 宿主设置的替身：只提供插件用到的那两个方法，够路由注册与调用路径跑通。
const settingsStub = {
  describe() {
    return [
      {
        ns: 'imagegen',
        revision: 3,
        value: { channels: [{ id: 'demo-channel', name: 'Demo Channel', apiUrl: 'https://demo.example/v1', models: [{ id: 'demo-model', alias: 'demo-model' }] }] },
      },
    ];
  },
  async mutate() {},
};

const disposers = [];
const fakeLlm = {
  async listProviders() {
    return [
      { id: 'demo', name: 'Demo Provider' },
    ];
  },
  async listModels() {
    return [{ id: 'demo-model', name: 'Demo Model' }];
  },
  async *stream() {
    yield {
      type: 'text-delta',
      text: JSON.stringify({
        fields: { subject: 'a brass diving helmet', environment: 'wet sand' },
        prompt: 'A brass diving helmet on wet sand --ar 3:2',
        negative: '',
        variants: [],
        notes: [],
      }),
    };
    yield { type: 'finish', reason: { kind: 'stop' } };
  },
};

const ctx = {
  llm: fakeLlm,
  webServer: {
    register(entry) {
      routes.set(entry.path, entry.handler);
      return () => routes.delete(entry.path);
    },
  },
  effect(fn) {
    const dispose = fn();
    disposers.push(dispose);
    return dispose;
  },
  inject(_deps, fn) {
    fn({
      tools: {
        register(definition) {
          tools.set(definition.name, definition);
          return () => tools.delete(definition.name);
        },
      },
      webServer: ctx.webServer,
      get(name) {
        return name === 'settings' ? settingsStub : undefined;
      },
      effect: ctx.effect,
    });
  },
};

const mod = await import(new URL('../index.js', import.meta.url).href);
mod.apply(ctx);

console.log('name   :', mod.name);
console.log('inject :', JSON.stringify(mod.inject));
console.log('routes :', [...routes.keys()].join(', '));
console.log('tools  :', [...tools.keys()].join(', '));

const tool = tools.get('optimize_image_prompt');
if (!tool) throw new Error('agent 工具未注册');
console.log('params :', JSON.stringify(tool.parameters.required), '| output:', JSON.stringify(tool.output.schema));

// 参数校验：缺 idea 必须被挡在模型调用之前
let rejected = false;
try {
  await tool.execute({}, {});
} catch (error) {
  rejected = /必填/.test(error.message);
}
console.log('缺 idea 被拦 :', rejected);

let report;
try {
  report = await tool.execute({ idea: 'a brass diving helmet on wet sand' }, {});
} catch (error) {
  report = `（未执行完整链路：${error.message.slice(0, 40)}…）`;
}
console.log('输出首行 :', String(report).split('\n')[0]);
console.log('含最终提示词 :', String(report).includes('【最终提示词】'));
