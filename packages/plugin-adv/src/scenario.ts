/**
 * 剧本模型与 worksheet 解析。
 *
 * **与渲染无关，也与上游无关**：这里只把「带表头的 worksheet JSON」变成一串
 * 统一命令对象。谁来画、画成什么样，是舞台的事（`engine.ts` 的 `Stage`）。
 *
 * ## 判据来自实测，不是猜的
 *
 * 上游研究记录（`example-adv-live2d/docs/ADV_WEB_RESEARCH.md`）
 * 在 6,714 个剧情 JSON、814,730 条指令上扫出来的结论：
 *
 *   - 结构是 `sheetList[].headerRow.cellList` 与 `sheetList[].contentRowList[].cellList`；
 *   - **按表头名称解析字段，不依赖固定列序**——列会重排，可选列会缺，
 *     还有注释行与不同语言版本。
 *
 * 我们只用这条**格式知识**，不搬运任何剧情文本（铁律 9：版权文件一个都不能进）。
 */

export class ScenarioParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScenarioParseError';
  }
}

/** 一条指令。识别得出的列给具名字段，其余原样留在 `extra` 里。 */
export interface ScenarioCommand {
  /** 在 `commands` 里的下标，也是 seek 的坐标。 */
  readonly index: number;
  readonly action: string;
  readonly speaker?: string;
  readonly text?: string;
  /** 立绘／背景等资源在表内的 ID。**不是 URL**——取用一律经 host.resources。 */
  readonly assetId?: string;
  readonly positionId?: string;
  readonly motion?: string;
  readonly faceType?: string;
  readonly sound?: string;
  /**
   * 没识别出来的列，原样保留。
   *
   * 丢掉它们会让「为什么这句没播」变成无从查起——而这套格式还在演进，
   * 今天不认识的列明天可能有意义。**不认识不等于可以扔。**
   */
  readonly extra: Readonly<Record<string, string>>;
}

export interface ScenarioDoc {
  readonly commands: readonly ScenarioCommand[];
  /** 有台词的那些指令的下标。进度按台词计——玩家感知的「第几行」是台词行。 */
  readonly speakingIndexes: readonly number[];
}

/** 表头名 → 具名字段。比较时统一小写去空白，容忍大小写与空格差异。 */
const COLUMNS: Readonly<Record<string, keyof ScenarioCommand>> = {
  actiontype: 'action',
  name: 'speaker',
  comment: 'text',
  assetid: 'assetId',
  positionid: 'positionId',
  motion: 'motion',
  facetype: 'faceType',
  soundfile: 'sound',
};

const norm = (s: string): string => s.trim().toLowerCase().replace(/[\s_-]/g, '');

interface RawSheet {
  headerRow?: { cellList?: unknown };
  contentRowList?: unknown;
}

function cells(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.map((c) => (c === null || c === undefined ? '' : String(c)));
}

/**
 * 解析 worksheet JSON。
 *
 * 结构不对一律抛，**不做「宽松模式」**：一个解析错的剧本会静默播成另一个样子，
 * 而没人会立刻发现——与铁律 1、2 同源的判断。
 */
export function parseWorksheet(input: unknown): ScenarioDoc {
  if (typeof input !== 'object' || input === null) {
    throw new ScenarioParseError('剧本不是对象');
  }
  const sheets = (input as { sheetList?: unknown }).sheetList;
  if (!Array.isArray(sheets) || sheets.length === 0) {
    throw new ScenarioParseError('缺少 sheetList，或它是空的');
  }

  const commands: ScenarioCommand[] = [];
  const speaking: number[] = [];

  for (const raw of sheets as RawSheet[]) {
    const header = cells(raw.headerRow?.cellList);
    if (header === null) {
      throw new ScenarioParseError('sheet 缺少 headerRow.cellList');
    }

    // 先由表头建列索引——这是整个解析器的核心，也是唯一正确的做法：
    // 列序在不同剧本之间是会变的，按下标取字段迟早取到别的列。
    const byField = new Map<keyof ScenarioCommand, number>();
    const extraCols: { name: string; at: number }[] = [];
    header.forEach((name, at) => {
      const field = COLUMNS[norm(name)];
      if (field !== undefined && !byField.has(field)) byField.set(field, at);
      else if (name.trim() !== '') extraCols.push({ name: name.trim(), at });
    });

    if (!byField.has('action')) {
      // 不许退回「就当第 0 列是 ActionType」。宁可解析不了，也不要猜错。
      throw new ScenarioParseError(
        `表头里没有 ActionType 列（见到的是：${header.join('、')}）——不按列序猜`,
      );
    }

    const rows = raw.contentRowList;
    if (!Array.isArray(rows)) {
      throw new ScenarioParseError('sheet 缺少 contentRowList');
    }

    for (const row of rows) {
      const cl = cells((row as { cellList?: unknown } | null)?.cellList);
      if (cl === null) continue; // 结构异常的行跳过，不让整本剧本播不了

      const at = (field: keyof ScenarioCommand): string | undefined => {
        const i = byField.get(field);
        if (i === undefined) return undefined;
        const v = cl[i];
        return v === undefined || v.trim() === '' ? undefined : v;
      };

      const action = at('action');
      // 注释行与空行：ActionType 为空或以 // # 开头。
      if (action === undefined || action.startsWith('//') || action.startsWith('#')) continue;

      const extra: Record<string, string> = {};
      for (const { name, at: i } of extraCols) {
        const v = cl[i];
        if (v !== undefined && v.trim() !== '') extra[name] = v;
      }

      const index = commands.length;
      const text = at('text');
      const cmd: ScenarioCommand = {
        index,
        action,
        ...(at('speaker') === undefined ? {} : { speaker: at('speaker')! }),
        ...(text === undefined ? {} : { text }),
        ...(at('assetId') === undefined ? {} : { assetId: at('assetId')! }),
        ...(at('positionId') === undefined ? {} : { positionId: at('positionId')! }),
        ...(at('motion') === undefined ? {} : { motion: at('motion')! }),
        ...(at('faceType') === undefined ? {} : { faceType: at('faceType')! }),
        ...(at('sound') === undefined ? {} : { sound: at('sound')! }),
        extra,
      };
      commands.push(cmd);
      if (text !== undefined) speaking.push(index);
    }
  }

  if (commands.length === 0) {
    throw new ScenarioParseError('解析出 0 条指令——剧本为空，或表头与内容对不上');
  }

  return { commands, speakingIndexes: speaking };
}
