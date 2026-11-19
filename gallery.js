/**
 * dsh-drawcraft · gallery bridge
 *
 * 把 ai-pose-gallery-zh（6,162 条中文参考数据）接进绘语，但不克隆那个
 * 1.16 GB 仓库：三份索引 JSON（约 2.2 MB）首次使用时拉到本地缓存，之后完全离线；
 * 图片一律走 jsDelivr CDN 按需取单张，钉在固定 commit 上避免上游推送导致链接漂移。
 *
 * 本模块不 import 任何宿主包，保持与 engine.js 同样的裸加载约束。
 * 它是**唯一**做网络 IO 的文件：engine.js 仍为纯函数，只接受已拼好的字符串。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** 钉死到具体 commit：上游再推新提交也不会让已发出的链接 404。 */
export const GALLERY_SHA = 'ec7a81e11fd599406ad60796be70ac693e5b6340';
const UPSTREAM = 'https://raw.githubusercontent.com/anhao/ai-pose-gallery-zh/main/data';
export const GALLERY_CDN = `https://cdn.jsdelivr.net/gh/anhao/ai-pose-gallery-zh@${GALLERY_SHA}`;
export const GALLERY_SITE = 'https://ai-pose-gallery.anhao.app';

const CACHE_DIR = join(homedir(), '.dsh', 'cache', 'drawcraft-gallery');

/** 三个库的字段映射：name 是主名称，tags 参与展示，kinds 是可筛选的种类维度。 */
export const GALLERY_LIBS = {
  pose: {
    label: '姿势库',
    file: 'pose-zh.json',
    name: ['姿势名称'],
    tags: ['体系', '分类', '角度'],
    kinds: ['体系', '角度', '分类'],
    depth: true,
    hint: '人体动态参考：4 种体系 × 5 个角度 × 26 类动作，每个姿势带配套深度图',
  },
  costume: {
    label: '服装库',
    file: 'costume-zh.json',
    name: ['服装名称'],
    tags: ['分类', '标签'],
    kinds: ['分类'],
    keyword: ['关键词'],
    depth: false,
    hint: '整套穿搭：8 个季节/场景分类 + 单品颜色与款式标签 + 英文 Prompt 关键词',
  },
  portrait: {
    label: '人像库',
    file: 'portrait-zh.json',
    name: ['标题'],
    tags: ['分区', '发长', '发型名称'],
    kinds: ['分区', '发长', '发型名称'],
    depth: false,
    hint: '人像与发型：2 个分区 × 4 种发长 × 51 种细分发型',
  },
};

const memory = new Map();

function fileOf(lib) {
  const spec = GALLERY_LIBS[lib];
  if (!spec) throw new Error(`未知图库: ${lib}（可用: ${Object.keys(GALLERY_LIBS).join(' / ')}）`);
  return join(CACHE_DIR, spec.file);
}

