import Link from 'next/link';
import type { ReactNode } from 'react';
import { KernelProvider } from '../kernel/KernelProvider';
import './globals.css';

export const metadata = {
  title: 'AIO 工作站',
  description: '命名空间 a复兴计划 · 多合一工具工作站',
};

/**
 * 宿主外壳。
 *
 * `KernelProvider` 包在最外层，所以整站共用**一个**内核实例——
 * WebGL 上下文治理、意图派发、事件总线都需要它是单例；每页一个内核会让
 * 上下文配额各算各的，然后在第 9 个查看器那里静默变黑。
 */
export default function RootLayout({ children }: { children: ReactNode }): ReactNode {
  return (
    <html lang="zh-CN">
      <body>
        <KernelProvider>
          <header className="topbar">
            <strong>AIO 工作站</strong>
            <nav>
              <Link href="/">资料</Link>
              <Link href="/admin">后台</Link>
            </nav>
          </header>
          <main>{children}</main>
        </KernelProvider>
      </body>
    </html>
  );
}
