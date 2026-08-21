import { describe, expect, it } from 'vitest';
import { animationNames, animationOf, GltfParseError, parseGltf } from '../src/gltf.js';

/** 数据全部合成，形状照 glTF 2.0 规范（铁律 9：素材不进这棵树）。 */

const gltf = (over: Record<string, unknown> = {}) => ({
  asset: { version: '2.0', generator: '合成' },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ name: 'root', mesh: 0 }],
  meshes: [{ name: 'body', primitives: [{ attributes: { POSITION: 0 } }] }],
  buffers: [{ uri: 'scene.bin', byteLength: 128 }],
  images: [{ uri: 'textures/base.png' }],
  animations: [
    { name: 'idle', channels: [{ sampler: 0, target: { node: 0, path: 'rotation' } }], samplers: [] },
    { channels: [{ sampler: 0, target: { node: 0, path: 'translation' } }], samplers: [] },
  ],
  ...over,
});

describe('parseGltf', () => {
  it('读出场景、节点、网格与动画', () => {
    const d = parseGltf(gltf());
    expect(d.version).toBe('2.0');
    expect(d.scene).toBe(0);
    expect(d.nodeCount).toBe(1);
    expect(d.meshCount).toBe(1);
    expect(d.animations).toHaveLength(2);
    expect(d.animations[0]).toMatchObject({ name: 'idle', index: 0, channels: 1 });
  });

  it('规范允许动画无名——无名的记成 null，清单里按下标指', () => {
    const d = parseGltf(gltf());
    expect(d.animations[1]?.name).toBeNull();
    expect(animationNames(d)).toEqual(['idle', '#1']);
  });

  it('外部依赖列出来，内嵌 data: 不算外部', () => {
    const d = parseGltf(gltf());
    expect(d.externals).toEqual([
      { kind: 'buffer', index: 0, uri: 'scene.bin' },
      { kind: 'image', index: 0, uri: 'textures/base.png' },
    ]);
    expect(d.embedded).toBe(0);

    // 把内嵌的当外部送进资源层，会得到一次必然失败的取用，
    // 而失败原因看起来像「资源缺失」。
    const embedded = parseGltf(
      gltf({ buffers: [{ uri: 'data:application/octet-stream;base64,AAAA' }] }),
    );
    expect(embedded.externals.map((e) => e.kind)).toEqual(['image']);
    expect(embedded.embedded).toBe(1);
  });

  it('拒绝 glTF 1.x——结构不兼容，按 2.0 去读会读出错的东西而不是报错', () => {
    expect(() => parseGltf(gltf({ asset: { version: '1.0' } }))).toThrow(GltfParseError);
    expect(() => parseGltf(gltf({ asset: { version: '1.0' } }))).toThrow(/只支持 glTF 2\.x/);
  });

  it('认出 GLB 并说清楚，而不是让 JSON.parse 抛个看不懂的语法错', () => {
    expect(() => parseGltf(new ArrayBuffer(12))).toThrow(/GLB/);
    expect(() => parseGltf(new Uint8Array([0x67, 0x6c, 0x54, 0x46]))).toThrow(/GLB/);
  });

  it('没有 channels 的动画直接抛——播了等于没播', () => {
    expect(() => parseGltf(gltf({ animations: [{ name: 'x', channels: [] }] }))).toThrow(
      /没有 channels/,
    );
  });

  it('文件没指定默认场景时为 null，不替它挑一个', () => {
    const d = parseGltf(gltf({ scene: undefined }));
    expect(d.scene).toBeNull();
  });

  it('结构不对一律抛', () => {
    expect(() => parseGltf(null)).toThrow(/不是对象/);
    expect(() => parseGltf({})).toThrow(/asset/);
    expect(() => parseGltf({ asset: {} })).toThrow(/asset\.version/);
    expect(() => parseGltf(gltf({ nodes: 'x' }))).toThrow(/nodes 不是数组/);
  });

  it('缺省的可选数组当空处理——没有动画的模型是合法的', () => {
    const d = parseGltf({ asset: { version: '2.0' } });
    expect(d.animations).toEqual([]);
    expect(d.externals).toEqual([]);
    expect(d.nodeCount).toBe(0);
  });
});

describe('animationOf', () => {
  it('按名字取；查不到返回 null，绝不退回第一条', () => {
    const d = parseGltf(gltf());
    expect(animationOf(d, 'idle')?.index).toBe(0);
    // 退回第一条的话，点「走路」会播「待机」。
    expect(animationOf(d, '不存在')).toBeNull();
  });

  it('无名动画可以用 #下标 显式指到', () => {
    const d = parseGltf(gltf());
    expect(animationOf(d, '#1')?.index).toBe(1);
    expect(animationOf(d, '#9')).toBeNull();
    expect(animationOf(d, '#x')).toBeNull();
  });
});
