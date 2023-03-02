import wrappable from "./wrappable.mjs";
import AutoQueue from "./AutoQueue.mjs";
import { Queue } from "./Queue.mjs";
import { Subscriber, Link } from "./Subscriber.mjs";

/** Tracks iterator vars for sync, which can be restarted and run recursively */
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

export class Reactive{
	/** Default options for subscribe method
	 * @type {Reactive~SubscribeOptions}
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
	 */
	dirty;
	/** A list of links to synchrounous subscribers
	 * @type {Link[]}
	 */
	sync = [];
	/** A list of links to asynchronous subscribers
	 * @type {Link[]}
	 */
	async = [];
	/** Used to handle recursive notification of synchronous subscribers; initialized when
	 * the first sync subscriber is registered
	 * @type {SynchronousIterator}
	 */
	sync_iter;

	constructor(){
		this.dirty = Queue.calls-1;
	}

	/** Reactive value; modifying will notify subscribers. Accessor getter/setter are not inherited,
	 * so need to be implemented together
	 */
	get value(){ throw Error("Not implemented"); }
	set value(value){ throw Error("Not implemented"); }
	/** Set the value without notifying any subscribers, e.g. assuming the value was always thus */
	assume(value){ throw Error("Not implemented"); }
	/** Returns the raw type that this Reactive object wraps
	 * @returns {object} For values, `{value}`; for accessors `{get,set}`
	 */
	unwrap(){ throw Error("Not implemented"); }
	
	/** Update the value by applying a transformation function; `transform` will be passed the current value */
	update(transform){ this.value = transform(this.value); }
	/** Set the value, notifying subscribers */
	set(value){ this.value = value; }
	/** Get the value */
	get(){ return this.value; }

