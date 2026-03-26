/**
 * ## Overview
 *
 * The scheduler coordinates async subscriber notifications across different timing primitives
 * (microtask, setTimeout, requestAnimationFrame, etc). It enforces the rule:
 *
 * > To flush tick of priority X, all ticks with priority < X must be flushed and empty
 *
 * This means recursive notifications at different priority levels complete in a single tick,
 * preventing janky half-updated state across multiple animation frames or timeouts.
 *
 * ## Data Flow
 *
 * ```
 * Reactive.notify()
 *   → Link.enqueue()
 *     → SchedulerQueue.enqueue(subscriber)        [v1.0 interface adapter]
 *       → Scheduler.enqueue(clock, subscriber)     [manages clock lifecycle]
 *         → RankedQueue.enqueue(clock, subscriber) [routes by clock rank bitmask]
 *           → FIFOQueue.enqueue(subscriber)        [non-timeout: direct FIFO]
 *           → RankedTimeoutQueue.enqueue(clock, subscriber)  [timeout: second-level routing]
 *             → FIFOQueue.enqueue(subscriber)      [per-timeout FIFO]
 * ```
 *
 * ## Flush Flow
 *
 * When a clock fires (or flush is called manually):
 *
 * ```
 * Clock fires (onflush)
 *   → RankedQueue.flush(clock, mask)
 *     while (nonemptyMask & mask):
 *       find lowest-rank non-empty queue
 *       → FIFOQueue.flush()                      [non-timeout: drain double buffer]
 *       → RankedTimeoutQueue.flush(clock)         [timeout: drain sub-queues <= timeout]
 *         while (nonempty, sorted ascending):
 *           → FIFOQueue.flush()
 *       loop back to check if lower-rank refilled
 * ```
 *
 * ## Component Responsibilities
 *
 * - **Clock** (Clock.mjs): Timing primitive. Owns one OS-level timer, a `scheduled` flag,
 *   and `schedule()`/`unschedule()` methods. Static `rank`/`mask`/`hasTimeout` define its
 *   priority tier. Singletons for deterministic clocks, per-timeout instances for parameterized.
 *
 * - **FIFOQueue**: Double-buffered FIFO for a single clock rank. Handles recursive flushes
 *   via shared iterator — a recursive flush drains the same iterator the outer call is
 *   iterating. Supports mid-iteration dequeue by nulling slots.
 *
 * - **RankedTimeoutQueue**: Second-level nesting for `hasTimeout` clocks. Maps timeout values
 *   to per-timeout FIFOQueues. Flushes in ascending timeout order (smaller timeout = higher
 *   priority within the tier). Reaps empty sub-queues when count exceeds threshold.
 *
 * - **RankedQueue**: Top-level dispatcher. Maps clock rank bitmasks to FIFOQueue (non-timeout)
 *   or RankedTimeoutQueue (timeout). Uses `nonemptyMask` bitmask for fast empty checking.
 *   Flush loop finds lowest non-empty rank via `masked & -masked` bit trick, drains it,
 *   repeats until all ranks in mask are empty. Tracks `partialMask` for timeout ranks that
 *   can't fully drain (higher timeout sub-queues remain).
 *
 * - **Scheduler**: Entry point. Manages clock→queue coordination. Schedules clocks when
 *   subscribers are enqueued, unschedules when their queue drains. Creates the bound
 *   flush callback bound in the clock's constructor.
 *
 * - **SchedulerQueue**: Adapter bridging the v1.0 Queue interface (enqueue/dequeue/flush/qid)
 *   to the v2.0 Scheduler, so existing Reactive.subscribe/Link infrastructure works without
 *   modification.
 */
import { Queue } from "../Queue.mjs";


/** Sentinel clock object used when a non-timeout clock triggers a flush that includes a
 * timeout rank. In that case, all timeout sub-queues should drain (the triggering clock has
 * higher rank than all timeouts, so they all satisfy the resolution contract).
 * @private
 */
const _maxTimeoutClock = { timeout: Infinity, constructor: { rank: -1 } };


/** Interface for queues used by {@link RankedQueue}. Both {@link FIFOQueue} and
 * {@link RankedTimeoutQueue} implement this interface.
 * @interface SchedulerInternalQueue
 */
/**
 * Add subscriber to queue for given clock
 * @name SchedulerInternalQueue#enqueue
 * @function
 * @param {Clock} clock Clock instance
 * @param {Subscriber} subscriber
 */
