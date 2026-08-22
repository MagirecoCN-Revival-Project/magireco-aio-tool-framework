const SOURCE_KEY_RE = /^story-v6:\d{8}t\d{6}z:[a-z0-9-]{1,64}:[0-9]{1,8}$/;

export function normalizeRouterBaseUrl(value) {
  let url;
  try {
    url = new URL(String(value).trim());
  } catch {
    throw new Error('Story Router 根地址必须是绝对 URL');
  }
  if (
    (url.protocol !== 'https:' && url.protocol !== 'http:')
    || url.username
    || url.password
    || url.search
    || url.hash
  ) {
    throw new Error('Story Router 根地址只接受无认证、无查询参数的 HTTP(S) URL');
  }
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString().replace(/\/$/, '');
}

export function validateSourceKey(sourceKey) {
  if (!SOURCE_KEY_RE.test(sourceKey)) {
    throw new Error('sourceKey 必须包含 story-v6、目录版本、分类和原始行号');
  }
  return sourceKey;
}

export function storyRoutesManifestUrl(routerBaseUrl) {
  return `${normalizeRouterBaseUrl(routerBaseUrl)}/story-routes.json`;
}

export function buildStoryRouterUrl(routerBaseUrl, sourceKey, target) {
  const base = normalizeRouterBaseUrl(routerBaseUrl);
  validateSourceKey(sourceKey);
  if (target !== 'reader' && target !== 'adv') {
    throw new Error('target 只接受 reader 或 adv');
  }
  const url = new URL(`${base}/open`);
  url.searchParams.set('source', sourceKey);
  url.searchParams.set('target', target);
  return url.toString();
}

export function findStoryRoute(manifest, sourceKey) {
  validateSourceKey(sourceKey);
  if (
    !manifest
    || manifest.version !== 1
    || manifest.bridgeRevision !== 1
    || manifest.sourceCatalog !== 'story-v6'
    || typeof manifest.targets?.adv?.handoffReady !== 'boolean'
    || !Array.isArray(manifest.routes)
  ) {
    throw new Error('Story Router 清单格式不受支持');
  }
  const revision = sourceKey.split(':')[1];
  if (manifest.catalogRevision !== revision) {
    throw new Error('搜索目录版本与 Story Router 清单不一致');
  }
  return manifest.routes.find((route) => route?.sourceKey === sourceKey) ?? null;
}
