import type { ReactNode } from 'react';
import { CONTRACTS } from '@aio/capability';
import { EmbedClient } from '../EmbedClient';

/**
 * 嵌入面：`/embed/<能力 id>?ref=…`
 *
 * ## 为什么是「每个能力一个静态页」而不是一条动态路由
 *
 * 站点走 `output: 'export'`，产物是纯静态文件。能力是**有限的**（契约表里
 * 就那几条），所以每个能力烘一个页出来正好；而 `ref` 与参数在 query 里，
 * query 不参与静态产物的路径，由客户端读——这也正确：同一个能力页服务
 * 无穷多个 ref，本来就不该为每个 ref 烘一个文件。
 *
 * ## 🔴 这一层不是准入判定
 *
 * 静态页发不出 404，也发不出 CSP。**真正的准入在边缘**
 * （`functions/embed/[capability].js` 调 `resolveEmbed()`）：
 * 下架、插件开关、`frame-ancestors` 都在那里。
 *
 * 这里的客户端再判一次是为了两件事：
 *
 * 1. 本地开发与预览没有边缘函数，得有个东西告诉你为什么是空的；
 * 2. 纵深防御——边缘配错时至少不会渲染出内容。
 *
 * 但**别把它当成安全边界**。边缘那份漏了，这份拦不住一个直接读 HTML 的人。
 */
export function generateStaticParams(): Array<{ capability: string }> {
  // 枚举**契约表里的全部能力**，而不是本部署装了的那几个。
  // 少烘一个的话，装了对应插件的部署会 404 在一条本该存在的路径上；
  // 多烘的那几个由客户端报 no-provider，这是准确的答案。
  return CONTRACTS.map((c) => ({ capability: c.id }));
}

export const dynamicParams = false;

export default async function EmbedPage({
  params,
}: {
  params: Promise<{ capability: string }>;
}): Promise<ReactNode> {
  const { capability } = await params;
  return <EmbedClient capability={capability} />;
}