/**
 * Remove subscriber from queue. Raises error if not previously subscribed
 * @name SchedulerInternalQueue#dequeue
 * @function
 * @param {Clock} clock Clock instance
 * @param {Subscriber} subscriber
 * @returns {boolean} true if the queue (or clock-specific sub-queue) became empty; for nested
 *  queues, this is indicating if the bottom level queue associated with the clock became empty, not
 *  the parent container queues
 */
/**
 * Whether the queue has no pending subscribers
 * @name SchedulerInternalQueue#empty
 * @type {boolean}
 */
/**
 * Flush all queued subscribers
 * @name SchedulerInternalQueue#flush
 * @function
 * @param {Clock} clock Clock that triggered the flush
 */
/**
 * Optional: check if the queue can make progress for the given clock. If defined and returns
 * false, the flush loop skips this queue for the current pass. Used by queues that support
 * partial flushing (e.g. RankedTimeoutQueue only flushes sub-queues with timeout <= the
 * triggering clock's timeout).
 * @name SchedulerInternalQueue#canFlush
 * @function
 * @param {Clock} clock Clock that triggered the flush
 * @returns {boolean}
 */


/** Holds a ranked list of queues keyed by clock rank bitmask. Clock ranks must be unique. Allows
 * flushing a queue of a certain rank, with the constraint that all queues of lower rank (higher
 * priority) will be flushed and emptied first. Limited to 32 queue types due to bitmask.
 *
 * For non-timeout ranks, each rank maps directly to a FIFOQueue. For timeout ranks (where
 * clock.constructor.hasTimeout is true), the rank maps to a RankedTimeoutQueue which provides
 * a second level of ordering by timeout value.
 * @implements SchedulerInternalQueue
 * @private
 */
class RankedQueue {
	/** Bitmask of ranks that have non-empty queues
	 * @type {number}
	 */
	nonemptyMask = 0;
	/** Mapping from clock rank (as string) to FIFOQueue or RankedTimeoutQueue. Object is used
	 * instead of Map since it's ~5x faster, even with the string serialization overhead. Array
	 * could be used, but then we wouldn't be able to use the nonemptyMask (e.g. converting from
	 * rank mask to array index has no fast operation in Javascript). The actual queues will be
	 * sparse; typically only a couple are used.
	 * @type {Object<string, FIFOQueue | RankedTimeoutQueue>}
	 */
	queues = {};

	/** Ensure a queue exists for the given clock's rank
	 * @param {Clock} clock A clock instance
	 * @returns {FIFOQueue | RankedTimeoutQueue}
	 * @private
	 */
	_ensureQueue(clock) {
		const rank = clock.constructor.rank;
		// protect against trying to queue on _maxTimeoutClock sentinel
		if (rank < 1)
			throw Error("Clock ranks must be strictly positive")
		let queue = this.queues[rank];
		if (!queue) {
			const Clazz = clock.constructor.queueClass || FIFOQueue;
			queue = this.queues[rank] = new Clazz(clock);
		}
		return queue;
	}

	// --- Queue interface ---
	get empty(){
		return !this.nonemptyMask;
	}
	enqueue(clock, subscriber) {
		const rank = clock.constructor.rank;
		this._ensureQueue(clock).enqueue(clock, subscriber);
		this.nonemptyMask |= rank;
	}
	dequeue(clock, subscriber) {
		const rank = clock.constructor.rank;
		const queue = this.queues[rank];
		if (!queue) throw Error("No queue for clock rank; was the subscriber enqueued?");
		const becameEmpty = queue.dequeue(clock, subscriber);
		if (queue.empty)
			this.nonemptyMask &= ~rank;
		return becameEmpty;
	}
	/** Flush queues up to and including the given clock's mask. Flushing is ordered so that a queue
	 * is only flushed once all queues of lower rank are empty. Queues may refill during flush (from
	 * recursive notifications); we allow this for batching, then repeat until all queues covered by
	 * the mask are completely empty.
	 *
	 * Queues that support partial flushing (e.g. RankedTimeoutQueue) may not fully drain. These
	 * are tracked in `partialMask` and retried only if `queue.canFlush(clock)` returns true,
	 * indicating new flushable work was enqueued by a subsequent flush.
	 * @param {Clock} clock The clock that triggered the flush; used for sub-queue routing
	 * @param {number} mask Bitmask of clock ranks to flush
	 */
	flush(clock, mask) {
		// Queues that support partial flushing (via canFlush) may not fully drain. We track
		// skipped ranks in `skipMask` to avoid infinite re-checking. After each successful
		// flush, reset skipMask since the flush may have enqueued new work into a
		// previously-skipped rank. The canFlush re-check on retry is cheap (heap peek).
		let skipMask = 0;
		while (true) {
			const masked = this.nonemptyMask & mask & ~skipMask;
			if (!masked)
				return;
			const lowest = masked & -masked;
			const queue = this.queues[lowest];
			const flushClock = (lowest === clock.constructor.rank) ? clock : _maxTimeoutClock;
			if (queue.canFlush && !queue.canFlush(flushClock)) {
				skipMask |= lowest;
				continue;
			}
			queue.flush(flushClock);
			if (queue.empty)
				this.nonemptyMask &= ~lowest;
			// reset skipMask: this flush may have enqueued into a skipped rank;
			// need to loop through all queues again and check canFlush again
			skipMask = 0;
		}
	}
}


