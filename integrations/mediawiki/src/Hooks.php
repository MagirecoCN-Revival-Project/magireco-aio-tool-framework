<?php
/**
 * AioEmbed —— 让 wiki 页面用一个标签嵌入 AIO 的查看器。
 *
 *     <aio-embed capability="sprite.show" ref="a:sprite/100100/d_r" movement="idle" />
 *
 * ## 为什么是 parser tag 而不是模板
 *
 * 模板生成不了 <iframe>：wikitext 的 HTML 白名单里没有它，靠 Widgets
 * 这类扩展绕过去等于把「能写任意 HTML」这项权力发给了模板编辑者。
 * parser tag 把 HTML 的生成留在 PHP 里，wiki 编辑者只能填**属性值**，
 * 而每个属性值都在下面被校验过。
 *
 * ## 这里做的校验，与嵌入面服务端那一份是重复的——故意的
 *
 * 服务端（packages/embed）当然还会再判一次。这里再判一次是为了
 * **让编辑者当场看见错**：wiki 页面上直接渲染出一条红色提示，
 * 而不是嵌进去一个 400 的 iframe，让读者看到一块空白。
 *
 * 但**这一份不是安全边界**——安全边界永远在服务端。这里拦不住的东西
 * 服务端仍会拦，反过来不成立。
 */

namespace MediaWiki\Extension\AioEmbed;

use MediaWiki\MediaWikiServices;
use Parser;
use PPFrame;

class Hooks {

	/**
	 * 允许嵌入的能力。**白名单，不是黑名单。**
	 *
	 * 与 packages/capability 里的契约一一对应。加能力时两边都要改——
	 * 写成「什么都放行」的话，服务端将来新增一个内部能力就会当场
	 * 变成 wiki 上可嵌的，而没人会在加能力时想到 wiki。
	 */
	private const CAPABILITIES = [
		'sprite.show'  => [ 'variant', 'movement', 'paused' ],
		'live2d.show'  => [ 'motion', 'expression', 'lipSync' ],
		'adv.play'     => [ 'line', 'auto' ],
		'model3d.show' => [ 'animation' ],
		'search.query' => [ 'q' ],
		'chart.height' => [ 'compare' ],
	];

	/**
	 * kind 的白名单，与 packages/core 的 REF_KINDS 一一对应。
	 *
	 * 早先这里写的是 `[a-z0-9]+`——「反正服务端还会再判」。拿真实语料
	 * 对过一遍才发现那样会让 `a:nope/1` 在 wiki 上看起来完全正常，
	 * 而嵌进去是个 400：编辑者只会看到一块空白，去反复改标签。
	 */
	private const KINDS = [
		'character', 'sprite', 'live2d', 'model3d', 'voice',
		'scenario', 'card', 'item', 'bgm', 'image',
	];

	/**
	 * ref 的形状。与 packages/core 的 parseRef 同源：
	 * `universe:kind/段[/段…][@variant]`，**裸 ID 一律不收**。
	 */
	private const REF_RE = '#^[a-z][a-z0-9]*:([a-z0-9]+)((?:/[A-Za-z0-9._-]+)+)(@[a-z0-9-]+)?$#';

	/**
	 * `.` 与 `..` 不能单独成段。
	 *
	 * 段的字符集里有 `.`（`d_r.png` 这种是合法的），所以光靠字符集拦不住
	 * `a:character/../etc`——那正是路径穿越的形状。它不该在任何一层
	 * 看起来是合法的：服务端当然会拦，但一个「在 wiki 上显示正常、
	 * 到服务端才被拒」的穿越串会让人以为它只是写错了。
	 */
	private static function segmentsSane( string $path ): bool {
		foreach ( explode( '/', ltrim( $path, '/' ) ) as $seg ) {
			if ( $seg === '' || $seg === '.' || $seg === '..' ) {
				return false;
			}
		}
		return true;
	}

	private static function refValid( string $ref ): bool {
		if ( !preg_match( self::REF_RE, $ref, $m ) ) {
			return false;
		}
		if ( !in_array( $m[1], self::KINDS, true ) ) {
			return false;
		}
		return self::segmentsSane( $m[2] );
	}

	public static function onParserFirstCallInit( Parser $parser ): void {
		$parser->setHook( 'aio-embed', [ self::class, 'render' ] );
	}

	/** @param array<string,string> $args */
	public static function render( ?string $input, array $args, Parser $parser, PPFrame $frame ): string {
		$parser->getOutput()->addModules( [ 'ext.aioEmbed' ] );

		$config = MediaWikiServices::getInstance()->getMainConfig();
		$origin = rtrim( (string)$config->get( 'AioEmbedOrigin' ), '/' );
		if ( $origin === '' ) {
			// 没配来源就直接说出来。悄悄不渲染的话，编辑者会以为标签写错了，
			// 去反复改标签——而问题在 LocalSettings.php 里。
			return self::error( wfMessage( 'aioembed-error-no-origin' )->text() );
		}

		$capability = $args['capability'] ?? '';
		if ( !isset( self::CAPABILITIES[$capability] ) ) {
			return self::error( wfMessage( 'aioembed-error-capability', $capability )->text() );
		}

		$ref = $args['ref'] ?? '';
		if ( !self::refValid( $ref ) ) {
			// 这条提示要说清楚「为什么」：编辑者最容易写的就是裸编号。
			return self::error( wfMessage( 'aioembed-error-ref', $ref )->text() );
		}

		$query = [ 'ref' => $ref ];
		foreach ( self::CAPABILITIES[$capability] as $name ) {
			if ( isset( $args[$name] ) && $args[$name] !== '' ) {
				$query[$name] = $args[$name];
			}
		}
		$src = $origin . '/embed/' . rawurlencode( $capability ) . '?' . http_build_query( $query );

		$height = (int)$config->get( 'AioEmbedDefaultHeight' );
		if ( isset( $args['height'] ) && ctype_digit( (string)$args['height'] ) ) {
			$height = max( 80, min( 20000, (int)$args['height'] ) );
		}

		// sandbox：只给脚本与同源，不给 top-navigation、不给表单、不给弹窗。
		// 少了 allow-scripts 查看器根本跑不起来；多给一项都是白送的权限。
		//
		// referrerpolicy=no-referrer：不要把读者正在看哪个 wiki 页面
		// 顺手告诉我们的服务器。这是嵌入方该有的默认，不是我们的损失。
		$attrs = [
			'class' => 'aio-embed',
			'src' => $src,
			'height' => (string)$height,
			'loading' => 'lazy',
			'referrerpolicy' => 'no-referrer',
			'sandbox' => 'allow-scripts allow-same-origin',
			'title' => $args['title'] ?? $capability,
			'data-aio-origin' => $origin,
		];
		$html = '<iframe';
		foreach ( $attrs as $k => $v ) {
			$html .= ' ' . $k . '="' . htmlspecialchars( (string)$v, ENT_QUOTES, 'UTF-8' ) . '"';
		}
		$html .= '></iframe>';

		return '<div class="aio-embed-wrap">' . $html . '</div>';
	}

	private static function error( string $text ): string {
		return '<div class="aio-embed-error">'
			. htmlspecialchars( $text, ENT_QUOTES, 'UTF-8' )
			. '</div>';
	}
}
