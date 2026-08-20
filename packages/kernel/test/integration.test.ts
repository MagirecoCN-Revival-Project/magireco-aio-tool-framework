import { describe, expect, it } from 'vitest';
import { formatRef, parseRef, type Intent } from '@aio/core';
import { Kernel, createIframePlugin, createMemoryTransportPair, type BridgeCommand } from '@aio/kernel';
import { createHeadlessSurfaceProvider, definePlugin } from '@aio/plugin-sdk';
import { makeResources, registry } from './fixtures.js';

/**
 * 两个「有机整合」的场景，端到端跑通。
 *
 * 这两个测试是本框架与「放一堆跳转链接」的分界线：模块之间不 import，
 * 不知道对方存在，却能互相调用并回话。
 */

function newKernel() {
  return new Kernel({
    resources: makeResources(),
    registry,
    surfaces: createHeadlessSurfaceProvider(),
  });
}

describe('场景一：看剧情文本时点一下，ADV 实机播放并把进度回传给阅读器', () => {
  it('阅读器发意图 → ADV 挂载 → 进度回流高亮', async () => {
    const kernel = newKernel();

    // ---- ADV 播放器插件：只知道自己会播剧情，不知道谁在看 ----------------
    let emitProgress: ((line: number) => void) | null = null;
    kernel.register(
      definePlugin({
        manifest: {
          id: 'adv-player',
          version: '0.1.0',
          title: 'ADV 播放器',
          isolation: 'inline',
          usesWebGL: true,
          provides: [{ id: 'adv.play', accepts: ['scenario'], title: '实机播放' }],
        },
        async mount(_target, intent, host) {
          const startLine = Number(intent.params?.['line'] ?? 0);
          emitProgress = (line) => {
            host.events.emit('progress', {
              surfaceId: host.surfaceId,
              ref: intent.ref,
              position: line,
              total: 120,
            });
          };
          emitProgress(startLine);
          return { suspend: () => {}, resume: () => {}, dispose: () => { emitProgress = null; } };
        },
      }),
    );

    // ---- 剧情阅读器：不 import ADV，只问「有没有人能播」 ------------------
    const scenario = parseRef('a:scenario/310241@zh');
    const reader = {
      highlighted: -1,
      canPlay(): boolean {
        return kernel.can('adv.play', scenario);
      },
      subscribe() {
        kernel.events.on('progress', (p) => {
          if (formatRef(p.ref) === formatRef(scenario)) this.highlighted = p.position;
        });
      },
      play(line: number) {
        const intent: Intent = {
          capability: 'adv.play',
          ref: scenario,
          params: { line },
          surface: 'sheet',
          source: 'story-reader',
        };
        return kernel.request(intent);
      },
    };
    reader.subscribe();

    // 按钮该不该画：装了 ADV 插件 + 清单里有这篇剧情 → 画
    expect(reader.canPlay()).toBe(true);

    const handle = await reader.play(42);
    expect(handle).not.toBeNull();
    // 起播行号传到了播放器，并顺着 progress 事件回到阅读器
    expect(reader.highlighted).toBe(42);

    // 播放推进，阅读器跟着高亮——**两个模块从未互相引用**
    emitProgress!(43);
    expect(reader.highlighted).toBe(43);

    await handle!.close();
  });

  it('没装 ADV 插件时，阅读器根本不渲染播放按钮（宿主依然自洽）', () => {
    const kernel = newKernel();
    expect(kernel.can('adv.play', parseRef('a:scenario/310241@zh'))).toBe(false);
  });

  it('清单里没有这篇剧情时也不渲染——不让用户点了才发现 404', () => {
    const kernel = newKernel();
    kernel.register(
      definePlugin({
        manifest: {
          id: 'adv-player', version: '0.1.0', title: 'ADV', isolation: 'inline',
          provides: [{ id: 'adv.play', accepts: ['scenario'] }],
        },
        mount: async () => ({ suspend: () => {}, resume: () => {}, dispose: () => {} }),
      }),
    );
    expect(kernel.can('adv.play', parseRef('a:scenario/310241@zh'))).toBe(true);
    expect(kernel.can('adv.play', parseRef('a:scenario/999999@zh'))).toBe(false);
  });
});

