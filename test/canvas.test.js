// 画布的存储层是纯函数（除了 localStorage），把它从 client.js 里抠出来单独跑。
// client.js 依赖 window.__ModuleLoader__，不能直接 import，所以用 new Function 拼一段。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '..', 'client.js'), 'utf8');

// 从 `function name(` 开始，按花括号配平截到函数结束。
function extractFunction(text, name) {
  const start = text.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `client.js 里找不到 ${name}`);
  let depth = 0;
  let seen = false;
  for (let at = start; at < text.length; at += 1) {
    const char = text[at];
    if (char === '{') {
      depth += 1;
      seen = true;
    } else if (char === '}') {
      depth -= 1;
      if (seen && depth === 0) return text.slice(start, at + 1);
    }
  }
  throw new Error(`${name} 的括号没配平`);
}

function extractConst(text, name) {
  const match = text.match(new RegExp(`const ${name} = [^;]+;`));
  assert.ok(match, `client.js 里找不到常量 ${name}`);
  return match[0];
}

const pieces = [
  extractConst(source, 'CANVAS_KEY'),
  extractConst(source, 'CANVAS_LIMIT'),
  extractConst(source, 'CANVAS_MIN_SCALE'),
  extractConst(source, 'CANVAS_MAX_SCALE'),
  extractConst(source, 'CANVAS_HISTORY'),
  extractConst(source, 'CANVAS_IMPORT_MAX_BYTES'),
  extractConst(source, 'CANVAS_COORD_LIMIT'),
  extractConst(source, 'CANVAS_TEXT_LIMIT'),
  "const CANVAS_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;",
  "const CANVAS_IMAGE_RE = /^data:image\\/(?:png|jpe?g|webp|gif|avif);base64,[A-Za-z0-9+/=\\s]+$/i;",
  extractConst(source, 'EMPTY_CANVAS'),
  extractFunction(source, 'histPush'),
  extractFunction(source, 'histUndo'),
  extractFunction(source, 'histRedo'),
  extractFunction(source, 'readCanvas'),
  extractFunction(source, 'canvasFinite'),
  extractFunction(source, 'canvasValidId'),
  extractFunction(source, 'canvasValidImage'),
  extractFunction(source, 'pruneCanvasEdges'),
  extractFunction(source, 'normalizeCanvasMeta'),
  extractFunction(source, 'normalizeCanvasState'),
  extractFunction(source, 'writeCanvas'),
  extractFunction(source, 'chainOrder'),
].join('\n');

function makeStore(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, value),
    removeItem: (key) => map.delete(key),
    dump: () => Object.fromEntries(map),
  };
}

function load(localStorage) {
  // eslint-disable-next-line no-new-func
  return new Function('localStorage', `${pieces}\nreturn { readCanvas, writeCanvas, histPush, histUndo, histRedo, EMPTY_CANVAS, CANVAS_HISTORY };`)(localStorage);
}

test('空存储时给出空画布', () => {
  const api = load(makeStore());
  const state = api.readCanvas();
  assert.deepEqual(state.nodes, []);
  assert.deepEqual(state.edges, []);
  assert.equal(state.view.scale, 1);
});

test('写完能原样读回', () => {
  const store = makeStore();
  const api = load(store);
  const node = { id: 'cn_1', kind: 'image', x: 10, y: 20, w: 200, h: 200, src: 'data:image/png;base64,AAA', title: '图' };
  const node2 = { id: 'cn_2', kind: 'text', x: 260, y: 20, w: 200, h: 100, src: '', text: '说明' };
  const warn = api.writeCanvas({ nodes: [node, node2], edges: [{ id: 'e1', from: 'cn_1', to: 'cn_2' }], view: { x: 5, y: 6, scale: 1.5 } });
  assert.equal(warn, '');
  const back = api.readCanvas();
  assert.equal(back.nodes.length, 2);
  assert.equal(back.nodes[0].src, node.src);
  assert.equal(back.edges[0].from, 'cn_1');
  assert.deepEqual(back.view, { x: 5, y: 6, scale: 1.5 });
});

