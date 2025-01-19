/** A queue holds an ordered list of {@link Subscriber}, and can schedule an async function to
 * notify those subscribers. Subclasses should implement {@link Queue#iterate},
 * {@link Queue#schedule}, and {@link Queue#unschedule}.
 * @interface
 */
export class Queue{
	/** Maximum queued subscribers before synchronously flushing
	 * @default 500
	 * @memberof Queue
	 * @static
	 * @type {number}
	 * @see Queue#flush
	 */
	static queued_max = 500;
	/** When {@link Queue.queued_max} is reached and we flush, whether we should allow recursive
	 * notifications. Set this to true when a subscriber itself triggers many additional subscribers
	 * to be queued. Recursive will cause that subscriber to pause intermittently to resolve those
	 * added subscribers.
	 * @type {boolean}
	 * @default true
	 * @memberof Queue
	 * @static
	 * @see Queue#flush
	 */
	static queued_max_recursive = true;
	/** Count of how many times any notify has been called (w/ possible overflow)
	 * @type {number}
	 * @private
	 */
	static calls = 0;
	/** Call this to indicate that a Queue has been flushed.
	 */
	static called(){
		if (++this.calls === Number.MAX_SAFE_INTEGER)
			this.calls = Number.MIN_SAFE_INTEGER+1;
	}

	/** Unique queue identifier, used by {@link Subscriber} to index which queues a subscriber
	 * has been enqueued in
	 * @type {string | Symbol}
	 * @readonly
	 */
	qid = Symbol();
	/** Flag that indicates the queue has been used; used to prevent reaping
	 * @type {boolean}
	 * @default false
	 * @private
	 */
	used = false;
	/** List of subscribers (callbacks) currently queued; for RecursiveQueue, the head of the list
	 * may contain already notified subscribers that have yet to be removed
	 * @protected
	 */
	subscribers = [];
	/** Count of unnotified subscribers. Used to accomodate {@link RecursiveQueue}, which does not
	 * buffer it {@link Queue#subscribers} list
	 * @type {number}
	 * @protected
	 */
	queued = 0;
	/** Async scheduled identifier or flag, such as a timer id; `null` if not currently scheduled
	 * @protected
	 */
	sid = null;
	/** A generator yielding subscribers we are currently notifying
	 * @private
	 * @generator
	 */
	notifying = null;
	/** Bound {@link Queue#notify} method, for use with {@link Queue#schedule}
	 * @protected
	 */
	notify_bound;

	constructor(){
		this.notify_bound = this.notify.bind(this);
	}
	/** Add a subscriber to the queue, scheduling notification if needed. Subscriber should
	 * not be queued twice, a constraint that should be enforced by the caller
	 * @param {Subscriber} subscriber Currently, this can also be any object with a `call(qid)` method
	 */
	enqueue(subscriber){
		this.subscribers.push(subscriber)
		// queue limit reached?
		if (++this.queued > Queue.queued_max){
			this.flush(Queue.queued_max_recursive);
			return;
		}
		// schedule async notification
		if (this.sid === null && this.schedule)
			this.sid = this.schedule();
	}
	/** Remove a subscriber from the queue, unscheduling notification if possible. Subscriber
	 * must be present in the queue, a constraint that should be enforced by the caller
	 * @param {Subscriber} subscriber Currently, this can also be any object with a `call(qid)` method
	 */
	dequeue(subscriber){
		this.queued--;
		// rarer case, otherwise we could use a Set instead;
		// search from back to accomodate RecursiveQueue
		const i = this.subscribers.lastIndexOf(subscriber);
		// could pop and replace i for slightly faster removal; that would not preserve
		// queue order though, which I think we would prefer
		this.subscribers.splice(i, 1);
		// if uncancelable, notify will be called, but will have empty list
		if (!this.subscribers.length && this.unschedule){
			this.unschedule(this.sid);
			this.sid = null;
		}
	}
	/** Synchronously flush the queue, rather than waiting for any async schedule callback to run
	 * @param {boolean} recursive If called while the queue is still looping through and notifying
	 * 	subscribers, should we resume the loop (true) or do nothing (false); set to true if calling
	 * 	from a subscriber and you want to force the queue to flush immediately
	 */
	flush(recursive){
		if (this.notifying === null){
			// pretend like this was a scheduled call
			if (this.sid === null)
				this.sid = true;
			// but cancel the actual scheduled call if possible
			else if (this.unschedule)
				this.unschedule(this.sid);
		}
		// recursive notify; must explicitly opt-in to this behavior
		else if (!recursive)
			return;
		this.notify();
	}
	/** Handles the subscriber notification loop, with some logic for handling recursive
	 * notifications
	 * @protected
	 */
	notify(deadline){
		Queue.called();
		this.used = true;
		// using a generator so that recursive calls simply resume the ongoing loop
		if (!this.notifying)
			this.notifying = this.iterate(deadline?.timeRemaining);
		// this.notifying taken by value, so safe to nullify later
		for (const subscriber of this.notifying)
			subscriber.call(this.qid);
		this.notifying = null;
	}

