'use client';

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { usePluginVersion, useStation } from '../../../kernel/KernelProvider';
import { LocalCmsStore } from '../../../cms/store';
import type { ContentPage, ManifestStatus, Member, Role } from '../../../cms/store';
import { DEMO_REGISTRY } from '../../../station/data';

/**
 * CMS 后台。四块，对应定下的范围：
 *
 *   1. 插件与能力开关   ← 真的能用，装卸立刻改变前台
 *   2. 交叉表与资源清单 ← 只读展示，Phase 4 接人工核对界面
 *   3. 站点内容页       ← 内存实现，Phase 5 接边缘函数 + KV
 *   4. 用户与权限       ← 同上
 *
 * 2/3/4 现在都**没有持久化**，刷新即失忆。这是有意的：没有后端就不该假装
 * 保存住了，否则维护者会以为改动生效了。
 */

const store = new LocalCmsStore({
  pages: [
    { slug: 'about', title: '关于本站', body: '', updated: '2026-08-20', draft: false },
    { slug: 'changelog', title: '更新日志', body: '', updated: '2026-08-20', draft: true },
  ],
  members: [
    { id: 'u1', name: '维护者', role: 'maintainer' },
    { id: 'u2', name: '校对志愿者', role: 'editor' },
  ],
  registry: DEMO_REGISTRY,
  manifests: [
    { universe: 'a', kind: 'sprite', entries: 1, pendingTakedown: [] },
    { universe: 'a', kind: 'scenario', entries: 1, pendingTakedown: [] },
    { universe: 'b', kind: 'model3d', entries: 1, pendingTakedown: [] },
  ],
});

export default function AdminPage(): ReactNode {
  const station = useStation();
  usePluginVersion();

  const [pages, setPages] = useState<readonly ContentPage[]>([]);
  const [members, setMembers] = useState<readonly Member[]>([]);
  const [manifests, setManifests] = useState<readonly ManifestStatus[]>([]);

  useEffect(() => {
    void store.listPages().then(setPages);
    void store.listMembers().then(setMembers);
    void store.manifestStatus().then(setManifests);
  }, []);

  const setRole = (id: string, role: Role): void => {
    void store.setRole(id, role).then(() => store.listMembers()).then(setMembers);
  };

  return (
    <>
      <h1>后台</h1>

      <section className="card">
        <h2>插件与能力开关</h2>
        <p className="muted">
          关掉一个插件，它开着的 surface 会先被关闭，能力随即从 <code>can()</code> 里消失。
          前台对应入口不是置灰，是不再渲染。
        </p>
        <ul className="plugins">
          {station.catalog.map((entry) => (
            <li key={entry.id}>
              <label>
                <input
                  type="checkbox"
                  checked={station.isEnabled(entry.id)}
                  onChange={() => {
                    void station.toggle(entry.id);
                  }}
                />
                <strong>{entry.title}</strong> <code>{entry.id}</code>
              </label>
              <p className="note">{entry.note}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>交叉表</h2>
        <p className="muted">
          只读。查不到就是查不到——<strong>绝不按编号规律猜</strong>，猜错的代价是
          显示了另一个角色而没人会立刻发现。Phase 4 接人工核对界面。
        </p>
        <table>
          <thead>
            <tr><th>ref</th><th>名称</th><th>关联</th></tr>
          </thead>
          <tbody>
            {DEMO_REGISTRY.entities.map((e) => (
              <tr key={e.ref}>
                <td><code>{e.ref}</code></td>
                <td>{e.nameZh ?? '—'}</td>
                <td>
                  {Object.entries(e.links).map(([kind, refs]) => (
                    <div key={kind}>
                      {kind}: {(refs ?? []).join('、')}
                    </div>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2>资源清单</h2>
        <p className="muted">
          下架 = 从清单里去掉条目，前端降级提示而不是白屏。素材本身在资源面，
          <strong>永远不在这个仓库里</strong>（铁律 9）。
        </p>
        <table>
          <thead>
            <tr><th>universe</th><th>kind</th><th>条目</th><th>待下架</th></tr>
          </thead>
          <tbody>
            {manifests.map((m) => (
              <tr key={`${m.universe}:${m.kind}`}>
                <td>{m.universe}</td><td>{m.kind}</td><td>{m.entries}</td>
                <td>{m.pendingTakedown.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2>站点内容页</h2>
        <p className="muted">内存实现，刷新即失忆。Phase 5 接边缘函数 + KV。</p>
        <ul>
          {pages.map((p) => (
            <li key={p.slug}>
              <code>/{p.slug}</code> — {p.title} {p.draft && <span className="pill">草稿</span>}
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>用户与权限</h2>
        <p className="muted">同上，未持久化。鉴权后台本身按 noindex 处理（Phase 5.3）。</p>
        <ul>
          {members.map((m) => (
            <li key={m.id}>
              {m.name}{' '}
              <select
                value={m.role}
                onChange={(ev) => setRole(m.id, ev.target.value as Role)}
              >
                <option value="maintainer">维护者</option>
                <option value="editor">编辑</option>
                <option value="viewer">只读</option>
              </select>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
