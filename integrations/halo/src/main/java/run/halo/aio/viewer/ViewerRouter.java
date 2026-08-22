package run.halo.aio.viewer;

import static org.springframework.web.reactive.function.server.RequestPredicates.GET;
import static org.springframework.web.reactive.function.server.RouterFunctions.route;

import java.util.HashMap;
import java.util.Map;
import org.springframework.context.annotation.Bean;
import org.springframework.core.io.ClassPathResource;
import org.springframework.core.io.Resource;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.server.HandlerFunction;
import org.springframework.web.reactive.function.server.RouterFunction;
import org.springframework.web.reactive.function.server.ServerResponse;
import reactor.core.publisher.Mono;
import run.halo.app.plugin.PluginContext;
import run.halo.app.theme.TemplateNameResolver;

/**
 * 前台路由。
 *
 * <p>三条：
 *
 * <pre>
 *   GET /aio                  → 渲染页面（主题的模板优先，没有就用我们自带的）
 *   GET /aio/assets/viewer.js → 前台 bundle
 *   GET /aio/assets/viewer.css
 * </pre>
 *
 * <h2>为什么自己吐静态资源</h2>
 *
 * <p>Halo 对外暴露插件静态文件是有一套路径约定的，但那是**平台行为**——
 * 而本项目在「假设平台行为」上连栽三次（EdgeOne 的静态优先、规则引擎不是快路、
 * 配额算不过账）。自己从 classpath 读出来返回，多写十几行，换掉一个假设。
 *
 * <h2>模板怎么找</h2>
 *
 * <p>{@link TemplateNameResolver#resolveTemplateNameOrDefault} 的语义是
 * 「主题里有这个模板就用主题的，没有就用 classpath 里的默认那份」。
 * 所以：
 *
 * <ul>
 *   <li>主题愿意接管样式 → 它自己写一个 {@code aio-viewer.html}，
 *       页面就长成站点该有的样子；
 *   <li>主题什么都不做 → 回落到我们自带的 {@code templates/aio-viewer.html}，
 *       页面照常能开。
 * </ul>
 *
 * <p>这比 {@code plugin-links} 那种「硬要求主题提供模板」宽容：装上就能用，
 * 想好看再让主题接管。
 */
@Component
public class ViewerRouter {

    /** 与 Halo 的模板机制约定的键，主题据此知道当前渲染的是哪个模板。 */
    private static final String TEMPLATE_ID = "_templateId";

    private static final String TEMPLATE = "aio-viewer";

    private final TemplateNameResolver templateNameResolver;
    private final PluginContext pluginContext;

    // 构造器手写，不用 Lombok：本项目的 Java 面只有这一个类需要它，
    // 为两行样板引一个注解处理器不划算（同「平台有的不重造」那条）。
    public ViewerRouter(TemplateNameResolver templateNameResolver, PluginContext pluginContext) {
        this.templateNameResolver = templateNameResolver;
        this.pluginContext = pluginContext;
    }

    @Bean
    RouterFunction<ServerResponse> aioViewerRoutes() {
        return route(GET("/aio"), pageHandler())
            .andRoute(GET("/aio/assets/viewer.js"),
                assetHandler("web/viewer.js", "application/javascript"))
            .andRoute(GET("/aio/assets/viewer.css"),
                assetHandler("web/viewer.css", "text/css"));
    }

    private HandlerFunction<ServerResponse> pageHandler() {
        return request -> templateNameResolver
            .resolveTemplateNameOrDefault(request.exchange(), TEMPLATE, TEMPLATE)
            .flatMap(templateName -> {
                Map<String, Object> model = new HashMap<>();
                model.put(TEMPLATE_ID, TEMPLATE);
                model.put("title", "AIO 查看器");
                model.put("pluginName", pluginContext.getName());
                return ServerResponse.ok().render(templateName, model);
            });
    }

    /**
     * 从 classpath 取一份资源返回。
     *
     * <p>缓存策略是**显式**的：产物文件名不带哈希（构建配置里关掉了），
     * 所以不能设长缓存——插件升级后浏览器会一直用旧的。这里用
     * {@code no-cache}：允许缓存但每次回来问一下，配合 ETag 就是一次 304。
     *
     * <p>这个取舍写在这里而不是「随便设一个」：缓存策略不写明的后果不是报错，
     * 是升级之后有人看到的还是旧版本，而且查不出来。
     */
    private HandlerFunction<ServerResponse> assetHandler(String path, String contentType) {
        return request -> {
            Resource resource = new ClassPathResource(path);
            if (!resource.exists()) {
                return ServerResponse.notFound().build();
            }
            return ServerResponse.ok()
                .contentType(MediaType.parseMediaType(contentType + ";charset=utf-8"))
                .cacheControl(CacheControl.noCache())
                .bodyValue(resource)
                .switchIfEmpty(Mono.defer(() -> ServerResponse.notFound().build()));
        };
    }
}
