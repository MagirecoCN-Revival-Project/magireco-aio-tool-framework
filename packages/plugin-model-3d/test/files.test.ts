import { describe, expect, it } from 'vitest';
import { parseRef } from '@aio/core';
import { Manifest, OriginPool, ResourceClient } from '@aio/resource';
import type { ManifestDoc } from '@aio/resource';
import { buildFiles, Model3dFilesError } from '../src/files.js';

function client(entries: ManifestDoc['entries']): ResourceClient {
  return new ResourceClient({
    origins: new OriginPool([{ base: 'https://assets.example.com/', weight: 1 }]),
    manifests: [Manifest.from({ version: 1, universe: 'b', kind: 'model3d', entries })],
  });
}

const REF = parseRef('b:model3d/100101');

describe('buildFiles', () => {
  it('把清单变成上游要的 路径→URL 表，并抠出角色号', () => {
    const c = client({
      'b:model3d/100101': {
        parts: [
          { path: '3d/chara_100101/model.fbx.gz', role: 'model', encoding: 'gzip' },
          { path: '3d/chara_100101/acc_ctrl.png', role: 'texture' },
        ],
      },
    });

    const built = buildFiles(c, REF);

    expect(built.characterId).toBe('100101');
    expect(built.files['3d/chara_100101/model.fbx.gz']).toBe(
      'https://assets.example.com/3d/chara_100101/model.fbx.gz',
    );
    // 插件交给上游的是普通 URL——多源回退留在资源层，上游不知道有几条线（铁律 3）。
    expect(Object.keys(built.files)).toHaveLength(2);
  });

  it('清单里没有 .fbx 时给出可读报错，而不是让上游抛 TypeError', () => {
    const c = client({
      'b:model3d/100101': { parts: [{ path: '3d/chara_100101/acc_ctrl.png', role: 'texture' }] },
    });
    expect(() => buildFiles(c, REF)).toThrow(Model3dFilesError);
    expect(() => buildFiles(c, REF)).toThrow(/没有 \.fbx/);
  });

  it('路径不含 chara_<数字>/ 时提前拦下——上游那里是个非空断言', () => {
    const c = client({
      'b:model3d/100101': { parts: [{ path: '3d/100101/model.fbx', role: 'model' }] },
    });
    expect(() => buildFiles(c, REF)).toThrow(/chara_<数字>\//);
  });

  it('清单里的角色号与 ref 对不上时拒绝——宁可打不开也不显示另一个角色', () => {
    const c = client({
      'b:model3d/100101': {
        parts: [{ path: '3d/chara_100107/model.fbx', role: 'model' }],
      },
    });
    // 这不是假想：命名空间 b 的 100101 对应的资源名实测是 chara_100107_battle_unit，
    // ID 与资源号根本不是一回事（AIO-ARCHITECTURE.md §二）。所以这条必须硬拦。
    expect(() => buildFiles(c, REF)).toThrow(/号对不上/);
  });

  it('清单里没有这条 ref 时按资源不可用报错', () => {
    const c = client({});
    expect(() => buildFiles(c, REF)).toThrow();
  });
});
