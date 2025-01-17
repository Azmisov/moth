import wrappable from "./wrappable.mjs";
import AutoQueue from "./AutoQueue.mjs";
import { Queue } from "./Queue.mjs";
import { Subscriber, Link } from "./Subscriber.mjs";

/** Tracks iterator vars for sync, which can be restarted and run recursively
 * @private
 */
class SynchronousIterator{
	i;
	stop;
	constructor(){
		this.reset();
	}
	reset(i=-1, stop=-2){
		this.i = i;
		this.stop = stop;
	}
	unsubscribe(i){
		this.stop--;
		if (this.i >= i)
			this.i--;
	}
}

/** Base class for all reactive values/types. A Reactive value holds a list of {@link Subscriber}
 * and their associated metadata, and handles notifying these subscribers when the value changes.
 * Derived classes should implement: the {@link Reactive#value} accessor, {@link Reactive#assume},
 * and {@link Reactive#unwrap}.
 *
 * The base class is {@link module:wrappable#wrappable|wrappable}, with a sensible default that
 * should work for most subclasses. It is wrapped as an accessor that forwards to
 * {@link Reactive#value}. Unwrapping the value will unsubscribe all subscribers, and then call
 * {@link Reactive#unwrap}. If you want different behavior, you can call
 * {@link module:wrappable#wrappable|wrappable} on `Reactive.prototype`, or on a subclass or
 * instance, with your own configuration.
 * @interface
 */
export class Reactive{
	/** Default options for {@link Reactive#subscribe}. By default, a microtask {@link AutoQueue} is
	 * used, with `notify`, `tracking`, and `unsubscribe` all set to `false`. You can change these
	 * default options to interface better with external libraries or your preferred syntax.
	 * @memberof Reactive
	 * @static
	 * @type {Reactive~SubscribeOptions}
	 * @see Reactive#subscribe
	 */
	static subscribe_defaults = {
		queue: AutoQueue(),
		notify: false,
		tracking: false,
		unsubscribe: false
	};
	/** Indicates when the last notify call was performed, as given by a Queue.calls timestamp;
	 * this is used to avoid repeatedly queueing notifications in a loop
	 * @type {number}
	 * @private
	 */
	dirty;
	/** A list of links to synchrounous subscribers
	 * @type {Link[]}
	 * @private
	 */
	sync = [];
	/** A list of links to asynchronous subscribers
	 * @type {Link[]}
	 * @private
	 */
	async = [];
	/** Used to handle recursive notification of synchronous subscribers; initialized when
	 * the first sync subscriber is registered
	 * @member {SynchronousIterator} sync_iter
	 * @private
	 */

	/** While subclasses can implement this however they want, to be compatible with the library's
	 * builtin variable wrapping features, the constructor should take either:
	 * 1. A single raw value as the first argument. This can be used to wrap data properties.
	 * 2. A getter and setter function as the first two arguments, respectively. This can be used to
	 *    wrap accessor properties.
	 */
	constructor(){
		this.dirty = Queue.calls-1;
	}

	/** Reactive value. Modifying the value will notify subscribers. The accessor getter/setter are
	 * not inherited, so derived classes will need to implement both
	 * @abstract
	 */
	get value(){ throw Error("Not implemented"); }
	set value(value){ throw Error("Not implemented"); }
	/** Set the value without notifying any subscribers, e.g. assuming the value was always thus
	 * @param value the updated value
	 * @abstract
	 */
	assume(value){ throw Error("Not implemented"); }
	/** Returns the raw type that this Reactive object wraps
	 * @returns {object} For values, `{value}`; for accessors `{get,set}`
	 * @abstract
	 */
	unwrap(){ throw Error("Not implemented"); }

	/** Update the value by applying a transformation function. This will notify subscribers.
	 * @param {function} transform This is passed the current value, and should return the new,
	 * 	transformed value
	 */
	update(transform){ this.value = transform(this.value); }
	/** Continuously update the value with the output of an async generator. This will queue
	 * a notification for each generated value
	 * @param {AsyncGenerator} generator The generator to pull values from
	 */
	async stream(generator){
		for await (const value of generator)
			this.value = value;
	}
	/** Set the value, notifying subscribers. You may also use `reactive.value = value`
	 * @param value the updated value
	 * @see Reactive#value
	 */
	set(value){ this.value = value; }
	/** Get the current value. You may also use `reactive.value`
	 * @see Reactive#value
	 */
	get(){ return this.value; }