/** Min-heap of items ordered by `.timeout` property. Uses single-assignment shift (not swap)
 * during sift operations — saves the moved element, shifts parents/children into its place one
 * at a time, then writes the saved element at its final position. This halves the number of
 * assignments and heapIndex updates per sift step compared to swapping. Benchmarked to be
 * 15-46% faster than swap-based approach at 5-15 items, with no measurable difference between
 * inlined and method-based sift (V8 inlines automatically).
 *
 * Items must have a `.timeout` number property (sort key) and a `.heapIndex` number property
 * (tracked position, set to -1 when not in heap).
 * @private
 */
class TimeoutHeap {
	data = [];
	get empty() { return !this.data.length; }
	get length() { return this.data.length; }
	peek() { return this.data[0]; }
	push(item) {
		const h = this.data;
		h.push(null);
		const i = this._siftUp(h.length - 1, item);
		h[i] = item;
		item.heapIndex = i;
	}
	remove(item) {
		const h = this.data;
		const idx = item.heapIndex;
		item.heapIndex = -1;
		if (idx === h.length - 1) {
			h.pop();
			return;
		}
		const moved = h.pop();
		// root can only sift down; others check parent to decide direction
		let i;
		if (idx === 0 || moved.timeout >= h[(idx - 1) >> 1].timeout)
			i = this._siftDown(idx, moved);
		else
			i = this._siftUp(idx, moved);
		h[i] = moved;
		moved.heapIndex = i;
	}
	/** Sift an item up from position i, shifting parents down. Returns final position.
	 * Does not write the item — caller must do `h[returned] = item`.
	 * @private
	 */
	_siftUp(i, item) {
		const h = this.data;
		while (i > 0) {
			const parent = (i - 1) >> 1;
			if (item.timeout >= h[parent].timeout) break;
			h[i] = h[parent];
			h[i].heapIndex = i;
			i = parent;
		}
		return i;
	}
	/** Sift an item down from position i, shifting children up. Returns final position.
	 * Does not write the item — caller must do `h[returned] = item`.
	 * @private
	 */
	_siftDown(i, item) {
		const h = this.data;
		const n = h.length;
		while (true) {
			let child = (i << 1) + 1;
			if (child >= n) break;
			const right = child + 1;
			if (right < n && h[right].timeout < h[child].timeout)
				child = right;
			if (item.timeout <= h[child].timeout) break;
			h[i] = h[child];
			h[i].heapIndex = i;
			i = child;
		}
		return i;
	}
}

/** Holds a list of FIFOQueues ranked by ascending timeout value. When flushing for a given
 * timeout, all sub-queues with timeout <= the triggering timeout are flushed. This provides
 * the second level of nesting for timeout-parameterized clocks (timeout(N), idle(N)).
 *
 * Non-empty sub-queues are tracked in a min-heap ordered by timeout, so the smallest timeout
 * (highest priority) is always at the root. Benchmarks show a min-heap outperforms sort-based
 * approaches for mixed insert/remove workloads at all practical sizes (2-15 unique timeouts),
 * with 3-5x speedup at 8-15 items.
 *
 * Design: timeout(N) is a *resolution* contract — "notify with at most N ms staleness."
 * When timeout(1000) fires, anything that wanted ≤ 1000ms resolution is satisfied, so
 * timeout(100) and timeout(500) are drained too.
 * @implements SchedulerInternalQueue
 * @private
 */
