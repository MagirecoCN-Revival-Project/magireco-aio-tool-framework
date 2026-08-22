import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { capabilityProviders } from '../src/station/providers';

/**
 * 边缘函数拿不到 `capabilityProviders()`——它跑在别的运行时里，
 * 而把整个插件目录 import 进边缘 bundle 既重又会在导入期碰 DOM。
 *
 * 所以那张表在构建期落成一份 JSON。落成文件就有**漂移**的风险：
 * 目录里加了插件而文件没更新，边缘会按旧表判定，于是新插件的能力
 * 嵌不出去——而且不报错。铁律 10 就是从这种「两张表各自自洽」的缝里漏的。
 *
 * 这条测试把两者钉在一起。要更新：`UPDATE_PROVIDERS=1 npx vitest run apps/station`
 */
const FILE = path.join(__dirname, '../../../functions/embed/providers.generated.json');

describe('边缘用的能力提供者表', () => {
  it('与插件目录一致（漂移了就是嵌入面按旧表判定）', () => {
    const want = JSON.stringify(capabilityProviders(), null, 2) + '\n';
    if (process.env['UPDATE_PROVIDERS'] === '1') {
      fs.mkdirSync(path.dirname(FILE), { recursive: true });
      fs.writeFileSync(FILE, want, 'utf8');
    }
    expect(fs.existsSync(FILE), `${FILE} 不存在，用 UPDATE_PROVIDERS=1 生成`).toBe(true);
    expect(fs.readFileSync(FILE, 'utf8')).toBe(want);
  });
});
