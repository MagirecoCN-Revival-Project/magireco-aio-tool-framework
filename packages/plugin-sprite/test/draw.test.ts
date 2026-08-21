import { describe, expect, it } from 'vitest';
import { parseAtlas } from '../src/atlas.js';
import { IDENTITY_AFFINE, multiply, placeFrame, toScreen } from '../src/draw.js';
import { matrixOf } from '../src/pose.js';

/** 摆放算术，没有一行 DOM——所以「贴图摆在哪」能在 node 上逐条验。 */

const atlas = (frame: string, extra = ''): ReturnType<typeof parseAtlas> =>
  parseAtlas(
    `<?xml version="1.0"?><plist version="1.0"><dict>` +
      `<key>frames</key><dict><key>p.png</key><dict>` +
      `<key>frame</key><string>${frame}</string>` +
      `<key>offset</key><string>{0,0}</string>` +
      `<key>sourceSize</key><string>{100,100}</string>${extra}` +
      `</dict></dict>` +
      `<key>metadata</key><dict><key>format</key><integer>2</integer>` +
      `<key>textureFileName</key><string>t.png</string></dict>` +
      `</dict></plist>`,
  );

const apply = (m: ReturnType<typeof toScreen>, x: number, y: number) => ({
  x: m.a * x + m.c * y + m.tx,
  y: m.b * x + m.d * y + m.ty,
});

describe('multiply', () => {
  it('单位元不改变任何矩阵', () => {
    const m = { a: 2, b: 3, c: 4, d: 5, tx: 6, ty: 7 };
    expect(multiply(m, IDENTITY_AFFINE)).toEqual(m);
    expect(multiply(IDENTITY_AFFINE, m)).toEqual(m);
  });

  it('是「先 n 后 m」的顺序', () => {
    const scale2 = { a: 2, b: 0, c: 0, d: 2, tx: 0, ty: 0 };
    const move = { a: 1, b: 0, c: 0, d: 1, tx: 10, ty: 0 };
    // 先平移再放大 → 平移量也被放大。
    expect(multiply(scale2, move).tx).toBe(20);
    // 先放大再平移 → 平移量不受影响。
    expect(multiply(move, scale2).tx).toBe(10);
  });
});

describe('toScreen', () => {
  const screen = toScreen(matrixOf({ x: 0, y: 0, scaleX: 1, scaleY: 1, skewX: 0, skewY: 0 }), 160, 160);

  it('原点落在画面中心', () => {
    expect(apply(screen, 0, 0)).toEqual({ x: 160, y: 160 });
  });

  it('局部 y 向下——与 drawImage 同一个口径，否则每张贴图都是倒的', () => {
    expect(apply(screen, 0, 10).y).toBe(170);
  });

  it('导出数据的 +y 是画面的上方', () => {
    // 只翻平移不翻线性部分（早先那种写法）在方块上看不出来，画贴图就会发现
    // 旋转方向反了。这里验的是整条链：pose.y 为正 → 屏幕 y 变小。
    const up = toScreen(matrixOf({ x: 0, y: 50, scaleX: 1, scaleY: 1, skewX: 0, skewY: 0 }), 160, 160);
    expect(apply(up, 0, 0)).toEqual({ x: 160, y: 110 });
  });

  it('骨骼旋转在屏幕上是同一个方向的旋转（行列式为正，没被镜像）', () => {
    const m = toScreen(matrixOf({ x: 0, y: 0, scaleX: 1, scaleY: 1, skewX: 0.5, skewY: 0.5 }), 0, 0);
    expect(m.a * m.d - m.b * m.c).toBeCloseTo(1, 10);
  });
});

describe('placeFrame', () => {
  it('目的矩形以骨骼原点为中心', () => {
    const p = placeFrame(atlas('{{8,16},{40,60}}').frame('p.png')!)!;
    expect(p).toMatchObject({ sx: 8, sy: 16, sw: 40, sh: 60, dx: -20, dy: -30, dw: 40, dh: 60 });
  });

  it('offset 把裁掉的透明边挪回来，且 y 取反（cocos 的 offset 是 y 向上的）', () => {
    const a = parseAtlas(
      `<plist version="1.0"><dict><key>frames</key><dict><key>p.png</key><dict>` +
        `<key>frame</key><string>{{0,0},{10,10}}</string>` +
        `<key>offset</key><string>{3,4}</string>` +
        `<key>sourceSize</key><string>{20,20}</string></dict></dict>` +
        `<key>metadata</key><dict><key>format</key><integer>2</integer>` +
        `<key>textureFileName</key><string>t.png</string></dict></dict></plist>`,
    );
    // 不挪的话，裁过的图会整体往一边缩，看起来像骨骼位置错了。
    expect(placeFrame(a.frame('p.png')!)!.matrix).toMatchObject({ tx: 3, ty: -4 });
  });

  it('rotated 的帧返回 null——不猜转的是哪个方向', () => {
    // 两个方向都会画出一张「看着像那么回事」的图，错的那个是上下颠倒或镜像的
    // 零件，而且不报错。手上没有真实图集可对，所以宁可说自己不会摆。
    const rotated = atlas('{{0,0},{40,60}}', '<key>rotated</key><true/>');
    expect(placeFrame(rotated.frame('p.png')!)).toBeNull();
  });
});