export class RankedTimeoutQueue {
	/** How many timeout sub-queues can exist before we start reaping empty ones
	 * @type {number}
	 */
	static reapThreshold = 15;
	/** Number of sub-queues created. If user is creating many unique timeouts, we start reaping
	 * empty queues to save memory. We assume if user has many unique timeouts, then each queue is
	 * likely one-time use
	 * @type {number}
	 */
	count = 0;
	/** Mapping from timeout (serialized as string) to queue. Object is used instead of Map since
	 * its 5x faster, even with the string serialization overhead
	 * @type {Object<string, FIFOQueue>}
	 */
	index = {};
	/** Min-heap of non-empty sub-queues, ordered by ascending timeout
	 * @type {TimeoutHeap}
	 */
	heap = new TimeoutHeap();

	/** The smallest timeout among non-empty sub-queues, or Infinity if empty
	 * @type {number}
	 */
	get minTimeout(){
		return this.heap.empty ? Infinity : this.heap.peek().timeout;
	}
	/** Whether this queue has work that can be flushed for the given clock. Returns false
	 * if all remaining sub-queues have timeout > the clock's timeout.
	 * @param {Clock} clock
	 * @returns {boolean}
	 */
	canFlush(clock) {
		return this.minTimeout <= clock.timeout;
	}
	/** Reap empty queues. Protection for pathological cases where consumer is creating many random
	 * timeouts, so memory doesn't grow unbounded
	 * @param {number} timeout
	 * @private
	 */
	_reap(timeout) {
		if (this.count >= RankedTimeoutQueue.reapThreshold) {
			delete this.index[timeout];
			this.count--;
		}
	}
	/** Get or create a sub-queue for the given timeout
	 * @param {number} timeout
	 * @returns {FIFOQueue}
	 * @private
	 */
	_ensureSubQueue(clock) {
		const timeout = clock.timeout;
		let queue = this.index[timeout];
		if (!queue) {
			this.count++;
			queue = this.index[timeout] = new FIFOQueue(clock);
			queue.timeout = timeout;
			queue.heapIndex = -1;
		}
		return queue;
	}

	// --- Queue interface ---
	get empty(){
		return this.heap.empty;
	}
	enqueue(clock, subscriber) {
		const queue = this._ensureSubQueue(clock);
		queue.enqueue(clock, subscriber);
		// first subscriber, add to nonempty heap
		if (queue.heapIndex === -1)
			this.heap.push(queue);
	}
	dequeue(clock, subscriber) {
		const queue = this.index[clock.timeout];
		if (!queue)
			throw Error("No sub-queue for timeout; was the subscriber enqueued?");
		const becameEmpty = queue.dequeue(clock, subscriber);
		if (becameEmpty) {
			this.heap.remove(queue);
			this._reap(queue.timeout);
		}
		return becameEmpty;
	}
	/** Flush all sub-queues with timeout <= the triggering clock's timeout
	 * @param {Clock} clock Clock instance with a timeout property
	 */
	flush(clock) {
		const timeout = clock.timeout;
		while (!this.heap.empty) {
			const queue = this.heap.peek();
			// stop when all <= timeout have been flushed
			if (queue.timeout > timeout)
				return;
			// flush this sub-queue; don't remove from heap before flush because
			// recursive flush needs the heap intact to find sub-queues
			Queue.called();
			queue.flush(clock);
			// FIFOQueue.flush guarantees empty on return; remove from heap. Need to check presence
			// after flush since recursive flush or dequeues could have removed it already.
			if (queue.heapIndex !== -1)
				this.heap.remove(queue);
			this._reap(queue.timeout)
		}
	}
}


/** FIFO, double buffered queue for a single clock rank. Accommodates subscribers which
 * recursively push to the buffer during flush. Uses double buffering for fast push operations
 * at the expense of doubling memory.
 * @implements SchedulerInternalQueue
 * @private
 */
class FIFOQueue {
	/** Null values in queue before compacting the buffer */
	static compactLimit = 500
	/** Clock identifier passed to subscriber.call() during flush
	 * @type {Symbol}
	 */
	clockId;
	/** @param {Clock} clock Clock this queue is associated with */
	constructor(clock) {
		this.clockId = clock.id;
	}
	/** Generator for subscribers currently being flushed */
	iter = null;
	/** Number of live (non-null) subscribers in {@link buffer}
	 * @type {number}
	 */
	_bufferQueued = 0;
	/** Buffer of newly added subscribers */
	buffer = [];
	/** Buffer of subscribers currently being flushed */
	flushBuffer = [];

