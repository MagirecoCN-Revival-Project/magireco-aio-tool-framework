package run.halo.aio.viewer;

import org.springframework.stereotype.Component;
import run.halo.app.plugin.BasePlugin;
import run.halo.app.plugin.PluginContext;

/**
 * Halo lifecycle shell inherited from aioviewer 0.1.0.
 *
 * The Story Router bridge is intentionally a console-only UI extension. The
 * plugin adds no backend API and therefore does not proxy or host story data.
 */
@Component
public class AioViewerPlugin extends BasePlugin {
    public AioViewerPlugin(PluginContext pluginContext) {
        super(pluginContext);
    }

    @Override
    public void start() {
    }

    @Override
    public void stop() {
    }
}
