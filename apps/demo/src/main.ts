/**
 * 演示宿主。
 *
 * 这一整页跑的是 packages/ 下的真代码：Kernel、Registry、ManifestCdnProvider、
 * OriginPool、createIframePlugin 全部原样 import，没有替身。
 * 只有三个插件的**内部渲染**是占位的——它们与内核之间的接线是真的。
 */
import { formatRef, parseRef, type ResourceRef, type SurfaceHint } from '@aio/core';
import { Kernel, type SurfaceProvider, type SurfaceTarget } from '@aio/kernel';
import { Registry } from '@aio/registry';
import { Manifest, OriginPool, ManifestCdnProvider } from '@aio/resource';
import { manifests, registryData, script } from './data.js';
import { advPlayer, model3d, spriteViewer } from './plugins.js';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// ── 资源面：两条源，权重照抄客户端 config.json 的形状 ──────────────
const origins = new OriginPool(
  [
    { base: 'https://assets.example/', weight: 80, name: 'EdgeOne 加速' },
    { base: 'https://backup.example/', weight: 10, name: '备用源' },
  ],
  { failuresBeforeCooldown: 2, cooldownMs: 60_000 },
);

const resources = new ManifestCdnProvider({
  origins,
  manifests: manifests.map((m) => Manifest.from(m)),
});
const registry = Registry.from(registryData);

// ── 宿主提供 surface ────────────────────────────────────────────────
const stack = $('stack');
const surfaceProvider: SurfaceProvider = {
  acquire(surfaceId: string, hint: SurfaceHint, pluginId: string): SurfaceTarget | null {
    const card = document.createElement('section');
    card.className = 'surface';
    card.dataset['sid'] = surfaceId;
    const inner = document.createElement('div');
    inner.className = 'surface-inner';
    const bar = document.createElement('div');
    bar.className = 'surface-bar';
    const label = document.createElement('span');
    label.className = 'sid';
    // 标的是**插件与它的隔离级别**，不是 surface 的呈现提示——
    // 后者也叫 inline，读者会当成隔离模式，而那正是这里要讲清楚的事。
    const iso = AVAILABLE.find((p) => p.id === pluginId)?.iso ?? '?';
    label.textContent = `${surfaceId} · ${pluginId} · ${iso}`;
    const focus = document.createElement('button');
    focus.className = 'mini';
    focus.textContent = '聚焦';
    focus.onclick = () => void kernel.touch(surfaceId).then(render);
    const close = document.createElement('button');
    close.className = 'mini';
    close.textContent = '关闭';
    close.onclick = () => void kernel.close(surfaceId).then(render);
    bar.append(label, focus, close);
    card.append(bar, inner);
    stack.append(card);
    $('stack-empty').hidden = true;
    return { surfaceId, container: inner, hint };
  },
  release(surfaceId: string) {
    stack.querySelector(`[data-sid="${surfaceId}"]`)?.remove();
    $('stack-empty').hidden = stack.children.length > 0;
  },
};

// ── 内核 ────────────────────────────────────────────────────────────
const kernel = new Kernel({
  resources,
  registry,
  surfaces: surfaceProvider,
  governor: { maxLiveWebGL: 2 },
  logger: (level, pluginId, msg) => log(level, `${pluginId} — ${msg}`),
});

// ── 日志 ────────────────────────────────────────────────────────────
function log(kind: string, msg: string) {
  const line = document.createElement('div');
  line.className = `log-line log-${kind}`;
  const t = document.createElement('span');
  t.className = 'log-kind';
  t.textContent = kind;
  const m = document.createElement('span');
  m.textContent = msg;
  line.append(t, m);
  const box = $('log');
  box.append(line);
  box.scrollTop = box.scrollHeight;
}

kernel.events.on('surface.opened', (p) =>
  log('intent', `${p.pluginId} 挂载 ${formatRef(p.ref)} → ${p.surfaceId}`));
