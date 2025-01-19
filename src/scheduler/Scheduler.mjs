
/** Holds a ranked list of up to 32 queues. Allows flushing a queue of a certain rank, with
 * the constraint that all queues of lower rank will be flushed and emptied first.
 */
class RecursiveQueue {
	/** Bitmask of queues that are non-empty */
	nonemptyMask = 0b0;
	/** Mapping from queue rank (serialized to string) to queue. Object is used instead of Map since
	 * its 5x faster, even with the string serialization overhead. Array could be used, but then
	 * we wouldn't be able to use the nonemptyMask (e.g. converting from rank mask to array index
	 * has no fast operation in Javascript); also, the actual queues will be sparse.
	 * @type {Object.<String, Queue>}
	 */
	queues = {};
	/** Ensure a queue exists. Typically only a couple queues are used,
	 * so they're sparsely initialized
	 */
	ensureQueue(rankMask) {
		if (!this.queues[rankMask])
			this.queues[rankMask] = new FIFOBufferedQueue();
	}
	enqueue(rankMask, subscriber) {
		this.queues[rankMask].enqueue(subscriber);
		this.nonemptyMask |= rankMask;
	}
	/** Flush the queue of some rank. All queues of <= rank will be empty after the method returns */
	flush(rankMask) {
		while (true) {
			// flush from lowest rank to highest; get lowest rank queue that is non-empty
			const lowest = this.nonemptyMask & -this.nonemptyMask;
			// all queues <= rank have been flushed
			if (!lowest || lowest > rankMask)
				return;
			this.queues[lowest].flush();
			this.nonemptyMask &= ~lowest;
		}
	}
}

/** FIFO, double buffered queue for a single clock source. This accomodates subscribers which
 * recursively push to the buffer. We want to implement this as a dequeue; we could use Set (slow
 * performance), splice (fast for small arrays, but slow for large), linked list (medium speed,
 * large memory). Using a double buffer we use only fast push ops at expense of doubling memory;
 * seems the best compromise option.
 */
class FIFOBufferedQueue {
	/** Generator for subscribers currently being flushed */
	iter = null;
	/** Buffer of newly added subscribers */
	buffer = [];
	/** Buffer of subscribers we're currently flushing */
	flushBuffer = [];
	enqueue(subscriber) {
		this.buffer.push(subscriber);
	}
	flush() {
		// resume previous iteration, which is the case if flush was called recursively by a subscriber
		if (!this.iter)
			this.iter = this.iterate();
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
		this.iter = null;
	}
	/** Iterator of subscribers. Implemented as generator so we can
	 * resume by a recursive flush call from a subscriber.
	 */
	*iterate() {
		while (this.buffer.length) {
			// swap buffers
			[this.flushBuffer, this.buffer] = [this.buffer, this.flushBuffer];
			for (const subscriber of this.flushBuffer)
				yield subscriber;
			this.flushBuffer.length = 0;
		}
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

	queue(subscriber) {

	}
}