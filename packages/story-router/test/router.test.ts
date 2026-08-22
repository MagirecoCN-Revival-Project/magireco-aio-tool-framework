import { describe, expect, it } from 'vitest';
import {
  advScenarioSectionId,
  buildAdvTargetUrl,
  buildReaderTargetUrl,
  buildRouterUrl,
  buildStorySourceKey,
  catalogRevisionFromGeneratedAt,
  createStoryRouteIndex,
  handleStoryRouterRequest,
  isAdvHandoffEnabled,
  parseStoryRouteManifest,
  readerSectionAnchorId,
  resolveStoryRoute,
} from '../src/index.js';

const manifestInput = {
  version: 1,
  bridgeRevision: 1,
  sourceCatalog: 'story-v6',
  catalogRevision: '20260816t013548z',
  catalogGeneratedAt: '2026-08-16T01:35:48Z',
  readerIndexEntries: 3012,
  targets: {
    reader: { indexEntries: 3012 },
    adv: {
      target: 'magiaexedralive2dviewer',
      handoffReady: true,
      readerRepository: 'HiiragiNemu/magi-reader',
      readerRevision: '65f221f2aaa5a9fe161ed32e03e4dfbb93d4746d',
      readerIndexPath: 'website/public/story_index.json',
      readerIndexEntries: 2107,
    },
  },
  routes: [
    {
      sourceKey: 'story-v6:20260816t013548z:character:0',
      canonicalStoryId: 'magireco:310011',
      match: 'exact-character-episode',
      reader: { storyId: '310011', section: '310011-1 Section 1' },
      adv: { chapterId: '310011', section: '310011-1 Section 1' },
    },
  ],
} as const;

describe('Story Router manifest', () => {
  it('binds source keys to the exact catalog revision', () => {
    expect(catalogRevisionFromGeneratedAt('2026-08-16T01:35:48Z')).toBe('20260816t013548z');
    expect(buildStorySourceKey('20260816t013548z', 'character', 0)).toBe(
      'story-v6:20260816t013548z:character:0',
    );
    expect(() => buildStorySourceKey('2026-08-16', 'character', 0)).toThrow(/catalogRevision/);
  });

  it('indexes only exact source keys', () => {
    const manifest = parseStoryRouteManifest(manifestInput);
    const index = createStoryRouteIndex(manifest);
    expect(resolveStoryRoute(index, 'story-v6:20260816t013548z:character:0')?.reader.storyId).toBe('310011');
    expect(resolveStoryRoute(index, 'story-v6:20260816t013548z:character:1')).toBeNull();
    expect(resolveStoryRoute(index, '../character:0')).toBeNull();
  });

  it('rejects duplicate keys and divergent Reader/ADV ids', () => {
    expect(() => parseStoryRouteManifest({
      ...manifestInput,
      routes: [...manifestInput.routes, manifestInput.routes[0]],
    })).toThrow(/重复/);
    expect(() => parseStoryRouteManifest({
      ...manifestInput,
      routes: [{
        ...manifestInput.routes[0],
        adv: { chapterId: '310012', section: '310012-1 Section 1' },
      }],
    })).toThrow(/同一剧情编号/);
    expect(() => parseStoryRouteManifest({
      ...manifestInput,
      routes: [{
        ...manifestInput.routes[0],
        sourceKey: 'story-v6:20260817t013548z:character:0',
      }],
    })).toThrow(/catalogRevision/);
    expect(() => parseStoryRouteManifest({
      ...manifestInput,
      catalogGeneratedAt: '2026-08-17T01:35:48Z',
    })).toThrow(/不一致/);
  });
});

