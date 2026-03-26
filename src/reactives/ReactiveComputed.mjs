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

/** @private */
const STALE = 1;
/** @private */
const OVERRIDE = 2;
/** @private */
const COMPUTING = 4;
/** @private */
const AUTOTRACK = 8;

// Install the tracking hook on Reactive. This is called by every Reactive subclass getter
// when Reactive._track is set. We only set it when there's an active tracking context.
// Handles subscribe inline so no separate reconciliation pass is needed for new deps.
function _trackDep(dep) {
	const computed = trackingStack[trackingStack.length - 1];
	const deps = computed._deps;
	if (!deps.has(dep))
		dep.subscribe(computed._subscriber, computed._trackOpts);
	deps.set(dep, computed._depGen);
}

/** A reactive value whose getter wraps a memoized function call. Additionally, the function call
 * itself acts serves as a subscriber, recomputed when its inputs have changed. If the recomputed
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
	/** Bitflags: STALE | OVERRIDE | COMPUTING | AUTOTRACK
	 * @type {number}
	 * @private
	 */
	_flags = STALE;
	/** Map of reactives this computed is subscribed to → generation counter.
	 * Only present when auto-tracking is enabled. Entries with counter < _depGen
	 * after compute are stale and get unsubscribed.
	 * @member {Map<Reactive, number>} _deps
	 * @private
	 */
	/** Generation counter for dependency tracking, incremented each compute.
	 * Only present when auto-tracking is enabled.
	 * @member {number} _depGen
	 * @private
	 */
	/** Delta from manual depend/undepend calls between computes.
	 * Only present when auto-tracking is enabled.
	 * @member {number} _depDelta
	 * @private
	 */
	/** Internal subscriber used to listen to input reactives
	 * @type {Subscriber}
	 * @private
	 */
	_subscriber;
	/** Subscribe options used for auto-tracked dependencies. Only present when auto-tracking
	 * is enabled.
	 * @member {Reactive~SubscribeOptions | null | string} _trackOpts
	 * @private
	 */

	/** Create a new computed reactive
	 * @param {function} fn The computation function. Its return value becomes the reactive's
	 *  value. When auto-tracking is enabled, any reactives read during execution are
	 *  automatically subscribed as dependencies.
	 * @param {Reactive~SubscribeOptions | null | string | false} [autotrack=null] Subscribe
	 *  options for auto-tracked dependencies, same as {@link Reactive#subscribe}. Defaults to
	 *  `null` (sync). Pass `false` to disable auto-tracking entirely, in which case you must
	 *  manually subscribe via {@link ReactiveComputed#depend}.
	 */
	constructor(fn, autotrack=null) {
		super();
		this._fn = fn;
		if (autotrack !== false){
			this._flags |= AUTOTRACK;
			this._trackOpts = autotrack;
			this._deps = new Map();
			this._depGen = Number.MIN_SAFE_INTEGER+1;
			this._depDelta = 0;
		}
		// create internal subscriber; when notified, it marks this computed as stale
		// and notifies our own downstream subscribers
		this._subscriber = new Subscriber(this._markStale.bind(this));
	}

	/** Mark this computed as stale. If there are downstream subscribers, eagerly recomputes
	 * and notifies only if the value changed. Otherwise, defers recomputation to the next
	 * `.value` read (pure pull).
	 * @private
	 */
	_markStale() {
		if (this._flags & STALE)
			return;
		this._flags = (this._flags | STALE) & ~OVERRIDE;
		// only eagerly recompute if there are downstream subscribers to notify
		if (this.sync || this.async){
			const oldValue = this._value;
			this._value = this._compute();
			if (this._value !== oldValue)
				this.notify();
		}
	}

	/** Recompute the value by running the function. If auto-tracking is enabled, this
	 * also re-discovers dependencies.
	 * @private
	 */
	_compute() {
		// There are probably some fringe, legitimate cases for doing recursive computed. For
		// example, preamble of computed updates some state, a dependency fetches the computed value
		// triggering recursion, but due to preamble updated state it can now return an initial
		// value to stop the recursion. But most commonly this is just a bug, so we prevent it.
		if (this._flags & COMPUTING)
			throw Error("Circular dependency detected in ReactiveComputed");
		this._flags |= COMPUTING;
		// setup dependency tracking; increment generation so _trackDep can detect stale deps
		let prevSize;
		if (this._flags & AUTOTRACK){
			this._depGen++;
			prevSize = this._deps.size;
			trackingStack.push(this);
			if (trackingStack.length === 1)
				Reactive._track = _trackDep;
		}
		// run computation; _trackDep subscribes to new deps inline
		let result;
		try {
			result = this._fn();
		}
		finally {
			if (this._flags & AUTOTRACK){
				trackingStack.pop();
				if (!trackingStack.length)
					Reactive._track = null;
				// unsubscribe from deps no longer read (stale generation); skip if deps size
				// unchanged (adjusted for manual depend/undepend), meaning all existing deps were
				// seen by _trackDep
				if (this._deps.size !== prevSize + this._depDelta){
					this._depDelta = 0;
					const gen = this._depGen;
					for (const [dep, g] of this._deps){
						if (g < gen){
							dep.unsubscribe(this._subscriber);
							this._deps.delete(dep);
						}
					}
				}
				else this._depDelta = 0;
			}
			this._flags &= ~COMPUTING;
		}
		this._flags &= ~STALE;
		return result;
	}

	get value() {
		// participate in parent auto-tracking
		if (Reactive._track)
			Reactive._track(this);
		// lazy recomputation; downstream notification already handled by _markStale
		if ((this._flags & (STALE | OVERRIDE)) === STALE)
			this._value = this._compute();
		return this._value;
	}
	set value(value) {
		this._flags = (this._flags | OVERRIDE) & ~STALE;
		if (value !== this._value){
			this._value = value;
			this.notify();
		}
	}
	/** Set the value without notifying subscribers, bypassing the computation function
	 * @param value the overridden value
	 */
	assume(value) {
		this._flags = (this._flags | OVERRIDE) & ~STALE;
		this._value = value;
	}
	unwrap() {
		return {value: this._value};
	}

	/** Manually add a dependency. The computed will be marked stale when `dep` changes.
	 * @param {Reactive} dep The reactive dependency
	 * @param {Reactive~SubscribeOptions | null | string} [opts=null] Subscribe options, same as
	 *  {@link Reactive#subscribe}. Defaults to sync so the computed is marked stale immediately.
	 */
	depend(dep, opts=null) {
		dep.subscribe(this._subscriber, opts);
		if (this._deps){
			this._deps.set(dep, Infinity);
			this._depDelta++;
		}
	}

	/** Manually remove a dependency
	 * @param {Reactive} dep The reactive dependency to remove
	 */
	undepend(dep) {
		dep.unsubscribe(this._subscriber);
		if (this._deps){
			this._deps.delete(dep);
			this._depDelta--;
		}
	}

	/** Destroy this computed, unsubscribing from all dependencies
	 */
	dispose() {
		// unsubscribe our internal subscriber from all deps
		if (this._deps){
			for (const [dep] of this._deps)
				dep.unsubscribe(this._subscriber);
			this._deps.clear();
		}
		// unsubscribe all of our own downstream subscribers
		this.unsubscribe();
	}
}
export default ReactiveComputed;