	/** Notify subscribers that the value has changed; can be called to manually indicate a change */
	notify(){
		// queue async first, since they could be called synchronously in a recursive notify;
		// we use the dirty counter to avoid repeated queueing in a loop; it only helps in simple
		// cases, e.g. no sync calls, no new subscriptions, no queues flushed
		if (this.async.length && this.dirty !== Queue.calls){
			this.dirty = Queue.calls;
			for (const link of this.async)
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
		const sl = this.sync.length;
		if (sl){
			// recursive notifies could end up calling async, not just from this value; there are
			// some things you can do to narrow the bounds, but I don't think it is worth it
			Queue.called();
			// all but first we need to track if still dirty before running
			if (sl > 1){
				for (let i=1; i<sl; i++)
					this.sync[i].dirty = true;
				// set iter vars before first sync call, since first may unsubscribe;
				// any new sync subscribers will be clean, hence bounds on length
				this.sync_iter.reset(1, sl);
			}			
			let link = this.sync[0];
			link.call();
			if (sl > 1){
				for (; this.sync_iter.i<this.sync_iter.stop; this.sync_iter.i++){
					link = this.sync[this.sync_iter.i];
					if (link.dirty)
						link.call();
				}
				// forces any recursive loops further up stack to exit, since all links are clean now
				this.sync_iter.reset();
			}
		}
	}

	/** Options when subscribing
	 * @typedef {object} Reactive~SubscribeOptions
	 * @property {null | Queue | AutoQueue | string | any[]} queue null/"sync" if synchronous,
	 *  otherwise the async queue to use; to dynamically create an AutoQueue, you can set this to
	 *  the `mode` or a tuple [`mode`,`timeout`]
	 * @property {string} mode alternative syntax to create AutoQueue; mode argument; no default
	 * @property {number} timeout alternative syntax to create AutoQueue; timeout argument; no default
	 * @property {?(boolean | string)} notify how subscriber is notified on first subscribe;
	 * 	- false: not notified
	 * 	- true: notified
	 * 	- null/"sync": notified, but forcibly synchronous
	 * @property {boolean | string[]} tracking if a function is passed as the subscriber, a
	 *  Subscriber object will be dynamically created from it; set this to true to create a
	 *  TrackingSubscriber with default arguments, or an array of strings to be passed as
	 *  non-default options
	 * @property {boolean} unsubscribe return an unsubscribe function instead of the current
	 * 	subscriber count
	 */

	/** Subscribe to this value's changes
	 * @param {object | Subscriber} subscriber this can be any callable object, in which case a
	 * 	new Subscriber object will be attached to it under an unenumerable key; otherwise, pass
	 * 	in a Subscriber that you created directly
	 * @param {Reactive~SubscribeOptions | null | Queue | AutoQueue | string} opts for full
	 *  configuration, this should be an object containing config options; otherwise it can be just
	 *  the `queue` parameter
	 * @returns {number | any} new subscriber count, or an unsubscribe function if requested instead
	 */
	subscribe(subscriber, opts={}){
		// opts can just be queue option
		if (!opts || opts.constructor !== Object)
			opts = {queue: opts};
		if (!(subscriber instanceof Subscriber))
			subscriber = Subscriber.attach(subscriber, opts.tracking ?? Reactive.subscribe_defaults.tracking);
		// check if already subscribed;
		// infrequent, so we just do a linear search
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
		else queue = Reactive.subscribe_defaults.queue;
		// add subscriber
		const link = new Link(subscriber, queue);
		if (!queue){
			this.sync.push(link);
			if (!this.sync_iter)
				this.sync_iter = new SynchronousIterator();
		}
		else{
			this.async.push(link);
			// forces requeue on next notify
			this.dirty--;
		}
		subscriber.subscribe(this, link);
		// first notify
		const notify = "notify" in opts ? opts.notify : Reactive.subscribe_defaults.notify;
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
		if (opts.unsubscribe || Reactive.subscribe_defaults.unsubscribe)
			return this.unsubscribe.bind(this, subscriber);
		return this.sync.length + this.async.length;
	}
	/** Unsubscribe from this value's changes
	 * @param {?(object | Subscriber)} subscriber what to unsubscribe; if an object, it should have
	 *  a Subscriber object as one of its keys; if falsey, it unsubscribes all
	 * @returns {number} new subscriber count
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
		if (link)
			throw Error("Not subscribed");
		// remove link from subscriber
		subscriber.unsubscribe(this, link);
		return this.sync.length + this.async.length;
	}
}
wrappable(Reactive.prototype, {
	get(){ return this.value; },
	set(v){ this.value = v; },
	unwrap(){
		this.unsubscribe();
		return this.unwrap();
	}
});

/** Wraps a raw value */
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
/** Wraps a property on another object, using [[Get]] and [[Set]] to access that property */
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
/** Wraps an accessor, with a getter and setter method */
export class ReactiveAccessor extends Reactive{
	constructor(getter, setter){
		super();
		this._getter = getter;
		this._setter = setter;
		this.assume = setter;
		Object.defineProperty(this, "value", {
			get: getter,
			set(value){
				this.assume(value);
				this.notify();
			}
		});
	}
	unwrap(){
		return { get: this._getter, set: this._setter };
	}
}
/** Wraps an object as a Proxy, where [[Set]] triggers notify */
export class ReactiveProxy extends Reactive{
	static owner = Symbol();
	static target = Symbol();
	static deproxy(value){
		try{
			const target = value[this.target];
			if (target)
				return target;
		} catch{}
		return value;
	}
	constructor(value, deep=false, native=false){
		super();
		const that = this;
		if (deep){
			/* No use trying to recursively wrap on initialization, since user may have already
				stored a reference to a non-proxied sub-value. In general, this can't handle all
				types of code, for instance:
					let cache = reactive.a;
					reactive.a = other
					cache += 10
				Here cache is still a proxy attached to reactive, but it has been implicitly
				detached by being overriden by other. 
			*/
			this._handler = {
				set(target, property, value, receiver){
					const ret = Reflect.set(target, property, ReactiveProxy.deproxy(value), receiver);
					if (ret)
						that.notify();
					return ret;
				},
				get(target, key, receiver){
					if (key === ReactiveProxy.owner)
						return that;
					if (key === ReactiveProxy.target)
						return target;
					// rebind to handle native objects
					let val;
					if (native){
						val = target[key];
						if (val instanceof Function)
							return function (...args){
								return val.apply(this === receiver ? target : this, args);
							};
					}
					else val = Reflect.get(...arguments);
					// for non-primitives, return a deep proxy
					if (val instanceof Object)
						return new Proxy(val, that._handler);
					return val;
				}
			}
		}
		else{
			this._handler = {
				set(target, key, value, receiver){
					if (key === ReactiveProxy.target)
						return target;
					const ret = Reflect.set(target, key, value, receiver);
					if (ret)
						that.notify();
					return ret;
				},
				get(target, key, receiver){
					if (key === ReactiveProxy.owner)
						return that;
					if (key === ReactiveProxy.target)
						return target;
					// rebind to handle native objects
					let val;
					if (native){
						const val = target[key];
						if (val instanceof Function)
							return function (...args){
								return val.apply(this === receiver ? target : this, args);
							};
					}
					else val = Reflect.get(...arguments);
					return val;
				}
			};
		}
		this.assume(value);
	}
	get value(){
		return this._value;
	}
	set value(value){
		if (this.assume(value))
			this.notify();
	}
	assume(value){
		// same value; don't create another proxy
		if (this._target === value || this._value === value)
			return false;
		this._target = value;
		// primitives that can't be proxied
		if (value instanceof Object)
			this._value = new Proxy(value, this._handler);
		else this._value = value;
		return true;
	}
	unwrap(){
		return {value: ReactiveProxy.deproxy(this._value)};
	}
}