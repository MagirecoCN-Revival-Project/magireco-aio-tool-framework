# 嵌出去：给别的站用我们的查看器

判据：**别的站放一个 `<iframe>` 就能得到我们的查看器，不装包、不懂内核、
拿不到我们的任何内部对象。通道里只过数据。**

这一面由 `@aio/embed` 提供。不装它的宿主就是「不对外提供嵌入」，别的什么都不少。

```
  他们的页面                      我们的边缘
  ┌────────────────┐              ┌──────────────────────┐
  │ <iframe src=   │ ──── GET ──▶ │ resolveEmbed()       │
  │  …/embed/…  >  │              │  ├ 解析（拒裸 ID）    │
  │                │ ◀── HTML ─── │  ├ 下架判定           │
  │  message 监听  │ ◀ postMessage│  ├ 插件开关           │
  └────────────────┘              │  └ CSP frame-ancestors│
                                  └──────────────────────┘
```

## URL 形状

```
/embed/<能力 id>?ref=<ref>&<契约登记的参数…>
```

```
/embed/sprite.show?ref=a:sprite/100100/d_r&movement=idle
/embed/adv.play?ref=a:scenario/310241@zh&line=12&auto=true
/embed/chart.height?ref=a:character/1001&compare=a:character/1002
```

参数**必须是能力契约登记过的**才生效。契约没登记的键直接丢掉，不报错——
契约会长出新参数，老部署收到新参数不该整个 400。但登记了却写错值的要报错：
那不是「新参数」，是写错了。

::: danger 裸 ID 在这里尤其危险
嵌入 URL 是**别人手写**的，还会被复制到几十个页面上。`parseRef` 那道闸
在这里比任何内部调用都更要紧——`?ref=100101` 直接 400，没有宽松模式。
:::

## 谁可以嵌：白名单，且没有「全放」

```ts
const policy = { allowedAncestors: ['https://wiki.example.org'] };
```

- **空名单 = 谁都不许嵌**（`frame-ancestors 'none'`），不是「谁都行」。
  忘了配置的后果应该是「嵌不上，来问」，而不是「谁都能嵌，没人发现」。
- **`'*'` 直接拒绝。** 放开它等于开放点击劫持：任何人都能把这个 iframe
  铺成透明层盖在自己的按钮上，用户以为点的是他的页面。
- 通配只支持 `https://*.example.org` 一种写法，语义与 CSP 一致——
  匹配子域，**不匹配主域本身**。要连主域一起放就写两条。

两边的判定必须一致（`isAllowedAncestor` 与浏览器对 `frame-ancestors` 的判定）。
不一致的后果最难查：浏览器放行而我们的 postMessage 校验拒收（功能静默失效），
或者反过来（以为拦住了其实没有）。

## 三条铁律在这一层的样子

| | 在嵌入面意味着什么 |
|---|---|
| **铁律 1**（ref 带命名空间） | 嵌入 URL 里的 ref 走 `parseRef`，裸 ID 400 |
| **铁律 10**（两半共用一个开关） | 准入用的是与浏览器侧**同一个插件 id、同一个开关**。后台关掉一个插件，嵌在别人页面上的那些当场 404 |
| **铁律 11**（下架不能只靠重建） | 下架在**请求期**再判一次。嵌入 URL 散在别人的页面里，重建我们的站碰不到它们一根汗毛 |

下架的判定**排在能力判定之前**。否则被下架的东西会因为「恰好没插件提供这个能力」
报成 `no-provider`，排查时分不清是真下架了还是配置错了。

## 响应头

`resolveEmbed()` 放行时给出必须原样下发的头：

| 头 | 为什么 |
|---|---|
| `Content-Security-Policy` | `frame-ancestors` 白名单，外加 `default-src 'self'`、`form-action 'none'`、`base-uri 'none'` |
| `X-Robots-Tag: noindex, nofollow` | 嵌入面是别人页面里的**一块 UI**，不是一个页面。被索引会与资料页构成重复内容，用户从搜索点进来看到的是一个没有导航的裸组件 |
| `Cache-Tag` | 配置改了要能让边缘缓存失效 |
| `Vary: Origin` | 不同来源拿到的 CSP 不同 |

