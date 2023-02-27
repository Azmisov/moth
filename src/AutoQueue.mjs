import {
	Queue, TickQueue, MicrotaskQueue, PromiseQueue, ImmediateQueue,
	MessageQueue, TimeoutQueue, AnimationQueue, IdleQueue, BufferedQueue
} from "./Queue.mjs";

/** Global map of queues managed by AutoQueue; maps qid to corresponding Queue
 * @type {Map<string, Queue>}
 */
const queues = new Map();

/** Timer for reap() */
let reap_timer = null;
/** Reaps unused queues from queues; this is beneficial for timeout queues, which may only be used once
 * @param {boolean} force force removal even if it was previously used
 */
function reap(force=false){
	for (const [qid, queue] of queues){
		// not used since last reap
		if ((force || !queue.used) && !queue.queued)
			queues.delete(qid);
		else queue.used = false;
	}
	if (queues.size && AutoQueue.reap_interval !== Infinity)
		reap_timer = setTimeout(reap, AutoQueue.reap_interval);
}

/** Wrapper around a shared queue with automatically managed lifetime
 * @param {string} mode the queue strategy, one of AutoQueue.modes
 * @param {number} timeout a millisecond timeout for compatible queues; behavior for a negative
 *  value is queue dependent: timeout = minimum delay, animation/idle = no deadline; for best
 *  results, try to use common timeouts across different subscriptions, as notifications are
 *  batched and each unique timeout requires an additional queue
 */
export default function AutoQueue(mode="microtask", timeout=-1){
	const qid = mode+timeout;
	// already created AutoQueue with same qid; override object creation and return old ref
	const exists = queues.get(qid);
	if (exists)
		return queues.autoqueue;
	// need to create a new AutoQueue
	if (!new.target)
		return new AutoQueue(...arguments);

	// queue parameters
	this.mode = mode;
	this.timeout = timeout;
	this.qid = qid;
}
// static members
Object.assign(AutoQueue, {
	/** Interval in milliseconds to reap empty queues to free memory; set to Infinity to disable */
	reap_interval: 5000,
	/** If number of queues exceeds this number, try reaping immediately; must be > 1 */
	reap_size: 10,
	/** Supported queue modes and their Queue class; modes are listed in roughly the order they
	 * are handled in the event loop
	 * @type {Object<string, Queue>}
	 */
	modes: {
		tick: TickQueue,
		microtask: MicrotaskQueue,
		promise: PromiseQueue,
		immediate: ImmediateQueue,
		message: MessageQueue,
		timeout: TimeoutQueue,
		animation: AnimationQueue,
		idle: IdleQueue,
		manual: BufferedQueue,
	},
	/** Manually trigger cleanup of unused queues */
	reap(){
		clearTimeout(reap_timer);
		reap(true);
	},
	/** Flush pending notifications for all currently managed AutoQueue's in an arbitrary order
	 * @param {boolean} recursive if called while the queue is looping through and notifying
	 * 	subscribers, should we resume the loop (true) or do nothing (false); set to true if calling
	 * 	from a subscriber and you want to force the queue to flush immediately
	 */
	flush(recursive=false){
		for (const q of queues.values())
			q.flush(recursive);
	}
});
// class members
Object.assign(AutoQueue.prototype, {
	/** Flush pending notifications for this queue
	 * @param {boolean} recursive if called while the queue is looping through and notifying
	 * 	subscribers, should we resume the loop (true) or do nothing (false); set to true if calling
	 * 	from a subscriber and you want to force the queue to flush immediately
	 */
	flush(recursive=false){
		const queue = this.get();
		if (queue)
			queue.flush(recursive);
	},
	/** Ensure the queue has been created; normal code should not call this */
	ensure(){
		let queue = this.get();
		// create new queue
		if (!queue){
			const clazz = AutoQueue.modes[this.mode];
			if (!clazz)
				throw Error("Unknown queue mode: "+this.mode);
			queue = new clazz(this.timeout);
			queue.qid = this.qid;
			queue.autoqueue = this;
			queues.set(this.qid, queue);
			
			// handle queue reaping
			if (queues.size === 1 && AutoQueue.reap_interval !== Infinity)
				reap_timer = setTimeout(reap, AutoQueue.reap_interval);
			else if (queues.size > AutoQueue.reap_size){
				clearTimeout(reap_timer);
				reap();
			}
		}
		return queue;
	},
	/** Fetch the internal queue; normal code should not call this */
	get(){
		return queues.get(this.qid);
	},
	/** Ensure the queue exists and queue a subscriber */
	enqueue(subscriber){
		return this.ensure().enqueue(subscriber);
	},
	/** Get the known existing queue and dequeue a subscriber */
	dequeue(subscriber){
		return this.get().dequeue(subscriber);
	}
});