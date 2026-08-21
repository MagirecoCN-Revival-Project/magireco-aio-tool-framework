# AIO 框架架构

> 版本：2026-08-20 第二版（**推翻第一版的「路径挂载 + 独立文档」方案**）
> 交付平台：EdgeOne Maker / Pages（主）+ COS + EdgeOne CDN（资源面）
> 代码：本仓库 `packages/`，已实现并有测试覆盖

---

## 一、第一版错在哪

第一版把每个查看器挂在各自的子路径上，切换走整页加载，理由是四条运行时
（three.js / Pixi / cocos2d-html5 / Cubism）互相冲突。

**那个约束是真的，但结论是错的。** 运行时冲突不该由「放弃整合」来解决，
该由**框架承担隔离**来解决。用户在剧情里点一下就该看到 ADV 实机播放，
而不是被扔到另一个页面。

第二版的判据只有一条：

> 模块之间**不互相 import、不知道对方存在**，却能互相调用并回话。
> 少装一个模块，宿主依然自洽，只是少一项能力。

---

## 二、三个概念

### 资源引用（ResourceRef）——通用货币

```
a:character/1001            命名空间 a · 角色甲
a:sprite/100100/d_r         命名空间 a · 精灵
a:scenario/310241@zh        命名空间 a · 剧情（中文）
b:model3d/100101            示例作品 B · 角色乙的 3D 模型
```

`universe` 前缀不是装饰。实测跨仓库对账发现：

| 证据 | 后果 |
|---|---|
| 命名空间 b 的 `style3dCharacterMstId: 100101` = 角色乙；命名空间 a的 `sprite 100100` = 角色甲 | **同号不同人。** 裸数字在系统里流动，迟早把角色甲的档案配上角色乙的模型，而且不报错 |
| 命名空间 b 的 `100101` 对应资源名 `chara_100107_battle_unit` | ID 与资源号根本不是一回事 |
| wiki 给 charaId `1001` 登记 costumeIds `03/04/50/53`，kyu 镜像里实际存在 `100100/100101/100109` | 「charaId + 服装号」这条规律**不成立** |

所以解析器**拒绝没有前缀的字符串**（`packages/core/src/ref.ts`）。

### 能力与意图（Capability / Intent）——调用方式

剧情阅读器不 import ADV 播放器。它只是发一个意图：

```ts
if (host.can('adv.play', scenario)) {          // ← 决定按钮画不画
  await host.request({
    capability: 'adv.play',
    ref: scenario,
    params: { line: 42 },
    surface: 'sheet',
  });
}
```

内核找到声明了 `adv.play` 且接受 `scenario` 的插件，装载到一个 surface 上。
**没装 ADV 插件时 `can()` 返回 false，按钮根本不渲染**——这就是插件化与
跳转链接的区别。

`can()` 还会检查资源清单里有没有这条 ref：装了插件也打不开不存在的东西，
在这里挡掉，用户点了才发现 404 的情况不复存在。

### 事件总线——回话通道

单向调用只能做到「点一下打开另一个东西」。有机整合需要反向回流：

```ts
// ADV 播到第 42 行
host.events.emit('progress', { surfaceId, ref, position: 42, total: 120 });

// 剧情阅读器（另一个模块，从未引用过 ADV）据此高亮第 42 行
kernel.events.on('progress', (p) => {
  if (formatRef(p.ref) === formatRef(myScenario)) highlight(p.position);
});
```

三种事件构成完整闭环：`progress`（进度）、`entity.focused`（ADV 里点了立绘）、
`surface.opened/closed`。

---

## 三、包结构（已实现）

```
packages/
  core/         @aio/core        ref 语法、能力/意图类型、事件总线   零依赖
  registry/     @aio/registry    实体交叉表，防撞号
  resource/     @aio/resource    清单、多源回退、完整性校验
  kernel/       @aio/kernel      插件注册、意图派发、surface、上下文治理、iframe 桥
  plugin-sdk/   @aio/plugin-sdk  definePlugin + 无头测试宿主
```

依赖方向单向：`core ← registry/resource ← kernel ← plugin-sdk`。
`core` 零依赖，任何人可以只拿它去解析 ref。

---

## 四、隔离：让老库共处一室

