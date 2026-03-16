
/** Holds a ranked list of up to 32 queues. Allows flushing a queue of a certain rank, with
 * the constraint that all queues of lower rank will be flushed and emptied first.
 */
class RankedQueue {
	/** Bitmask of queues that are non-empty */
	nonemptyMask = 0;
	/** Mapping from queue rank (serialized to string) to queue. Object is used instead of Map since
	 * its 5x faster, even with the string serialization overhead. Array could be used, but then
	 * we wouldn't be able to use the nonemptyMask (e.g. converting from rank mask to array index
	 * has no fast operation in Javascript); also, the actual queues will be sparse.
	 * @type {Object.<String, RankedTimeoutQueue | FIFOBufferedQueue>}
	 */
	queues = {};
	/** Ensure a queue exists. Typically only a couple queues are used,
	 * so they're sparsely initialized
	 */
	ensureQueue(clock) {
		const rank = clock.rank;
		let queue = this.queues[rank];
		if (!queue) {
			const clazz = rank.hasTimeout ? RankedTimeoutQueue : FIFOBufferedQueue;
			queue = this.queues[rank] = new clazz();
		}
		// timeout contains nested queues
		if (rank.hasTimeout)
			queue.ensureQueue(clock);
	}
	/** Add subscriber to notification queue. Caller is responsible for ensuring subscriber is not
	 * enqueud twice, e.g. by tracking an external queued flag. Caller is also responsible for
	 * calling {@link ensureQueue} prior.
	 */
	enqueue(subscriber) {
		const rank = subscriber.clock.rank;
		this.queues[rank].enqueue(subscriber);
		this.nonemptyMask |= rank;
	}
	/** Remove subscriber from notification queue. Caller is responsible for ensuring subscriber was
	 * previously queued.
	 */
	dequeue(subscriber) {
		const rank = subscriber.clock.rank;
		if (!this.queues[rank].dequeue(subscriber))
			this.nonemptyMask &= ~rank;
	}
	/** Flush multiple queues Flushing is ordered and repeated such that a queue is only flushed
	 *  once all queues of lower rank (and present in the mask) are empty. Note though that a lower
	 *  rank queue might refill as we are flushing; we allow this, instead of forcing the lower rank
	 *  queue to drain before continuing; this allows changes to get batched and subscribers are
	 *  only notified once. We repeat the process until all the queues are completely empty.
	 * @param {number} mask Bitmask of queues to flush. After the method returns, these queues
	 * 	are guaranteed to all be empty
	 */
	flush(clock) {
		const mask = clock.mask;
		while (true) {
			// need to read this.nonemptyMask on each loop, since flushes may recursively enqueue
			const masked = this.nonemptyMask & mask;
			if (!masked)
				return;
			// flush from lowest rank to highest; get lowest rank queue that is non-empty
			const lowest = masked & -masked;
			this.queues[lowest].flush(clock);
			this.nonemptyMask &= ~lowest;
		}
	}
}

/** Holds a list of queues ranked by ascending `timeout`. Allows flushing a queue of a certain
 * timeout, with the constraint that all queues of smaller timeout will be flushed and emptied
 * first. There's a bit more overhead in maintaining separate queues for each timeout since the
 * timeouts are not known ahead-of-time
 */
class RankedTimeoutQueue {
	/** How many timeout queues can be in {@link index} before we start reaping empty queues
	 * @type {number}
	 */
	static reapThreshold = 15;
	/** How many queues are in {@link index}. If user is creating many unique timeouts, we
	 * start reaping empty queues to save memory. We assume if user has many unique timeouts, then
	 * each queue is likely one-time use
	 * @type {number}
	 */
	count = 0;
	/** Mapping from timeout (serialized as string) to queue. Object is used instead of Map since its 5x faster, even with
	 * the string serialization overhead
	 * @type {Object.<string, FIFOBufferedQueue>}
	 */
	index = {};
	/** Nonempty queues, ordered by descending timeout
	 * TODO: experiment with heap structure instead of sorting; see which is faster
	 * TODO: experiment with using heap of subscribers prioritized by timeout, rather than having
	 * 	a separate queue for each timeout
	 * @type {FIFOBufferedQueue[]}
	 */
	nonempty = [];
	/** Whether nonempty is dirty and needs to be resorted */
	dirty = false;

