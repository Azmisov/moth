import { Queue } from "./Queue.mjs";
import { Subscriber, Link, LinkAsync } from "./Subscriber.mjs";

/** Tracks iterator vars for _sync, which can be restarted and run recursively */
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
	/** Indicates when the last notify call was performed, as given by a Queue.calls timestamp;
	 * this is used to avoid repeatedly queueing notifications in a loop
	 * @type {number}
	 */
	_dirty;
	/** A list of links to synchrounous subscribers
	 * @type {Link[]}
	 */
	_sync = [];
	/** A list of links to asynchronous subscribers
	 * @type {Link[]}
	 */
	_async = [];
	/** Used to handle recursive notification of synchronous subscribers
	 * @type {SynchronousIterator}
	 */
	_sync_iter = new SynchronousIterator();

	constructor(){
		this._dirty = Queue.calls-1;
	}

	/** Reactive value; modifying will notify subscribers */
	get value(){ throw Error("Not implemented"); }
	set value(value){ throw Error("Not implemented"); }
	/** Set the value without notifying any subscribers, e.g. assuming the value was always thus */
	assume(value){ throw Error("Not implemented"); }
	
	/** Update the value by applying a transformation function; `transform` will be passed the current value */
	update(transform){ this.value = transform(this.value); }
	/** Set the value, notifying subscribers */
	set(value){ this.value = value; }
	/** Get the value */
	get(){ return this.value; }

	/** Notify subscribers that the value has changed; can be called to manually indicate a change */
	notify(){
		// queue async first, since they could be called synchronously in a recursive notify;
		// we use the _dirty counter to avoid repeated queueing in a loop; it only helps in simple
		// cases, e.g. no sync calls, no new subscriptions, no queues flushed
		if (this._async.length && this._dirty !== Queue.calls){
			this._dirty = Queue.calls;
			for (const link of this._async)
				link.queue();
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

			Recursive notifies to this same value should restart the _sync loop. This means when the
			stack unwinds, all unvisited _sync links are now clean, as they've been handled by the
			recursive notify. To implement this, we'll use a shared iterator variable _sync_iter.
		*/
		const sl = this._sync.length;
		if (sl){
			// recursive notifies could end up calling _async, not just from this value; there are
			// some things you can do to narrow the bounds, but I don't think it is worth it
			Queue.called();
			// all but first we need to track if still dirty before running
			if (sl > 1){
				for (let i=1; i<sl; i++)
					this._sync[i].dirty = true;
				// set iter vars before first _sync call, since first may unsubscribe;
				// any new sync subscribers will be clean, hence bounds on length
				this._sync_iter.reset(1, sl);
			}			
			let link = this._sync[0];
			link.call();
			if (sl > 1){
				for (; this._sync_iter.i<this._sync_iter.stop; this._sync_iter.i++){
					link = this._sync[this._sync_iter.i];
					if (link.dirty)
						link.call();
				}
				// forces any recursive loops further up stack to exit, since all links are clean now
				this._sync_iter.reset();
			}
		}
	}

	/** Subscribe to this value's changes
	 * @param {object | Subscriber} subscriber this can be any callable object, in which case a
	 * 	new Subscriber object will be attached to it under an unenumerable key; otherwise, pass
	 * 	in a Subscriber that you created directly
	 * @param {string} mode how this subscriber wants to be notified; if "sync", it will be notified
	 * 	synchronously; any other value is asynchronous, with the scheduling mode given by one of
	 * 	QueueManager.modes
	 * @param {number} timeout for compatible async modes, this gives a timeout or deadline for
	 * 	when the notification should occur; for best results, try to use a common timeouts across
	 * 	different subscriptions, as notifications are batched and each unique timeout requires an
	 * 	additional queue
	 * @returns {number} new subscriber count
	 */
	subscribe(subscriber, mode="microtask", timeout=-1){
		if (!(subscriber instanceof Subscriber))
			subscriber = Subscriber.attach(subscriber);
		let link;
		// check if already subscribed;
		// infrequent, so we just do a linear search
		if (Link.findSubscriber(this._sync, subscriber) !== -1 || Link.findSubscriber(this._async, subscriber) !== -1)
			throw Error("Already subscribed");
		if (mode === "sync"){
			link = new Link(this, subscriber);
			this._sync.push(link);
		}
		else{
			link = new LinkAsync(this, subscriber, mode, timeout);
			this._async.push(link);
			// forces requeue on next notify
			this._dirty--;
		}
		return this._sync.length + this._async.length;
	}
	/** Unsubscribe from this value's changes
	 * @param {object | Subscriber} subscriber what to unsubscribe; if an object, it should have a
	 * 	Subscriber object as one of its keys
	 * @returns {number} new subscriber count
	 */
	unsubscribe(subscriber){
		if (!(subscriber instanceof Subscriber))
			subscriber = subscriber[Subscriber.key];
		// remove link from value;
		// infrequent, so we just do a linear search
		let link = null;
		let i = Link.findSubscriber(this._sync, subscriber);
		if (i !== -1){
			link = this._sync.splice(i, 1)[0];
			// in case of unsubscribe during synchronous notify
			this._sync_iter.unsubscribe(i);
		}
		else{
			i = Link.findSubscriber(this._async, subscriber);
			if (i !== -1)
				link = this._async.splice(i, 1)[0];
		}
		if (link === null)
			throw Error("Not subscribed");
		// remove link from subscriber
		subscriber.unsubscribe(link);
		return this._sync.length + this._async.length;
	}
}

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
}
/** Wraps an accessor, with a getter and setter method */
export class ReactiveAccessor extends Reactive{
	constructor(getter, setter){
		super();
		this.assume = setter;
		Object.defineProperty(this, "value", {
			get: getter,
			set(value){
				this.assume(value);
				this.notify();
			}
		});
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
	constructor(value, deep=false){
		super();
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
				set: (target, property, value, receiver) => {
					const ret = Reflect.set(target, property, ReactiveProxy.deproxy(value), receiver);
					if (ret)
						this.notify();
					return ret;
				},
				get: (target, key, receiver) => {
					if (key === ReactiveProxy.owner)
						return this;
					if (key === ReactiveProxy.target)
						return target;
					let val = Reflect.get(target, key, receiver);
					// for non-primitives, return a deep proxy
					if (val instanceof Object)
						val = new Proxy(val, this._handler);
					return val;
				}
			}
		}
		else{
			this._handler = {
				set: (target, key, value, receiver) => {
					if (key === ReactiveProxy.target)
						return target;
					const ret = Reflect.set(target, key, value, receiver);
					if (ret)
						this.notify();
					return ret;
				},
				get: (target, key, receiver) => {
					if (key === ReactiveProxy.owner)
						return this;
					if (key === ReactiveProxy.target)
						return target;
					return Reflect.get(target, key, receiver);
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
}