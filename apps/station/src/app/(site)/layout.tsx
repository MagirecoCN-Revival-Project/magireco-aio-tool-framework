import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * 站点的可见外壳。**只包站点页面，不包嵌入面**——
 * 嵌入面走 `/embed/*`，不在这个 group 里。
 */
export default function SiteLayout({ children }: { children: ReactNode }): ReactNode {
  return (
    <>
      <header className="topbar">
        <strong>AIO 工作站</strong>
        <nav>
          <Link href="/">资料</Link>
          <Link href="/admin">后台</Link>
        </nav>
      </header>
      <main>{children}</main>
    </>
  );
}
