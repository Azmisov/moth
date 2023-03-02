/** Data class for the link between a Subscriber and the value it's subscribed to. By default,
 * it is minimal only holding a dirty flag and the subscriber reference. However, it may also track:
 * - queue: Queue or AutoQueue for async subscribers
 * - dep: reference to subscriber's Reactive dependency, thus serving as a bidirectional graph edge
 * - cache: cached value for dep
 * @private
 */
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

	constructor(subscriber, queue){
		this.subscriber = subscriber;
		// only for async links
		if (queue)
			this.queue = queue;
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
	enqueue(){ this.subscriber.enqueue(this); }

	static findSubscriber(arr, subscriber){
		for (let i=0; i<arr.length; i++)
			if (arr[i].subscriber === subscriber)
				return i;
		return -1;
	}
}

export class Subscriber{
	/** Key to store Subscriber under for attach */
	static key = Symbol();
	/** Attach a Subscriber to a callable, if one isn't already. It is attached as a non-enumerable
	 * property with key Subscriber.key
	 * @param {boolean | string[]} tracking if present, a TrackingSubscriber will be created with
	 * 	these arguments
	 * @returns {Subscriber}
	 */
	static attach(callable, tracking){
		let value = callable[this.key];
		if (!value){
			if (tracking){
				const args = Array.isArray(tracking) ? tracking : TrackingSubscriber.defaults;
				value = new TrackingSubscriber(callable, ...args);
			}
			else value = new Subscriber(callable);
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
	/** How many dependencies requested a notification through a particular queue; this is used
	 * to track whether an unsubscribe should dequeue. Each value is of the form {count, queue},
	 * which holds a cache of the queue or autoqueue variable
	 * @type {Object<string, object>}
	 */
	queued = {};

	constructor(callable){
		this.callable = () => {
			this.clean();
			return callable();
		};
	}
	/** Mark all links as clean prior to calling */
	clean(){
		// using a counter to denote/reset dirty values, to avoid looping over links
		if (++this.calls === Number.MAX_SAFE_INTEGER)
			this.calls = Number.MIN_SAFE_INTEGER+1;
	}
	/** A queue is notifying this subscriber; dequeue from others */
	call(qid){
		delete this.queued[qid];
		this.dequeue();
		this.callable();
	}
	/** Value has changed; queue notification
	 * @param {Link} link an async link with queue member
	 */
	enqueue(link){
		// link was already dirty, no need to queue again
		if (link.dirty)
			return;
		link.dirty = true;
		// add to new queue mode
		const queue = link.queue;
		const qid = queue.qid;
		if (!(qid in this.queued)){
			// Since we want to allow users to pass in a queue, rather than always using AutoQueue,
			// our options are: Map (much slower than Object), ref counting Queues (O(n) dequeue),
			// or to store a reference of the queue. The last seems the best option
			this.queued[qid] = {count:1, queue};
			queue.enqueue(this);
		}
		// already queued for this mode
		else this.queued[qid].count++;
	}
	/** Dequeue from all queues */
	dequeue(){
		// multiple queues should be a fairly rare case
		for (const qid in this.queued){
			// guaranteed not reaped since non-empty
			this.queued[qid].queue.dequeue(this);
			delete this.queued[qid];
		}
	}

	subscribe(dep, link){}
	/** Remove the dependency given by `link`
	 * @param {?Link} link the link to remove; if not present, all links are removed
	 */
	unsubscribe(dep, link){
		// remove all links
		if (!link){
			this.dequeue();
			return;
		}
		// dequeue if needed
		if (link.dirty && link.queue){
			// synchronous link won't have queue
			const qid = link.queue.qid;
			const v = this.queued[qid];
			if (!--v.count){
				v.queue.dequeue(this);
				delete this.queued[qid];
			}
		}
	}
}

/** A subscriber that also tracks the list of dependencies it is subscribed to */
export class TrackingSubscriber extends Subscriber{
	static defaults = ["deps","array"];
	/** Tracks each of the dependencies that the subscriber is subscribed to; ordered by
	 * the time that we subscribed to the dependency
	 * @type {Link[]}
	 */
	links = [];
	/** Whether we're caching values inside each Link
	 * @type {boolean}
	 */
	caching;

	/** Create a Subscriber that tracks its dependencies. Default arguments are given by
	 * TrackingSubscriber.defaults
	 * @param callable the subscriber's callback
	 * @param {string} args what to pass as arguments to the callback
	 * 	- deps: pass dependencies, each a Reactive instance
	 * 	- vals: pass dependency values, dynamically fetched each time the callback is called
	 * 	- cache: pass dependency values, caching values that have not changed so they don't have
	 * 		to be refetched when the callback is called
	 * @param {string} pass how the arguments are passed to the callback
	 * 	- expand: pass as separate arguments
	 * 	- array: pass as a single array argument
	 * 	- single: if there is just a single value, pass it as the only argument; otherwise pass
	 * 		as a single array argument
	 */
	constructor(callable, args, pass){
		super();
		args ||= TrackingSubscriber.defaults[0];
		pass ||= TrackingSubscriber.defaults[1];
		// seems better to dynamically create these than have 9 sub-classes;
		// need to create new arrays for array/single modes, so might as well use Array.map
		let map;
		this.caching = args === "cache";
		switch (args){
			case "deps":
				map = l => l.dep;
				break;
			case "vals":
				map = l => l.dep.value;
				break;
			case "cache":
				map = l => {
					if (l.dirty)
						l.cache = l.dep.value;
					return l.cache;
				};
				break;
			default:
				throw Error("Unknown keyword for 'args' argument");
		}
		map = Array.prototype.map.bind(this.links, map);
		switch (pass){
			case "expand":
				this.callable = () => {
					const a = map();
					this.clean();
					return callable(...a);
				};
				break;
			case "array":
				this.callable = () => {
					const a = map();
					this.clean();
					return callable(a);
				}
				break;
			case "single":
				this.callable = () => {
					let a = map();
					if (a.length === 1)
						a = a[0];
					this.clean();
					return callable(a);
				}
				break;
			default:
				throw Error("Unknown keyword for 'pass' argument");
		}
	}
	subscribe(dep, link){
		super.subscribe(dep, link);
		link.dep = dep;
		// all clean links need to be cached
		if (this.caching)
			link.cache = dep.value;
		this.links.push(link);
	}
	unsubscribe(dep, link){
		super.unsubscribe(dep, link);
		if (!link){
			this.links.length = 0;
			return;
		}
		// remove as a dependency
		const idx = this.links.indexOf(link);
		this.links.splice(idx, 1);
	}
}