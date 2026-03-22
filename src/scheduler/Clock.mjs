/** Holds various *clock signal* classes. Each clock represents a different timing primitive for
 * scheduling async work. Clocks are ranked by priority — lower rank means higher priority (runs
 * sooner in the event loop).
 *
 * The rank is encoded as a bitmask, where each clock occupies a single bit. The mask for a clock
 * includes all higher-priority clocks' bits ORed together with its own. This allows the scheduler
 * to efficiently determine which queues to flush: flushing a clock flushes all queues whose rank
 * bit is set in the clock's mask.
 *
 * Clocks are singletons for the deterministic ticks (microtask, promise, tick, message) and created
 * per-timeout for parameterized ticks (timeout(N), idle(N)).
 */

/** Coerces millisecond delay argument to a non-negative 32-bit integer
 * @param {number} v Millisecond delay
 * @returns {number}
 * @private
 */
function timeoutToInt(v) {
	v = Math.trunc(+v);
	if (isNaN(v) || v < 0 || v > 2147483647)
		return 0;
	return v;
}

/** Base interface for all clock signals. A clock represents a single timing primitive
 * (e.g. microtask, animation frame, setTimeout) that can schedule an async flush callback.
 * Clocks are not instantiated directly — use the concrete subclasses or {@link getClock}.
 * @interface
 */
/**
 * Priority rank as a single bit. Lower bit position = higher priority
 * @name Clock.rank
 * @type {number}
 * @static
 */
/**
 * Bitmask including this clock's rank and all higher-priority clock ranks
 * @name Clock.mask
 * @type {number}
 * @static
 */
/**
 * Whether this clock type accepts a timeout parameter
 * @name Clock.hasTimeout
 * @type {boolean}
 * @static
 */
/**
 * Whether this clock's async callback is currently scheduled
 * @name Clock#scheduled
 * @type {boolean}
 * @default false
 */
/**
 * Bound function to call when the clock fires. Set by the scheduler
 * @name Clock#onflush
 * @type {?function}
 */
/**
 * Schedule the clock's async callback
 * @name Clock#schedule
 * @function
 */
/**
 * Cancel a previously scheduled callback. Not all clocks support this; those that do will
 * have an `unschedule` method. Cancelable clocks also store a scheduler id in `_sid`.
 * @name Clock#unschedule
 * @function
 */

// --- Deterministic Clocks ---
// These fire in a well-defined order relative to the event loop

/** Called as a microtask, which runs after the current task completes. This uses
 * `queueMicrotask` internally.
 * @implements Clock
 */
export class MicrotaskClock {
	static rank = 0b1;
	static mask = MicrotaskClock.rank;
	static hasTimeout = false;
	scheduled = false;
	onflush = null;
	schedule() {
		this.scheduled = true;
		queueMicrotask(this.onflush);
	}
}

/** Called as a microtask from the runtime's promise microtask queue. Most likely behaves like
 * a lower priority microtask. This uses `Promise.resolve()` internally.
 * @implements Clock
 */
export class PromiseClock {
	static rank = MicrotaskClock.rank << 1;
	static mask = MicrotaskClock.mask | PromiseClock.rank;
	static hasTimeout = false;
	scheduled = false;
	onflush = null;
	schedule() {
		this.scheduled = true;
		Promise.resolve().then(this.onflush);
	}
}

/** Called on the next tick, a special queue specific to NodeJS. It can be thought of as a
 * higher priority microtask that runs before promises and plain microtasks. This uses
 * `process.nextTick` internally.
 * @implements Clock
 */
export class TickClock {
	static rank = PromiseClock.rank << 1;
	static mask = PromiseClock.mask | TickClock.rank;
	static hasTimeout = false;
	scheduled = false;
	onflush = null;
	schedule() {
		this.scheduled = true;
		process.nextTick(this.onflush);
	}
}

/** Called as a message in a `MessageChannel`, which historically can be called faster than a
 * zero delay timeout, but still not immediately.
 * @implements Clock
 */
export class MessageClock {
	static rank = TickClock.rank << 1;
	static mask = TickClock.mask | MessageClock.rank;
	static hasTimeout = false;
	scheduled = false;
	onflush = null;
	constructor() {
		this._channel = new MessageChannel();
	}
	schedule() {
		this.scheduled = true;
		this._channel.port1.onmessage = this.onflush;
		this._channel.port2.postMessage(null);
	}
}

// --- Timer-based Clocks ---
// These fire based on timeouts or external signals; nondeterministic timing

/** Called as a new task using `setImmediate`. Currently only NodeJS supports this interface.
 * @implements Clock
 */
export class ImmediateClock {
	static rank = MessageClock.rank << 1;
	static mask = MessageClock.mask | ImmediateClock.rank;
	static hasTimeout = false;
	scheduled = false;
	onflush = null;
	_sid = null;
	schedule() {
		this.scheduled = true;
		this._sid = setImmediate(this.onflush);
	}
	unschedule() {
		this.scheduled = false;
		clearImmediate(this._sid);
		this._sid = null;
	}
}

/** Called as a new task with zero delay using `setTimeout`. Many runtimes enforce a minimum
 * delay internally (e.g. ~4ms).
 * @implements Clock
 */