	/** Manually notify subscribers that the value has changed. You might call this if the variable
	 * has been modified deeply, and so was not changed via {@link Reactive#set} or assigning to
	 * {@link Reactive#value}. For instance, if implementing a `MyReactiveType` class, you might
	 * call this at the end of a CRUD method.
	 */
	notify(){
		const a = this.async, s = this.sync;
		// queue async first, since they could be called synchronously in a recursive notify;
		// we use the dirty counter to avoid repeated queueing in a loop; it only helps in simple
		// cases, e.g. no sync calls, no new subscriptions, no queues flushed
		if (a.length && this.dirty !== Queue.calls){
			this.dirty = Queue.calls;
			for (const link of a)
				link.enqueue();
		}
		/* For sync, we have to deal with recursive calls. We could queue all but the first and let
			the async logic handle it; we'd want a separate LIFO queue (technically a stack) to
			ensure recursive order is correct. There's a bit of overhead involved, but we can
			actually inline the async logic needed for de-duplicating calls and avoid all that.

			One tricky scenario is if a recursive call cleans a link, and then another recursive
			call makes it dirty again; technically the dirty value is due to the other recursive
			value, not the current. This scenario can't occur however, because as the stack unwinds,
			all of a recursive value's sync links are cleaned before returning. So its not possible
			to have a dirty link that was not due to the current value.

			Recursive notifies to this same value should restart the sync loop. This means when the
			stack unwinds, all unvisited sync links are now clean, as they've been handled by the
			recursive notify. To implement this, we'll use a shared iterator variable sync_iter.
		*/
		const sl = s.length;
		if (sl){
			// recursive notifies could end up calling async, not just from this value; there are
			// some things you can do to narrow the bounds, but I don't think it is worth it
			Queue.called();
			// all but first we need to track if still dirty before running
			const si = this.sync_iter;
			if (sl > 1){
				for (let i=1; i<sl; i++)
					s[i].dirty = true;
				// set iter vars before first sync call, since first may unsubscribe;
				// any new sync subscribers will be clean, hence bounds on length
				si.reset(1, sl);
			}
			let link = s[0];
			link.call();
			if (sl > 1){
				for (; si.i<si.stop; si.i++){
					link = s[si.i];
					if (link.dirty)
						link.call();
				}
				// forces any recursive loops further up stack to exit, since all links are clean now
				si.reset();
			}
		}
	}

	/** Options when subscribing. See {@link Reactive.subscribe_defaults} for default values.
	 * @typedef {object} Reactive~SubscribeOptions
	 * @property {null | Queue | AutoQueue | string | any[]} queue If `null` or `"sync"`, the
	 *  subscriber will be notified synchronously.
	 *
	 *  All other options give async notifications. If
	 *  you don't pass either a {@link Queue} or {@link AutoQueue}, the option specifies arguments
	 *  to pass to {@link AutoQueue}. This can be a single `mode` argument, or tuple `[mode,
	 *  timeout]`.
	 * @property {string} mode Alternative syntax to specify an {@link AutoQueue} queue; this
	 *  specifies the `mode` argument
	 * @property {number} timeout Alternative syntax to specify an {@link AutoQueue} queue; this
	 *  specifies the `timeout` argument
	 * @property {null | boolean | string} notify Whether the subscriber is notified immediately on
	 * subscribe, to indicate the current value:
	 * - `false`: not notified
	 * - `true`: notified
	 * - `null` or `"sync"`: notified, but forcibly synchronous
	 * @property {boolean | string[]} tracking As noted in {@link Reactive#subscribe}, if a function
	 *  is passed as the subscriber, a {@link Subscriber} object will be dynamically created from
	 *  it. If this config option is truthy, a {@link TrackingSubscriber} will be created instead.
	 *  Set this option to `true` use default arguments ({@link TrackingSubscriber.defaults}), or a
	 *  string array to be passed as non-default options.
	 * @property {boolean} unsubscribe If true, a bound unsubscribe function will be returned
	 *  instead of the current subscriber count.
	 * @see Reactive#subscribe
	 */

