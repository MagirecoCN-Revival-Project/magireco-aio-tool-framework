# magireco-aio-tool-framework

**AIO 工作站的控制面。**

这个仓库不装业务代码，也不装资源。它装的是：把散在 10 个仓库里的东西，
缝成一个域名下的工作站，所需要的**契约、策略、守卫与编排**。

交付平台以 **EdgeOne Maker / Pages** 为主，资产走 **COS + EdgeOne CDN**。

## 为什么不是 monorepo

三条各自独立、任何一条都足以否掉合并的理由：

1. **许可证互斥。** `example-client` 是 GPLv3 + 附加条款；
   `example-reader` 明确写着"No open-source license is granted"；
   `example-sprite-mirror` / `example-live2d-viewer` 里是游戏原始素材，归版权方。
   把它们 vendor 进同一棵树，本仓库的 GPLv3 当场自相矛盾。
2. **发布禁令是既有硬约束。** `example-restricted-data` 用 `repository-policy.json` +
   CI 明令禁止接入任何公开托管；`example-user-archive` 是 190 名真实玩家的流量归档。
   这两个仓库**不进入本工作站的任何公开面**。
3. **平台限额在物理上不允许。** EdgeOne Pages 单项目 5 GiB / 20,000 文件 /
   单文件 25 MiB。`example-live2d-viewer` 的 48,964 张图是文件数上限的 2.4 倍，
   `example-reader` 的 47,886 个文件同理。

所以本工作站的原则是 **不合并仓库，只合并入口**：上游各自保持主权，
AIO 只消费它们**已发布的产物**，并按一份人写死的契约表把它们挂到统一路由上。

## 目录

```
docs/AIO-ARCHITECTURE.md    架构：三个平面、项目拆分、路由与资产面
docs/AIO-ROADMAP.md         落地方案：六个阶段、验收判据、工作量
docs/CONSTRAINTS.md         硬约束登记：发布禁令、许可义务、平台限额
docs/reports/               上游仓库盘点报告
contracts/                  上游接线契约（每仓库一份）+ Schema
repository-policy.json      公开面策略：谁允许上公开站，谁禁止
tools/check-sources.py      守卫：契约自洽、禁令不被绕过、预算不超限
```

## 守卫

```bash
python3 tools/check-sources.py
```

契约不合 schema、禁发仓库被挂了路由、两个源抢同一个挂载点、Pages 项目预算
超过平台限额——四种情况都红灯。**这套东西的目的就是最后两条**：撞限额是这个
架构最可能翻车的地方，而它翻车的时候不报错，只是部署到一半失败。

## 许可

本仓库自身按 **GPLv3** 授权（见 `LICENSE`）。上游各仓库的许可各归各的，
逐条登记在 `docs/CONSTRAINTS.md`。
