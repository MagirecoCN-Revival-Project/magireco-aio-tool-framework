import { describe, expect, it } from 'vitest';
import { parseRef } from '@aio/core';
import { EmbedError, buildEmbedUrl, parseEmbedRequest } from '@aio/embed';

const parse = (p: string, s = '') => parseEmbedRequest(p, s);

describe('嵌入请求解析', () => {
  it('解析基本形态', () => {
    const r = parse('/embed/sprite.show', 'ref=a:sprite/100100/d_r&movement=idle');
    expect(r.capability).toBe('sprite.show');
    expect(r.ref.universe).toBe('a');
    expect(r.ref.segments).toEqual(['100100', 'd_r']);
    expect(r.params).toEqual({ movement: 'idle' });
  });

  it('🔴 裸 ID 一律拒绝——嵌入 URL 是别人手写的，这道闸最要紧', () => {
    for (const bad of ['ref=100101', 'ref=sprite/100100', 'ref=']) {
      expect(() => parse('/embed/sprite.show', bad), bad).toThrow(EmbedError);
    }
    expect(() => parse('/embed/sprite.show', 'ref=100101')).toThrow(/ref/);
  });

  it('缺 ref 直接拒', () => {
    expect(() => parse('/embed/sprite.show')).toThrow(/缺少 ref/);
  });

  it('🔴 能力接不了这个 kind 就拒，不硬塞', () => {
    // adv.play 只接 scenario。塞一个 character 进去，实现要么崩要么放空白，
    // 两种都比当场 400 难查。
    const e = (() => {
      try {
        parse('/embed/adv.play', 'ref=a:character/1001');
        return null;
      } catch (err) {
        return err as EmbedError;
      }
    })();
    expect(e?.code).toBe('kind-mismatch');
  });

  it('没登记的能力报 unknown-capability，不是解析失败', () => {
    const e = (() => {
      try {
        parse('/embed/nope.thing', 'ref=a:character/1001');
        return null;
      } catch (err) {
        return err as EmbedError;
      }
    })();
    expect(e?.code).toBe('unknown-capability');
  });

  it('路径形状不对就拒', () => {
    for (const bad of ['/sprite.show', '/embed/', '/embed/a/b']) {
      expect(() => parse(bad, 'ref=a:sprite/1'), bad).toThrow(EmbedError);
    }
  });

  it('🔴 契约没登记的参数丢掉而不报错——契约会长出新参数', () => {
    // 新宿主发来老实现不认识的参数，不该让整个嵌入 400。
    const r = parse('/embed/sprite.show', 'ref=a:sprite/1&movement=x&futureParam=1&utm_source=wiki');
    expect(r.params).toEqual({ movement: 'x' });
  });

  it('🔴 登记了但值不合法要报错——那不是「新参数」，是写错了', () => {
    // 空串不是数字：?line= 被当成第 0 行起播，而调用方以为自己没传。
    expect(() => parse('/embed/adv.play', 'ref=a:scenario/1&line=')).toThrow(/空/);
    expect(() => parse('/embed/adv.play', 'ref=a:scenario/1&line=abc')).toThrow(/数字/);
    expect(() => parse('/embed/adv.play', 'ref=a:scenario/1&line=Infinity')).toThrow(/数字/);
  });

  it('🔴 布尔只认 1/0/true/false——「其它一切为真」会把「否」读成「是」', () => {
    expect(parse('/embed/adv.play', 'ref=a:scenario/1&auto=1').params['auto']).toBe(true);
    expect(parse('/embed/adv.play', 'ref=a:scenario/1&auto=false').params['auto']).toBe(false);
    expect(parse('/embed/adv.play', 'ref=a:scenario/1&auto=0').params['auto']).toBe(false);
    // ?auto=no 按 JS 真值判定会变成「开」——调用方明确写了「否」。
    expect(() => parse('/embed/adv.play', 'ref=a:scenario/1&auto=no')).toThrow(/1\/0/);
  });

  it('往返稳定，且 URL 里不认识任何域名', () => {
    const req = parse('/embed/adv.play', 'ref=a:scenario/310241@zh&line=12&auto=true');
    const url = buildEmbedUrl('https://host.invalid', req);
    const u = new URL(url);
    expect(u.pathname).toBe('/embed/adv.play');
    const back = parseEmbedRequest(u.pathname, u.search);
    expect(back).toEqual(req);
    // origin 由调用方传，换域名不需要改这个包。
    expect(buildEmbedUrl('https://other.invalid/', req)).toContain('https://other.invalid/embed/');
  });

  it('variant 跟着 ref 一起走完整条链路', () => {
    const req = parse('/embed/adv.play', 'ref=a:scenario/310241@zh');
    expect(req.ref.variant).toBe('zh');
    const back = parseEmbedRequest('/embed/adv.play', new URL(buildEmbedUrl('https://h.invalid', req)).search);
    // 中文剧情不是日文剧情——variant 丢了就是放错了语言。
    expect(back.ref).toEqual(parseRef('a:scenario/310241@zh'));
  });
});
