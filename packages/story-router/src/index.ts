export const STORY_ROUTER_REVISION = 1 as const;
export const STORY_ROUTE_MANIFEST_VERSION = 1 as const;

export type StoryTarget = 'reader' | 'adv';

export interface StoryRouteDestination {
  readonly reader: {
    readonly storyId: string;
    readonly section?: string;
  };
  readonly adv: {
    readonly chapterId: string;
    readonly section: string;
  } | null;
}

export interface StoryRouteRecord extends StoryRouteDestination {
  readonly sourceKey: string;
  readonly canonicalStoryId: string;
  readonly match:
    | 'exact-character-episode'
    | 'exact-main-episode'
    | 'exact-reader-group'
    | 'explicit-title'
    | 'manual';
}

export interface StoryRouterTargets {
  readonly reader: {
    readonly indexEntries: number;
  };
  readonly adv: {
    readonly target: string;
    readonly handoffReady: boolean;
    readonly readerRepository: string;
    readonly readerRevision: string;
    readonly readerIndexPath: string;
    readonly readerIndexEntries: number;
  };
}

export interface StoryRouteManifest {
  readonly version: typeof STORY_ROUTE_MANIFEST_VERSION;
  readonly bridgeRevision: typeof STORY_ROUTER_REVISION;
  readonly sourceCatalog: 'story-v6';
  readonly catalogRevision: string;
  readonly catalogGeneratedAt: string;
  readonly readerIndexEntries: number;
  readonly targets: StoryRouterTargets;
  readonly routes: readonly StoryRouteRecord[];
}

export interface StoryRouterOrigins {
  readonly readerBaseUrl: string;
  readonly advBaseUrl: string;
  readonly advRenderer?: string;
  readonly advReaderRevision: string;
  readonly advHandoffEnabled: boolean;
}

export type StoryRouteIndex = Readonly<Record<string, StoryRouteDestination>>;

const CATALOG_REVISION_RE = /^\d{8}t\d{6}z$/;
const SOURCE_KEY_RE = /^story-v6:\d{8}t\d{6}z:[a-z0-9-]{1,64}:[0-9]{1,8}$/;
const STORY_ID_RE = /^[A-Za-z0-9_.:-]{1,256}$/;
const ISO_INSTANT_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$/;
const CONTROL_RE = /[\u0000-\u001f\u007f]/;
const TARGET_NAME_RE = /^[A-Za-z0-9._:-]{1,128}$/;
const REPOSITORY_RE = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const REVISION_RE = /^[A-Za-z0-9._:-]{1,128}$/;
const INDEX_PATH_RE = /^[A-Za-z0-9._/-]{1,256}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(
  value: unknown,
  label: string,
  pattern: RegExp,
  maxLength: number,
): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength || !pattern.test(value)) {
    throw new Error(`${label} 无效`);
  }
  return value;
}

function parseRoute(value: unknown, index: number): StoryRouteRecord {
  if (!isRecord(value)) throw new Error(`routes[${index}] 必须是对象`);
  const sourceKey = requireString(value['sourceKey'], `routes[${index}].sourceKey`, SOURCE_KEY_RE, 128);
  const canonicalStoryId = requireString(
    value['canonicalStoryId'],
    `routes[${index}].canonicalStoryId`,
    /^magireco:[A-Za-z0-9_.:-]{1,256}$/,
    272,
  );
  const match = value['match'];
  if (
    match !== 'exact-character-episode'
    && match !== 'exact-main-episode'
    && match !== 'exact-reader-group'
    && match !== 'explicit-title'
    && match !== 'manual'
  ) {
    throw new Error(`routes[${index}].match 无效`);
  }
  if (!isRecord(value['reader'])) throw new Error(`routes[${index}].reader 必须是对象`);
  const storyId = requireString(
    value['reader']['storyId'],
    `routes[${index}].reader.storyId`,
    STORY_ID_RE,
    256,
  );
  const readerSectionValue = value['reader']['section'];
  let readerSection: string | undefined;
  if (readerSectionValue !== undefined) {
    if (
      typeof readerSectionValue !== 'string'
      || readerSectionValue.length === 0
      || readerSectionValue.length > 512
      || CONTROL_RE.test(readerSectionValue)
    ) {
      throw new Error(`routes[${index}].reader.section 无效`);
    }
    readerSection = readerSectionValue;
  }
  let adv: StoryRouteDestination['adv'] = null;
  if (value['adv'] !== null) {
    if (!isRecord(value['adv'])) throw new Error(`routes[${index}].adv 必须是对象或 null`);
    const chapterId = requireString(
      value['adv']['chapterId'],
      `routes[${index}].adv.chapterId`,
      STORY_ID_RE,
      256,
    );
    const section = value['adv']['section'];
    if (
      typeof section !== 'string' ||
      section.length === 0 ||
      section.length > 512 ||
      CONTROL_RE.test(section)
    ) {
      throw new Error(`routes[${index}].adv.section 无效`);
    }
    if (chapterId !== storyId) {
      throw new Error(`routes[${index}] 的 Reader 与 ADV 没有使用同一剧情编号`);
    }
    if (readerSection !== undefined && section !== readerSection) {
      throw new Error(`routes[${index}] 的 Reader 与 ADV 没有使用同一章节`);
    }
    adv = { chapterId, section };
  }
  if (canonicalStoryId !== `magireco:${storyId}`) {
    throw new Error(`routes[${index}].canonicalStoryId 与 Reader 编号不一致`);
  }
  return {
    sourceKey,
    canonicalStoryId,
    match,
    reader: readerSection === undefined ? { storyId } : { storyId, section: readerSection },
    adv,
  };
}