	/** Generator that yields subscribers in the order they should be notified. This must be
	 * implemented in derived classes, with proper logic to handle {@link Queue.queued_max} and
	 * recursive {@link Queue#flush}. This must be able to handle an empty list of subscribers, for
	 * cases where the scheduled notify cannot be canceled. This method defines the strategy for
	 * how subscribers are notified.
	 * @yields {Subscriber}
	 * @abstract
	 * @generator
	 */
	*iterate(){ throw Error("Not implemented"); }
}
/**
 * Schedules {@link Queue#notify} to be called in an asynchronous manner. For convenience, the
 * {@link Queue#notify_bound} method can be used. Subclasses do not need to implement this if
 * flushing the queue is triggered by external logic.
 * @abstract
 * @function
 * @name Queue#schedule
 * @memberof Queue
 * @returns {number} a scheduler identifier that is stored in {@link Queue#sid}
 */
/**
 * Unschedules the asynchronous notify triggered from {@link Queue#schedule}. Subclasses do
 * not need to implement this, even if {@link Queue#schedule} is implemented, as to accomodate
 * async scheduled calls that cannot be canceled. In this case, {@link Queue#iterate} will still be
 * called, albeit with no subscribers, and should yield nothing.
 * @abstract
 * @function
 * @name Queue#unschedule
 * @memberof Queue
 * @param {number} sid same as {@link Queue#sid}; passed for convenience, as many builtin
 * 	methods follow this signature (e.g. `setTimeout` or `cancelAnimationFrame`)
 */

/** Uses a double buffer of subscribers for notification. Also supports an `IdleDeadline` to pause
 * notifications if a deadline has passed. You may use this as a basic reusable "manual" queue, if
 * you wish to trigger queue flushes yourself.
 * @extends Queue
 */
export class BufferedQueue extends Queue{
	buffer = [];
	*iterate(deadline){
		this.sid = null;
		while (true) {
			this.queued = 0;
			// swap buffers; this avoids creating a new array
			const swap = this.buffer;
			this.buffer = this.subscribers;
			this.subscribers = swap;
			if (!deadline)
				yield* this.buffer;
			// must pause if deadline is reached
			else{
				let cur = 0;
				const last = this.buffer.length-1;
				while (cur < last){
					yield this.buffer[cur];
					cur++;
					// deadline has passed; pause notifications
					if (!deadline()){
						// move unhandled buffer to subscribers; logic here favors always finishing
						// before deadline, as otherwise the double buffering has no benefit
						this.buffer.splice(0, cur);
						this.subscribers.unshift(...this.buffer);
						this.buffer.length = 0;
						// schedule to resume
						if (this.sid === null)
							this.sid = this.schedule();
						return;
					}
				}
				yield this.buffer[cur];
			}
			this.buffer.length = 0;
			if (this.queued <= Queue.queued_max)
				break;
			Queue.called();
		}
	}
}
/** Uses a single buffer which can be appended to recursively during notifications. This avoids
 * having notifications scheduled while we are notifying, meaning less overhead if you know the
 * scheduled will run right away anyways (e.g. as is the case with microtasks, promises, tick).
 * @extends Queue
 */
export class RecursiveQueue extends Queue{
	*iterate(){
		// handle in batches, so subscribers size doesn't grow indefinitely
		let batch_size = this.subscribers.length;
		while (true){
			for (let i=0; i<batch_size; i++){
				yield this.subscribers[i];
				this.queued--;
			}
			const new_batch_size = this.subscribers.length - batch_size;
			// finished notifying
			if (!new_batch_size){
				this.subscribers.length = 0;
				break;
			}
			// more have been queued recursively; trim size to keep memory bounded
			this.subscribers.splice(0, batch_size);
			batch_size = new_batch_size;
			Queue.called();
		}
		// cleared *after* notification, so that recursive subscribers are handled in the loop above
		this.sid = null;
	}
}
/** One time use queue, e.g. no subscribers will be queued during or after the first flush. You may
 * use this as a basic non-reusable "manual" queue, which you flush yourself.
 * @extends Queue
 */
export class TemporaryQueue extends Queue{
	*iterate(){
		this.sid = null;
		yield* this.subscibers;
	}
}

/** Called on the next tick, a special queue specific to NodeJS. It can be thought of as a higher
 * priority microtask that runs before promises and plain microtasks. This uses `process.nextTick`
 * internally.
 * @extends RecursiveQueue
 */
export class TickQueue extends RecursiveQueue{
	schedule(){
		process.nextTick(this.notify_bound);
		return true;
	}
}
/** Called as a microtask, which runs after the current task (or next task, if not running)
 * completes. This uses `queueMicrotask` internally.
 * @extends RecursiveQueue
 */