kernel.events.on('surface.closed', (p) => log('close', `${p.pluginId} 卸载 ${p.surfaceId}`));
kernel.events.on('entity.focused', (p) => {
  const owner = registry.ownerOf(p.ref);
  log('focus', `子帧上报选中 ${formatRef(p.ref)}` +
    (owner ? ` → 反查主人 ${registry.displayName(owner)}` : '（交叉表里查不到主人）'));
});

// 进度回流：ADV 播到第几行，剧本面板就高亮第几行
let highlighted = -1;
kernel.events.on('progress', (p) => {
  if (formatRef(p.ref) !== formatRef(SCENARIO)) return;
  highlighted = p.position;
  paintHighlight();
});

// ── 插件架 ──────────────────────────────────────────────────────────
const AVAILABLE = [
  { id: 'adv-player', make: advPlayer, iso: 'inline', caps: ['adv.play'] },
  { id: 'sprite-viewer', make: spriteViewer, iso: 'iframe', caps: ['sprite.show'] },
  { id: 'model-3d', make: model3d, iso: 'inline', caps: ['model3d.show'] },
] as const;

const installed = new Set<string>(['adv-player', 'sprite-viewer', 'model-3d']);
for (const p of AVAILABLE) kernel.register(p.make());

async function toggle(id: string) {
  if (installed.has(id)) {
    await kernel.unregister(id);
    installed.delete(id);
    log('plugin', `卸载 ${id} —— 依赖它的入口应当立即消失`);
  } else {
    const def = AVAILABLE.find((p) => p.id === id);
    if (!def) return;
    kernel.register(def.make());
    installed.add(id);
    log('plugin', `装上 ${id} —— 入口应当立即出现`);
  }
  render();
}

// 派发助手：`request()` 会改变 surface 与 WebGL 预算，之后必须重渲染，
// 否则界面上的计数与按钮状态是上一次渲染留下的陈旧值。
async function dispatch(intent: Parameters<Kernel['request']>[0]): Promise<void> {
  await kernel.request(intent);
  render();
}

// ── 内容 ────────────────────────────────────────────────────────────
const SCENARIO = parseRef('a:scenario/310241@zh');
const CHARACTERS: readonly ResourceRef[] = [
  parseRef('a:character/1001'),
  parseRef('a:character/1002'),
  parseRef('b:character/100101'),
];
// 角色卡上试哪些能力：能力 → 该从交叉表取哪一类关联
const ACTIONS = [
  { cap: 'sprite.show', kind: 'sprite', label: '显示精灵' },
  { cap: 'model3d.show', kind: 'model3d', label: '查看 3D' },
] as const;

function paintHighlight() {
  for (const n of document.querySelectorAll<HTMLElement>('.line')) {
    n.classList.toggle('on', Number(n.dataset['i']) === highlighted);
  }
}