function parseTargets(value: unknown): StoryRouterTargets {
  if (!isRecord(value) || !isRecord(value['reader']) || !isRecord(value['adv'])) {
    throw new Error('targets 无效');
  }
  const indexEntries = value['reader']['indexEntries'];
  const advIndexEntries = value['adv']['readerIndexEntries'];
  if (!Number.isSafeInteger(indexEntries) || Number(indexEntries) < 1) {
    throw new Error('targets.reader.indexEntries 无效');
  }
  if (!Number.isSafeInteger(advIndexEntries) || Number(advIndexEntries) < 1) {
    throw new Error('targets.adv.readerIndexEntries 无效');
  }
  const target = requireString(value['adv']['target'], 'targets.adv.target', TARGET_NAME_RE, 128);
  const readerRepository = requireString(
    value['adv']['readerRepository'],
    'targets.adv.readerRepository',
    REPOSITORY_RE,
    201,
  );
  const readerRevision = requireString(
    value['adv']['readerRevision'],
    'targets.adv.readerRevision',
    REVISION_RE,
    128,
  );
  const readerIndexPath = requireString(
    value['adv']['readerIndexPath'],
    'targets.adv.readerIndexPath',
    INDEX_PATH_RE,
    256,
  );
  if (
    readerIndexPath.startsWith('/')
    || readerIndexPath.split('/').some(part => part === '' || part === '.' || part === '..')
  ) {
    throw new Error('targets.adv.readerIndexPath 无效');
  }
  if (typeof value['adv']['handoffReady'] !== 'boolean') {
    throw new Error('targets.adv.handoffReady 无效');
  }
  return {
    reader: { indexEntries: Number(indexEntries) },
    adv: {
      target,
      handoffReady: value['adv']['handoffReady'],
      readerRepository,
      readerRevision,
      readerIndexPath,
      readerIndexEntries: Number(advIndexEntries),
    },
  };
}

export function parseStoryRouteManifest(input: unknown): StoryRouteManifest {
  if (!isRecord(input)) throw new Error('剧情路由清单必须是对象');
  if (input['version'] !== STORY_ROUTE_MANIFEST_VERSION) throw new Error('剧情路由清单版本不支持');
  if (input['bridgeRevision'] !== STORY_ROUTER_REVISION) throw new Error('剧情桥接 revision 不支持');
  if (input['sourceCatalog'] !== 'story-v6') throw new Error('剧情路由清单来源不支持');
  const catalogRevision = input['catalogRevision'];
  if (typeof catalogRevision !== 'string' || !CATALOG_REVISION_RE.test(catalogRevision)) {
    throw new Error('catalogRevision 无效');
  }
  const catalogGeneratedAt = input['catalogGeneratedAt'];
  if (typeof catalogGeneratedAt !== 'string' || !ISO_INSTANT_RE.test(catalogGeneratedAt)) {
    throw new Error('catalogGeneratedAt 必须是 UTC 时间');
  }
  if (catalogRevisionFromGeneratedAt(catalogGeneratedAt) !== catalogRevision) {
    throw new Error('catalogGeneratedAt 与 catalogRevision 不一致');
  }
  const readerIndexEntries = input['readerIndexEntries'];
  if (!Number.isSafeInteger(readerIndexEntries) || (readerIndexEntries as number) < 1) {
    throw new Error('readerIndexEntries 无效');
  }
  if (!Array.isArray(input['routes'])) throw new Error('routes 必须是数组');
  const targets = parseTargets(input['targets']);
  if (targets.reader.indexEntries !== readerIndexEntries) {
    throw new Error('targets.reader.indexEntries 与 readerIndexEntries 不一致');
  }
  const routes = input['routes'].map(parseRoute);
  const seen = new Set<string>();
  for (const route of routes) {
    if (route.sourceKey.split(':')[1] !== catalogRevision) {
      throw new Error(`剧情路由键与 catalogRevision 不一致：${route.sourceKey}`);
    }
    if (seen.has(route.sourceKey)) throw new Error(`剧情路由键重复：${route.sourceKey}`);
    seen.add(route.sourceKey);
  }
  return {
    version: STORY_ROUTE_MANIFEST_VERSION,
    bridgeRevision: STORY_ROUTER_REVISION,
    sourceCatalog: 'story-v6',
    catalogRevision,
    catalogGeneratedAt,
    readerIndexEntries: readerIndexEntries as number,
    targets,
    routes,
  };
}