四个查看器里有两个**靠全局变量活着**：

| 运行时 | 全局 | 隔离级别 |
|---|---|---|
| three.js 0.182（example-model-viewer） | 无，ESM | `inline` |
| Pixi（命名空间 b ADV，版本已 pin） | 无，ESM，但 pin 不能被打破 | `iframe` |
| cocos2d-html5（example-sprite-mirror） | `window.cc` | `iframe` |
| Cubism Core（Live2D） | `window.Live2DCubismCore` | `iframe` |

`iframe` 插件跑在独立 realm，通过 postMessage RPC 收发生命周期命令。
**关键在于对调用方完全透明**：

```ts
// 调用方写法完全一样，不知道对面是不是 iframe
await host.request({ capability: 'sprite.show', ref });
```

`createIframePlugin()` 把「跑在 iframe 里的查看器」包装成一个普通 `Plugin`，
内核和其它插件看到的与 inline 插件毫无区别。传输层是注入的（`Transport` 接口），
所以协议逻辑能在 node 上直接测，不用起浏览器。

已覆盖的边界：命令超时必须 reject（不回话的 iframe 不能让 `dispose` 永远挂着）、
子帧已死时 `dispose` 仍要拆干净、子帧发来的坏 ref 直接丢弃不污染事件总线。

### WebGL 上下文治理

浏览器同时保有的 WebGL 上下文有硬上限（常见 8–16）。超过之后**不报错**，
只是最早那个被丢弃——表现是「刚才还好好的 3D 查看器突然变黑」。

这个问题在「一个页面一个查看器」下不存在，但本框架要让剧情、精灵、Live2D、3D
同时活在一个页面上，就必须有人管。内核按 LRU 挂起最久未用的实例
（`suspend()` 释放上下文与音频，状态保留），用户再交互时 `resume()` 回来。

---

## 五、资源面：assets 与网站彻底分离

判据只有一条：**网站源码里 grep 不到任何资源路径。**

```
插件：  host.resources.fetchPart(ref, 'texture')
          ↓
清单：  a:sprite/100100/d_r → [ {path: 's/100100.png', role: 'texture', sha256} ]
          ↓
选路：  按权重排序的多个 base，失败打冷却、跨资源共享
          ↓
COS + EdgeOne CDN
```

- **插件不碰 URL、不碰 fetch、不知道 CDN 有几条线。** 换 CDN、加备份源、
  把某批资源下架，全都不需要动插件。
- **选路语义照抄客户端 `CNMirrors`**——那套被真实玩家验证过。一条**没照抄**：
  `switch_after_failures: 1` 是为大文件长连接定的，浏览器端小文件短请求
  一次超时就永久降权会在弱网下把所有线路轮空，这里默认 2 次。
- **只收 https**（localhost 例外）。清单条目缺独立校验和时完整性全押在 TLS 上，
  一个明文源就是整条资源链的投毒入口。
- **sha256 不符视为该源失败并继续回退**，不接受坏字节。地址不是身份。
- **下架 = 从清单里去掉条目**，`resolve()` 抛「可能已下架」，UI 降级提示而非白屏。

资源前缀在契约里全局唯一（守卫第 4 条），两个源共用一个前缀会互相覆盖清单。

### 这带来一个架构简化

第一版要拆 7 个 Pages 项目，是被 5 GiB / 20,000 文件的限额逼的。
资源全部外置之后，**交付面只剩一个小体量的 Pages 项目**：

| | 第一版 | 第二版 |
|---|---|---|
| Pages 项目 | 7 个 + 1 条反代 | **1 个** `aio-station` + 1 条反代 |
| 部署产物 | 各自塞着素材 | 只有代码与插件 chunk |
| iframe 插件 | — | 同一项目下的 `/frames/*` 路由，几十 KB |

守卫第 5 条盯着这件事：契约里声明的资产量若逼近 Pages 限额，说明它没真的外置。

---

## 六、交叉表：让「点一下看精灵」真的指对人

```ts
const spriteRef = registry.primaryLink(parseRef('a:character/1001'), 'sprite');
// → a:sprite/100100/d_r
```

**这是数据，不是公式**（理由见 §二 的证据表）。查不到就返回空数组，
**绝不按编号规律猜**——猜错的代价是显示了另一个角色，而没人会立刻发现。

