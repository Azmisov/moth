/** Internal data class used to hold the link between a {@link Subscriber} (the dependent) and a
 * {@link Reactive} (the dependency) it's subscribed to. By default it is minimal, only holding a
 * dirty flag and the subscriber reference.
 * @protected
 */
export class Link{
	/** If this equals Subscriber.calls, the value is dirty and subscriber needs to be notified;
	 * e.g. if subscriber is called, all dirty values/links are now clean
	 * @private
	 * @type {number}
	 */
	_dirty;
	/** The subscriber dependent, always present
	 * @type {Subscriber}
	 */
	subscriber;
	/** The value dependency, thus serving as a bidirectional graph edge. This is only present for
	 * {@link TrackingSubscriber}
	 * @memberof Link
	 * @type {Reactive}
	 * @name Link#dep
	 */
	/** The queue the subscriber should be queued on, should the value for {@link Link#dep} change.
	 * This will not be present for synchronous subscribers, which have no queue.
	 * @memberof Link
	 * @type {Queue | AutoQueue}
	 * @name Link#queue
	 */
	/** A cache of the raw value for {@link Link#dep}. This is only present for {@link TrackingSubscriber}
	 * @memberof Link
	 * @name Link#cache
	 */

	/** Create a new link. The members {@link Link#dep} and {@link Link#cache} are not initialized
	 * here, and should be set manually if needed.
	 * @param {Subscriber} subscriber
	 * @param {?(Queue | AutoQueue)} queue
	 */
	constructor(subscriber, queue){
		this.subscriber = subscriber;
		// only for async links
		if (queue)
			this.queue = queue;
		this.dirty = false;
	}
	/** Indicates whether the link is dirty, meaning the value for {@link Link#dep} has changed,
	 * necessitating a notification to {@link Link#subscriber}. This can be set to `false`, marking
	 * the link clean.
	 * @type {boolean}
	 * @default false
	 */
	get dirty(){
		return this._dirty === this.subscriber.calls;
	}
	set dirty(toggle){
		this._dirty = this.subscriber.calls - !toggle;
	}
	/** Synchronously call the link's subscriber
	 * @see Subscriber#call
	 */
	call(){ return this.subscriber.call();}
	/** Queue the subscriber of this link
	 * @see Subscriber#enqueue
	 */
	enqueue(){ this.subscriber.enqueue(this); }

	/** Search for a subscriber in a list of links
	 * @param {Link[]} arr
	 * @param {Subscriber} subscriber
	 * @returns {number} index of the first link containing `subscriber`, otherwise `-1` if not found
	 * @static
	 * @memberof Link
	 */
	static findSubscriber(arr, subscriber){
		for (let i=0; i<arr.length; i++)
			if (arr[i].subscriber === subscriber)
				return i;
		return -1;
	}
}

/** A subscriber wraps a callback function, which is called when one of the subscriber's
 * dependencies has changed.
 */
export class Subscriber{
	/** Key to store the subscriber under for {@link Subscriber.attach}
	 * @type {Symbol}
	 * @memberof Subscriber
	 * @static
	 * @see Subscriber.attach
	 */
	static key = Symbol();
	/** Attach a {@link Subscriber} to a function, or retrieve a {@link Subscriber} that was
	 * attached previously. It is attached as a non-enumerable property with key
	 * {@link Subscriber.key}. Attaching a subscriber to a function allows the function to be used
	 * seamlessly as if it were a subscriber.
	 * @param {function} callable the function to wrap as a {@link Subscriber}
	 * @param {boolean | string[]} tracking if truthy, a {@link TrackingSubscriber} will be created
	 *  with these arguments directly, or {@link TrackingSubscriber.defaults} if not an array
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

	/** The function we'll call to notify the subscriber. This has been wrapped in a closure to
	 * perform some extra operations, so shouldn't be modified directly.
	 * @protected
	 */
	callable;
	/** Number of times this subscriber has been notified (w/ possible overflow)
	 * @private
	 */
	calls = 0;
	/** How many dependencies requested a notification through a particular queue; this is used
	 * to track whether an unsubscribe should dequeue. Each value is of the form `{count, queue}`.
	 * @type {Object<string, object>}
	 * @protected
	 */
	queued = {};