export function catalogRevisionFromGeneratedAt(catalogGeneratedAt: string): string {
  const match = ISO_INSTANT_RE.exec(catalogGeneratedAt);
  if (match === null) throw new Error('catalogGeneratedAt 必须是 UTC 时间');
  const [, year, month, day, hour, minute, second] = match;
  return `${year}${month}${day}t${hour}${minute}${second}z`;
}

export function createStoryRouteIndex(manifest: StoryRouteManifest): StoryRouteIndex {
  const result: Record<string, StoryRouteDestination> =
    Object.create(null) as Record<string, StoryRouteDestination>;
  for (const route of manifest.routes) result[route.sourceKey] = route;
  return Object.freeze(result);
}

export function buildStorySourceKey(
  catalogRevision: string,
  categorySlug: string,
  rowIndex: number,
): string {
  if (!CATALOG_REVISION_RE.test(catalogRevision)) throw new Error('catalogRevision 无效');
  if (!/^[a-z0-9-]{1,64}$/.test(categorySlug)) throw new Error('categorySlug 无效');
  if (!Number.isSafeInteger(rowIndex) || rowIndex < 0 || rowIndex > 99_999_999) {
    throw new Error('rowIndex 无效');
  }
  return `story-v6:${catalogRevision}:${categorySlug}:${rowIndex}`;
}

export function resolveStoryRoute(index: StoryRouteIndex, sourceKey: string): StoryRouteDestination | null {
  if (!SOURCE_KEY_RE.test(sourceKey)) return null;
  return index[sourceKey] ?? null;
}

