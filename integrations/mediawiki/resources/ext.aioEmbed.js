/**
 * 父页这一侧：听子页报高度，把 iframe 调到内容的实际高度。
 *
 * 跨域拿不到子页的 scrollHeight（同源策略），所以只能子页自己报。
 * 这是 postMessage 在这里存在的唯一理由——不是为了「更灵活」。
 *
 * ## 🔴 event.origin 这一道不能省
 *
 * 任何页面都能给你发一条形状完全合法的消息。不校验来源的后果不是报错：
 *
 *   - 伪造 resize，把 iframe 撑成一万像素，页面被顶烂；
 *   - 伪造 entity.focused，让宿主跳到别的实体上。
 *
 * 所以每个 iframe 都把自己的来源记在 data-aio-origin 上，
 * 收到消息时**先比来源，再比是不是这个 iframe 发来的**。
 * 后者用 contentWindow 比对——光比来源的话，页面上任何一个同来源的
 * iframe 都能替别人报高度。
 */
( function () {
	'use strict';

	var CHANNEL = 'aio-embed';
	var VERSION = 1;
	var MAX_HEIGHT = 20000;

	function frames() {
		return Array.prototype.slice.call(
			document.querySelectorAll( 'iframe.aio-embed[data-aio-origin]' )
		);
	}

	function isOurs( data ) {
		return data !== null
			&& typeof data === 'object'
			&& data.channel === CHANNEL
			&& data.v === VERSION;
	}

	function apply( iframe, height ) {
		if ( typeof height !== 'number' || !isFinite( height ) ) {
			return;
		}
		if ( height < 0 || height > MAX_HEIGHT ) {
			return;
		}
		iframe.style.height = Math.ceil( height ) + 'px';
	}

	window.addEventListener( 'message', function ( e ) {
		if ( !isOurs( e.data ) ) {
			return;
		}
		// 找出「来源匹配 **且** 就是这个 window」的那个 iframe。
		var target = null;
		frames().forEach( function ( f ) {
			if ( f.getAttribute( 'data-aio-origin' ) === e.origin
				&& f.contentWindow === e.source ) {
				target = f;
			}
		} );
		if ( target === null ) {
			return;
		}

		if ( e.data.type === 'resize' || e.data.type === 'ready' ) {
			apply( target, e.data.height );
		}

		if ( e.data.type === 'event' ) {
			// 把能力事件转成一个 DOM 事件，wiki 那边想接就接，不接也不影响。
			// 用 CustomEvent 而不是全局回调：wiki 页面上可能有多个嵌入，
			// 一个全局回调分不清是谁发的。
			target.dispatchEvent( new CustomEvent( 'aio-embed-event', {
				bubbles: true,
				detail: { name: e.data.name, detail: e.data.detail }
			} ) );
		}
	} );
}() );
