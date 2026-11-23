/**
 * 绘语内置的 Muse 免费额度通道。
 *
 * 目标：只装绘语一个插件，就能用 Muse 账号的免费额度出图，不再需要 dsh-muse-media。
 *
 * 结构上是一个单账号、串行的迷你 runtime：
 *   - 账号固定一个（`default`），浏览器数据目录在 `~/.dsh/drawcraft-muse/profiles/default`
 *   - 第一次用要先「打开登录窗口」让人在 muse.ai 登录一次；登录态由 Chrome 保存
 *   - 出图走 Muse 网页本身：开新对话 → 上传参考图 → 写提示词 → 点发送 → 等送达 → 等成品 → 取字节
 *
 * 驱动层是 vendored 的上游代码（见 vendor/muse/README.md，MIT），这里只做编排。
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { extname, join } from 'node:path';

import { MuseBrowser, MusePaths } from '../vendor/muse/browser.js';
import { MusePage, THREAD_URL } from '../vendor/muse/muse.js';
import { FAILURE, MuseFailure, asFailure } from '../vendor/muse/pool.js';

/** 绘语只有一个内置 Muse 账号槽；换账号就是清掉这个 profile 重新登录。 */
export const MUSE_ACCOUNT_ID = 'default';

const MEDIA_EXT = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

const DEFAULTS = {
  /** 登录后日常出图不弹窗，免得每次都抢焦点。 */
  headlessAfterLogin: true,
  imageTimeoutSeconds: 300,
  deliveryWarnSeconds: 25,
  deliveryUnknownSeconds: 60,
  /** 与上游一致：一次请求最多 4 张参考图。 */
  maxReferences: 4,
};

function textOf(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 按字节头判真实类型。
 *
 * Muse 回的 content-type 不可靠（实测把 JPEG 标成 image/webp），
 * 而面板是拿 mime 拼 data URL 的，标错了浏览器解不出来。
 */
export function sniffMime(bytes) {
  if (!bytes || typeof bytes.length !== 'number' || bytes.length < 12) return undefined;
  const view = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes.buffer ?? bytes, bytes.byteOffset ?? 0, bytes.length);
  if (view[0] === 0xff && view[1] === 0xd8) return 'image/jpeg';
  if (view[0] === 0x89 && view[1] === 0x50 && view[2] === 0x4e && view[3] === 0x47) return 'image/png';
  if (view.subarray(0, 4).toString('latin1') === 'RIFF' && view.subarray(8, 12).toString('latin1') === 'WEBP') {
    return 'image/webp';
  }
  if (view.subarray(0, 3).toString('latin1') === 'GIF') return 'image/gif';
  return undefined;
}

export class MuseProvider {
  #paths;
  #browser;
  #log;
  #chain = Promise.resolve();
  #lastError;

