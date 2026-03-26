/** Holds various *clock signal* classes. Each clock represents a different timing primitive for
 * scheduling async work. Clocks are ranked by priority — lower rank means higher priority (runs
 * sooner in the event loop).
 *
 * The rank is encoded as a bitmask, where each clock occupies a single bit. The mask for a clock
 * includes all clock ranks that should be drained when this clock flushes.
 *
 * Clocks are organized into streams:
 * - **Deterministic** (microtask, promise, tick, message): cascade into all streams. Every
 *   stream's mask includes these.
 * - **Timing** (immediate, timeout, timeout(N)): independent of animation and idle.
 * - **Animation** (animation): independent of timing and idle.
 * - **Idle** (idle(N), idle): independent of timing and animation.
 *
 * Clocks are singletons for the deterministic ticks and created per-timeout for parameterized
 * ticks (timeout(N), idle(N)).
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
 * Clocks are not instantiated directly — use {@link Scheduler#getClock}.
 *
 * All clock constructors take a {@link Scheduler} as first argument. The clock builds its
 * `onflush` and `schedule` functions in the constructor, binding to the queue for zero-overhead
 * dispatch.
 * @interface
 */
/**
 * Unique identifier for this clock instance. Used by {@link Subscriber} to key its
 * per-clock queue bookkeeping.
 * @name Clock#id
 * @type {Symbol}
 */
/**
 * Priority rank as a single bit. Lower bit position = higher priority
 * @name Clock.rank
 * @type {number}
 * @static
 */
/**
 * Bitmask including this clock's rank and all higher-priority clock ranks that must be flushed
 * before this clock's subscribers can be notified.
 * @name Clock.mask
 * @type {number}
 * @static
 */
/**
 * Whether this clock's async callback is currently scheduled. The Clock manages setting/resetting
 * the flag when schedule/unscheduled; consumers should only use this flag to know when to call
 * schedule/unschedule.
 * @name Clock#scheduled
 * @type {boolean}
 * @default false
 */
/**
 * Schedule the clock's async callback. Created in the constructor as a bound function
 * for zero-overhead dispatch.
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
// These fire in a well-defined order relative to the event loop, and cascade into all streams.

/** Called as a microtask, which runs after the current task completes. This uses
 * `queueMicrotask` internally.
 * @implements Clock
 */
export class MicrotaskClock {
	static rank = 0b10;
	static mask = MicrotaskClock.rank;
	scheduled = false;
	/** @param {Scheduler} sched */
	constructor(sched) {
		this.id = Symbol();
		this.scheduler = sched;
		const clock = this;
		const queue = sched.queue;
		const mask = MicrotaskClock.mask;
		const onflush = () => {
			clock.scheduled = false;
			queue.flush(clock, mask);
		};
		this.schedule = () => {
			clock.scheduled = true;
			queueMicrotask(onflush);
		};
	}
}

/** Called as a microtask from the runtime's promise microtask queue. Most likely behaves like
 * a lower priority microtask. This uses `Promise.resolve()` internally.
 * @implements Clock
 */
export class PromiseClock {
	static rank = MicrotaskClock.rank << 2;
	static mask = MicrotaskClock.mask | PromiseClock.rank;
	scheduled = false;
	/** @param {Scheduler} sched */
	constructor(sched) {
		this.id = Symbol();
		this.scheduler = sched;
		const clock = this;
		const queue = sched.queue;
		const mask = PromiseClock.mask;
		const onflush = () => {
			clock.scheduled = false;
			queue.flush(clock, mask);
		};
		this.schedule = () => {
			clock.scheduled = true;
			Promise.resolve().then(onflush);
		};
	}
}

/** Called on the next tick, a special queue specific to NodeJS. It can be thought of as a
 * higher priority microtask that runs before promises and plain microtasks. This uses
 * `process.nextTick` internally.
 * @implements Clock
 */