export class TimeoutClock {
	static rank = ImmediateClock.rank << 1;
	static mask = ImmediateClock.mask | TimeoutClock.rank;
	static hasTimeout = false;
	scheduled = false;
	onflush = null;
	_sid = null;
	schedule() {
		this.scheduled = true;
		this._sid = setTimeout(this.onflush);
	}
	unschedule() {
		this.scheduled = false;
		clearTimeout(this._sid);
		this._sid = null;
	}
}

/** Called as a new task after a specified delay using `setTimeout`. Each unique timeout gets
 * its own clock instance. The timeout defines a *resolution* contract: subscribers are notified
 * with at most N ms staleness.
 * @implements Clock
 */
export class TimeoutDelayClock {
	static rank = TimeoutClock.rank << 1;
	static mask = TimeoutClock.mask | TimeoutDelayClock.rank;
	static hasTimeout = true;
	scheduled = false;
	onflush = null;
	_sid = null;
	/** @param {number} timeout Delay in milliseconds; must be > 0 */
	constructor(timeout) {
		/** The delay in milliseconds for this clock
		 * @type {number}
		 */
		this.timeout = timeoutToInt(timeout);
		if (!this.timeout)
			throw new Error("Non-zero timeout required for timeout clock");
	}
	schedule() {
		this.scheduled = true;
		this._sid = setTimeout(this.onflush, this.timeout);
	}
	unschedule() {
		this.scheduled = false;
		clearTimeout(this._sid);
		this._sid = null;
	}
}

/** Called before the browser repaints, typically around 30/60fps. May be delayed indefinitely
 * if the page is a background window. This uses `requestAnimationFrame` internally.
 * @implements Clock
 */
export class AnimationClock {
	static rank = TimeoutDelayClock.rank << 1;
	static mask = TimeoutDelayClock.mask | AnimationClock.rank;
	static hasTimeout = false;
	scheduled = false;
	onflush = null;
	_sid = null;
	schedule() {
		this.scheduled = true;
		this._sid = requestAnimationFrame(this.onflush);
	}
	unschedule() {
		this.scheduled = false;
		cancelAnimationFrame(this._sid);
		this._sid = null;
	}
}

/** Called when the event loop is idle, with a timeout fallback. Each unique timeout gets its
 * own clock instance. This uses `requestIdleCallback` internally.
 * @implements Clock
 */
export class IdleDelayClock {
	static rank = AnimationClock.rank << 1;
	static mask = AnimationClock.mask | IdleDelayClock.rank;
	static hasTimeout = true;
	scheduled = false;
	onflush = null;
	_sid = null;
	/** @param {number} timeout Fallback delay in milliseconds; must be > 0 */
	constructor(timeout) {
		/** The fallback delay in milliseconds for this clock
		 * @type {number}
		 */
		this.timeout = timeoutToInt(timeout);
		if (!this.timeout)
			throw new Error("Non-zero timeout required for idle clock");
	}
	schedule() {
		this.scheduled = true;
		this._sid = requestIdleCallback(this.onflush, {timeout: this.timeout});
	}
	unschedule() {
		this.scheduled = false;
		cancelIdleCallback(this._sid);
		this._sid = null;
	}
}

/** Called when the event loop is idle, with no timeout fallback. This uses
 * `requestIdleCallback` internally.
 * @implements Clock
 */
export class IdleClock {
	static rank = IdleDelayClock.rank << 1;
	static mask = IdleDelayClock.mask | IdleClock.rank;
	static hasTimeout = false;
	scheduled = false;
	onflush = null;
	_sid = null;
	schedule() {
		this.scheduled = true;
		this._sid = requestIdleCallback(this.onflush);
	}
	unschedule() {
		this.scheduled = false;
		cancelIdleCallback(this._sid);
		this._sid = null;
	}
}

// --- Clock Registry ---

/** Maps mode strings to clock classes
 * @type {Object<string, function>}
 */
export const clockClasses = {
	microtask: MicrotaskClock,
	promise: PromiseClock,
	tick: TickClock,
	message: MessageClock,
	immediate: ImmediateClock,
	timeout: TimeoutClock,
	animation: AnimationClock,
	idle: IdleClock,
};

/** Singleton clocks for non-parameterized modes
 * @private
 */
const singletons = {};

/** Parameterized clocks indexed by mode+timeout
 * @private
 */
const parameterized = {};

/** Get or create a clock for a given mode and optional timeout
 * @param {string} mode Clock mode name
 * @param {number} [timeout=-1] Timeout for parameterized clocks (timeout(N), idle(N))
 * @returns {object} A clock instance
 */
export function getClock(mode, timeout=-1) {
	// parameterized clock (timeout delay or idle delay)
	if (timeout > 0) {
		if (mode === "timeout") {
			const key = "timeout_" + timeout;
			let clock = parameterized[key];
			if (!clock)
				clock = parameterized[key] = new TimeoutDelayClock(timeout);
			return clock;
		}
		if (mode === "idle") {
			const key = "idle_" + timeout;
			let clock = parameterized[key];
			if (!clock)
				clock = parameterized[key] = new IdleDelayClock(timeout);
			return clock;
		}
		throw Error("Clock mode '" + mode + "' does not support a timeout parameter");
	}
	// singleton clock
	let clock = singletons[mode];
	if (!clock) {
		const Clazz = clockClasses[mode];
		if (!Clazz)
			throw Error("Unknown clock mode: " + mode);
		clock = singletons[mode] = new Clazz();
	}
	return clock;
}