	/** Create a new subscriber
	 * @param {?function} callable The callback function to wrap. This can be omitted for subclasses
	 * 	that wish to construct the member themselves
	 */
	constructor(callable){
		// can be falsey to accomodate sub-classes
		if (callable){
			this.callable = () => {
				this.clean();
				return callable();
			};
		}
	}
	/** Calls the subscriber's callback function, thus notifying of any dependency changes. The
	 * subscriber is dequeued from any queues. This can be safely called manually if desired.
	 * @param {?(string | Symbol)} qid The {@link Queue.qid} identifier for the queue that triggered
	 * 	this call. Can be omitted if the call was triggered manually or synchronously.
	 */
	call(qid){
		delete this.queued[qid];
		this.dequeue();
		this.callable();
	}
	/** Mark all links as clean. Typical code should not need to call this, and can in fact
	 * break functionality if not called along with {@link Subscriber#dequeue}.
	 */
	clean(){
		// using a counter to denote/reset dirty values, to avoid looping over links
		if (++this.calls === Number.MAX_SAFE_INTEGER)
			this.calls = Number.MIN_SAFE_INTEGER+1;
	}
	/** Queue asynchronous notification of this subscriber, e.g. in response to a change to a
	 * dependency
	 * @param {Link | Queue | AutoQueue} link The async link whose {@link Link#dep} has changed, and
	 *  whose {@link Link#queue} the subscriber notification should be queued on. You can also
	 *  provide a queue to enqueue on directly, e.g. for hard-coded reactive dependencies.
	 */
	enqueue(link){
		let queue;
		if (link instanceof Link){
			// link was already dirty, no need to queue again
			if (link.dirty)
				return;
			link.dirty = true;
			queue = link.queue;
		}
		else queue = link;
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
	/** Dequeue this subscriber from all queues it is queued in. Typical code should not need to
	 * call this. This can be called manually, in which case you will also need to call
	 * {@link Subscriber#clean}
	 */
	dequeue(){
		// multiple queues should be a fairly rare case
		for (const qid in this.queued){
			// guaranteed not reaped since non-empty
			this.queued[qid].queue.dequeue(this);
			delete this.queued[qid];
		}
	}

	/** Add a new dependency link to this subscriber
	 * @param {Reactive} dep the dependency
	 * @param {?Link} link the link to add
	 * @protected
	 */
	subscribe(dep, link){}
	/** Remove a previous dependency link from this subscriber
	 * @param {Reactive} dep the dependency
	 * @param {?Link} link the link to remove
	 * @protected
	 */
	unsubscribe(dep, link){
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

/** A subscriber that also tracks the list of dependencies it is subscribed to. Dependencies are
 * stored in the {@link Link} internal class. Callbacks can consult the
 * {@link TrackingSubscriber#links} list, but at a minor risk of backwards incompatibility. Prefer
 * instead to use the dependencies passed to the {@link Subscriber#callable} callback.
 * @extends Subscriber
*/
export class TrackingSubscriber extends Subscriber{
	/** Default `args` and `pass` arguments for constructing a {@link TrackingSubscriber}
	 * @memberof TrackingSubscriber
	 * @static
	 * @type {string[]}
	 * @default ["deps","array"]
	 */
	static defaults = ["deps","array"];
	/** Tracks each of the dependencies that the subscriber is subscribed to; ordered by
	 * the time that we subscribed to the dependency
	 * @type {Link[]}
	 * @protected
	 */
	links = [];
	/** Whether we're caching values inside each {@link Link} of {@link TrackingSubscriber#links}
	 * @type {boolean}
	 * @private
	 */
	caching;

	/** Create a {@link Subscriber} that also tracks its dependencies. Dependencies will be passed
	 * to the callback, with a signature that can be configured via `args` and `pass` constructor
	 * arguments. Default arguments are given by {@link TrackingSubscriber.defaults}
	 * @param {function} callable the subscriber's callback
	 * @param {string} args What to pass as arguments to the callback:
	 * - `deps`: pass dependencies, each a {@link Reactive} instance
	 * - `vals`: pass dependency values, dynamically fetched each time the callback is called
	 * - `cache`: pass dependency values, caching values that have not changed so they don't have
	 *   to be refetched when the callback is called (see {@link Link#dirty} and {@link Link#cache})
	 * @param {string} pass How the arguments are passed to the callback
	 * - `expand`: pass as separate arguments
	 * - `array`: pass as a single array argument
	 * - `single`: if there is just a single value, pass it as the only argument; otherwise pass
	 * 	 as a single array argument
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
		// remove as a dependency
		const idx = this.links.indexOf(link);
		this.links.splice(idx, 1);
	}
}