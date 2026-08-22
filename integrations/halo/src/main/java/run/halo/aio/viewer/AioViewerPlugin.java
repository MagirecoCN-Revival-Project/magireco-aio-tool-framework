package run.halo.aio.viewer;

import org.springframework.stereotype.Component;
import run.halo.app.plugin.BasePlugin;
import run.halo.app.plugin.PluginContext;

/**
 * 插件主类——只管生命周期，不管渲染。
 *
 * <p>渲染全在 {@code ui/}（TypeScript）。这个类存在的意义是让 Halo 的
 * <b>启停开关</b>成为整套能力的总闸：{@code plugin.yaml} 里的
 * {@code spec.enabled} 一关，Halo 卸载这个插件，控制台入口消失、
 * {@code ui/} 的 bundle 不再下发、下面注册的路由一并撤掉。
 *
 * <p>这正是框架那条「插件的两半共用一个开关」（铁律 10）在 Halo 上的兑现。
 * 在自建宿主里我们得自己维护一张「能力 → 插件 id」的对照表来做到这件事；
 * 到了这里，<b>平台自己就是那张表</b>，对照表可以扔掉。
 *
 * <p><b>这一版故意不接统一资源管线。</b>示例数据内联在 {@code ui/} 里，
 * 走 {@code StaticProvider}。目的是先验证「Halo 能不能装下这套东西」，
 * 而不是一次性把资源面也搬过来——那两件事一起做，出了问题分不清是谁的。
 */
@Component
public class AioViewerPlugin extends BasePlugin {

    public AioViewerPlugin(PluginContext pluginContext) {
        super(pluginContext);
    }

    @Override
    public void start() {
        // 这里不做任何初始化：能力的注册在浏览器侧由内核完成。
        // 后端将来要长出来的东西（自定义模型存交叉表、/embed 准入路由、
        // 下架拦截）都还没有，先不占位——空实现比假实现诚实。
    }

    @Override
    public void stop() {
    }
}