	get empty() {
		return !this._bufferQueued && !this.iter;
	}
	/** Add subscriber to queue. Caller is responsible for ensuring the subscriber is not
	 * already enqueued (e.g. via a dirty flag on the subscriber/link). Enqueuing the same
	 * subscriber twice without an intervening dequeue will result in duplicate notifications.
	 * Additionally, dequeue removes only the first occurrence, so a double-enqueue could
	 * leave a stale entry that gets notified after the subscriber has been logically removed.
	 * @param {Clock} clock Clock instance (unused by FIFOQueue, accepted for uniform interface)
	 * @param {Subscriber} subscriber
	 */
	enqueue(clock, subscriber) {
		this._bufferQueued++;
		this.buffer.push(subscriber);
	}
	/** Remove subscriber from queue. Nulls the slot in whichever buffer the subscriber is
	 * found in, avoiding O(n) splice. Nulls are skipped during flush and cleaned up on
	 * buffer swap.
	 * @param {Clock} clock Clock instance (unused by FIFOQueue, accepted for uniform interface)
	 * @param {Subscriber} subscriber
	 * @returns {boolean} true if the queue became empty as a result of this dequeue
	 */
	dequeue(clock, subscriber) {
		let idx = this.buffer.lastIndexOf(subscriber);
		if (idx !== -1){
			this.buffer[idx] = null;
			// compact the buffer if too many dequeued; protection in pathological, nonstandard case
			// to avoid buffer growing unbounded
			if (this.buffer.length - --this._bufferQueued > FIFOQueue.compactLimit) {
				let i = 0, j = 0;
				while (i < this._bufferQueued && j < this.buffer.length) {
					if (this.buffer[j] !== null) {
						if (i !== j)
							this.buffer[i] = this.buffer[j];
						++i;
					}
					++j;
				}
				this.buffer.length = i;
			}
			return this.empty;
		}
		if (this.flushBuffer.length){
			idx = this.flushBuffer.lastIndexOf(subscriber);
			if (idx !== -1){
				this.flushBuffer[idx] = null;
				return this.empty;
			}
		}
		throw Error("Subscriber not found in queue; was it enqueued?");
	}
	/** Flush all queued subscribers. Handles recursive flushes from within subscribers.
	 * After this method returns, the queue is guaranteed to be empty — all subscribers that
	 * were pending (including any enqueued during the flush) have been called.
	 * @param {Clock} clock Clock that triggered the flush (unused by FIFOQueue, accepted
	 *  for uniform interface)
	 */
	flush(clock) {
		Queue.called();
		const clockId = this.clockId;
		// A subscriber may call flush() recursively. Both the outer and recursive call iterate
		// this.iter via for...of, which advances the shared iterator by calling .next(). The
		// recursive call drains the iterator to completion; when it returns, the outer call's
		// for...of calls .next() once more, gets {done: true}, and exits. No explicit coordination
		// needed — the shared iterator state handles it.
		if (this.iter){
			for (const subscriber of this.iter){
				if (subscriber)
					subscriber.call(clockId);
			}
			// must clear before entering the while loop; otherwise the swap puts
			// already-processed subscribers back into flushBuffer
			this.flushBuffer.length = 0;
		}
		while (this._bufferQueued){
			const swap = this.flushBuffer;
			this.flushBuffer = this.buffer;
			this.buffer = swap;
			this._bufferQueued = 0;
			this.iter = this.flushBuffer[Symbol.iterator]();
			for (const subscriber of this.iter){
				if (subscriber)
					subscriber.call(clockId);
			}
			this.flushBuffer.length = 0;
		}
		this.iter = null;
	}
}


/** Manages clock signals and ranked queues. The scheduler is the central coordinator for
 * async notifications, replacing the per-queue scheduling of v1.0 with a unified priority
 * system.
 */
export class Scheduler {
	/** Registry of non-parameterized clock classes, keyed by mode string. Clock modules
	 * register themselves here to avoid circular imports.
	 * @type {Object<string, function(new:Clock, RankedQueue)>}
	 * @static
	 */
	static clockClasses = {};
	/** Registry of parameterized (timeout-accepting) clock classes, keyed by mode string.
	 * @type {Object<string, function(new:Clock, RankedQueue, number)>}
	 * @static
	 */
	static clockDelayClasses = {};

