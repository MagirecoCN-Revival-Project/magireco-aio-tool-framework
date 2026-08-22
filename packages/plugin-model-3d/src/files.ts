import { formatRef, refId } from '@aio/core';
import type { ResourceRef } from '@aio/core';
import type { ResourceProvider } from '@aio/resource';

/**
 * 「把一个既有查看器接进来」实际要写的那**一个函数**（docs/VIEWER-REFACTOR.md 的结论）。
 *
 * 上游 `CharacterManager` 的构造函数签名本来就是注入式的：
 *
 *     new CharacterManager(files: Record<string, string>)   // 路径 → URL
 *
 * 它现在的应用侧用 `import.meta.glob` 在**构建期**把模型打进 dist。要走资源面，
 * 需要的全部改动就是换一个 `Record` 的来源——从清单构造，而不是从磁盘 glob。
 * 子包一行不用动，这也是为什么这个查看器排在 Phase 1 打头阵。
 */

/**
 * 上游 `loader.ts` 从 fbx 路径里抠角色号，用的是：
 *
 *     fbxPath.match(/chara_(\d+).*\//)![1]
 *
 * **那个 `!` 是非空断言**：路径不含 `chara_<数字>/` 时它不会给出可读的报错，
 * 而是抛一个没有上下文的 TypeError。清单里的路径由我们决定，所以这条约束
 * 必须在进入上游代码**之前**验，否则排查时只能看到一句 `Cannot read
 * properties of null`，谁也不知道是清单路径写错了。
 */
const CHARA_PATH_RE = /chara_(\d+).*\//;

export class Model3dFilesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Model3dFilesError';
  }
}

export interface BuiltFiles {
  /** 直接喂给 `new CharacterManager(...)`。 */
  readonly files: Record<string, string>;
  /** 从 fbx 路径里抠出来的角色号，喂给 `loadCharacterById`。 */
  readonly characterId: string;
}

/**
 * 按 ref 从资源清单构造 `path → URL` 表。
 *
 * 只取每一份的**首选**候选：多源回退是资源提供者的职责，上游查看器
 * 拿到的是普通 URL，它不知道也不需要知道后面有几条线路（铁律 3）。
 */
export function buildFiles(resources: ResourceProvider, ref: ResourceRef): BuiltFiles {
  const resolved = resources.resolve(ref);

  const files: Record<string, string> = {};
  for (const part of resolved.parts) {
    const first = part.candidates[0];
    if (first === undefined) continue;
    files[part.path] = first.url;
  }

  const paths = Object.keys(files);
  if (paths.length === 0) {
    throw new Model3dFilesError(`${formatRef(ref)} 的清单没有任何可用候选——检查资源源是否全部冷却`);
  }

  const fbx = paths.filter((p) => p.includes('.fbx'));
  if (fbx.length === 0) {
    throw new Model3dFilesError(
      `${formatRef(ref)} 的清单里没有 .fbx——上游按文件名里有没有 .fbx 找模型，` +
        `压缩过的也要保留该后缀（如 chara_100101/model.fbx.gz）`,
    );
  }

  const bad = paths.filter((p) => !CHARA_PATH_RE.test(p));
  if (bad.length > 0) {
    throw new Model3dFilesError(
      `${formatRef(ref)} 的清单路径不含 \`chara_<数字>/\` 段：${bad.join('、')}。` +
        `上游 loader 用 /chara_(\\d+).*\\// 抠角色号且带非空断言，不合规会抛一个` +
        `没有上下文的 TypeError——所以在这里先拦下来`,
    );
  }

  const first = fbx[0] as string;
  const matched = CHARA_PATH_RE.exec(first);
  const characterId = matched?.[1];
  if (characterId === undefined) {
    /* c8 ignore next 2 */
    throw new Model3dFilesError(`无法从 ${first} 抠出角色号`);
  }

  // 清单路径里的角色号必须与 ref 的主标识一致，否则就是「档案配错模型」——
  // 那正是铁律 1 要防的事，只不过这次错在清单而不是 ref 语法。
  const expect = refId(ref);
  if (characterId !== expect) {
    throw new Model3dFilesError(
      `${formatRef(ref)} 指向的清单条目里是 chara_${characterId}——` +
        `号对不上就是配错了人，宁可打不开也不显示另一个角色`,
    );
  }

  return { files, characterId };
}
