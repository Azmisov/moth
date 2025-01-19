import toInt from './util.mjs';

/** Coerces millisecond delay argument to a signed 32-bit integer, greater than zero. Negative
 * values are clamped to zero. Values too large are overflowed and set to zero as well.
 * @param {number} v Millisecond delay
 */
function delayToInt(v) {
	v = toInt(v);
	return v > 2147483647 || v < 0 ? 0 : v;
}

class MicrotaskTick {
	constructor(fn) {
		this.sid =
		this.schedule = queueMicrotask.bind(null, fn);
	}
}

class PromiseTick {
	constructor(fn) {
		this.schedule = () => Promise.resolve().then(fn);
	}
}

class TickTick {
	constructor(fn) {
		this.schedule = process.nextTick.bind(null, fn);
	}
}

class MessageTick {
	constructor (fn) {
		const c = new MessageChannel();
		c.port1.onmessage = fn;
		this.schedule = c.port2.postMessage.bind(null, null)
	}
}

class ImmediateTick {
	constructor(fn) {
		this.schedule = setImmediate.bind(null, fn);
	}
}

class AnimationTick {
	constructor(fn) {
		this.schedule = () => {
			requestAnimationFrame.bind(null, fn);
		}
	}
}

class IdleTick {
	constructor(fn, delay=0) {
		this.delay = delayToInt(delay);
		if (this.delay)
			this.schedule = requestIdleCallback.bind(null, fn, {timeout: this.delay});
		else
			this.schedule = requestIdleCallback.bind(null, fn);
	}
}

class TimeoutTick {
	constructor(fn, delay=0) {
		this.delay = delayToInt(delay);
		this.schedule = setTimeout.bind(null, fn, this.delay);
	}
}

export const clock = {
	microtask: new MicrotaskTick(),
	promise: new PromiseTick(),
	tick: new TickTick(),
	message: new MessageTick(),
	immediate: new ImmediateTick(),
	animation: new AnimationTick(),
	idle: new IdleTick(),
	timeout: new TimeoutTick()
}