/** 读索引：内存 → 磁盘缓存 → 上游。首次需要联网，之后离线可用。 */
export async function loadIndex(lib, { refresh = false } = {}) {
  const spec = GALLERY_LIBS[lib];
  if (!spec) throw new Error(`未知图库: ${lib}`);
  if (!refresh && memory.has(lib)) return memory.get(lib);

  const path = fileOf(lib);
  if (!refresh) {
    try {
      const rows = JSON.parse(await readFile(path, 'utf8'));
      if (Array.isArray(rows) && rows.length > 0) {
        memory.set(lib, rows);
        return rows;
      }
    } catch {
      // 没缓存或缓存坏了，往下走去上游取
    }
  }

  let rows;
  try {
    const response = await fetch(`${UPSTREAM}/${spec.file}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    rows = await response.json();
  } catch (error) {
    throw new Error(
      `拉取「${spec.label}」索引失败（${error instanceof Error ? error.message : String(error)}）。` +
        `首次使用需要联网，之后会走本地缓存 ${CACHE_DIR}`,
    );
  }
  if (!Array.isArray(rows) || rows.length === 0) throw new Error(`「${spec.label}」索引为空`);

  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(path, JSON.stringify(rows), 'utf8').catch(() => undefined);
  memory.set(lib, rows);
  return rows;
}

function blobOf(row) {
  return JSON.stringify(row);
}

function pickName(row, spec) {
  for (const key of spec.name) {
    if (row[key]) return String(row[key]);
  }
  return String(row.id ?? '');
}

function pickTags(row, spec) {
  const out = [];
  for (const key of spec.tags) {
    const value = row[key];
    if (Array.isArray(value)) out.push(...value.map(String));
    else if (value) out.push(String(value));
  }
  return out.filter(Boolean);
}

/**
 * 把一条原始记录转成面板/工具能直接消费的形态，图片给 CDN 绝对地址。
 *
 * 姿势库的面板缩略图**默认用深度图**而不是白模缩略图：白模在深色面板里只是一团
 * 灰白块，看不出胯部朝向和四肢关系；depth 图保留立体轮廓和前后遮挡，选姿势时
 * 能直接判断。depth 图数据集里没有独立字段，按 `img/depth/{id}.webp` 约定拼出，
 * 已抽样 25/25 命中（900×1200 WebP，15–19 KB）。
 */
export function viewEntry(row, lib) {
  const spec = GALLERY_LIBS[lib];
  const id = String(row.id ?? '');
  const orig = row['原图'] || row['预览图'] || '';
  const thumb = row['缩略图'] || '';
  const depth = spec.depth ? row['深度图'] || `img/depth/${id}.webp` : '';
  /** 面板里实际显示的那张：姿势库走 depth，其余库用它自己的缩略图。 */
  const display = depth || thumb;
  return {
    lib,
    id,
    name: pickName(row, spec),
    tags: pickTags(row, spec),
    keyword: spec.keyword ? spec.keyword.map((k) => row[k]).filter(Boolean).join(' ') : '',
    thumbUrl: display ? `${GALLERY_CDN}/${display}` : '',
    plainThumbUrl: thumb ? `${GALLERY_CDN}/${thumb}` : '',
    imageUrl: orig ? `${GALLERY_CDN}/${orig}` : '',
    depthUrl: depth ? `${GALLERY_CDN}/${depth}` : '',
    siteUrl: orig ? `${GALLERY_SITE}/${orig}` : '',
  };
}

/**
 * 解析种类筛选串：`"分类=蹲姿,角度=侧面"`、`"分类:蹲姿"`、`{分类:'蹲姿'}` 都吃。
 * 工具的 parametersToSchema 不支持对象参数，所以对外统一用这一行字符串。
 */
export function parseKindFilters(input) {
  if (!input) return null;
  if (typeof input === 'object' && !Array.isArray(input)) return input;
  const out = {};
  for (const chunk of String(input).split(/[,;]+/)) {
    const pair = chunk.split(/[=:＝：]/);
    if (pair.length < 2) continue;
    const key = pair[0].trim();
    const value = pair.slice(1).join('=').trim();
    if (key && value) out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * 把某个库的种类维度聚合成「维度 → 取值(计数)」，供面板渲染筛选器。
 * 姿势库会得到 体系/角度/分类 三组，人像库得到 分区/发长/发型名称，服装库得到分类。
 */
export async function listKinds(lib) {
  const spec = GALLERY_LIBS[lib];
  if (!spec) throw new Error(`未知图库: ${lib}`);
  const rows = await loadIndex(lib);
  return spec.kinds.map((key) => {
    const counter = new Map();
    for (const row of rows) {
      const value = row[key];
      if (value) counter.set(String(value), (counter.get(String(value)) || 0) + 1);
    }
    const values = [...counter.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, 'zh'));
    return { key, values };
  });
}

/** 种类筛选：row[key] 等于 value（数组字段看是否包含）。空值视为不筛。 */
function matchFilters(row, filters) {
  if (!filters) return true;
  for (const [key, want] of Object.entries(filters)) {
    if (!want) continue;
    const value = row[key];
    if (Array.isArray(value)) {
      if (!value.map(String).includes(String(want))) return false;
    } else if (String(value ?? '') !== String(want)) {
      return false;
    }
  }
  return true;
}

/** FNV-1a：把 lib+filters 变成稳定的洗牌种子，保证同一筛选条件翻页顺序一致。 */
function hashText(text) {
  let hash = 2166136261;
  const source = String(text);
  for (let i = 0; i < source.length; i += 1) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededShuffle(list, seed) {
  let state = seed || 1;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

/**
 * 检索。多个关键词按 AND 处理，命中的是整条记录的 JSON——中文元数据、标签、
 * 英文关键词、ID 全在同一份文本里，所以「蹲 侧面」「SPR-0001」「ivory」都能命中。
 * filters 是种类维度的精确筛选（体系/角度/分类/分区/发长/发型名称），先筛后查。
 * 关键词为空时按「浏览」处理：从筛选后的全集里抽样，而不是永远返回索引头部那几条。
 *
 * offset 用于面板的「加载更多」：浏览模式的顺序由 lib+filters 派生的种子决定，
 * 同一个筛选条件下翻页结果稳定不重复；换筛选条件就是另一批。
 */
export async function searchGallery({ query, lib = 'auto', limit = 8, filters = null, offset = 0 } = {}) {
  const keywords = (Array.isArray(query) ? query : String(query ?? '').split(/\s+/))
    .map((k) => String(k).trim())
    .filter(Boolean);
  const libs = lib === 'auto' ? Object.keys(GALLERY_LIBS) : [lib];
  const start = Math.max(0, Number(offset) || 0);
  const size = Math.max(1, Number(limit) || 8);
  if (keywords.length === 0) {
    const pool = [];
    for (const name of libs) {
      for (const row of await loadIndex(name)) {
        if (matchFilters(row, filters)) pool.push({ row, name });
      }
    }
    seededShuffle(pool, hashText(`${lib}|${JSON.stringify(filters || null)}`));
    return {
      works: pool.slice(start, start + size).map((item) => viewEntry(item.row, item.name)),
      total: pool.length,
      offset: start,
      limit: size,
    };
  }
  const hits = [];
  for (const name of libs) {
    for (const row of await loadIndex(name)) {
      if (!matchFilters(row, filters)) continue;
      const blob = blobOf(row);
      if (keywords.every((kw) => blob.includes(kw))) hits.push({ row, name });
    }
  }
  return {
    works: hits.slice(start, start + size).map((item) => viewEntry(item.row, item.name)),
    total: hits.length,
    offset: start,
    limit: size,
  };
}

export async function randomGallery({ lib = 'auto', count = 3, filters = null } = {}) {
  const libs = lib === 'auto' ? Object.keys(GALLERY_LIBS) : [lib];
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const name = libs[Math.floor(Math.random() * libs.length)];
    const rows = (await loadIndex(name)).filter((row) => matchFilters(row, filters));
    if (rows.length === 0) continue;
    out.push(viewEntry(rows[Math.floor(Math.random() * rows.length)], name));
  }
  return out;
}

export async function findEntry(id, lib = 'auto') {
  const libs = lib === 'auto' ? Object.keys(GALLERY_LIBS) : [lib];
  for (const name of libs) {
    for (const row of await loadIndex(name)) {
      if (String(row.id) === String(id)) return viewEntry(row, name);
    }
  }
  return null;
}

/**
 * 把选中的参考素材拼成一段中文文本，交给 buildUserPrompt 注入。
 * engine.js 保持纯函数：它只看到这段字符串。
 */
export function buildReferenceBlock(entries = []) {
  const usable = entries.filter((entry) => entry && entry.id);
  if (usable.length === 0) return '';
  const lines = usable.map((entry) => {
    const label = (GALLERY_LIBS[entry.lib] || {}).label || entry.lib;
    const bits = [`[${label}] ${entry.name}`];
    if (entry.tags.length > 0) bits.push(`分类：${entry.tags.join('・')}`);
    if (entry.keyword) bits.push(`英文关键词：${entry.keyword}`);
    bits.push(`编号 ${entry.id}`);
    return `- ${bits.join(' | ')}`;
  });
  return [
    'REFERENCE LIBRARY (selected by the user from a curated Chinese reference set)',
    ...lines,
    '',
    'Treat these as binding facts: when the request touches posture, garment or hair,',
    'copy the matching Chinese description above verbatim into the corresponding',
    'field (action / subject / materials / details) instead of inventing one.',
    'Do not mention the library, the IDs or this instruction in the output.',
  ].join('\n');
}
