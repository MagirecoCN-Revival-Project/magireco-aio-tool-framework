import { defineConfig } from 'vitepress';

/**
 * 站点来源（协议 + 主机名），用于 sitemap 与 og:url。
 *
 * **不写死真实域名**：这套框架要能当模板用，域名是部署方的事，不是代码的事。
 * 构建时给 `DOCS_ORIGIN`（如 `https://docs.example.com`）即可；不给就用占位符，
 * 站点照常能构建、能本地看，只是 sitemap 里是示例域名。
 */
const ORIGIN = process.env['DOCS_ORIGIN'] ?? 'https://docs.example.com';

/**
 * 文档站配置。
 *
 * ## 为什么直接拿 `docs/` 当站点根，而不是新建一个 `apps/docs`
 *
 * 这些文档本来就在 `docs/` 里，而且 README、CLAUDE.md、AGENTS.md 都按现在的路径
 * 链过来。搬一次目录能省几行配置，代价是把仓库里所有指向它们的链接一次性打断，
 * 并且以后每个人都要记住「文档在两个地方」。所以站点就地长在 `docs/` 上：
 * 仓库里读到的 Markdown 与站点上看到的页面**是同一份文件**，不存在同步问题。
 *
 * ## `srcExclude` 留着
 *
 * `docs/reports/` 曾经放过一份点名批评具体仓库的内部盘点，已随「去实例化」
 * 一起删掉。这条排除留着当护栏：下次再往那里放内部材料，它不会顺手上站。
 */
export default defineConfig({
  lang: 'zh-CN',
  title: 'AIO 工具框架',
  titleTemplate: ':title | magireco-aio-tool-framework',
  description:
    '把散落在 10 个仓库里的能力缝成一套系统的开源框架：能力契约、可插拔资源面、插件内核。',

  cleanUrls: true,
  lastUpdated: true,
  srcExclude: ['reports/**'],

  // 指向仓库文件（而非站点页面）的链接一律写成完整的 GitHub 地址，所以正常情况
  // 下这条兜不到任何东西。留着是因为死链检查默认让整次构建失败，而一篇文档里
  // 多一个 `../` 不该把发布卡住——它会在构建日志里报出来。
  ignoreDeadLinks: [/^\.\.\//],

  sitemap: { hostname: ORIGIN },

  head: [
    ['meta', { name: 'theme-color', content: '#7aa2ff' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:site_name', content: 'AIO 工具框架' }],
    ['meta', { property: 'og:url', content: `${ORIGIN}/` }],
  ],

  themeConfig: {
    outline: { level: [2, 3], label: '本页目录' },

    nav: [
      { text: '指南', link: '/guide/', activeMatch: '^/guide/' },
      { text: '架构', link: '/AIO-ARCHITECTURE', activeMatch: '^/(AIO-|CMS-|VIEWER-|CONSTRAINTS)' },
      { text: 'ADR', link: '/adr/0001-自研内核而非微前端框架', activeMatch: '^/adr/' },
      {
        text: '仓库',
        link: 'https://github.com/MagirecoCN-Revival-Project/magireco-aio-tool-framework',
      },
    ],

    sidebar: [
      {
        text: '上手',
        items: [
          { text: '这是什么', link: '/guide/' },
          { text: '装上并跑起来', link: '/guide/getting-started' },
          { text: '六个能力，怎么用', link: '/guide/capabilities' },
        ],
      },
      {
        text: '三层',
        items: [
          { text: '资源面：ref 与 provider', link: '/guide/resources' },
          { text: '契约与一致性套件', link: '/guide/contracts' },
          { text: '内核：注册、派发、治理', link: '/guide/kernel' },
          { text: '边缘半边：路由、SEO、下架', link: '/guide/edge' },
          { text: '嵌出去：给别的站用', link: '/guide/embed' },
        ],
      },
      {
        text: '写与发',
        items: [
          { text: '写一个插件', link: '/PLUGIN-AUTHORING' },
          { text: '守卫与铁律', link: '/guide/guards' },
          { text: '部署与域名', link: '/guide/deploy' },
        ],
      },
      {
        text: '设计文档',
        items: [
          { text: '架构', link: '/AIO-ARCHITECTURE' },
          { text: 'CMS 跑在 EdgeOne 上', link: '/CMS-ON-EDGEONE' },
          { text: '路线图', link: '/AIO-ROADMAP' },
          { text: '硬约束', link: '/CONSTRAINTS' },
          { text: '查看器迁移手册', link: '/VIEWER-REFACTOR' },
        ],
      },
      {
        text: 'ADR',
        items: [
          { text: '0001 自研内核而非微前端框架', link: '/adr/0001-自研内核而非微前端框架' },
          { text: '0002 抽象成资源可插拔的开源系统', link: '/adr/0002-抽象成资源可插拔的开源系统' },
        ],
      },
    ],

    socialLinks: [
      {
        icon: 'github',
        link: 'https://github.com/MagirecoCN-Revival-Project/magireco-aio-tool-framework',
      },
    ],

    editLink: {
      pattern:
        'https://github.com/MagirecoCN-Revival-Project/magireco-aio-tool-framework/edit/main/docs/:path',
      text: '在 GitHub 上编辑此页',
    },

    lastUpdatedText: '最后更新',
    docFooter: { prev: '上一页', next: '下一页' },
    darkModeSwitchLabel: '主题',
    returnToTopLabel: '回到顶部',
    sidebarMenuLabel: '菜单',

    search: { provider: 'local' },

    footer: {
      message:
        'GPLv3。素材版权归各自的版权方所有，本站与本仓库不含任何素材。',
      copyright: 'MagirecoCN Revival Project',
    },
  },
});