	/** Subscribe to this value's changes
	 * @param {function | Subscriber} subscriber This can be any callable object, in which case a
	 *  new {@link Subscriber} will be attached to it under an unenumerable key (see
	 *  {@link Subscriber.attach}). Otherwise, pass in a {@link Subscriber} that you created
	 *  directly
	 * @param {Reactive~SubscribeOptions | null | Queue | AutoQueue | string} opts For full
	 *  configuration, this should be an object containing config options. Otherwise it can be just
	 *  the {@link Reactive~SubscribeOptions|queue} config option.
	 * @returns {number | function} By default, it returns the new subscriber count. If requested
	 *  via {@link Reactive~SubscribeOptions|unsubscribe} config option, an unsubscribe function can
	 *  be returned instead.
	 */
	subscribe(subscriber, opts={}){
		const defaults = this.subscribe_defaults || Reactive.subscribe_defaults;
		// opts can just be queue option
		if (!opts || opts.constructor !== Object)
			opts = {queue: opts};
		if (!(subscriber instanceof Subscriber))
			subscriber = Subscriber.attach(subscriber, opts.tracking ?? defaults.tracking);
		// check if already subscribed;
		// infrequent and usually few items, so we just do a linear search
		if (Link.findSubscriber(this.sync, subscriber) !== -1 || Link.findSubscriber(this.async, subscriber) !== -1)
			throw Error("Already subscribed");
		// get the subscriber queue
		let queue;
		if ("queue" in opts){
			queue = opts.queue;
			queue_syntax: {
				if (queue === "sync")
					queue = null;
				else{
					if (typeof queue === "string")
						queue = [queue, -1];
					else if (!Array.isArray(queue))
						break queue_syntax;
					queue = AutoQueue(...queue);
				}
			}
		}
		else if ("mode" in opts)
			queue = AutoQueue(opts.mode, opts.timeout ?? -1);
		else queue = defaults.queue;
		// add subscriber
		const link = new Link(subscriber, queue);
		if (!queue){
			if (this.sync.push(link) > 1 && !this.sync_iter)
				this.sync_iter = new SynchronousIterator();
		}
		else{
			this.async.push(link);
			// forces requeue on next notify
			this.dirty--;
		}
		subscriber.subscribe(this, link);
		// first notify
		const notify = "notify" in opts ? opts.notify : defaults.notify;
		if (notify !== false){
			// sync (possibly forced)
			if ((notify === null || notify === "sync") || !queue){
				Queue.called();
				link.call();
			}
			// async
			else link.enqueue();
		}
		// return value
		if (opts.unsubscribe ?? defaults.unsubscribe)
			return this.unsubscribe.bind(this, subscriber);
		return this.sync.length + this.async.length;
	}
	/** Unsubscribe from this value's changes
	 * @param {?(function | Subscriber)} subscriber The subscriber you wish to unsubscribe from
	 * value changes, and remove as a dependency. If a function, it should have an attached
	 * {@link Subscriber} via {@link Subscriber.attach}. This argument can also be falsey/ommitted,
	 * which unsubscribes all.
	 * @returns {number} The new subscriber count
	 */
	unsubscribe(subscriber){
		// unsubscribe all links
		if (!subscriber){
			if (this.sync.length){
				for (const l of this.sync)
					l.subscriber.unsubscribe(this, l);
				this.sync_iter.reset();
				this.sync.length = 0;
			}
			if (this.async.length){
				for (const l of this.async)
					l.subscriber.unsubscribe(this, l);
				this.async.length = 0;
			}
			return 0;
		}
		if (!(subscriber instanceof Subscriber))
			subscriber = subscriber[Subscriber.key];
		// remove link from value;
		// infrequent, so we just do a linear search
		let link = null;
		let i = Link.findSubscriber(this.sync, subscriber);
		if (i !== -1){
			link = this.sync.splice(i, 1)[0];
			// in case of unsubscribe during synchronous notify
			this.sync_iter.unsubscribe(i);
		}
		else{
			i = Link.findSubscriber(this.async, subscriber);
			if (i !== -1)
				link = this.async.splice(i, 1)[0];
		}
		if (!link)
			throw Error("Not subscribed");
		// remove link from subscriber
		subscriber.unsubscribe(this, link);
		return this.sync.length + this.async.length;
	}
}
wrappable(Reactive.prototype, {
	// a generic accessor that will work with any subclass
	accessor(reactive){
		// reactive.value does less prototype traversal than reactive.get/set
		return {
			get(){ return reactive.value; },
			set(v){ reactive.value = v; }
		};
	},
	unwrap(){
		this.unsubscribe();
		return this.unwrap();
	}
});
export default Reactive;

/** The simplest type of {@link Reactive}, which simply wraps a raw value.
 * ```js
 * const r = new ReactiveValue("Hello");
 * r.value += " world!";
 * ```
 * @extends Reactive
 */
export class ReactiveValue extends Reactive{
	constructor(value){
		super();
		this._value = value;
	}
	get value(){
		return this._value;
	}
	set value(value){
		this._value = value;
		this.notify();
	}
	assume(value){
		this._value = value;
	}
	unwrap(){
		return {value:this._value};
	}
}
/** Wraps a property on another object, using `[[Get]]` (`object[property]`) and `[[Set]]`
 * (`object[property] = value`) to access that property. This lets another object manage the
 * storage of the raw value.
 * ```js
 * const data = {message: "Hello "};
 * const r = new ReactivePointer(data, "message");
 * r.value += " world!";
 * console.log(data.message); // Hello world!
 * ```
 * Note that modifying the value through the owning object will *not* be reactive. For reactivity,
 * assignments must come from the {@link ReactivePointer} object. To have the owning object be
 * reactive, you will need to use {@link ObjectWrapper} or similar wrapper class instead.
 * @extends Reactive
 */
export class ReactivePointer extends Reactive{
	constructor(object, property){
		super();
		this._object = object;
		this._property = property;
	}
	get value(){
		return this._object[this._property];
	}
	set value(value){
		this._object[this._property] = value;
		this.notify();
	}
	assume(value){
		this._object[this._property] = value;
	}
	unwrap(){
		return {value:this._object[this._property]};
	}
}