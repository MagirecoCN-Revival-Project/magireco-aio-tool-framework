import { describe, expect, it } from 'vitest';
import { parsePlist, PlistParseError } from '../src/plist.js';

/**
 * plist 全部是**当场写的**，不是游戏素材（铁律 9）。
 * 这里验的是「读错了会怎样」——尤其是那几条**不抛就会静默读出别的东西**的。
 */

const wrap = (body: string): string =>
  `<?xml version="1.0" encoding="UTF-8"?>\n` +
  `<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" ` +
  `"http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n` +
  `<plist version="1.0">\n${body}\n</plist>\n`;

describe('parsePlist', () => {
  it('读得出嵌套字典、数组与四种标量', () => {
    const value = parsePlist(
      wrap(`<dict>
        <key>s</key><string>hello</string>
        <key>i</key><integer>-12</integer>
        <key>r</key><real>1.5</real>
        <key>t</key><true/>
        <key>f</key><false/>
        <key>arr</key><array><integer>1</integer><string>x</string></array>
        <key>sub</key><dict><key>a</key><string>b</string></dict>
      </dict>`),
    );
    expect(value).toEqual({
      s: 'hello',
      i: -12,
      r: 1.5,
      t: true,
      f: false,
      arr: [1, 'x'],
      sub: { a: 'b' },
    });
  });

  it('XML 声明、DOCTYPE、注释都跳过', () => {
    const value = parsePlist(
      wrap('<!-- 这是注释 --><dict><key>a</key><string>1</string></dict><!-- 尾注释 -->'),
    );
    expect(value).toEqual({ a: '1' });
  });

  it('空标签有意义：<string/> 是空串，<dict/>/<array/> 是空容器', () => {
    expect(
      parsePlist(wrap('<dict><key>s</key><string/><key>d</key><dict/><key>a</key><array/></dict>')),
    ).toEqual({ s: '', d: {}, a: [] });
  });

  it('认得预定义实体与数字引用', () => {
    expect(parsePlist(wrap('<string>a &amp; b &lt;c&gt; &#65; &#x42;</string>'))).toBe(
      'a & b <c> A B',
    );
  });

  it('自定义实体一律拒绝——本读取器不读 DTD，所以 XXE 与实体爆炸不存在', () => {
    const attack =
      `<?xml version="1.0"?>\n` +
      `<!DOCTYPE plist [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>\n` +
      `<plist version="1.0"><string>&xxe;</string></plist>`;
    expect(() => parsePlist(attack)).toThrow(/未知实体/);
  });

  it('字典 key 重复要抛——否则「按名字取帧」是看运气取到哪一个', () => {
    expect(() => parsePlist(wrap('<dict><key>a</key><string>1</string><key>a</key><string>2</string></dict>'))).toThrow(
      /key 重复/,
    );
  });

  it('__proto__ 当 key 时是**一个普通字段**，不是改原型', () => {
    const value = parsePlist(wrap('<dict><key>__proto__</key><string>x</string></dict>')) as Record<
      string,
      unknown
    >;
    // 普通对象上 out['__proto__'] = 'x' 什么字段都不加，那一帧就凭空消失且不报错。
    expect(Object.hasOwn(value, '__proto__')).toBe(true);
    expect(value['__proto__']).toBe('x');
  });

  it('<integer> 是空的要抛——Number("") 是 0，会把「缺一个数」变成「这里是 0」', () => {
    expect(() => parsePlist(wrap('<integer>  </integer>'))).toThrow(PlistParseError);
    expect(() => parsePlist(wrap('<integer/>'))).toThrow(PlistParseError);
    expect(() => parsePlist(wrap('<real>abc</real>'))).toThrow(/不是数字/);
  });

  it('不认识的标签直接抛，不跳过——跳过等于少读一批帧', () => {
    expect(() => parsePlist(wrap('<data>QUJD</data>'))).toThrow(/不支持的 plist 标签/);
    expect(() => parsePlist(wrap('<date>2026-08-21</date>'))).toThrow(/不支持的 plist 标签/);
  });

  it('结构坏了要抛：根不是 plist、标签没闭合、dict 里不是 key', () => {
    expect(() => parsePlist('<root><dict/></root>')).toThrow(/根标签/);
    expect(() => parsePlist(wrap('<dict><key>a</key><string>x</dict>'))).toThrow(/期望 <\/string>/);
    expect(() => parsePlist(wrap('<dict><string>x</string></dict>'))).toThrow(/期望 <key>/);
    expect(() => parsePlist(wrap('<dict><key>a</key><string>x</string>'))).toThrow(PlistParseError);
  });

  it('报错带行号与附近原文——只说「解析失败」等于让人从头找', () => {
    let message = '';
    try {
      parsePlist(`<plist version="1.0">\n\n  这里不是标签\n</plist>`);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/第 3 行/);
    expect(message).toMatch(/这里不是标签/);
  });
});