function render() {
  // 插件架
  const rack = $('rack');
  rack.replaceChildren();
  for (const p of AVAILABLE) {
    const on = installed.has(p.id);
    const card = document.createElement('label');
    card.className = `chip${on ? ' on' : ''}`;
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = on;
    box.onchange = () => void toggle(p.id);
    const name = document.createElement('span');
    name.className = 'chip-name';
    name.textContent = p.id;
    const iso = document.createElement('span');
    iso.className = `iso iso-${p.iso}`;
    iso.textContent = p.iso;
    const caps = document.createElement('code');
    caps.className = 'chip-caps';
    caps.textContent = p.caps.join(' ');
    card.append(box, name, iso, caps);
    rack.append(card);
  }

  // 剧本
  const canPlay = kernel.can('adv.play', SCENARIO);
  $('adv-state').textContent = canPlay
    ? '内核找得到 adv.play 的提供者 → 每行右侧画播放按钮'
    : '没有插件提供 adv.play → 按钮整排消失，阅读器照常可读';
  $('adv-state').className = canPlay ? 'state ok' : 'state off';

  const list = $('script');
  list.replaceChildren();
  script.forEach((l, i) => {
    const row = document.createElement('div');
    row.className = 'line';
    row.dataset['i'] = String(i);
    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = l.speaker;
    const text = document.createElement('span');
    text.className = 'text';
    text.textContent = l.text;
    row.append(who, text);
    if (canPlay) {
      const btn = document.createElement('button');
      btn.className = 'play';
      btn.textContent = '▶ 从这行播';
      btn.onclick = () => {
        void dispatch({
          capability: 'adv.play', ref: SCENARIO,
          params: { line: i }, surface: 'inline', source: 'story-reader',
        });
      };
      row.append(btn);
    }
    list.append(row);
  });
  paintHighlight();

  // 角色
  const cards = $('chars');
  cards.replaceChildren();
  for (const ref of CHARACTERS) {
    const card = document.createElement('div');
    card.className = 'char';
    const head = document.createElement('div');
    head.className = 'char-head';
    const nm = document.createElement('span');
    nm.className = 'char-name';
    nm.textContent = registry.displayName(ref);
    const rf = document.createElement('code');
    rf.className = `ref u-${ref.universe}`;
    rf.textContent = formatRef(ref);
    head.append(nm, rf);
    card.append(head);

    const acts = document.createElement('div');
    acts.className = 'acts';
    let any = false;
    for (const a of ACTIONS) {
      const target = registry.primaryLink(ref, a.kind);
      if (target === null) continue;          // 交叉表没登记 → 不画
      if (!kernel.can(a.cap, target)) continue; // 没插件或清单没有 → 不画
      any = true;
      const b = document.createElement('button');
      b.className = 'act';
      b.textContent = a.label;
      b.onclick = () => {
        void dispatch({ capability: a.cap, ref: target, surface: 'inline', source: 'codex' });
      };
      acts.append(b);
    }
    if (!any) {
      const none = document.createElement('span');
      none.className = 'muted';
      none.textContent = '当前没有可用能力';
      acts.append(none);
    }
    card.append(acts);
    cards.append(card);
  }

  $('webgl').textContent = `${kernel.liveWebGLCount()} / 2`;
  $('webgl').className = kernel.liveWebGLCount() >= 2 ? 'num warn' : 'num';
}

// ── 演示按钮 ────────────────────────────────────────────────────────
$('btn-bare').onclick = () => {
  try {
    parseRef('100101');
    log('bad', '裸 ID 竟然通过了 —— 不该发生');
  } catch (err) {
    log('guard', (err as Error).message);
  }
};

$('btn-collide').onclick = () => {
  const inB = parseRef('b:character/100101');
  const inA = parseRef('a:character/1001');
  log('guard',
    `b:character/100101 = ${registry.displayName(inB)}；` +
    `a:character/1001 = ${registry.displayName(inA)}（精灵 unit 100100）。` +
    '两个命名空间各自连续编号，交集处同号不同实体，所以 ref 必须带命名空间前缀。');
};

$('btn-fail').onclick = () => {
  origins.reportFailure('https://assets.example/');
  origins.reportFailure('https://assets.example/');
  const r = resources.resolve(parseRef('a:sprite/100100/d_r'));
  log('origin',
    `主源连续失败两次进入冷却 → 选路顺序变为 ${r.parts[0]?.candidates.map((c) => c.base).join(' → ')}。` +
    '冷却是跨资源共享的，后续所有资源自动跳过它。');
};

$('btn-missing').onclick = () => {
  const gone = parseRef('a:sprite/999999/d_r');
  log('guard',
    `resources.has(${formatRef(gone)}) = ${resources.has(gone)}。` +
    '清单里没有 → can() 为假 → 按钮根本不画，而不是点了才 404。');
};

render();
log('boot', '内核就绪。三个插件已装上，WebGL 预算 2。');