export class TickClock {
	static rank = PromiseClock.rank << 2;
	static mask = PromiseClock.mask | TickClock.rank;
	scheduled = false;
	/** @param {Scheduler} sched */
	constructor(sched) {
		this.id = Symbol();
		this.scheduler = sched;
		const clock = this;
		const queue = sched.queue;
		const mask = TickClock.mask;
		const onflush = () => {
			clock.scheduled = false;
			queue.flush(clock, mask);
		};
		this.schedule = () => {
			clock.scheduled = true;
			process.nextTick(onflush);
		};
	}
}

/** Called as a message in a `MessageChannel`, which historically can be called faster than a
 * zero delay timeout, but still not immediately.
 * @implements Clock
 */
export class MessageClock {
	static rank = TickClock.rank << 2;
	static mask = TickClock.mask | MessageClock.rank;
	scheduled = false;
	/** @param {Scheduler} sched */
	constructor(sched) {
		this.id = Symbol();
		this.scheduler = sched;
		const clock = this;
		const queue = sched.queue;
		const mask = MessageClock.mask;
		const channel = new MessageChannel();
		const onflush = () => {
			clock.scheduled = false;
			queue.flush(clock, mask);
		};
		this.schedule = () => {
			clock.scheduled = true;
			channel.port1.onmessage = onflush;
			channel.port2.postMessage(null);
		};
		this.unschedule = () => {
			clock.scheduled = false;
			channel.port1.onmessage = null;
		};
	}
}

/** Cumulative mask for all deterministic clocks. All streams include this as their base —
 * flushing any stream also drains all deterministic ticks.
 * @type {number}
 */
export const deterministicMask = MessageClock.mask;

// --- Timing Stream ---
// immediate, timeout, timeout(N). Independent of animation and idle streams.

/** Called as a new task using `setImmediate`. Currently only NodeJS supports this interface.
 * @implements Clock
 */
