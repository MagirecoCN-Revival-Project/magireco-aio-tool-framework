---
layout: home

hero:
  name: AIO 工具框架
  text: 把散落在 10 个仓库里的能力缝成一套系统
  tagline: 模块之间不互相 import、不知道对方存在，却能互相调用并回话。少装一个模块，宿主依然自洽，只是少一项能力。
  actions:
    - theme: brand
      text: 这是什么
      link: /guide/
    - theme: alt
      text: 装上并跑起来
      link: /guide/getting-started
    - theme: alt
      text: GitHub
      link: https://github.com/MagirecoCN-Revival-Project/magireco-aio-tool-framework

features:
  - title: 六个能力，全部有自有实现
    details: model3d.show / sprite.show / live2d.show / adv.play / search.query / chart.height。每一个都是从零写的，不碰任何上游代码——上游若愿意接，它是同一契约的又一个实现。
    link: /guide/capabilities
  - title: 换一个实现，宿主零改动
    details: 一致性套件不 import 任何具体实现，只有契约、内核与接口。所以这句话是能被验证的事，而不是靠读代码相信。
    link: /guide/contracts
  - title: 资源与代码分离
    details: 插件只说「给我这条 ref 的 texture」。清单查表、按权重选路、失败冷却、sha256 校验、下架降级全在资源层里。网站源码里 grep 不到任何资源路径。
    link: /guide/resources
  - title: 插件有两半，共用一个开关
    details: 浏览器半边管交互，边缘半边管路由与 SEO——2400 多个页面若只在浏览器里渲染，百度看到的是空壳。两半由同一个插件 id 绑定，后台一个开关同时管住。
    link: /guide/edge
  - title: 老运行时关进 iframe，调用方不知道
    details: cocos2d 挂 window.cc，Cubism 挂 window.Live2DCubismCore，同 realm 会互相覆盖。框架把 realm 隔离藏进内核，写法与调用 inline 插件一模一样。
    link: /guide/kernel
  - title: 判据写成守卫，不靠自觉
    details: 发布禁令、资源前缀冲突、版权素材入库、能力表对账、提交信息——守卫自带坏样本自测，跑在 CI 里，不依赖任何本地配置。
    link: /guide/guards
  - title: 决定都带证据
    details: 命名空间 b 的 100101 是角色乙，命名空间 a的 100100 是角色甲——同号不同人。所以 parseRef('100101') 直接抛错。每条铁律背后都有一次实测。
    link: /AIO-ARCHITECTURE
---

## 三十秒版本

```bash
git clone https://github.com/MagirecoCN-Revival-Project/magireco-aio-tool-framework
cd magireco-aio-tool-framework
npm install
npm run check                       # typecheck + 407 个测试 + 守卫
npm run -w @aio/station dev    # 带插件的 CMS 宿主，:3000
```

打开 `/`，点角色档案上的按钮：精灵在 canvas 上动起来、剧情逐行推进并把行号回传、
身高图把没登记身高的那个列出来而不是画成 0。去 `/admin` 拔掉一个插件，
对应的按钮当场消失，其余功能一点没受影响——**那条判据就是这么验的。**

## 它不是什么

不是把几个网站放进一个域名，也不是一堆适配器把上游的形状原样透出来。
判据是可证伪的：`packages/conformance` 里的套件不 import 任何具体实现，
任何实现装进去都必须全绿。三个实现同时过 `model3d.show` 那一套，就是这个意思。

## 🔴 这里没有游戏素材

本仓库以 GPLv3 公开分发，而立绘、语音、BGM、模型、剧情文本的版权在
各自的版权方手里——我们没有任何权利去授予。所以**一个版权文件
都不进这棵树**，`tools/check-assets.py` 与 `pre-push` 钩子会拦。
素材的去处是资源面，经清单按 ref 取用。详见[守卫与铁律](/guide/guards)。