describe('场景二：看角色简介时点一下调用精灵显示（精灵跑在 iframe 里）', () => {
  it('档案页经交叉表拿到精灵 ref，发意图，iframe 插件挂载', async () => {
    const kernel = newKernel();

    // ---- 精灵查看器：cocos2d-html5 靠 window.cc 活着，必须独占 realm ----
    const received: BridgeCommand[] = [];
    kernel.register(
      createIframePlugin({
        manifest: {
          id: 'sprite-viewer',
          version: '0.1.0',
          title: '战斗精灵',
          isolation: 'iframe',
          usesWebGL: true,
          provides: [{ id: 'sprite.show', accepts: ['sprite'], title: '显示精灵' }],
        },
        async connect() {
          const [hostSide, frameSide] = createMemoryTransportPair();
          // 模拟子帧：收到命令就回 ok
          frameSide.onMessage((raw) => {
            const cmd = raw as BridgeCommand;
            received.push(cmd);
            frameSide.post({ t: 'ok', id: cmd.id });
          });
          return hostSide;
        },
      }),
    );

    // ---- 角色档案页：不知道精灵在 iframe 里，也不知道它叫什么 ------------
    const chara = parseRef('a:character/1001');
    const profile = {
      spriteRef() {
        return kernel.registry.primaryLink(chara, 'sprite');
      },
      canShowSprite(): boolean {
        const ref = this.spriteRef();
        return ref !== null && kernel.can('sprite.show', ref);
      },
      showSprite() {
        const ref = this.spriteRef();
        if (ref === null) return Promise.resolve(null);
        return kernel.request({ capability: 'sprite.show', ref, surface: 'inline', source: 'codex' });
      },
    };

    expect(profile.canShowSprite()).toBe(true);
    const handle = await profile.showSprite();
    expect(handle).not.toBeNull();

    // 命令确实过了桥，且带的是完整 ref（不是裸数字）
    expect(received[0]).toMatchObject({ t: 'mount', ref: 'a:sprite/100100/d_r', capability: 'sprite.show' });

    await handle!.close();
    expect(received.at(-1)).toMatchObject({ t: 'dispose' });
  });

  it('交叉表里没登记精灵的角色，按钮不画', () => {
    const kernel = newKernel();
    // 1002 登记了精灵，但没有插件 → 不画
    expect(kernel.registry.has(parseRef('a:character/1002'), 'sprite')).toBe(true);
    expect(kernel.can('sprite.show', parseRef('a:sprite/100200/d_r'))).toBe(false);
    // 没登记 3D 的角色 → 连 ref 都取不到
    expect(kernel.registry.primaryLink(parseRef('a:character/1001'), 'model3d')).toBeNull();
  });
});

describe('场景三：插件之间互相发意图（ADV 里点立绘 → 打开角色档案）', () => {
  it('插件通过 host.request 发意图，内核照常派发', async () => {
    const kernel = newKernel();
    const openedProfiles: string[] = [];

    kernel.register(
      definePlugin({
        manifest: {
          id: 'codex', version: '0.1.0', title: '资料', isolation: 'inline',
          provides: [{ id: 'codex.open', accepts: ['character'] }],
        },
        async mount(_t, intent) {
          openedProfiles.push(formatRef(intent.ref));
          return { suspend: () => {}, resume: () => {}, dispose: () => {} };
        },
      }),
    );

    let clickPortrait: (() => Promise<void>) | null = null;
    kernel.register(
      definePlugin({
        manifest: {
          id: 'adv-player', version: '0.1.0', title: 'ADV', isolation: 'inline',
          provides: [{ id: 'adv.play', accepts: ['scenario'] }],
        },
        async mount(_t, _i, host) {
          clickPortrait = async () => {
            // ADV 只知道「屏幕上这张立绘是 a:sprite/100100/d_r」。
            // 谁是它的主人由交叉表反查，谁来显示档案由内核决定。
            const owner = host.registry.ownerOf(parseRef('a:sprite/100100/d_r'));
            if (owner === null || !host.can('codex.open', owner)) return;
            await host.request({ capability: 'codex.open', ref: owner });
          };
          return { suspend: () => {}, resume: () => {}, dispose: () => {} };
        },
      }),
    );

    await kernel.request({ capability: 'adv.play', ref: parseRef('a:scenario/310241@zh') });
    await clickPortrait!();
    expect(openedProfiles).toEqual(['a:character/1001']);
  });
});
