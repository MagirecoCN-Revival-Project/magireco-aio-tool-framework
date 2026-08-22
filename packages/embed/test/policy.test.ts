import { describe, expect, it } from 'vitest';
import {
  DENY_ALL,
  EmbedPolicyError,
  embedCsp,
  frameAncestors,
  isAllowedAncestor,
  parsePolicy,
} from '@aio/embed';

const wiki = { allowedAncestors: ['https://wiki.example.org'] };

describe('嵌入来源白名单', () => {
  it('🔴 空名单是「谁都不许嵌」，不是「谁都行」', () => {
    // 忘了配置的后果必须是嵌不上（看得见），而不是谁都能嵌（没人发现）。
    expect(frameAncestors(DENY_ALL)).toBe("'none'");
    expect(isAllowedAncestor(DENY_ALL, 'https://wiki.example.org')).toBe(false);
  });

  it('🔴 拒绝通配全放——那等于开放点击劫持', () => {
    for (const bad of ['*', "'*'"]) {
      expect(() => frameAncestors({ allowedAncestors: [bad] }), bad).toThrow(EmbedPolicyError);
    }
  });

  it('精确来源只匹配自己', () => {
    expect(isAllowedAncestor(wiki, 'https://wiki.example.org')).toBe(true);
    expect(isAllowedAncestor(wiki, 'https://evil.org')).toBe(false);
    // 同名不同 scheme 不算——http 页面能被中间人改写。
    expect(isAllowedAncestor(wiki, 'http://wiki.example.org')).toBe(false);
    // 前缀撞名：evil 注册 wiki.example.org.evil.com 就想混进来。
    expect(isAllowedAncestor(wiki, 'https://wiki.example.org.evil.com')).toBe(false);
  });

  it('🔴 通配子域的语义必须与 CSP 一致：匹配子域，不匹配主域本身', () => {
    // 两边不一致的后果最难查：浏览器放行而我们拒收（功能静默失效），
    // 或者我们放行而浏览器拦下（以为拦住了其实没有）。
    const p = { allowedAncestors: ['https://*.example.org'] };
    expect(isAllowedAncestor(p, 'https://wiki.example.org')).toBe(true);
    expect(isAllowedAncestor(p, 'https://a.b.example.org')).toBe(true);
    expect(isAllowedAncestor(p, 'https://example.org')).toBe(false);
    // 「以 example.org 结尾」不等于「是它的子域」。
    expect(isAllowedAncestor(p, 'https://notexample.org')).toBe(false);
    expect(isAllowedAncestor(p, 'https://evilexample.org')).toBe(false);
  });

  it('🔴 null 来源永远不放行', () => {
    // sandbox iframe / file:// / 不透明来源都会给 "null"。
    expect(isAllowedAncestor(wiki, 'null')).toBe(false);
    expect(isAllowedAncestor({ allowedAncestors: ['https://*.example.org'] }, 'null')).toBe(false);
  });

  it('默认端口与显式默认端口是同一个来源', () => {
    const p = { allowedAncestors: ['https://wiki.example.org:443'] };
    expect(isAllowedAncestor(p, 'https://wiki.example.org')).toBe(true);
    // 非默认端口是另一个来源。
    expect(isAllowedAncestor(p, 'https://wiki.example.org:8443')).toBe(false);
  });

  it('拒绝带路径/凭据/非 http(s) 的来源写法', () => {
    // 写了路径的人会以为「只有这个路径下能嵌」，而 frame-ancestors 只比来源。
    for (const bad of [
      'https://wiki.example.org/wiki',
      'https://u:p@wiki.example.org',
      'ftp://wiki.example.org',
      'https://wiki.example.org?a=1',
      '',
    ]) {
      expect(() => parsePolicy({ allowedAncestors: [bad] }), bad).toThrow(EmbedPolicyError);
    }
  });

  it('通配只认 scheme://*.host 一种写法', () => {
    for (const bad of ['https://*', 'https://*.a.*.org', 'https://a.*.org', 'https://*.org']) {
      expect(() => parsePolicy({ allowedAncestors: [bad] }), bad).toThrow(EmbedPolicyError);
    }
  });

  it('一条坏的就整份拒绝——半份生效的白名单比没有更危险', () => {
    expect(() =>
      frameAncestors({ allowedAncestors: ['https://ok.example.org', 'https://bad.example.org/x'] }),
    ).toThrow(EmbedPolicyError);
  });

  it('CSP 里钉死了几条与 frame-ancestors 同样重要的', () => {
    const csp = embedCsp(wiki);
    expect(csp).toContain('frame-ancestors https://wiki.example.org');
    expect(csp).toContain("default-src 'self'");
    // 嵌入页没有表单；留着 form-action 等于给 XSS 一条外传通道。
    expect(csp).toContain("form-action 'none'");
    expect(csp).toContain("base-uri 'none'");
  });
});