::: warning 静态导出发不出这些头
`output: 'export'` 产出的是纯静态文件，头得由 EdgeOne 的规则引擎或边缘函数补。
嵌入面**必须**走能发头的那条路径——`frame-ancestors` 发不出去等于白名单没生效。
:::

**嵌入 URL 不进 sitemap。** 路由表能枚举，嵌入 URL 有无穷多个（ref × 参数组合），
而且它们本来就该 noindex。

## postMessage：只有三条消息

跨域 iframe 与父页之间平台只给了这一条通道（铁律 8：平台有的不重造）。
内核里那套 `MessagePort` 桥是**同源** iframe 插件用的，信任模型不同，所以协议单独一份。

| 方向 | 消息 | 用途 |
|---|---|---|
| 子 → 父 | `ready` | 起来了，附带初始高度 |
| 子 → 父 | `resize` | 内容高度变了（跨域拿不到子页高度，只能它自己报） |
| 子 → 父 | `event` | 把能力契约 `emits` 的事件透出去 |

没有「父页调用子页方法」这一半——那需要一套请求/应答与错误模型，
而目前没有任何用例要它。等真有了再加，别先建一条没人走的通道。

::: danger 收消息的一方必须自己校验来源
`isEmbedMessage()` 只判**形状**，判不了**来源**——`event.origin` 不在消息体里。

```ts
window.addEventListener('message', (e) => {
  if (!isAllowedAncestor(policy, e.origin)) return;   // ← 这一步不能省
  if (!isEmbedMessage(e.data)) return;
  // …
});
```

漏掉的后果不是报错：任何页面都能发一条形状合法的 `resize` 把 iframe 撑成
一万像素，或者伪造 `entity.focused` 让宿主跳到别的实体上。

高度另有上限（`MAX_EMBED_HEIGHT`）。一条 `resize: 1e9` 可能来自**我们自己的
bug**，不一定是攻击；设了上限，最坏情况是内容被截断，看得见、查得出。
:::

## MediaWiki 那一侧

`integrations/mediawiki/` 是一个可直接安装的扩展，装完 wiki 编辑者写：

```
<aio-embed capability="sprite.show" ref="a:sprite/100100/d_r" movement="idle" />
```

`LocalSettings.php`：

```php
wfLoadExtension( 'AioEmbed' );
$wgAioEmbedOrigin = 'https://<你的嵌入面来源>';   // 没有默认值
```

设计上的三个选择：

- **parser tag 而不是模板**：wikitext 的 HTML 白名单里没有 `<iframe>`，
  靠 Widgets 那类扩展绕过去等于把「能写任意 HTML」发给了模板编辑者。
  parser tag 把 HTML 的生成留在 PHP 里，编辑者只能填属性值，而每个值都被校验。
- **`$wgAioEmbedOrigin` 没有默认值**：留空则扩展报错而不是猜一个域名。
- **iframe 带 `sandbox` 与 `referrerpolicy="no-referrer"`**：
  不把「读者正在看哪个 wiki 页面」顺手告诉我们的服务器。这是嵌入方该有的默认。

::: tip 两份 ref 校验必须给同样的答案
PHP 那份是**编辑期预检**，不是安全边界（安全边界永远在服务端）。但它必须与
`parseRef` 判得一样：更松则 wiki 上看着合法、嵌进去空白；更严则合法的 ref 被拒。

实测出过一次前者——PHP 的 kind 段写成 `[a-z0-9]+`，`a:nope/1` 和
`a:character/../etc` 都被放过。语料钉在 `packages/embed/test/ref-shape.test.ts`，
**改了 `parseRef` 的判据就得回去改 PHP 那份并重跑对照。**
:::
