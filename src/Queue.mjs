/** A queue holds an ordered list of subscribers, and can schedule an async function to
 * notify those subscribers. Subclasses should implement:
 * - *iterate (req): defines the strategy for how subscribers are notified
 * - schedule (opt): should schedule notify to be called async and return a scheduler id;
 *  	notify_bound can be used as scheduled callable
 * - cancel(sid) (opt): should cancel the previously scheduled async notify call
 */
export class Queue{
	/** Maximum queued subscribers before synchronously flushing */
	static queued_max = 500;
	/** When queued_max is reached and we flush, whether we should allow recursive notifications.
	 * Set this to true when a subscriber itself triggers many additional subscribers to be queued.
	 * Recursive will cause that subscriber to pause intermittently to resolve those added
	 * subscribers.
	 */
	static queued_max_recursive = true;
	/** Count of how many times any notify has been called (w/ possible overflow) */
	static calls = 0;
	static called(){
		if (++this.calls === Number.MAX_SAFE_INTEGER)
			this.calls = Number.MIN_SAFE_INTEGER+1;
	}

	/** Unique queue identifier, set by the QueueManager
	 * @type {string | Symbol}
	 */
	qid = Symbol();
	/** Flag that indicates the queue has been used; used to prevent reaping */
	used = false;
	/** List of subscribers (callbacks) currently queued; for RecursiveQueue, the head of the list
	 * may contain already notified subscribers that have yet to be removed
	 */
	subscribers = [];
	/** Count of unnotified subscribers (used to handle RecursiveQueue) */
	queued = 0;
	/** Scheduled identifier or flag, e.g. a timer id; null if not scheduled */
	sid = null;
	/** A generator yielding subscribers we are currently notifying */
	notifying = null;
	/** Bound notify method, for use with schedule() */
	notify_bound;

	constructor(){
		this.notify_bound = this.notify.bind(this);
	}
	/** Add a callback to the queue, scheduling notification if needed. Callback should
	 * not be queued twice, a constraint that should be enforced by the caller
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
	/** Remove a callback from the queue, unscheduling notification if possible. Callback
	 * must be present in the queue, a constraint that should be enforced by the caller
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
		if (!this.subscribers.length && this.cancel){
			this.cancel(this.sid);
			this.sid = null;
		}
	}
	/** Synchronously flush the queue, rather than waiting for any async schedule callback to run 
	 * @param {boolean} recursive if called while the queue is still looping through and notifying
	 * 	subscribers, should we resume the loop (true) or do nothing (false); set to true if calling
	 * 	from a subscriber and you want to force the queue to flush immediately
	 */
	flush(recursive){
		if (this.notifying === null){
			// pretend like this was a scheduled call
			if (this.sid === null)
				this.sid = true;
			// but cancel the actual scheduled call if possible
			else if (this.cancel)
				this.cancel(this.sid);
		}
		// recursive notify; must explicitly opt-in to this behavior
		else if (!recursive)
			return;
		this.notify();
	}
	/** Handles the subscriber notification loop */
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
}

/** Uses a double buffer of subscribers for notification. Also supports an IdleDeadline to pause
 * notifications if a deadline has passed
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
 * scheduled will run right away anyways (e.g. as is the case with microtasks)
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
/** One time use queue; no subscribers will be queued during or after the first flush */
export class TemporaryQueue extends Queue{
	*iterate(){
		this.sid = null;
		yield* this.subscibers;
	}
}

/** Called on the next tick, a special queue specific to NodeJS. It can be thought of as a higher
 * priority microtask that runs before promises and plain microtasks
 */
export class TickQueue extends RecursiveQueue{
	schedule(){
		process.nextTick(this.notify_bound);
		return true;
	}
}
/** Called as a microtask, which runs after the current task (or next task, if not running) completes  */
export class MicrotaskQueue extends RecursiveQueue{
	schedule(){
		queueMicrotask(this.notify_bound);
		return true;
	}
}
/** Called as a microtask from the runtime's promise microtask queue. While exact behavior is not
 * standardized, it will most likely behave identically to MicrotaskQueue. Prefer using
 * MicrotaskQueue instead if the runtime supports it.
 */
export class PromiseQueue extends RecursiveQueue{
	schedule(){
		Promise.resolve().then(this.notify_bound);
		return true;
	}
}
/** Called as a new task, which runs on the next event loop iteration. This can be
 * used to emulate a timeout of zero
 */
export class ImmediateQueue extends BufferedQueue{
	schedule(){
		return setImmediate(this.notify_bound);
	}
	cancel = clearImmediate;
}
/** Called as message in a MessageChannel, which historically can be called faster than a zero
 * timeout, but still not immediately
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
 * minimum delay internally, so there's no guarantee a zero delay will run on the next event loop
 * iteration. For that, consider ImmediateQueue, if supported, or a microtask queue instead.
 */
export class TimeoutQueue extends BufferedQueue{
	constructor(timeout){
		super();
		this.timeout = timeout;
	}
	schedule(){
		return setTimeout(this.notify_bound, this.timeout);
	}
	cancel = clearTimeout;
}
/** Called before the browser repaints, which will typically be around 30/60fps. This could be
 * delayed indefinitely if the page is a background window and animations have been paused. This
 * supports a supplementary "deadline" timer which will force notifications if there hasn't
 * been a repaint by the time it expires.
 */
export class AnimationQueue extends BufferedQueue{
	constructor(timeout){
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
	cancel(sid){
		cancelAnimationFrame(sid);
		if (this.timeout >= 0)
			clearTimeout(this.tid);
	}
}
/** Called as a new task when the event loop is idle. Additionally, notifications are only given a
 * time slice to run (typically 50ms), after which notifications are paused to yield control back to
 * higher priority tasks.
 */
export class IdleQueue extends BufferedQueue{
	constructor(timeout){
		super();
		this.timeout = timeout;
	}
	schedule(){
		return requestIdleCallback(this.notify_bound, {timeout: this.timeout});
	}
	cancel = cancelIdleCallback;
}