describe('target URL adapters', () => {
  it('builds the confirmed Reader route without hosting Reader', () => {
    expect(buildReaderTargetUrl('https://reader.example/', '310011', '310011-1 Section 1')).toBe(
      'https://reader.example/reader/310011?section=sec-310011-1-1#sec-310011-1-1',
    );
    expect(buildReaderTargetUrl('https://reader.example/archive', '310011')).toBe(
      'https://reader.example/archive/reader/310011',
    );
    expect(readerSectionAnchorId('000003-4 Section 4')).toBe('sec-000003-4-4');
  });

  it('builds the ADV handoff from the same Reader id and first section', () => {
    const url = new URL(buildAdvTargetUrl(
      'https://adv.example/player',
      '310011',
      '310011-1 Section 1',
      '65f221f2aaa5a9fe161ed32e03e4dfbb93d4746d',
    ));
    expect(url.pathname).toBe('/player');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      advRenderer: 'pixi-v2',
      bridge: '1',
      story: '310011',
      section: '310011-1',
      readerRevision: '65f221f2aaa5a9fe161ed32e03e4dfbb93d4746d',
    });
    expect(advScenarioSectionId('101102-1 Section 1')).toBe('101102-1');
    expect(() => advScenarioSectionId('101102-1')).toThrow(/格式/);
  });

  it('requires both manifest acceptance and the EdgeOne switch for ADV', () => {
    expect(isAdvHandoffEnabled(true, '1')).toBe(true);
    expect(isAdvHandoffEnabled(false, '1')).toBe(false);
    expect(isAdvHandoffEnabled(true, undefined)).toBe(false);
    expect(isAdvHandoffEnabled(true, '0')).toBe(false);
  });

  it('builds a fixed router endpoint rather than accepting a target origin', () => {
    expect(buildRouterUrl(
      'https://router.example/open',
      'story-v6:20260816t013548z:character:0',
      'reader',
    )).toBe('https://router.example/open?source=story-v6%3A20260816t013548z%3Acharacter%3A0&target=reader');
  });
});

describe('EdgeOne request handler', () => {
  const index = createStoryRouteIndex(parseStoryRouteManifest(manifestInput));
  const origins = {
    readerBaseUrl: 'https://reader.example/',
    advBaseUrl: 'https://adv.example/',
    advReaderRevision: '65f221f2aaa5a9fe161ed32e03e4dfbb93d4746d',
    advHandoffEnabled: true,
  };

  it('redirects Reader and ADV requests', () => {
    const reader = handleStoryRouterRequest(
      new Request('https://router.example/open?source=story-v6%3A20260816t013548z%3Acharacter%3A0&target=reader'),
      index,
      origins,
    );
    expect(reader.status).toBe(302);
    expect(reader.headers.get('location')).toBe(
      'https://reader.example/reader/310011?section=sec-310011-1-1#sec-310011-1-1',
    );

    const adv = handleStoryRouterRequest(
      new Request('https://router.example/open?source=story-v6%3A20260816t013548z%3Acharacter%3A0&target=adv'),
      index,
      origins,
    );
    expect(adv.status).toBe(302);
    expect(new URL(adv.headers.get('location') ?? '').searchParams.get('section')).toBe(
      '310011-1',
    );
  });

  it('returns explicit errors for unmapped and malformed requests', async () => {
    const missing = handleStoryRouterRequest(
      new Request('https://router.example/open?source=story-v6%3A20260816t013548z%3Acharacter%3A99&target=reader'),
      index,
      origins,
    );
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ code: 'route_not_found' });

    const malformed = handleStoryRouterRequest(
      new Request('https://router.example/open?source=story-v6%3A20260816t013548z%3Acharacter%3A0&target=https%3A%2F%2Fevil.example'),
      index,
      origins,
    );
    expect(malformed.status).toBe(400);
  });

  it('keeps Reader available while withholding unsupported or not-yet-enabled ADV routes', async () => {
    const readerOnlyManifest = parseStoryRouteManifest({
      ...manifestInput,
      routes: [{ ...manifestInput.routes[0], adv: null }],
    });
    const readerOnlyIndex = createStoryRouteIndex(readerOnlyManifest);
    const reader = handleStoryRouterRequest(
      new Request('https://router.example/open?source=story-v6%3A20260816t013548z%3Acharacter%3A0&target=reader'),
      readerOnlyIndex,
      origins,
    );
    expect(reader.status).toBe(302);

    const unavailable = handleStoryRouterRequest(
      new Request('https://router.example/open?source=story-v6%3A20260816t013548z%3Acharacter%3A0&target=adv'),
      readerOnlyIndex,
      origins,
    );
    expect(unavailable.status).toBe(404);
    expect(await unavailable.json()).toMatchObject({ code: 'target_not_available' });

    const pending = handleStoryRouterRequest(
      new Request('https://router.example/open?source=story-v6%3A20260816t013548z%3Acharacter%3A0&target=adv'),
      index,
      { ...origins, advHandoffEnabled: false },
    );
    expect(pending.status).toBe(409);
    expect(await pending.json()).toMatchObject({ code: 'target_not_ready' });
  });
});
