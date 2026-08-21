import { describe, expect, it } from 'vitest';
import { AtlasParseError, parseAtlas, regionInAtlas } from '../src/atlas.js';

/**
 * 图集全部是**当场写的**，不是游戏素材（铁律 9）。
 * 四种 format 的键名各不相同，这里逐档验一遍——按错的 format 读出来的不是
 * 报错，是一整套错矩形。
 */

const plist = (body: string): string =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n<dict>${body}</dict>\n</plist>`;

const meta = (format: number, extra = ''): string =>
  `<key>metadata</key><dict>` +
  `<key>format</key><integer>${format}</integer>` +
  `<key>realTextureFileName</key><string>mini_000000.png</string>` +
  `<key>size</key><string>{512,512}</string>${extra}</dict>`;

describe('parseAtlas', () => {
  it('format 2：frame / offset / sourceSize / rotated', () => {
    const atlas = parseAtlas(
      plist(
        `<key>frames</key><dict><key>part_a.png</key><dict>` +
          `<key>frame</key><string>{{128,64},{48,72}}</string>` +
          `<key>offset</key><string>{-2,3}</string>` +
          `<key>rotated</key><true/>` +
          `<key>sourceColorRect</key><string>{{0,0},{48,72}}</string>` +
          `<key>sourceSize</key><string>{64,80}</string>` +
          `</dict></dict>` + meta(2),
      ),
    );
    expect(atlas.texture).toBe('mini_000000.png');
    expect(atlas.size).toEqual({ width: 512, height: 512 });
    expect(atlas.format).toBe(2);
    expect(atlas.frame('part_a.png')).toEqual({
      name: 'part_a.png',
      x: 128,
      y: 64,
      width: 48,
      height: 72,
      rotated: true,
      offsetX: -2,
      offsetY: 3,
      sourceWidth: 64,
      sourceHeight: 80,
    });
  });

  it('旋转过的帧：显示尺寸与大图占位是两个口径', () => {
    const atlas = parseAtlas(
      plist(
        `<key>frames</key><dict>` +
          `<key>a.png</key><dict>` +
          `<key>frame</key><string>{{0,0},{48,72}}</string>` +
          `<key>offset</key><string>{0,0}</string><key>rotated</key><true/>` +
          `<key>sourceSize</key><string>{48,72}</string></dict>` +
          `<key>b.png</key><dict>` +
          `<key>frame</key><string>{{0,0},{48,72}}</string>` +
          `<key>offset</key><string>{0,0}</string><key>rotated</key><false/>` +
          `<key>sourceSize</key><string>{48,72}</string></dict>` +
          `</dict>` + meta(2),
      ),
    );
    const rotated = atlas.frame('a.png');
    const plain = atlas.frame('b.png');
    // 显示尺寸两者相同……
    expect([rotated?.width, rotated?.height]).toEqual([plain?.width, plain?.height]);
    // ……但大图里占的区域宽高是调过来的。照 frame 的宽高裁会裁到隔壁的图。
    expect(regionInAtlas(rotated!)).toEqual({ x: 0, y: 0, width: 72, height: 48 });
    expect(regionInAtlas(plain!)).toEqual({ x: 0, y: 0, width: 48, height: 72 });
  });

  it('format 1：没有 rotated 这回事，写了也不认', () => {
    const atlas = parseAtlas(
      plist(
        `<key>frames</key><dict><key>a.png</key><dict>` +
          `<key>frame</key><string>{{1,2},{3,4}}</string>` +
          `<key>offset</key><string>{0,0}</string>` +
          `<key>rotated</key><true/>` +
          `<key>sourceSize</key><string>{3,4}</string>` +
          `</dict></dict>` + meta(1),
      ),
    );
    expect(atlas.frame('a.png')?.rotated).toBe(false);
  });

  it('format 0：一个数字一个 key，原尺寸取绝对值', () => {
    const atlas = parseAtlas(
      plist(
        `<key>frames</key><dict><key>a.png</key><dict>` +
          `<key>x</key><integer>10</integer><key>y</key><integer>20</integer>` +
          `<key>width</key><integer>30</integer><key>height</key><integer>40</integer>` +
          `<key>offsetX</key><real>0.5</real><key>offsetY</key><real>-0.5</real>` +
          `<key>originalWidth</key><integer>-30</integer>` +
          `<key>originalHeight</key><integer>-40</integer>` +
          `</dict></dict>` + meta(0),
      ),
    );
    expect(atlas.frame('a.png')).toEqual({
      name: 'a.png',
      x: 10,
      y: 20,
      width: 30,
      height: 40,
      rotated: false,
      offsetX: 0.5,
      offsetY: -0.5,
      sourceWidth: 30,
      sourceHeight: 40,
    });
  });

  it('format 3：矩形原点来自 textureRect，显示尺寸来自 spriteSize', () => {
    const atlas = parseAtlas(
      plist(
        `<key>frames</key><dict><key>a.png</key><dict>` +
          // textureRect 的宽高是大图里的占位（已旋转），显示尺寸另放在 spriteSize。
          `<key>textureRect</key><string>{{7,9},{72,48}}</string>` +
          `<key>textureRotated</key><true/>` +
          `<key>spriteSize</key><string>{48,72}</string>` +
          `<key>spriteOffset</key><string>{1,-1}</string>` +
          `<key>spriteSourceSize</key><string>{64,80}</string>` +
          `</dict></dict>` + meta(3),
      ),
    );
    const f = atlas.frame('a.png');
    expect(f).toMatchObject({ x: 7, y: 9, width: 48, height: 72, rotated: true });
    expect(regionInAtlas(f!)).toEqual({ x: 7, y: 9, width: 72, height: 48 });
  });

  it('查不到的帧返回 null——不去掉 .png 再试，也不忽略大小写', () => {
    const atlas = parseAtlas(
      plist(
        `<key>frames</key><dict><key>part_a.png</key><dict>` +
          `<key>frame</key><string>{{0,0},{1,1}}</string>` +
          `<key>offset</key><string>{0,0}</string>` +
          `<key>sourceSize</key><string>{1,1}</string>` +
          `</dict></dict>` + meta(2),
      ),
    );
    expect(atlas.frame('part_a')).toBeNull();
    expect(atlas.frame('PART_A.PNG')).toBeNull();
    expect(atlas.frame('part_b.png')).toBeNull();
  });

  it('format 缺失或不认识直接抛——不默认成 2', () => {
    const frames =
      `<key>frames</key><dict><key>a.png</key><dict>` +
      `<key>frame</key><string>{{0,0},{1,1}}</string>` +
      `<key>offset</key><string>{0,0}</string>` +
      `<key>sourceSize</key><string>{1,1}</string></dict></dict>`;
    expect(() =>
      parseAtlas(
        plist(
          frames +
            `<key>metadata</key><dict><key>textureFileName</key><string>x.png</string></dict>`,
        ),
      ),
    ).toThrow(/format 必须是 0\/1\/2\/3/);
    expect(() => parseAtlas(plist(frames + meta(9)))).toThrow(AtlasParseError);
  });

  it('几何串数字个数不对要抛——少一个就是整套矩形偏了', () => {
    expect(() =>
      parseAtlas(
        plist(
          `<key>frames</key><dict><key>a.png</key><dict>` +
            `<key>frame</key><string>{{0,0},{1}}</string>` +
            `<key>offset</key><string>{0,0}</string>` +
            `<key>sourceSize</key><string>{1,1}</string>` +
            `</dict></dict>` + meta(2),
        ),
      ),
    ).toThrow(/期望 4 个数字/);
  });

  it('缺键要抛，不给它补 0', () => {
    expect(() =>
      parseAtlas(
        plist(
          `<key>frames</key><dict><key>a.png</key><dict>` +
            `<key>frame</key><string>{{0,0},{1,1}}</string>` +
            `</dict></dict>` + meta(2),
        ),
      ),
    ).toThrow(/缺 offset/);
  });

  it('一帧都没有要抛——空图集不白屏，它让每个部件都静静不画', () => {
    expect(() => parseAtlas(plist(`<key>frames</key><dict/>` + meta(2)))).toThrow(/一帧都没有/);
  });

  it('大图文件名两个键都没有要抛', () => {
    expect(() =>
      parseAtlas(
        plist(
          `<key>frames</key><dict><key>a.png</key><dict>` +
            `<key>frame</key><string>{{0,0},{1,1}}</string>` +
            `<key>offset</key><string>{0,0}</string>` +
            `<key>sourceSize</key><string>{1,1}</string></dict></dict>` +
            `<key>metadata</key><dict><key>format</key><integer>2</integer></dict>`,
        ),
      ),
    ).toThrow(/realTextureFileName/);
  });

  it('metadata.size 可以没有（老图集），那时是 null 而不是 0×0', () => {
    const atlas = parseAtlas(
      plist(
        `<key>frames</key><dict><key>a.png</key><dict>` +
          `<key>x</key><integer>0</integer><key>y</key><integer>0</integer>` +
          `<key>width</key><integer>1</integer><key>height</key><integer>1</integer>` +
          `<key>offsetX</key><integer>0</integer><key>offsetY</key><integer>0</integer>` +
          `<key>originalWidth</key><integer>1</integer>` +
          `<key>originalHeight</key><integer>1</integer></dict></dict>` +
          `<key>metadata</key><dict><key>format</key><integer>0</integer>` +
          `<key>textureFileName</key><string>x.png</string></dict>`,
      ),
    );
    expect(atlas.size).toBeNull();
    expect(atlas.texture).toBe('x.png');
  });

  it('帧按名字升序，两次解析顺序一致', () => {
    const frame = (n: string): string =>
      `<key>${n}</key><dict><key>frame</key><string>{{0,0},{1,1}}</string>` +
      `<key>offset</key><string>{0,0}</string><key>sourceSize</key><string>{1,1}</string></dict>`;
    const atlas = parseAtlas(
      plist(`<key>frames</key><dict>${frame('c.png')}${frame('a.png')}${frame('b.png')}</dict>` + meta(2)),
    );
    expect(atlas.frames.map((f) => f.name)).toEqual(['a.png', 'b.png', 'c.png']);
  });
});
