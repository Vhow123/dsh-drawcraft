# vendor/muse —— 从 dsh-muse-media 移植的浏览器驱动

绘语自带 Muse 出图能力，不再依赖 `dsh-muse-media` 插件。这里放的是驱动层源码，原样移植，只改了 import 相对路径。

- 上游：`dsh-muse-media` v1.3.0（npm）
- 作者：sizhe03
- 许可证：MIT（全文见本目录 `LICENSE`，版权归 sizhe03）

| 文件 | 职责 |
|---|---|
| `cdp.js` | Chrome DevTools Protocol 的最小客户端（WebSocket + 命令/事件） |
| `browser.js` | 定位本机 Chrome、拉起带 `--user-data-dir` 的实例、按账号复用连接、空闲回收 |
| `muse.js` | muse.ai 页面操作：等页面就绪、检查登录、上传参考图、写提示词、点发送、等送达、等成品、读额度 |
| `pool.js` | 失败分类（`FAILURE` / `MuseFailure`）与额度文案判定 |
| `store.js` | 账号索引文件格式（绘语侧只用其中的常量与类型形状） |

绘语自己的调用封装在 `lib/muse-provider.js`：单账号、串行、登录窗口、出图。

升级上游时的做法：把这五个文件重新覆盖，然后跑 `node test/muse-provider.test.mjs` 看接口有没有漂。