test('坏 JSON 不会把画布打死', () => {
  const store = makeStore({ 'dsh-drawcraft:canvas:v1': '{ this is not json' });
  const api = load(store);
  const state = api.readCanvas();
  assert.equal(state.nodes.length, 0);
  assert.equal(state.view.scale, 1);
});

test('缩放值超出范围时被夹回来', () => {
  const store = makeStore({
    'dsh-drawcraft:canvas:v1': JSON.stringify({ nodes: [], edges: [], view: { x: 0, y: 0, scale: 42 } }),
  });
  const api = load(store);
  assert.equal(api.readCanvas().view.scale, 2.5);
});

test('撞配额时退一步只留排版', () => {
  const store = makeStore();
  let first = true;
  const original = store.setItem;
  store.setItem = (key, value) => {
    if (first) {
      first = false;
      const error = new Error('QuotaExceededError');
      error.name = 'QuotaExceededError';
      throw error;
    }
    original(key, value);
  };
  const api = load(store);
  const warn = api.writeCanvas({
    nodes: [{ id: 'cn_1', kind: 'image', x: 0, y: 0, w: 200, h: 200, src: 'data:image/png;base64,' + 'A'.repeat(64) }],
    edges: [],
    view: { x: 0, y: 0, scale: 1 },
  });
  assert.equal(warn, 'quota');
  const back = api.readCanvas();
  assert.equal(back.nodes.length, 1, '排版要留住');
  assert.equal(back.nodes[0].src, '', '像素丢掉');
  assert.equal(back.nodes[0].lost, true, '标记成丢图');
});

test('节点数量超过上限时只留最近的', () => {
  const store = makeStore();
  const api = load(store);
  const nodes = Array.from({ length: 70 }, (_, index) => ({ id: `cn_${index}`, kind: 'text', x: index, y: 0, w: 200, h: 100 }));
  api.writeCanvas({ nodes, edges: [], view: { x: 0, y: 0, scale: 1 } });
  const back = api.readCanvas();
  assert.equal(back.nodes.length, 60);
  assert.equal(back.nodes[59].id, 'cn_69');
});

test('撤销栈压入时清空重做分支', () => {
  const api = load(makeStore());
  let hist = { past: [], future: [] };
  hist = api.histPush(hist, { nodes: [], tag: 'a' });
  hist = api.histPush(hist, { nodes: [], tag: 'b' });
  assert.equal(hist.past.length, 2);
  // 撤销一步后又有新操作，future 必须清掉，否则重做会跳到旧分支。
  const undone = api.histUndo(hist, { nodes: [], tag: 'c' });
  assert.equal(undone.state.tag, 'b');
  assert.equal(undone.hist.future.length, 1);
  const pushed = api.histPush(undone.hist, { nodes: [], tag: 'd' });
  assert.equal(pushed.future.length, 0);
  assert.deepEqual(pushed.past.map((item) => item.tag), ['a', 'd']);
});

test('撤销栈超过深度只丢最老的', () => {
  const api = load(makeStore());
  let hist = { past: [], future: [] };
  for (let index = 0; index < 50; index += 1) hist = api.histPush(hist, { nodes: [], tag: String(index) });
  assert.equal(hist.past.length, api.CANVAS_HISTORY);
  assert.equal(hist.past[0].tag, String(50 - api.CANVAS_HISTORY));
  assert.equal(hist.past[hist.past.length - 1].tag, '49');
});

test('撤销到底就没有下一步', () => {
  const api = load(makeStore());
  assert.equal(api.histUndo({ past: [], future: [] }, { nodes: [], tag: 'x' }), null);
  assert.equal(api.histRedo({ past: [], future: [] }, { nodes: [], tag: 'x' }), null);
});