export class MicrotaskQueue extends RecursiveQueue{
	schedule(){
		queueMicrotask(this.notify_bound);
		return true;
	}
}
/** Called as a microtask from the runtime's promise microtask queue. While exact behavior is not
 * standardized, it will most likely behave like a lower priority microtask queue. This uses
 * `Promise.resolve()` internally.
 *
 * Note that the subscribers notifications are *scheduled* inside a promise. If the subscriber
 * notification is itself an async function, calling it will not execute immediately, but place it
 * back onto the runtime's native promise microtask queue.
 * @extends RecursiveQueue
 */
export class PromiseQueue extends RecursiveQueue{
	schedule(){
		Promise.resolve().then(this.notify_bound);
		return true;
	}
}
/** Called as a new task, which runs on the next event loop iteration. This can be
 * used to simulate a true, zero delay timeout. Currently, only NodeJS supports this interface.
 * This uses `setImmediate` internally.
 * @extends BufferedQueue
 */
export class ImmediateQueue extends BufferedQueue{
	schedule(){
		return setImmediate(this.notify_bound);
	}
	unschedule = clearImmediate;
}
/** Called as message in a `MessageChannel`, which historically can be called faster than a zero
 * delay timeout, but still not immediately
 * @extends BufferedQueue
 */
export class MessageQueue extends BufferedQueue{
	constructor(){
		super();
		this.channel = new MessageChannel();
		this.channel.port1.onmessage = this.notify_bound;
	}
	schedule(){
		this.channel.port2.postMessage(null);
	}
}
/** Called as a new task, which runs on a subsequent event loop iteration. Many runtimes enforce a
 * minimum delay internally (e.g. ~4ms), so there's no guarantee a zero delay will run on the next
 * event loop iteration. This uses `setTimeout` internally.
 *
 * This queue can be used to throttle notifications to fire at most once for a specified time
 * interval. Note however that the timeout begins when the first subscriber is queued, so when
 * used as a shared queue you can't guarantee a minimum delay since the value changed. Rather,
 * this specifies a minimum delay since the last notification.
 * @extends BufferedQueue
 */
export class TimeoutQueue extends BufferedQueue{
	/** Create a new TimeoutQueue
	 * @param {number} [timeout=-1] minimum delay between queue flushes
	*/
	constructor(timeout=-1){
		super();
		this.timeout = timeout;
	}
	schedule(){
		return setTimeout(this.notify_bound, this.timeout);
	}
	unschedule = clearTimeout;
}
/** Called before the browser repaints, which will typically be around 30/60fps. This could be
 * delayed indefinitely if the page is a background window and animations have been paused. This
 * supports a supplementary "deadline" timer which will force notifications if there hasn't
 * been a repaint by the time it expires. This uses `requestAnimationFrame` and `setTimeout`
 * internally.
 * @extends BufferedQueue
 */
export class AnimationQueue extends BufferedQueue{
	/** Create a new AnimationQueue
	 * @param {number} [timeout=-1] Minimum delay before switching from flushing on repaint, to
	 * 	flushing as a new task. This can be used to prevent notifications from being delayed
	 * 	indefinitely while browser animations have been paused.
	 */
	constructor(timeout=-1){
		super();
		this.timeout = timeout;
		this.tid = null;
		this.notify_timeout = () => {
			cancelAnimationFrame(this.sid);
			this.notify();
		};
		this.notify_animation = () => {
			clearTimeout(this.tid);
			this.notify();
		};
	}
	schedule(){
		// plain animation request
		if (this.timeout < 0)
			return requestAnimationFrame(this.notify_bound);
		// animation + deadline timer
		this.tid = setTimeout(this.notify_timeout);
		return requestAnimationFrame(this.notify_animation);
	}
	unschedule(sid){
		cancelAnimationFrame(sid);
		if (this.timeout >= 0)
			clearTimeout(this.tid);
	}
}
/** Called as a new task when the event loop is idle. Additionally, notifications are only given a
 * time slice to run (typically 50ms), after which notifications are paused to yield control back to
 * higher priority tasks. This uses `requestIdleCallback` internally.
 * @extends BufferedQueue
 */
export class IdleQueue extends BufferedQueue{
	/** Create a new IdleQueue
	 * @param {number} [timeout=-1] Minimum delay before switching from flushing on idle, to
	 * 	flushing as a new task. This can be used to prevent notifications from being delayed
	 * 	indefinitely when the browser is doing lots of work.
	 */
	constructor(timeout=-1){
		super();
		this.timeout = timeout;
	}
	schedule(){
		return requestIdleCallback(this.notify_bound, {timeout: this.timeout});
	}
	unschedule = cancelIdleCallback;
}