export class ImmediateClock {
	static rank = MessageClock.rank << 2;
	static mask = deterministicMask | ImmediateClock.rank;
	scheduled = false;
	_sid = null;
	/** @param {Scheduler} sched */
	constructor(sched) {
		this.id = Symbol();
		this.scheduler = sched;
		const clock = this;
		const queue = sched.queue;
		const mask = ImmediateClock.mask;
		const onflush = () => {
			clock.scheduled = false;
			queue.flush(clock, mask);
		};
		this.schedule = () => {
			clock.scheduled = true;
			clock._sid = setImmediate(onflush);
		};
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
	static rank = ImmediateClock.rank << 2;
	static mask = ImmediateClock.mask | TimeoutClock.rank;
	scheduled = false;
	_sid = null;
	/** @param {Scheduler} sched */
	constructor(sched) {
		this.id = Symbol();
		this.scheduler = sched;
		const clock = this;
		const queue = sched.queue;
		const mask = TimeoutClock.mask;
		const onflush = () => {
			clock.scheduled = false;
			queue.flush(clock, mask);
		};
		this.schedule = () => {
			clock.scheduled = true;
			clock._sid = setTimeout(onflush);
		};
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
	static rank = TimeoutClock.rank << 2;
	static mask = TimeoutClock.mask | TimeoutDelayClock.rank;
	scheduled = false;
	_sid = null;
	/** @param {Scheduler} sched
	 *  @param {number} timeout Delay in milliseconds; must be > 0
	 */
	constructor(sched, timeout) {
		this.id = Symbol();
		this.scheduler = sched;
		/** The delay in milliseconds for this clock
		 * @type {number}
		 */
		this.timeout = timeoutToInt(timeout);
		if (!this.timeout)
			throw new Error("Non-zero timeout required for timeout clock");
		const clock = this;
		const queue = sched.queue;
		const mask = TimeoutDelayClock.mask;
		const onflush = () => {
			clock.scheduled = false;
			queue.flush(clock, mask);
		};
		this.schedule = () => {
			clock.scheduled = true;
			clock._sid = setTimeout(onflush, clock.timeout);
		};
	}
	unschedule() {
		this.scheduled = false;
		clearTimeout(this._sid);
		this._sid = null;
	}
}

// --- Animation Stream ---
// Independent of timing and idle streams.

/** Called before the browser repaints, typically around 30/60fps. May be delayed indefinitely
 * if the page is a background window. This uses `requestAnimationFrame` internally.
 * @implements Clock
 */
export class AnimationClock {
	static rank = TimeoutDelayClock.rank << 2;
	static mask = deterministicMask | AnimationClock.rank;
	scheduled = false;
	_sid = null;
	/** @param {Scheduler} sched */
	constructor(sched) {
		this.id = Symbol();
		this.scheduler = sched;
		const clock = this;
		const queue = sched.queue;
		const mask = AnimationClock.mask;
		const onflush = () => {
			clock.scheduled = false;
			queue.flush(clock, mask);
		};
		this.schedule = () => {
			clock.scheduled = true;
			clock._sid = requestAnimationFrame(onflush);
		};
	}
	unschedule() {
		this.scheduled = false;
		cancelAnimationFrame(this._sid);
		this._sid = null;
	}
}

// --- Idle Stream ---
// Independent of timing and animation streams.

/** Called when the event loop is idle, with a timeout fallback. Each unique timeout gets its
 * own clock instance. This uses `requestIdleCallback` internally.
 * @implements Clock
 */
export class IdleDelayClock {
	static rank = AnimationClock.rank << 2;
	static mask = deterministicMask | IdleDelayClock.rank;
	scheduled = false;
	_sid = null;
	/** @param {Scheduler} sched
	 *  @param {number} timeout Fallback delay in milliseconds; must be > 0
	 */
	constructor(sched, timeout) {
		this.id = Symbol();
		this.scheduler = sched;
		/** The fallback delay in milliseconds for this clock
		 * @type {number}
		 */
		this.timeout = timeoutToInt(timeout);
		if (!this.timeout)
			throw new Error("Non-zero timeout required for idle clock");
		const clock = this;
		const queue = sched.queue;
		const mask = IdleDelayClock.mask;
		const opts = {timeout: this.timeout};
		const onflush = () => {
			clock.scheduled = false;
			queue.flush(clock, mask);
		};
		this.schedule = () => {
			clock.scheduled = true;
			clock._sid = requestIdleCallback(onflush, opts);
		};
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
	static rank = IdleDelayClock.rank << 2;
	static mask = deterministicMask | IdleDelayClock.rank | IdleClock.rank;
	scheduled = false;
	_sid = null;
	/** @param {Scheduler} sched */
	constructor(sched) {
		this.id = Symbol();
		this.scheduler = sched;
		const clock = this;
		const queue = sched.queue;
		const mask = IdleClock.mask;
		const onflush = () => {
			clock.scheduled = false;
			queue.flush(clock, mask);
		};
		this.schedule = () => {
			clock.scheduled = true;
			clock._sid = requestIdleCallback(onflush);
		};
	}
	unschedule() {
		this.scheduled = false;
		cancelIdleCallback(this._sid);
		this._sid = null;
	}
}

// --- Clock Registration ---
// Clocks register themselves on Scheduler's static maps. This avoids circular imports:
// Clock.mjs → Scheduler.mjs (for registration + RankedTimeoutQueue), but Scheduler.mjs
// does NOT import Clock.mjs.

import { Scheduler, RankedTimeoutQueue } from "./Scheduler.mjs";

// Non-parameterized clocks
Object.assign(Scheduler.clockClasses, {
	microtask: MicrotaskClock,
	promise: PromiseClock,
	tick: TickClock,
	message: MessageClock,
	immediate: ImmediateClock,
	timeout: TimeoutClock,
	animation: AnimationClock,
	idle: IdleClock,
});

// Parameterized (timeout-accepting) clocks; set queueClass for RankedTimeoutQueue routing
TimeoutDelayClock.queueClass = RankedTimeoutQueue;
IdleDelayClock.queueClass = RankedTimeoutQueue;
Object.assign(Scheduler.clockDelayClasses, {
	timeout: TimeoutDelayClock,
	idle: IdleDelayClock,
});