  constructor({ log = () => {}, config = {} } = {}) {
    this.#log = log;
    this.config = { ...DEFAULTS, ...config };
    this.#paths = new MusePaths(join(homedir(), '.dsh'), 'drawcraft-muse').ensure();
    this.#browser = new MuseBrowser({
      paths: this.#paths,
      getConfig: () => ({
        chromePath: this.config.chromePath,
        debugPortBase: this.config.debugPortBase,
        maxLiveBrowsers: 1,
        idleReapSeconds: this.config.idleReapSeconds ?? 900,
      }),
      log: this.#log,
    });
    this.#browser.startIdleReaper?.();
  }

  get profileDir() {
    return this.#paths.profileDir(MUSE_ACCOUNT_ID);
  }

  /** 串行队列：Muse 页面一次只能有一个操作。 */
  #run(label, task) {
    const run = this.#chain.then(async () => {
      try {
        return await task();
      } catch (error) {
        this.#lastError = textOf(error);
        throw error;
      }
    });
    this.#chain = run.catch(() => {});
    void label;
    return run;
  }

  /** 现在的登录状态；不会为了检查而启动浏览器。 */
  async status() {
    const running = this.#browser.isRunning?.(MUSE_ACCOUNT_ID) === true;
    if (!running) {
      return { ok: true, running: false, signedIn: undefined, profile: this.profileDir, lastError: this.#lastError };
    }
    try {
      const verdict = await this.#browser.withPage(
        MUSE_ACCOUNT_ID,
        { url: THREAD_URL, visible: false, background: true, timeoutMs: 60_000 },
        async (rawPage) => {
          const page = new MusePage(rawPage, this.#log);
          const ready = await page.waitReady({ timeoutMs: 30_000 });
          if (ready === 'signed-out') return 'signed-out';
          const session = await page.checkSession();
          return session.verdict;
        },
      );
      return {
        ok: true,
        running: true,
        signedIn: verdict !== 'signed-out',
        verdict,
        profile: this.profileDir,
        lastError: this.#lastError,
      };
    } catch (error) {
      return { ok: false, running: true, message: textOf(error), profile: this.profileDir, lastError: this.#lastError };
    }
  }

  /**
   * 打开可见窗口让人登录。
   *
   * 返回时不代表已登录：`waitSeconds` 内会轮询页面，登录成功就提前返回。
   */
  async login({ waitSeconds = 10 } = {}) {
    return this.#run('打开登录窗口', async () => {
      await this.#browser.openVisible(MUSE_ACCOUNT_ID, 'https://muse.ai/');
      const deadline = Date.now() + Math.max(0, Math.min(waitSeconds, 30)) * 1000;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        try {
          const verdict = await this.#browser.withPage(
            MUSE_ACCOUNT_ID,
            { url: 'https://muse.ai/', visible: true, background: true, timeoutMs: 20_000 },
            async (rawPage) => {
              const page = new MusePage(rawPage, this.#log);
              const session = await page.checkSession();
              return session.verdict;
            },
          );
          if (verdict !== 'signed-out') {
            return { ok: true, verdict, signedIn: true, message: '已登录' };
          }
        } catch (error) {
          this.#log(`登录检查未完成：${textOf(error)}`);
        }
      }
      return {
        ok: true,
        verdict: 'waiting',
        signedIn: false,
        message: '窗口已打开，请在窗口里完成 muse.ai 登录；登录后再点一次「检查登录」。',
      };
    });
  }

  /** 关闭内置浏览器（登录态留在 profile 里，不会丢）。 */
  async close() {
    return this.#run('关闭浏览器', async () => {
      const closed = await this.#browser.close(MUSE_ACCOUNT_ID, { reason: '绘语请求关闭' });
      return { ok: true, closed };
    });
  }

  /** 换账号 / 清登录态：删掉整个 profile 目录。 */
  async signOut() {
    return this.#run('清除登录态', async () => {
      await this.#browser.close(MUSE_ACCOUNT_ID, { reason: '清除登录态' }).catch(() => {});
      const removed = this.#paths.removeProfile(MUSE_ACCOUNT_ID);
      return { ok: true, removed };
    });
  }

  /**
   * 出图。一次调用对应 n 次真实发送（Muse 没有批量），串行执行。
   * @returns {Promise<{images: Array<{b64: string, mime: string, width?: number, height?: number}>, durationMs: number}>}
   */
  async generate({ prompt, size, n = 1, references = [] } = {}) {
    const text = String(prompt ?? '').trim();
    if (text === '') {
      throw new MuseFailure('提示词为空，没有发送。', { code: 'EMPTY_PROMPT', kind: FAILURE.INVALID });
    }
    const count = Math.max(1, Math.min(4, Number(n) || 1));
    const refs = Array.isArray(references) ? references.filter((item) => typeof item === 'string' && item !== '') : [];
    if (refs.length > this.config.maxReferences) {
      throw new MuseFailure(`一次最多 ${this.config.maxReferences} 张参考图，收到 ${refs.length} 张。`, {
        code: 'TOO_MANY_REFERENCES',
        kind: FAILURE.INVALID,
      });
    }
    const outgoing = this.#composePrompt(text, size);
    const started = Date.now();
    const images = [];
    for (let index = 0; index < count; index += 1) {
      const media = await this.#run(`生图 ${index + 1}/${count}`, () => this.#once(outgoing, refs));
      images.push({
        b64: media.bytes.toString('base64'),
        mime: sniffMime(media.bytes) ?? media.mime ?? 'image/webp',
        width: media.width,
        height: media.height,
      });
    }
    return { images, durationMs: Date.now() - started };
  }

  /** Muse 没有画幅参数，比例只能写成一句提示。 */
  #composePrompt(prompt, size) {
    return composePrompt(prompt, size);
  }

  /** 一次真实的生成：开对话 → 上传 → 写词 → 发送 → 等送达 → 等成品。 */
  async #once(prompt, references) {
    const { files, dir } = await this.#materialize(references);
    try {
      return await this.#browser.withPage(
        MUSE_ACCOUNT_ID,
        { visible: !this.config.headlessAfterLogin, url: THREAD_URL, timeoutMs: 60_000 },
        async (rawPage) => {
          const page = new MusePage(rawPage, this.#log);
          const ready = await page.waitReady({ timeoutMs: 45_000 });
          if (ready === 'signed-out') {
            throw new MuseFailure('Muse 会话已失效，需要在绘语设置里重新登录一次。', {
              code: 'SIGNED_OUT',
              kind: FAILURE.SIGNED_OUT,
            });
          }
          if (ready !== 'ready') {
            throw new MuseFailure(`Muse 页面没有就绪（${ready}），这次没有发送。`, {
              code: 'PAGE_NOT_READY',
              kind: FAILURE.SHARED,
            });
          }
          const session = await page.checkSession();
          if (session.verdict === 'signed-out') {
            throw new MuseFailure('Muse 会话已失效，需要在绘语设置里重新登录一次。', {
              code: 'SIGNED_OUT',
              kind: FAILURE.SIGNED_OUT,
            });
          }

          await page.clearComposer({ fresh: true });
          if (files.length > 0) {
            await page.attachFiles(files, { expected: files.length, timeoutMs: 90_000 });
          }

          const baseline = await page.snapshot();
          const written = await page.setPrompt(prompt);
          if (written.length === 0) {
            throw new MuseFailure('提示词没有进入输入框，已停止（没有发送）。', {
              code: 'COMPOSER_EMPTY',
              kind: FAILURE.SHARED,
            });
          }

          const send = await page.sendOnce({ expectedPrompt: prompt });
          if (!send.fired) {
            throw new MuseFailure(
              `发送没有触发（${send.reason ?? 'unknown'}），这次没有提交，也不消耗额度。`,
              { code: 'SEND_NOT_FIRED', kind: FAILURE.SHARED },
            );
          }
          if (send.unconfirmed === true) {
            throw new MuseFailure(
              '发送动作已发出但回执丢失，结果未知。请先看 Muse 里这个账号的对话，不要直接重发。',
              { code: 'OUTCOME_UNKNOWN', kind: FAILURE.TIMEOUT },
            );
          }

          const delivery = await page.waitDelivery(baseline, {
            warnMs: this.config.deliveryWarnSeconds * 1000,
            unknownMs: this.config.deliveryUnknownSeconds * 1000,
          });
          if (delivery.unknown === true) {
            throw new MuseFailure(
              '发送后没有拿到送达证据，结果未知。请先看 Muse 里这个账号的对话，不要直接重发。',
              { code: 'OUTCOME_UNKNOWN', kind: FAILURE.TIMEOUT },
            );
          }

          const deadline = Date.now() + this.config.imageTimeoutSeconds * 1000;
          return await page.waitMedia(baseline, { kind: 'image', deadline, expectedPrompt: prompt });
        },
      );
    } finally {
      if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
    }
  }

  /** 参考图：data URL / 本机路径 / file:// 都落到临时文件，attachFiles 只吃路径。 */
  async #materialize(values) {
    if (values.length === 0) return { files: [], dir: undefined };
    const dir = join(tmpdir(), `drawcraft-muse-refs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`);
    mkdirSync(dir, { recursive: true });
    const files = [];
    for (const [index, value] of values.entries()) {
      const raw = String(value).trim();
      if (raw.startsWith('data:')) {
        const comma = raw.indexOf(',');
        if (comma === -1) throw new MuseFailure(`第 ${index + 1} 张参考图不是有效的 data URL。`, { code: 'BAD_REFERENCE', kind: FAILURE.INVALID });
        const head = raw.slice(5, comma);
        const mime = head.split(';')[0] || 'image/png';
        const payload = raw.slice(comma + 1);
        const bytes = head.includes(';base64')
          ? Buffer.from(payload, 'base64')
          : Buffer.from(decodeURIComponent(payload), 'binary');
        const path = join(dir, `reference-${index + 1}${MEDIA_EXT[mime] ?? '.png'}`);
        writeFileSync(path, bytes);
        files.push(path);
        continue;
      }
      if (raw.startsWith('file://')) {
        files.push(decodeURIComponent(new URL(raw).pathname.replace(/^\/([A-Za-z]:)/, '$1')));
        continue;
      }
      files.push(raw);
    }
    return { files, dir };
  }
}

/** 画幅提示：Muse 只认提示词，不认参数。 */
const ASPECT_HINTS = {
  '1:1': '画面比例 1:1，正方形构图。',
  '16:9': '画面比例 16:9，横版宽幅构图。',
  '9:16': '画面比例 9:16，竖版构图。',
  '4:3': '画面比例 4:3，横向构图。',
  '3:4': '画面比例 3:4，竖向构图。',
  '3:2': '画面比例 3:2，横向构图。',
  '2:3': '画面比例 2:3，竖向构图。',
};

/** 把画幅写成一句话追加到提示词；不认识的值原样返回。 */
export function composePrompt(prompt, size) {
  const hint = ASPECT_HINTS[String(size ?? '').trim()];
  return hint === undefined ? prompt : `${prompt}\n\n${hint}`;
}

export { FAILURE, MuseFailure, asFailure, extname };
