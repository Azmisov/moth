/** Holds various *clock signal* classes */
import { toInt } from "../util.mjs";

/** Hold strong reference to queues that are running */
const runningQueues = [];
/** Hold strong reference to queues that are paused */
const pausedQueues = [];

function flush() {
	for (const queue of runningQueues)
		queue.flush(this);
}


/** Coerces millisecond delay argument to a signed 32-bit integer, greater than zero. Negative
 * values are clamped to zero. Values too large are overflowed and set to zero as well.
 * @param {number} v Millisecond delay
 */
function timeoutToInt(v) {
	v = toInt(v);
	return v > 2147483647 || v < 0 ? 0 : v;
}

class MicrotaskTick {
	static rank = 0b1;
	static mask = this.rank;
	constructor() {
		this.schedule = queueMicrotask.bind(null, flush.bind(this));
		this.scheduled = false;
	}
}

class PromiseTick {
	static rank = MicrotaskTick.rank << 1;
	static mask = MicrotaskTick.mask | this.rank;
	constructor() {
		this.schedule = () => Promise.resolve().then(flush.bind(this));
		this.scheduled = false;
	}
}

class TickTick {
	static rank = PromiseTick.rank << 1;
	static mask = PromiseTick.mask | this.rank;
	constructor() {
		this.schedule = process.nextTick.bind(null, flush.bind(this));
		this.scheduled = false;
	}
}

class MessageTick {
	static rank = TickTick.rank << 1;
	static mask = TickTick.mask | this.rank;
	constructor (fn) {
		const c = new MessageChannel();
		c.port1.onmessage = flush.bind(this);
		this.schedule = c.port2.postMessage.bind(null, null)
		this.scheduled = false;
	}
}

class AnimationTick {
	static rank = MessageTick.rank << 1;
	static mask = MessageTick.mask | this.rank;
	constructor() {
		// TODO: schedule timeout?
		this.schedule = requestAnimationFrame.bind(null, flush.bind(this));
		this.scheduled = false;
	}
}

class ImmediateTick {
	static rank = AnimationTick.rank << 1;
	static mask = MessageTick.mask | this.rank;
	constructor() {
		this.schedule = setImmediate.bind(null, flush.bind(this));
		this.scheduled = false;
	}
}

class TimeoutTick {
	static rank = ImmediateTick.rank << 1;
	static mask = Immediate.mask | this.rank;
	constructor() {
		this.schedule = setTimeout.bind(null, flush.bind(this));
		this.scheduled = false;
	}
}

class TimeoutDelayTick {
	static rank = TimeoutTick.rank << 1;
	static mask = TimeoutTick.mask | this.rank;
	static hasTimeout = true;
	constructor(fn, timeout) {
		this.timeout = timeoutToInt(timeout);
		if (!this.timeout)
			throw new Error("Non-zero timeout required for timeout clock")
		this.schedule = setTimeout.bind(null, flush.bind(this), this.timeout);
		this.scheduled = false;
	}
}

class IdleDelayTick {
	static rank = TimeoutDelayTick.rank << 1;
	static mask = MessageTick.mask | this.rank;
	static hasTimeout = true;
	constructor(timeout) {
		this.timeout = timeoutToInt(timeout);
		if (!this.timeout)
			throw new Error("Non-zero timeout required for idle clock")
		this.schedule = requestIdleCallback.bind(null, flush.bind(this), {timeout: this.timeout});
		this.scheduled = false;
	}
}

class IdleTick {
	static rank = IdleDelayTick.rank << 1;
	static mask = IdleDelayTick.mask | this.rank;
	constructor() {
		this.schedule = requestIdleCallback.bind(null, fn);
		this.scheduled = false;
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

