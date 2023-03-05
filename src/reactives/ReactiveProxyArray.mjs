import { ReactiveProxy } from "../Reactive.mjs";

/** Coerces a value to be an integer, as described here:
 * https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number#integer_conversion
 * @private
 */
function toInt(v){
	v = Math.trunc(+v);
	return isNaN(v) || v === -0 ? 0 : v;
}
/** Indexing conversion for many array methods */
function toIndex(v, l){
	v = toInt(v);
	return v < 0 ? Math.max(0, v + l) : v;
}

/** A special reactive type optimized for Array. It can also be used for any Array-like object,
 * with a `length` property and integer keys.
 */
export class ReactiveProxyArray extends ReactiveProxy{
	static mutating = [
		"pop", "push", "shift", "unshift", "splice", "copyWithin", "fill", "reverse", "sort"
	];
	static iterating = new Set([
		"every", "filter", "find", "findIndex", "findLast", "findLastIndex", "flatMap", "forEach",
		"group", "groupToMap", "map", "reduce", "reduceRight", "some"
	]);

	/**
	 * @param {*} value 
	 * @param {boolean} [optimized=true] Use optimized versions of `mutating` methods, which check
	 *  that the array has actually been modified before notifying subscribers. Array operations are
	 * 	very slightly slower due to the checks, but can be worth it due to less false notifications. 
	 * @param {boolean} [safe_iterating=false] When fetching `iterating` methods, whether to call
	 *  them using the Proxy. The iterating methods pass a reference to the array to the callback.
	 *  Setting this to false will be faster, as it won't have to go through the Proxy interface,
	 *  but potentially less safe as the callback could call additional methods on the non-proxied
	 *  array reference.
	 */
	
	build_handler(optimized=true, safe_iterating=false){
		const that = this;
		let overrides = {};
		// optimized methods, which are potentially less safe
		if (optimized){
			overrides = {
				pop(){
					const notify = !!this.length;
					const ret = Array.prototype.pop.apply(this, arguments);
					if (notify)
						that.notify();
					return ret;
				},
				push(){
					const ol = this.length;
					const nl = Array.prototype.push.apply(this, arguments);
					if (nl !== ol)
						that.notify();
					return nl;
				},
				shift(){
					const notify = !!this.length;
					const ret = Array.prototype.shift.apply(this, arguments);
					if (notify)
						that.notify();
					return ret;
				},
				unshift(){
					const ol = this.length;
					const nl = Array.prototype.unshift.apply(this, arguments);
					if (nl !== ol)
						that.notify();
					return nl;
				},
				splice(start, ...args){
					const start_idx = toIndex(start, this.length);
					// insertions, or start of deletions < length and deletions > 0 (no delete param = Infinity)
					const notify = args.length > 1 || (start_idx < this.length && (!args.length || toInt(args[0]) > 0));
					const ret = Array.prototype.splice.apply(this, arguments);
					if (notify)
						that.notify();
					return ret;
				},
				copyWithin(target, start, ...args){
					const l = this.length;
					const target_idx = toIndex(target, l);
					const start_idx = toIndex(start, l);
					const end_idx = args.length ? Math.min(l, toIndex(args[0], l)) : l;
					const notify = target_idx < l && start_idx < l && end_idx > start_idx && target_idx !== start_idx; 
					Array.prototype.copyWithin.apply(this, arguments);
					if (notify)
						that.notify();
					return this;
				},
				fill(val, start, ...args){
					const l = this.length;
					const start_idx = toIndex(start, l);
					const end_idx = args.length ? Math.min(l, toIndex(args[0], l)) : l;
					const notify = start_idx < l && start_idx < end_idx;
					Array.prototype.fill.apply(this, arguments);
					if (notify)
						that.notify();
					return this;
				},
				reverse(){
					const notify = this.length > 1;
					Array.prototype.reverse.apply(this, arguments);
					if (notify)
						that.notify();
					return this;
				},
				sort(){
					const notify = this.length > 1;
					Array.prototype.sort.apply(this, arguments);
					if (notify)
						that.notify();
					return this;
				}
			}
		}
		// unoptimized methods which always notify
		for (const method of ReactiveProxyArray.mutating){
			if (method in overrides)
				continue;
			const fn = Array.prototype[method];
			overrides[method] = function(){
				const ret = fn.apply(this, arguments);
				that.notify();
				return ret;
			}
		}
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
				// only want to proxy the `iterating` methods, and ony if requested; the special
				// overrides methods will take care of notifying, rather than going through [[Set]]
				let val;
				if (key in overrides)
					val = overrides[key];
				else if (safe_iterating && ReactiveProxyArray.iterating.has(key))
					return Reflect.get(...arguments);
				else{
					// non-proxied value
					val = target[key];
					if (!(val instanceof Function))
						return val;
				}
				// function, force it not to go through proxied [[Set]]
				return function(){
					return val.apply(this === receiver ? target : this, arguments);
				};
			}
		};
	}
}