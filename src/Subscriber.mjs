import QueueManager from "./Queue.mjs";

/** Data class for the link between a Subscriber and the value it's subscribed to */
export class Link{
	/** If this equals Subscriber.calls, the value is dirty and subscriber needs to be notified;
	 * e.g. if subscriber is called, all dirty values/links are now clean
	 * @type {number}
	 */
	_dirty;
	/** Reference to Subscriber
	 * @type {Subscriber}
	 */
	subscriber;
	/** Indicates which link this is for the Subscriber; ordered by subscribe time
	 * @type {number}
	 */
	index;

	constructor(value, subscriber){
		subscriber.dependencies.push(value);
		subscriber.links.push(this);
		this.subscriber = subscriber;
		this.index = subscriber.links.length-1;
		this.dirty = false;
	}
	/** Mark the link as dirty */
	set dirty(toggle){
		this._dirty = this.subscriber.calls - !toggle;
	}
	/** Check if the link is dirty, necessitating a subscriber notification */
	get dirty(){
		return this._dirty === this.subscriber.calls;
	}
	/** Synchronously call the link's subscriber */
	call(){ return this.subscriber.call(); }
	/** Queue the subscriber of this link */
	queue(){ this.subscriber.queue(this); }

	static findSubscriber(arr, subscriber){
		for (let i=0; i<arr.length; i++)
			if (arr[i].subscriber === subscriber)
				return i;
		return -1;
	}
}
/** Same as Link, but with extra parameters for async scheduling */
export class LinkAsync extends Link{
	// Queue parameters
	queue_mode;
	queue_timeout;
	qid;

	constructor(value, subscriber, queue_mode, queue_timeout){
		super(value, subscriber);
		this.queue_mode = queue_mode;
		this.queue_timeout = queue_timeout;
		this.qid = queue_mode + queue_timeout;
	}
}

// TODO: clean this up; e.g. dependencies/links are not necessary to store on here
export class Subscriber{
	/** Key to store metadata under */
	static key = Symbol("subscriber");
	/** Attach a Subscriber to a callable, if one isn't already. It is attached as a non-enumerable
	 * property with key Subscriber.key
	 * @returns {Subscriber}
	 */
	static attach(callable){
		let value = callable[this.key];
		if (!value){
			value = new Subscriber(callable);
			Object.defineProperty(callable, this.key, {
				configurable: true, // allow cleanup
				value
			});
		}
		return value;
	}

	/** The function we'll call to notify the subscriber */
	callable;
	/** Number of times this subscriber has been notified (w/ possible overflow) */
	calls = 0;
	/** List of dependencies, in the order they were subscribed to; see Link constructor
	 * @type {Reactive[]}
	*/
	dependencies = [];
	/** One value for each of dependencies, holding additional information about the dependency;
	 * see Link constructor
	 * @type {Link[]}
	 */
	links = [];
	/** How many dependencies requested a notification through a particular queue; this is used
	 * to track whether an unsubscribe should dequeue
	 * @type {Object<string, number>}
	 */
	queued = {};

	constructor(subscriber, mode="plain"){
		// switch (mode){
		// 	case "plain":
		// 		this.callable = subscriber;
		// 		break;
		// 	case "deps":
		// 		this.callable = () => subscriber(...this.dependencies);
		// 		break;
		// 	case "values":
		// 		this.callable = () => {
		// 			const vals = this.dependencies.map(v => v.value);
		// 			return subscriber(...vals);
		// 		};
		// 		break;
		// 	case "cached_values":
		// 		this.cache = [];
		// 		this.callable = () => {
		// 			subscriber(...this.)
		// 		};
		// 		break;				

		// }
		this.callable = () => {
			return subscriber(...this.dependencies);
		};
	}
	/** A queue is notifying this subscriber; dequeue from others */
	call(qid){
		delete this.queued[qid];
		// multiple queues should be a fairly rare case
		for (const other_qid in this.queued){
			delete this.queued[other_qid];
			// guaranteed not reaped since non-empty
			QueueManager.get(other_qid).dequeue(this);
		}
		// using a counter to denote/reset dirty values, to avoid looping over links
		if (++this.calls === Number.MAX_SAFE_INTEGER)
			this.calls = Number.MIN_SAFE_INTEGER+1;
		this.callable();
	}
	/** Value has changed; queue notification
	 * @param {LinkAsync} link
	 */
	queue(link){
		// link was already dirty, no need to queue again
		if (link.dirty)
			return;
		link.dirty = true;
		// add to new queue mode
		if (!(link.qid in this.queued)){
			this.queued[link.qid] = 1;
			QueueManager.ensure(link.qid, link.queue_mode, link.queue_timeout).queue(this);
		}
		// already queued for this mode
		else this.queued[link.qid]++;
	}
	/** Remove the dependency given by `link`
	 * @param {?Link} link the link to remove; if not present, all links are removed
	 */
	unsubscribe(link){
		// remove all links
		if (!link){
			this.dependencies.length = 0;
			this.links.length = 0;
			for (const qid in this.queued){
				delete this.queued[qid];
				QueueManager.get(qid).dequeue(this);
			}
			return;
		}
		// dequeue if needed
		if (link.dirty){
			const qid = link.qid;
			// only LinkAsync has a qid
			if (qid && !--this.queued[qid]){
				delete this.queued[qid];
				QueueManager.get(qid).dequeue(this);
			}
		}
		// remove as a dependency
		const idx = link.idx;
		this.dependencies.splice(idx, 1);
		this.links.splice(idx, 1);
		// subsequent subscribers have a new index
		for (; idx<this.links.length; idx++)
			this.links[idx].index--;
	}
}