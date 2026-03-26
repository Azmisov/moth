import Reactive from "../Reactive.mjs";
import { Subscriber } from "../Subscriber.mjs";

/** Global stack of currently executing computeds, for auto-dependency tracking.
 * When a ReactiveComputed's function executes, it pushes itself onto this stack.
 * Any Reactive whose `.value` is read while a tracking context is active will
 * auto-subscribe the tracking context as a dependency.
 * @type {ReactiveComputed[]}
 * @private
 */
const trackingStack = [];

// Install the tracking hook on Reactive. This is called by every Reactive subclass getter
// when Reactive._track is set. We only set it when there's an active tracking context.
function _trackDep(dep) {
	const len = trackingStack.length;
	if (len)
		trackingStack[len - 1]._deps.add(dep);
}

/** A reactive value whose getter wraps a memoized function call. The function is lazily
 * re-evaluated when the value is read and any of its inputs have changed. If the recomputed
 * result differs (`!==`), downstream subscribers are notified.
 *
 * This fits the existing Reactive type hierarchy:
 * - {@link ReactiveValue} — private value, get/set manipulate it
 * - {@link ReactiveCache} — same, but only notifies on `!==`
 * - {@link ReactiveComputed} — get runs memoized function, only notifies on `!==`
 *
 * Pull vs push falls out of the existing subscription model:
 * - No subscribers → pure pull. Read `.value` whenever, it resolves if dirty.
 * - Has subscribers → pull + push. Inputs change → computed marks dirty → downstream
 *   links are queued. When a subscriber runs and reads `.value`, the computed resolves.
 *
 * The queue belongs to the Link, not the computed. A computed is just a Reactive — subscribe
 * to it with whatever queue makes sense for the downstream work.
 *
 * `set()` and `assume()` manually override the memoized value, bypassing the function.
 *
 * @extends Reactive
 */
export class ReactiveComputed extends Reactive {
	/** The computation function
	 * @type {function}
	 * @private
	 */
	_fn;
	/** The cached result of the computation
	 * @private
	 */
	_value;
	/** Whether the cached value is stale and needs recomputation
	 * @type {boolean}
	 * @private
	 */
	_stale = true;
	/** Whether the value was manually overridden via set/assume
	 * @type {boolean}
	 * @private
	 */
	_override = false;
	/** Whether we are currently inside the compute function (cycle detection)
	 * @type {boolean}
	 * @private
	 */
	_computing = false;
	/** Whether auto-tracking is enabled for this computed
	 * @type {boolean}
	 * @private
	 */
	_autotrack;
	/** Set of reactives this computed is subscribed to (for auto-tracking cleanup).
	 * Only present when auto-tracking is enabled.
	 * @type {?Set<Reactive>}
	 * @private
	 */
	_deps = null;
	/** Internal subscriber used to listen to input reactives
	 * @type {Subscriber}
	 * @private
	 */
	_subscriber;

	/** Create a new computed reactive
	 * @param {function} fn The computation function. Its return value becomes the reactive's
	 *  value. When auto-tracking is enabled, any reactives read during execution are
	 *  automatically subscribed as dependencies.
	 * @param {boolean} [autotrack=true] Whether to automatically track dependencies by
	 *  detecting which reactives are read during `fn` execution. When false, you must
	 *  manually subscribe the computed's internal subscriber to its dependencies.
	 */
	constructor(fn, autotrack=true) {
		super();
		this._fn = fn;
		this._autotrack = autotrack;
		if (autotrack)
			this._deps = new Set();
		// create internal subscriber; when notified, it marks this computed as stale
		// and notifies our own downstream subscribers
		this._subscriber = new Subscriber();
		const that = this;
		this._subscriber.callable = function() {
			that._subscriber.clean();
			that._markStale();
		};
	}

	/** Mark this computed as stale, recompute, and notify downstream only if the value
	 * actually changed. This eagerly resolves so that downstream subscribers always see
	 * consistent state and we avoid spurious notifications.
	 * @private
	 */
	_markStale() {
		if (this._stale)
			return;
		this._stale = true;
		this._override = false;
		// eagerly recompute so we can check if value actually changed
		const oldValue = this._value;
		this._value = this._compute();
		if (this._value !== oldValue)
			this.notify();
	}

	/** Recompute the value by running the function. If auto-tracking is enabled, this
	 * also re-discovers dependencies.
	 * @private
	 */
	_compute() {
		if (this._computing)
			throw Error("Circular dependency detected in ReactiveComputed");
		this._computing = true;
		const oldDeps = this._deps;
		let newDeps;
		if (this._autotrack){
			newDeps = new Set();
			this._deps = newDeps;
			trackingStack.push(this);
			// enable tracking hook if this is the first tracker on the stack
			if (trackingStack.length === 1)
				Reactive._track = _trackDep;
		}
		let result;
		try {
			result = this._fn();
		}
		finally {
			if (this._autotrack){
				trackingStack.pop();
				// disable tracking hook if stack is empty
				if (!trackingStack.length)
					Reactive._track = null;
			}
			this._computing = false;
		}
		// reconcile dependencies if auto-tracking
		if (this._autotrack){
			// unsubscribe from deps that are no longer read
			if (oldDeps){
				for (const dep of oldDeps){
					if (!newDeps.has(dep))
						dep.unsubscribe(this._subscriber);
				}
			}
			// subscribe to new deps (subscribe is idempotent check via "already subscribed")
			for (const dep of newDeps){
				if (!oldDeps || !oldDeps.has(dep))
					dep.subscribe(this._subscriber, null);
			}
		}
		this._stale = false;
		return result;
	}

	get value() {
		// participate in parent auto-tracking
		if (Reactive._track)
			Reactive._track(this);
		// lazy recomputation
		if (this._stale && !this._override){
			const oldValue = this._value;
			this._value = this._compute();
			// if value changed, downstream subscribers are already notified from _markStale;
			// they'll get the new value when they read .value
		}
		return this._value;
	}
	set value(value) {
		this._override = true;
		this._stale = false;
		if (value !== this._value){
			this._value = value;
			this.notify();
		}
	}
	/** Set the value without notifying subscribers, bypassing the computation function
	 * @param value the overridden value
	 */
	assume(value) {
		this._override = true;
		this._stale = false;
		this._value = value;
	}
	unwrap() {
		return {value: this._value};
	}

	/** Get the internal subscriber, for manually subscribing to dependencies when
	 * auto-tracking is disabled
	 * @type {Subscriber}
	 */
	get subscriber() {
		return this._subscriber;
	}

	/** Manually add a dependency. The computed will be marked stale when `dep` changes.
	 * @param {Reactive} dep The reactive dependency
	 * @param {null | string} [queue=null] Queue mode for the subscription. Defaults to sync
	 *  so the computed is marked stale immediately.
	 */
	depend(dep, queue=null) {
		dep.subscribe(this._subscriber, queue);
		if (this._deps)
			this._deps.add(dep);
	}

	/** Manually remove a dependency
	 * @param {Reactive} dep The reactive dependency to remove
	 */
	undepend(dep) {
		dep.unsubscribe(this._subscriber);
		if (this._deps)
			this._deps.delete(dep);
	}

	/** Destroy this computed, unsubscribing from all dependencies
	 */
	dispose() {
		// unsubscribe our internal subscriber from all deps
		if (this._deps){
			for (const dep of this._deps)
				dep.unsubscribe(this._subscriber);
			this._deps.clear();
		}
		// unsubscribe all of our own downstream subscribers
		this.unsubscribe();
	}
}
export default ReactiveComputed;