test('撤销再重做回到原样', () => {
  const api = load(makeStore());
  let hist = api.histPush({ past: [], future: [] }, { nodes: [], tag: 'before' });
  const current = { nodes: [], tag: 'after' };
  const undone = api.histUndo(hist, current);
  assert.equal(undone.state.tag, 'before');
  const redone = api.histRedo(undone.hist, undone.state);
  assert.equal(redone.state.tag, 'after');
  assert.equal(redone.hist.future.length, 0);
});

test('附图编号跟着连线走，不跟坐标走', () => {
  const load = new Function(`${pieces}\nreturn { chainOrder };`);
  const { chainOrder } = load();
  // 故意把上游摆在右边：照片 x=600、服装 x=300、姿势 x=100。
  // 连线是 照片 → 服装 → 姿势，编号就该按这个来。
  const nodes = [
    { id: 'a', x: 600, y: 0 },
    { id: 'b', x: 300, y: 0 },
    { id: 'c', x: 100, y: 0 },
  ];
  const edges = [
    { from: 'a', to: 'b' },
    { from: 'b', to: 'c' },
  ];
  assert.deepEqual(chainOrder(nodes, edges).map((node) => node.id), ['a', 'b', 'c']);
});

test('跨文字节点的图链仍按完整拓扑排序', () => {
  const load = new Function(`${pieces}\nreturn { chainOrder };`);
  const { chainOrder } = load();
  const images = [
    { id: 'photo', x: 900, y: 0 },
    { id: 'pose', x: 100, y: 0 },
  ];
  const graphNodes = [
    images[0],
    { id: 'caption', kind: 'text', x: 500, y: 0 },
    images[1],
  ];
  const edges = [
    { from: 'photo', to: 'caption' },
    { from: 'caption', to: 'pose' },
  ];
  assert.deepEqual(chainOrder(images, edges, graphNodes).map((node) => node.id), ['photo', 'pose']);
});

test('没连线的图退回按坐标排', () => {
  const load = new Function(`${pieces}\nreturn { chainOrder };`);
  const { chainOrder } = load();
  const nodes = [
    { id: 'right', x: 400, y: 0 },
    { id: 'left', x: 40, y: 0 },
  ];
  assert.deepEqual(chainOrder(nodes, []).map((node) => node.id), ['left', 'right']);
});

test('两条链并排时各自保持上下游', () => {
  const load = new Function(`${pieces}\nreturn { chainOrder };`);
  const { chainOrder } = load();
  const nodes = [
    { id: 'p2', x: 500, y: 300 },
    { id: 'p1', x: 100, y: 300 },
    { id: 'q2', x: 500, y: 0 },
    { id: 'q1', x: 100, y: 0 },
  ];
  const edges = [
    { from: 'p1', to: 'p2' },
    { from: 'q1', to: 'q2' },
  ];
  const order = chainOrder(nodes, edges).map((node) => node.id);
  assert.ok(order.indexOf('p1') < order.indexOf('p2'));
  assert.ok(order.indexOf('q1') < order.indexOf('q2'));
});

test('自环与成环都不会卡死', () => {
  const load = new Function(`${pieces}\nreturn { chainOrder };`);
  const { chainOrder } = load();
  const nodes = [
    { id: 'a', x: 0, y: 0 },
    { id: 'b', x: 100, y: 0 },
  ];
  const edges = [
    { from: 'a', to: 'a' },
    { from: 'a', to: 'b' },
    { from: 'b', to: 'a' },
  ];
  const order = chainOrder(nodes, edges);
  assert.equal(order.length, 2);
});

test('链条上一共三张图时，编号按连线深度排', () => {
  const load = new Function(`${pieces}\nreturn { chainOrder };`);
  const { chainOrder } = load();
  const nodes = [
    { id: 'pose', x: 700, y: 0 },
    { id: 'photo', x: 0, y: 0 },
    { id: 'costume', x: 350, y: 0 },
  ];
  const edges = [
    { from: 'photo', to: 'costume' },
    { from: 'costume', to: 'pose' },
  ];
  assert.deepEqual(chainOrder(nodes, edges).map((node) => node.id), ['photo', 'costume', 'pose']);
});