	/** Whether to reap empty queues */
	get reap(){
		return this.count >= RankedTimeoutQueue.reapThreshold;
	}
	#ensureQueue(tick) {
		const timeout = tick.timeout;
		let queue = index[timeout]
		// second nesting level queue[1]
		if (!queue) {
			this.count++;
			queue = index[timeout] = new FIFOBufferedQueue()
			// inject a couple extra properties to track in nonempty list
			queue.timeout = timeout; // for sorting
			queue.nonempty = false; // whether queue is in nonempty list
		}
		return queue;
	}
	/** Ensure a queue is precreated. When  */
	ensureQueue(tick) {
		// queue starts out empty; so don't create if reaping is activated
		if (!this.reap)
			this.#ensureQueue(tick);
	}
	enqueue(tick, subscriber) {
		// ensure will create on the fly if reaping was enabled
		const queue = this.#ensureQueue(tick);
		queue.enqueue(tick, subscriber);
		// add to nonempty list if not already there
		if (!queue.nonempty) {
			queue.nonempty = true;
			this.nonempty.push(queue);
			this.dirty = true;
		}
	}
	flush(tick) {
		const ne = this.nonempty;
		const timeout = tick.timeout;
		while (ne.length) {
			// (re)sort non-empty queues by timeout descending
			if (this.dirty)
				ne.sort((a, b) => b.timeout - a.timeout);
			// idea is to repeatedly flush the smallest timeout queue (last element)
			const queue = ne[ne.length - 1];
			if (queue.timeout > timeout)
				return;
			// we'd like to pop queue now, since ensureQueue might append new values to nonempty;
			// however, if flush is called recursively, that recursive call must have a reference
			// to queue to flush; so unfortunately need to leave in and search for it later; the
			// nonempty array can change arbitrarily, e.g. queue may not even be present anymore
			queue.flush(tick);
			// search for queue; most likely at back
			const idx = ne.lastIndexOf(queue);
			if (idx !== -1) {
				queue.nonempty = false;
				// unordered delete
				const last = ne.pop();
				if (idx !== ne.length) {
					ne[idx] = last;
					this.dirty = true;
				}
			}
			// reap the queue if there are too many queues
			if (this.reap) {
				delete this.index[queue.timeout];
				this.count--;
			}
		}
	}
}

/** FIFO, double buffered queue for a single clock source. This accomodates subscribers which
 * recursively push to the buffer. We want to implement this as a dequeue; we could use Set (slow
 * performance), splice (fast for small arrays, but slow for large), linked list (medium speed,
 * large memory). Using a double buffer we use only fast push ops at expense of doubling memory;
 * seems the best compromise.
 */
class FIFOBufferedQueue {
	/** Generator for subscribers currently being flushed */
	iter = null;
	/** Buffer of newly added subscribers */
	buffer = [];
	/** Buffer of subscribers we're currently flushing */
	flushBuffer = [];
	enqueue(tick, subscriber) {
		this.buffer.push(subscriber);
	}
	/** Remove subscriber. Rarer use case, so we optimize for addition instead. Caller's
	 * responsibility to ensure subscriber was previously enqueued.
	 * @returns {boolean} true if queue is nonempty
	 */
	dequeue(tick, subscriber) {
		// we could do an unordered deletion, but we want to keep FIFO order
		// TODO: experiment with storing index in subscriber?
		const idx = this.buffer.indexOf(subscriber);
		this.buffer.splice(idx, 1);
		// TODO: remove from flushBuffer
		// >>>>>>>>>>>>>>>>>>>>>>>

		return iter || this.buffer.length;
	}
	flush(tick) {
		// resume previous iteration, which is the case if flush was called recursively by a subscriber
		if (!this.iter) {
			if (!this.buffer.length)
				return;
			this.iter = this.iterate();
		}
		while (true) {
			// this.iter is iterated by value, so no issues if a recursive call sets this.iter to null
			for (const subscriber of this.iter){
				// don't let faulty subscriber take down the whole application
				try {
					subscriber.notify();
				} catch (e) {
					subscriber.logError(e);
				}
				// subscriber may call flush recursively here, which causes iterator to drain
				// completely; normally you need to use generator.next() interface to do resumable
				// iteration, but in this case since we know the recursive call drains completely, it
				// works without it
			}
			// recursive flush will have drained this.iter, but there could have been more iters
			// added to the buffer after that; so need to check again in loop
			if (!this.buffer.length)
				break;
			this.iter = this.iterate();
		}
		this.iter = null;
	}
	/** Iterator of subscribers. Assumes caller checks that buffer is nonempty. Implemented as
	 * generator so we can resume by a recursive flush call from a subscriber.
	 */
	*iterate() {
		do {
			// swap buffers
			[this.flushBuffer, this.buffer] = [this.buffer, this.flushBuffer];
			for (const subscriber of this.flushBuffer)
				yield subscriber;
			this.flushBuffer.length = 0;
		} while (this.buffer.length);
	}
}

class Scheduler {
	/** Bound {@link Queue#notify} method, for use with {@link Queue#schedule}
	 * @protected
	 */
	notify_bound;

	ticks_scheduled
	/** Map from timeout milliseconds to timer ID
	 * @type {Object.<number, number>}
	 */
	timeouts_scheduled = {}

	queues = [];

	addQueue() {
		const queue = new RankedQueue();
		this.queues.push(queue);
		return queue;
	}
}

// singletons
const scheduler = new Scheduler()
const defaultQueue = scheduler.addQueue();