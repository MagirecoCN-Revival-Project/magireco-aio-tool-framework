import type { ReactNode } from 'react';
import { KernelProvider } from '../kernel/KernelProvider';
import './globals.css';

export const metadata = {
  title: 'AIO 工作站',
  description: 'AIO 多合一工具工作站',
};

/**
 * 根外壳：只有 `<html>`、`<body>` 与内核。
 *
 * 站点的可见外壳（顶栏、`<main>` 的版心）在 `(site)/layout.tsx` 里，
 * 因为**嵌入面不要外壳**——它是别人页面里的一块 UI，套一层顶栏进去
 * 既难看又会把「这是谁家的东西」搞混。
 *
 * `KernelProvider` 留在根层，所以嵌入面与站点共用**同一个**内核实例：
 * WebGL 上下文治理、意图派发、事件总线都要它是单例；每页一个内核会让
 * 上下文配额各算各的，然后在第 9 个查看器那里静默变黑。
 */
export default function RootLayout({ children }: { children: ReactNode }): ReactNode {
  return (
    <html lang="zh-CN">
      <body>
        <KernelProvider>{children}</KernelProvider>
      </body>
    </html>
  );
}