function parseBaseUrl(value: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} 不是绝对 URL`);
  }
  if (
    (url.protocol !== 'https:' && url.protocol !== 'http:') ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    throw new Error(`${label} 必须是无认证、无查询参数的 http(s) URL`);
  }
  return url;
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function safeAnchorToken(value: string): string {
  const trimmed = value.trim();
  const cleaned = trimmed.replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '');
  if (cleaned && cleaned === trimmed) return cleaned;
  return `${cleaned || 'source'}-${stableHash(trimmed)}`;
}

export function readerSectionAnchorId(sectionDescriptor: string): string {
  if (
    sectionDescriptor.length === 0
    || sectionDescriptor.length > 512
    || CONTROL_RE.test(sectionDescriptor)
  ) {
    throw new Error('Reader section 无效');
  }
  const descriptor = /^(.*?)\s+Section\s*(\d+)\b/i.exec(sectionDescriptor);
  if (descriptor === null) throw new Error('Reader section 格式无效');
  const source = safeAnchorToken(descriptor[1]?.trim() || 'story');
  const section = safeAnchorToken(descriptor[2] ?? 'unknown');
  const branch = /(?:Branch|分支|group)\s*_?\s*(\d+)/i.exec(sectionDescriptor)?.[1];
  return `sec-${source}-${section}${branch ? `-branch-${safeAnchorToken(branch)}` : ''}`;
}

export function advScenarioSectionId(sectionDescriptor: string): string {
  if (
    sectionDescriptor.length === 0
    || sectionDescriptor.length > 512
    || CONTROL_RE.test(sectionDescriptor)
  ) {
    throw new Error('ADV section 无效');
  }
  const descriptor = /^(.*?)\s+Section\s*\d+\b/i.exec(sectionDescriptor);
  if (descriptor === null) throw new Error('ADV section 格式无效');
  return requireString(
    descriptor[1]?.trim(),
    'ADV scenario section id',
    STORY_ID_RE,
    256,
  );
}

export function isAdvHandoffEnabled(
  manifestReady: boolean,
  environmentValue: string | undefined,
): boolean {
  return manifestReady && environmentValue === '1';
}

export function buildReaderTargetUrl(
  baseUrl: string,
  storyId: string,
  section?: string,
): string {
  requireString(storyId, 'Reader storyId', STORY_ID_RE, 256);
  const base = parseBaseUrl(baseUrl, 'Reader base URL');
  if (!base.pathname.endsWith('/')) base.pathname += '/';
  const url = new URL(`reader/${encodeURIComponent(storyId)}`, base);
  if (section !== undefined) {
    const anchor = readerSectionAnchorId(section);
    url.searchParams.set('section', anchor);
    url.hash = anchor;
  }
  return url.toString();
}

export function buildAdvTargetUrl(
  baseUrl: string,
  chapterId: string,
  section: string,
  readerRevision: string,
  renderer = 'pixi-v2',
): string {
  requireString(chapterId, 'ADV chapterId', STORY_ID_RE, 256);
  requireString(readerRevision, 'ADV Reader revision', REVISION_RE, 128);
  requireString(renderer, 'ADV renderer', TARGET_NAME_RE, 128);
  const scenarioSectionId = advScenarioSectionId(section);
  const url = parseBaseUrl(baseUrl, 'ADV base URL');
  url.searchParams.set('advRenderer', renderer);
  url.searchParams.set('bridge', String(STORY_ROUTER_REVISION));
  url.searchParams.set('story', chapterId);
  url.searchParams.set('section', scenarioSectionId);
  url.searchParams.set('readerRevision', readerRevision);
  return url.toString();
}

export function resolveStoryTargetUrl(
  route: StoryRouteDestination,
  target: StoryTarget,
  origins: StoryRouterOrigins,
): string {
  if (target === 'reader') {
    return buildReaderTargetUrl(
      origins.readerBaseUrl,
      route.reader.storyId,
      route.reader.section,
    );
  }
  if (route.adv === null) {
    throw new Error('该剧情没有与 ADV 数据版本兼容的章节');
  }
  return buildAdvTargetUrl(
    origins.advBaseUrl,
    route.adv.chapterId,
    route.adv.section,
    origins.advReaderRevision,
    origins.advRenderer,
  );
}

export function buildRouterUrl(endpoint: string, sourceKey: string, target: StoryTarget): string {
  if (!SOURCE_KEY_RE.test(sourceKey)) throw new Error('sourceKey 无效');
  const url = parseBaseUrl(endpoint, 'Story Router endpoint');
  url.searchParams.set('source', sourceKey);
  url.searchParams.set('target', target);
  return url.toString();
}

function errorResponse(status: number, code: string, message: string, head: boolean): Response {
  const body = JSON.stringify({ ok: false, code, message });
  return new Response(head ? null : body, {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

export function handleStoryRouterRequest(
  request: Request,
  index: StoryRouteIndex,
  origins: StoryRouterOrigins,
): Response {
  const head = request.method === 'HEAD';
  if (request.method !== 'GET' && !head) {
    return errorResponse(405, 'method_not_allowed', '仅接受 GET 或 HEAD', false);
  }
  const url = new URL(request.url);
  const sources = url.searchParams.getAll('source');
  const targets = url.searchParams.getAll('target');
  if (sources.length !== 1 || targets.length !== 1) {
    return errorResponse(400, 'bad_request', 'source 与 target 必须各出现一次', head);
  }
  const sourceKey = sources[0] ?? '';
  const target = targets[0];
  if (!SOURCE_KEY_RE.test(sourceKey) || (target !== 'reader' && target !== 'adv')) {
    return errorResponse(400, 'bad_request', 'source 或 target 格式错误', head);
  }
  const route = resolveStoryRoute(index, sourceKey);
  if (route === null) {
    return errorResponse(404, 'route_not_found', '该搜索结果尚未登记剧情路由', head);
  }
  if (target === 'adv' && route.adv === null) {
    return errorResponse(404, 'target_not_available', '该搜索行尚无经过验证的 ADV 精确章节', head);
  }
  if (target === 'adv' && !origins.advHandoffEnabled) {
    return errorResponse(409, 'target_not_ready', 'ADV 启动接收器尚未启用', head);
  }
  let location: string;
  try {
    location = resolveStoryTargetUrl(route, target, origins);
  } catch (error) {
    return errorResponse(
      500,
      'router_misconfigured',
      error instanceof Error ? error.message : 'Story Router 配置错误',
      head,
    );
  }
  return new Response(null, {
    status: 302,
    headers: {
      Location: location,
      'Cache-Control': 'public, max-age=300',
    },
  });
}
