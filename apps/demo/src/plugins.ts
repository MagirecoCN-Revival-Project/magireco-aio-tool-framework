/**
 * 演示用的三个插件。
 *
 * 它们的**内部**是占位的（不真的渲染 Live2D 或 three.js 场景），但它们与内核
 * 之间的一切——manifest、能力声明、生命周期、事件、iframe RPC——都是真的，
 * 走的是 packages/kernel 的同一份代码。
 *
 * 换句话说：把 mount 里的占位内容换成真正的查看器，这三个插件就是成品。
 * 见 docs/VIEWER-REFACTOR.md。
 */
import { formatRef, type Intent } from '@aio/core';
import { createIframePlugin, type Plugin, type PluginInstance } from '@aio/kernel';

function el(tag: string, cls?: string, text?: string): HTMLElement {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function panel(container: HTMLElement, title: string, sub: string): HTMLElement {
  container.replaceChildren();
  const head = el('div', 'sf-head');
  head.append(el('span', 'sf-title', title), el('code', 'ref', sub));
  const body = el('div', 'sf-body');
  container.append(head, body);
  return body;
}

// ── ADV 播放器（inline：Pixi 一类的 ESM 运行时可同 realm）────────────

export function advPlayer(): Plugin {
  return {
    manifest: {
      id: 'adv-player',
      version: '0.1.0',
      title: 'ADV 播放器',
      isolation: 'inline',
      usesWebGL: true,
      provides: [{ id: 'adv.play', accepts: ['scenario'], title: '实机播放' }],
    },
    async mount(target, intent, host) {
      const root = target.container as HTMLElement;
      const body = panel(root, 'ADV 播放器', formatRef(intent.ref));
      const stage = el('div', 'adv-stage');
      const caption = el('p', 'adv-caption', '准备中…');
      const meter = el('div', 'meter');
      const fill = el('i');
      meter.append(fill);
      body.append(stage, caption, meter);

      // 资源解析是真的：走 ResourceClient → 清单 → 多源选路
      let total = 8;
      try {
        const resolved = host.resources.resolve(intent.ref);
        const part = resolved.parts[0];
        if (part) {
          body.append(
            el('p', 'note', `脚本取自 ${part.candidates[0]?.url ?? '(无可用源)'}`),
          );
        }
      } catch (err) {
        host.log('warn', String(err));
      }

      let line = Number(intent.params?.['line'] ?? 0);
      let timer: number | undefined;
      let paused = false;

      const tick = () => {
        caption.textContent = `第 ${line + 1} 行`;
        fill.style.width = `${((line + 1) / total) * 100}%`;
        host.events.emit('progress', {
          surfaceId: host.surfaceId,
          ref: intent.ref,
          position: line,
          total,
        });
        line = (line + 1) % total;
      };

      const start = () => {
        if (timer !== undefined || paused) return;
        tick();
        timer = window.setInterval(tick, 1400);
      };
      const stop = () => {
        if (timer !== undefined) window.clearInterval(timer);
        timer = undefined;
      };
      start();

      const inst: PluginInstance = {
        suspend: () => {
          paused = true;
          stop();
          stage.classList.add('suspended');
          caption.textContent = '已挂起（WebGL 上下文让给了更近使用的 surface）';
        },
        resume: () => {
          paused = false;
          stage.classList.remove('suspended');
          start();
        },
        dispose: () => {
          stop();
          root.replaceChildren();
        },
        update: (next: Intent) => {
          line = Number(next.params?.['line'] ?? 0);
          total = 8;
          stop();
          paused = false;
          stage.classList.remove('suspended');
          start();
        },
      };
      return inst;
    },
  };
}

// ── 3D 模型（inline：three.js 是 ESM，不污染全局）─────────────────────

export function model3d(): Plugin {
  return {
    manifest: {
      id: 'model-3d',
      version: '0.1.0',
      title: '3D 模型',
      isolation: 'inline',
      usesWebGL: true,
      provides: [{ id: 'model3d.show', accepts: ['model3d', 'character'], title: '查看 3D 模型' }],
    },
    async mount(target, intent, host) {
      const root = target.container as HTMLElement;
      const body = panel(root, '3D 模型', formatRef(intent.ref));
      const stage = el('div', 'model-stage');
      stage.append(el('span', 'glyph', '◳'));
      body.append(stage);

      // 展示资源层真正解出来的候选，含预压缩标记
      try {
        const r = host.resources.resolve(intent.ref);
        const list = el('ul', 'parts');
        for (const p of r.parts) {
          const li = el('li');
          li.append(el('code', 'role', p.role));
          li.append(el('span', 'muted', p.candidates[0]?.url ?? ''));
          if (p.encoding === 'gzip') li.append(el('span', 'tag', 'gzip'));
          list.append(li);
        }
        body.append(list);
      } catch (err) {
        body.append(el('p', 'bad', String(err)));
      }

      return {
        suspend: () => stage.classList.add('suspended'),
        resume: () => stage.classList.remove('suspended'),
        dispose: () => root.replaceChildren(),
      };
    },
  };
}

// ── 精灵查看器（iframe：cocos2d-html5 靠 window.cc 活着）───────────────

/** 子帧里跑的东西。真实场景里这里是 cocos2d-html5 与 4,025 组精灵。 */
const FRAME_SRCDOC = `<!doctype html><meta charset="utf-8"><style>
 html,body{margin:0;height:100%;font:13px/1.5 ui-monospace,monospace;
   background:#0f0e14;color:#d8d4e4;display:grid;place-items:center;text-align:center}
 .wrap{padding:14px}
 .id{font-size:26px;letter-spacing:.04em;color:#e0a84a}
 .lbl{opacity:.55;font-size:11px;letter-spacing:.14em;text-transform:uppercase}
 .glob{margin-top:10px;font-size:11px;opacity:.7}
 .suspended{opacity:.3}
</style><div class="wrap" id="w">
 <div class="lbl">隔离 realm · iframe</div>
 <div class="id" id="u">—</div>
 <div class="glob" id="g"></div>
</div><script>
 // 模拟一个靠全局变量活着的老库（cocos2d-html5 的 window.cc）
 window.cc = { name: 'cocos2d-html5', version: '3.x' };
 var w = document.getElementById('w');
 document.getElementById('g').textContent =
   'window.cc = ' + window.cc.name + '（父页面里没有它）';
 function reply(port, id, ok, msg){ port.postMessage(ok?{t:'ok',id:id}:{t:'err',id:id,message:msg}); }
 window.addEventListener('message', function (ev) {
   var port = ev.ports && ev.ports[0];
   if (!port) return;
   port.onmessage = function (e) {
     var c = e.data || {};
     try {
       if (c.t === 'mount' || c.t === 'update') {
         var seg = String(c.ref).split('/')[1] || '?';
         document.getElementById('u').textContent = seg;
         w.classList.remove('suspended');
         // 主动上报：用户在子帧里点了这个精灵
         setTimeout(function(){ port.postMessage({ t: 'focus', ref: c.ref }); }, 400);
       } else if (c.t === 'suspend') { w.classList.add('suspended'); }
       else if (c.t === 'resume')  { w.classList.remove('suspended'); }
       reply(port, c.id, true);
     } catch (err) { reply(port, c.id, false, String(err)); }
   };
   port.start && port.start();
 });
<\/script>`;

export function spriteViewer(): Plugin {
  return createIframePlugin({
    manifest: {
      id: 'sprite-viewer',
      version: '0.1.0',
      title: '战斗精灵',
      isolation: 'iframe',
      usesWebGL: true,
      provides: [{ id: 'sprite.show', accepts: ['sprite', 'character'], title: '显示精灵' }],
    },
    timeoutMs: 8000,
    async connect(target) {
      const root = target.container as HTMLElement;
      const body = panel(root, '战斗精灵', '独立 realm');
      const frame = document.createElement('iframe');
      frame.className = 'frame';
      frame.setAttribute('sandbox', 'allow-scripts');
      frame.srcdoc = FRAME_SRCDOC;
      body.append(frame);

      await new Promise<void>((res) => {
        frame.addEventListener('load', () => res(), { once: true });
      });

      const channel = new MessageChannel();
      frame.contentWindow?.postMessage('init', '*', [channel.port2]);
      channel.port1.start();

      return {
        post: (m) => channel.port1.postMessage(m),
        onMessage: (h) => {
          const fn = (ev: MessageEvent) => h(ev.data);
          channel.port1.addEventListener('message', fn);
          return () => channel.port1.removeEventListener('message', fn);
        },
      };
    },
  });
}