	/** The ranked queue holding all scheduled subscribers
	 * @type {RankedQueue}
	 * @private
	 */
	queue = new RankedQueue();
	/** Singleton clocks for non-parameterized modes, owned by this scheduler
	 * @type {Object<string, Clock>}
	 * @private
	 */
	clocks = {};
	/** Parameterized clocks indexed by mode+timeout, owned by this scheduler
	 * @type {Object<string, Clock>}
	 * @private
	 */
	clocksDelay = {};

	/** Get or create a clock for a given mode and optional timeout. The clock is owned by
	 * this scheduler — singleton clocks are shared across calls with the same mode, and
	 * parameterized clocks are shared across calls with the same mode+timeout.
	 * @param {string} mode Clock mode name (microtask, promise, tick, message, immediate,
	 *  timeout, animation, idle)
	 * @param {number} [timeout=-1] Timeout for parameterized clocks (timeout(N), idle(N))
	 * @returns {Clock} A clock instance; precondition that it belongs to this Scheduler
	 */
	getClock(mode, timeout=-1) {
		let key = mode;
		let index = this.clocks;
		if (timeout > 0) {
			index = this.clocksDelay;
			key += String(timeout);
		}
		let clock = index[key]
		// construct a new clock if first use; the clock binds onflush and schedule in its
		// constructor using the queue reference for zero-overhead dispatch
		if (!clock) {
			const Clazz = timeout > 0 ? Scheduler.clockDelayClasses[mode] : Scheduler.clockClasses[mode];
			if (!Clazz)
				throw Error(mode in Scheduler.clockClasses
					? "Clock mode does not support timeouts: " + mode
					: "Unknown clock mode: " + mode);
			clock = timeout > 0 ? new Clazz(this, timeout) : new Clazz(this);
			index[key] = clock
		}
		return clock;
	}

	/** Whether this scheduler has been stopped via {@link Scheduler#stop}. When stopped,
	 * subscribers are still enqueued but clocks will not be scheduled to flush them.
	 * @type {boolean}
	 */
	stopped = false;

	/** Enqueue a subscriber for notification on the given clock's tick. If the scheduler
	 * is stopped, the subscriber is queued but no clock is scheduled.
	 * @param {Clock} clock A clock instance (from getClock)
	 * @param {Subscriber} subscriber
	 */
	enqueue(clock, subscriber) {
		this.queue.enqueue(clock, subscriber);
		if (!clock.scheduled && !this.stopped)
			clock.schedule();
	}
	/** Dequeue a subscriber from the given clock's queue
	 * @param {Clock} clock A clock instance; precondition that it belongs to this Scheduler
	 * @param {Subscriber} subscriber
	 */
	dequeue(clock, subscriber) {
		const clockBecameEmpty = this.queue.dequeue(clock, subscriber);
		// unschedule clock if its queue just emptied and clock supports cancellation;
		// clock.scheduled may be false if dequeue is called mid-flush (flush resets
		// scheduled before draining) — no timer to cancel in that case
		if (clockBecameEmpty && clock.scheduled && clock.unschedule)
			clock.unschedule();
	}
	/** Synchronously flush queues. If a clock is provided, flushes all queues up to and including
	 * that clock's priority. If no clock is provided, flushes all queues. Unlike a clock's
	 * the clock's own flush callback, this does not reset the clock's scheduled state — the OS timer remains
	 * active and will fire as a no-op if the queue is already drained.
	 * @param {Clock} [clock] A clock instance; precondition that it belongs to this Scheduler.
	 *  If omitted, all queues are flushed.
	 */
	flush(clock) {
		if (clock)
			this.queue.flush(clock, clock.constructor.mask);
		else
			this.queue.flush(_maxTimeoutClock, 0xFFFFFFFF);
	}
	/** Stop the scheduler: cancel all pending clock timers and prevent future clock scheduling.
	 * Subscribers may still be enqueued after stopping, but no clocks will fire to flush them.
	 * Manual `flush()` / `flush(clock)` still works. Use this to cancel pending tasks to allow app
	 * shutdown.
	 */
	stop() {
		this.stopped = true;
		// cancel clocks that support it; non-cancellable clocks (microtask, promise, tick)
		// will fire and flush an empty queue — a no-op
		for (const index of [this.clocks, this.clocksDelay]){
			for (const key in index){
				const c = index[key];
				if (c.scheduled && c.unschedule)
					c.unschedule();
			}
		}
	}
}

/** The default global scheduler instance */
export const scheduler = new Scheduler();
