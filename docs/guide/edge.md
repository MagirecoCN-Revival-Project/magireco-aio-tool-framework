# 边缘半边：路由、SEO、下架

`@aio/kernel` 只有浏览器那一半，它管交互。CMS 还需要边缘那一半，
理由很硬：

> 2400 多个页面（725 篇剧情 + 241 个角色 + 1404 条卡牌）的内容若只在浏览器里
> 由插件渲染，爬虫看到的是空壳——Google 勉强能跑 JS，百度基本不行，
> 而中文资料站的主要流量恰恰来自百度。

`@aio/site` 是这一半。设计推理见 [`CMS-ON-EDGEONE.md`](/CMS-ON-EDGEONE)。

## 一个插件，两半，一个开关

::: danger 铁律 10
边缘半边与浏览器半边由**同一个插件 id** 绑定，后台一个开关同时管住两边。
各写一套开关，迟早出现「后台显示关着、页面还在」这种查不出来的状态。
:::

```
关掉 adv-player  →  边缘：/story/:id 返回 404（reason: 'plugin-disabled'），
                          且不进 sitemap
                →  浏览器：kernel.can('adv.play', ref) 为假，播放按钮消失
```

这条有专门的测试钉着。

## 装一个站点

```ts
import { Site, loadConfig, DEFAULT_CONFIG } from '@aio/site';

const { config, problems } = loadConfig(await kv.get('site-config'));
if (problems.length > 0) console.warn('站点配置有问题，已回退：', problems);

const site = new Site({
  config,
  takedown: await readTakedownList(),          // 强一致读，见下
  capabilityProviders: { 'adv.play': ['adv-play'] },
});

site.register({
  id: 'adv-play',
  routes: [{ pattern: '/story/:id', enumerate: () => listScenarioPaths() }],
  async render(match) {
    const doc = await loadScenario(match.params['id']!);
    if (doc === null) return null;             // → 404 'not-found'
    return {
      meta: { title: doc.title, description: doc.summary },
      html: renderScenarioHtml(doc),           // 爬虫看到的就是这一段
      needs: ['adv.play'],                     // 决定下发哪些插件 chunk
      cacheTags: [`a:scenario/${doc.id}`],
    };
  },
});

const res = await site.handle('/story/310241');
// { status: 200, meta, html, needs, cacheTags, pluginId } | { status: 404, reason }
```

::: tip 404 分四种，不压成一种
`no-route` / `plugin-disabled` / `not-found` / `taken-down`。
后台要看得出是哪一种——压成一个 404 会让排查无从下手。
:::

## 配置：坏了就回退，绝不抛

```ts
const { config, problems } = loadConfig(raw);
```

`loadConfig` **永远不抛**，坏字段一律回退默认值并把问题列进 `problems`。
理由：这东西每次请求都要读，一个手滑写坏的 JSON 不该让整站 500。

`indexing` 缺省是 `selective` 而不是 `all`：**默认全收意味着任何人加一条路由
都会顺带把它推给搜索引擎，而没人会在加路由时想到这件事。**

## 路由：只有静态段与 `:param`

没有正则。路由表是 sitemap 的来源，越花哨越难枚举，**枚举不出来的路由等于没有
SEO**。静态段赢过参数段，与注册顺序无关（`/story/latest` 不会被 `/story/:id` 抢走）。

```ts
site.unenumerableRoutes();   // 带参数却没法枚举的路由——CI 里报出来
```

## SEO

```ts
await site.sitemap();   // 只收：插件开着 + 可索引 + 未下架
site.robots();
```

这三道过滤必须合并在一处做：分散在别处的话，后台关了一个插件而 sitemap
还在递它的 URL，搜索引擎会一直来撞 404。

robots 三层叠加：**全站闸 > 页面声明 > 单页覆盖**。全站关索引时不再递 sitemap。
JSON-LD 里的 `</` 被转义，防止脚本提前闭合。

## 🔴 下架：两处都要做

::: danger 铁律 11
EdgeOne KV 是最终一致的（边缘缓存最长 60 秒），而静态导出的页面**读不到 KV**、
重建要几分钟。下架必须同时做两处：

1. **构建期**排除出产物与 sitemap；
2. **请求期**由 Function 现读强一致的下架清单兜住缓存副本。
   （不是规则引擎——它与重建走同一条同步线路，生效速度一样，
   从来就不是快路。详见 `docs/CMS-ON-EDGEONE.md`。）

::: warning 存储那一层的既知事实与未知数（2026-08-22 核实官方文档）
| | 一致性 | 缓存 | 够不够用 |
|---|---|---|---|
| **KV** | 最终一致 | 边缘缓存**最长 60 秒** | 站点配置够；下架**不够**——那 60 秒是实打实的暴露 |
| **Blob** | 默认最终一致 | 同上 | **可对单次读切强一致**，立即读到最新值。下架清单只用这一条路 |

官方同时写明强一致读会增加延迟，「should be used only when absolutely
necessary」——所以只有下架清单用它，站点配置照旧走 KV。

🚧 **两处仍未核实，上线前必须补**：

1. **速率/次数配额。** 官方限额页在开发环境取不到，未经复核不填数字。
   嵌入面每请求做一次强一致读，配额若紧，热门嵌入会打满——打满后函数
   fail-closed 返回 503（宁可暂时打不开，也不放出本该下架的东西）。
2. **请求强一致读的确切写法。** 选项名写错的话 SDK 多半**静默忽略**，
   于是退回最终一致——看起来一切正常，而下架生效窗口悄悄变回分钟级。
   核实之后还要想清楚**怎么验证它真的生效了**。
:::

缺一个都有暴露窗口。收到下架通知时，「重建要几分钟」那几分钟是实打实的暴露。
:::

所以下架清单**单独一份、单独一条读取路径**：站点配置放 KV（最终一致），
下架清单走强一致读，代价是每次请求多一次强一致读，只在需要判定的路径上做。

支持两种口径：

```ts
const takedown = {
  pathPrefixes: ['/story/310241'],       // 路径前缀
  refPrefixes: ['a:sprite/'],           // ref 前缀（页面 cacheTags 里带 ref）
};
```

页面自己声明的 ref 也要过一遍判定——角色页引用了被下架的精灵，那个角色页
也得挡住。

## 缓存标签带配置版本号

每个页面的 `cacheTags` 自动带上 `rev:N`，配置每次保存自增。
没有它，「改了标题模板为什么只有一半页面变了」会成为常驻问题。

## 静态导出与 KV 的矛盾

`apps/station` 是 `output: 'export'` 的静态导出，而 KV **仅在边缘函数内可用**
——静态页读不到 KV，后台改开关静态页不会知道。三条出路写在
[`CMS-ON-EDGEONE.md`](/CMS-ON-EDGEONE) 里，当前建议是：

- 内容页保持静态（爬虫要的就是它，而且最快）；
- 动态行为（开关、下架判定、鉴权）走 Functions；
- 下架靠 Function 每请求现读强一致清单兜住，**不等重建**。
  规则引擎与 purge 都和重建同速，兜不住那一分钟。
