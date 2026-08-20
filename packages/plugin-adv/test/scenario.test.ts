import { describe, expect, it } from 'vitest';
import { parseWorksheet, ScenarioParseError } from '../src/scenario.js';

/**
 * 剧本全部是**合成的**，不是游戏原文（铁律 9：版权文件一个都不能进）。
 * 这里验的是格式判据，与内容无关——正因为无关，合成数据完全够用。
 */

const sheet = (header: string[], rows: (string | null)[][]) => ({
  sheetList: [
    {
      headerRow: { cellList: header },
      contentRowList: rows.map((cellList) => ({ cellList })),
    },
  ],
});

describe('parseWorksheet', () => {
  it('按表头名建列索引，列序变了照样解析对', () => {
    // 同样三条指令，两种列序——结果必须一致。上游实测结论：列会重排。
    const a = parseWorksheet(
      sheet(
        ['ActionType', 'Name', 'Comment', 'AssetID'],
        [['Talk', '甲', '第一句', 'a01']],
      ),
    );
    const b = parseWorksheet(
      sheet(
        ['AssetID', 'Comment', 'ActionType', 'Name'],
        [['a01', '第一句', 'Talk', '甲']],
      ),
    );
    expect(a.commands[0]).toEqual(b.commands[0]);
    expect(a.commands[0]?.speaker).toBe('甲');
    expect(a.commands[0]?.text).toBe('第一句');
    expect(a.commands[0]?.assetId).toBe('a01');
  });

  it('缺 ActionType 列直接抛——不退回「就当第 0 列是它」', () => {
    expect(() => parseWorksheet(sheet(['Name', 'Comment'], [['甲', '话']]))).toThrow(
      ScenarioParseError,
    );
    expect(() => parseWorksheet(sheet(['Name', 'Comment'], [['甲', '话']]))).toThrow(/不按列序猜/);
  });

  it('可选列缺席不影响解析', () => {
    const doc = parseWorksheet(sheet(['ActionType', 'Comment'], [['Talk', '只有台词']]));
    expect(doc.commands[0]?.assetId).toBeUndefined();
    expect(doc.commands[0]?.text).toBe('只有台词');
  });

  it('注释行与空行跳过', () => {
    const doc = parseWorksheet(
      sheet(
        ['ActionType', 'Comment'],
        [['// 这是注释', 'x'], ['', ''], ['#也是注释', 'y'], ['Talk', '真台词']],
      ),
    );
    expect(doc.commands).toHaveLength(1);
    expect(doc.commands[0]?.text).toBe('真台词');
  });

  it('没识别出来的列原样留在 extra 里——不认识不等于可以扔', () => {
    const doc = parseWorksheet(
      sheet(['ActionType', 'MouthAnime', '将来才有的列'], [['Talk', 'open', '某值']]),
    );
    expect(doc.commands[0]?.extra).toEqual({ MouthAnime: 'open', 将来才有的列: '某值' });
  });

  it('speakingIndexes 只收有台词的行', () => {
    const doc = parseWorksheet(
      sheet(
        ['ActionType', 'Comment'],
        [['BgChange', ''], ['Talk', '一'], ['Wait', ''], ['Talk', '二']],
      ),
    );
    expect(doc.commands).toHaveLength(4);
    expect(doc.speakingIndexes).toEqual([1, 3]);
  });

  it('结构不对一律抛，不做宽松模式', () => {
    expect(() => parseWorksheet(null)).toThrow(/不是对象/);
    expect(() => parseWorksheet({})).toThrow(/sheetList/);
    expect(() => parseWorksheet({ sheetList: [{}] })).toThrow(/headerRow/);
    expect(() =>
      parseWorksheet({ sheetList: [{ headerRow: { cellList: ['ActionType'] } }] }),
    ).toThrow(/contentRowList/);
    // 表头对但一条指令都没有：解析成空剧本会静默播成白屏，所以也拦
    expect(() => parseWorksheet(sheet(['ActionType'], []))).toThrow(/0 条指令/);
  });
});