三条硬规则，都有测试：

1. 跨作品关联直接拒收（`a:character/1001` 不许链到 `b:model3d/100101`）。
2. 分组与 kind 不符拒收。
3. 反查支持：`ownerOf(sprite)` → character，供「ADV 里点立绘打开档案」。

### 素材来源与那条禁令

交叉表最重要的素材在 `example-restricted-data`（`charaId`、`costumeIds`、
`voice_index`、`media_manifest`），而那个仓库有 CI 强制的公开部署禁令。

交叉表是 ID 映射，不是 wiki 正文，但**它是否算「派生自禁止公开的仓库」
需要维护者拍板**。本方案默认：交叉表的生成脚本可以读 wiki-data，
但生成结果能否随公开站发布，等你的决定。见「待拍板事项」。

---

## 七、宿主不止一个

最容易被忽略的一点：**框架不吸收那些站点，是那些站点采用框架。**

```ts
// example-reader 自己的 Next.js 站点里
kernel.register(advPlayerPlugin);
// 从此它的剧情页多出一个「实机播放」按钮
```

这一条同时解决了许可证问题：`example-reader` 明确未授予任何开源许可，
**不能被 vendor**。但它可以作为**独立宿主**安装框架插件——主权不变，
能力增加。`example-model-viewer` 同理，装上 voice 插件就有了语音。

AIO 工作站只是**其中一个宿主**，装了全部插件而已。

---

## 八、EdgeOne 上怎么跑

| 部分 | 落点 |
|---|---|
| `aio-station`（宿主 + 全部插件 chunk） | EdgeOne Pages 单项目 |
| iframe 插件的子文档 | 同项目 `/frames/sprite/`、`/frames/adv/` 等路由 |
| 资源（约 20 GiB） | COS 桶 + EdgeOne CDN，`assets.<域>` |
| 清单与交叉表 | 与资源同桶，独立于网站发版更新 |
| `/story/` | 反代 example-reader 既有 Cloudflare 部署 |
| 边缘函数 | 线路探测、鉴权后台会话（Phase 5） |

EdgeOne Makers 的 Agent 托管留到最后（诊断 Agent > 剧情语义检索 > 资料问答），
**不得成为前面阶段的依赖**。

---

## 待验证项（开工前必须复核）

1. EdgeOne Pages 限额（5 GiB / 20,000 文件 / 25 MiB）——本文数据来自第三方文章，
   官方文档站当时 503。资源外置后余量很大，但仍需复核。
2. EdgeOne Pages Functions 的 CPU 时间 / 内存 / 请求体上限。
3. 自定义域名的 ICP 备案要求；Cloudflare 托管的根域名不支持绑定，需用子域。
4. COS 与 EdgeOne 回源的计费口径（资源面约 20 GiB，以图片小文件为主）。
5. **精灵图集里 `rotated=true` 的帧转的是哪个方向。** 打包器把竖长图转 90°
   塞进图集，两个方向都会画出一张「看着像那么回事」的图，错的那个是上下颠倒
   或镜像的零件，**不报错**。所以 `plugin-sprite` 的 `placeFrame()` 目前对这类帧
   **返回 null 而不是蒙一个**，舞台跳过并经 `onSkipped` 报出来。
   复核方式：拿一张真实图集，找一个 `rotated=true` 的帧比对它在游戏里的朝向；
   定了之后补一次 90° 旋转（五行）与一条判据。
6. **CocosStudio 导出的 `version >= 0.3`（combined）要不要那两步补偿。**
   运行时对这类导出会先把 `bone_data` 并进每一帧再做 `scale -= 1`，那是它为
   自己的插值方式做的修正。没有真实导出文件无从验证，所以 `worldPoseAt()`
   **不做**这两步，只做无歧义的父级合成，并把根上的 `version` 原样放在
   `doc.dataVersion` 里备查。复核方式见 `packages/plugin-sprite/src/pose.ts`。

## 待拍板事项

1. **交叉表能否公开。** 素材来自有公开禁令的 `example-restricted-data`。
   本方案默认「生成可以、发布待定」。
2. **Story 走反代还是迁移。** 默认反代（§七 的宿主模型让迁移不再必要）。
3. **域名与备案。**
