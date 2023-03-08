// TODO: bind_value, we can replace the per-value binding with that._value instead of this
//	however, we'd have double the number of function definitions in generic_wrapper; we could
//	do an if statement inside though

import Reactive from "../Reactive.mjs";
import { get_properties } from "../wrapper.mjs";

/** Generate generic wrapper for any property type and an optional notify callback, with subscriber
 * notifications occurring after the property method/accessor finishes its work
 * @type {ReactiveWrapper~Custom}
 */
function generic_wrapper(opts, prop, unwrap){
	const that = this;
	const name = opts.property;
	const notify = opts.notify;
	let desc;
	if (prop.data){
		const base = prop.value;
		// wrap method
		if (base instanceof Function){
			let fn;
			if (notify === false)
				fn = base;
			else if (!notify){
				fn = function(){
					const ret = base.apply(this, arguments);
					that.notify();
					return ret;
				}
			}
			else{
				fn = function(){
					const n = notify.apply(this, arguments);
					const ret = base.apply(this, arguments);
					if (n) that.notify();
					return ret;
				}
			}
			desc = { value: fn };
		}
		// wrap data
		else if (!prop.writable)
			throw TypeError("Refusing to wrap non-writable property: "+name);
		// no dependence on this; safe to use prototype inheritence
		else if (notify === false)
			return;
		else{
			let private_var = base;
			let fn;
			if (!notify){
				fn = function(val){
					private_var = val;
					that.notify();
				}
			}
			else{
				fn = function(val){
					const n = notify.call(this, val);
					private_var = val;
					if (n) that.notify();
				}
			}
			// turn it into an accessor
			desc = { set: fn, get(){ return private_var; } };
			unwrap[name] = {
				configurable: prop.configurable,
				enumerable: prop.enumerable,
				writable: true,
				value: desc.get
			};
		}
	}
	// wrap accessor
	else{
		const get = prop.get;
		const set = prop.set;
		let fn;
		if (notify === false)
			fn = set;
		else if (!notify){
			fn = function(val){
				set.call(this, val);
				that.notify();
			}
		}
		else{
			fn = function(val){
				const n = notify.call(this, val);
				set.call(this, val);
				if (n) that.notify();
			}
		}
		desc = { get, set: fn };
	}
	return desc;
}

/** Holds `roots` option for {@link ReactiveWrapper} */
class Roots{
	/** Create a new container for roots
	 * @param {object[]} roots
	 * @param {string} property
	 */
	constructor(roots, property){
		this.roots = roots; // we'll copy the array later
		this.placeholder = roots.indexOf("value");
		this.properties = [property];
	}
	/** Checks if a roots definition matches this one, and if so adds to {@link Roots#properties}
	 * @param {object[]} roots
	 * @param {string} property
	 */
	matches(roots, property){
		if (roots !== this.roots){
			if (roots.length !== this.roots.length)
				return false;
			for (let i=0; i<roots.length; i++)
				if (roots[i] !== this.roots[i])
					return false;
		}
		this.properties.push(property);
		return true;
	}
}
/** Holds list of unique `roots` options for {@link ReactiveWrapper} */
class RootsList{
	constructor(){
		/** @type {Roots[]} */
		this.list = [];
	}
	add(roots, property){
		for (const r of this.list)
			if (r.matches(roots, property))
				return;
		const r = new Roots(roots, property);
		this.list.push(r);
	}
	/** Makes copies of all roots so they can safely be edited */
	finalize(){
		for (const r of this.list)
			r.roots = Array.from(r.roots);
	}
	/** Get a list of props for all {@link Roots} objects in the list
	 * @returns {object<string,object>}
	 */
	getProperties(value){
		const out = {};
		for (const r of this.list){
			r.roots[r.placeholder] = value;
			get_properties(r.roots, r.properties, out);
		}
		return out;
	}
	/** Get properties for all non-value dependent roots, and remove them from the list
	 * @returns {object<string,object>}
	 */
	extractGenericProperties(){
		const nlist = [];
		const out = {};
		for (const r of this.list){
			if (r.placeholder !== -1){
				nlist.push(r);
				continue;
			}
			get_properties(r.roots, r.properties, out);
		}
		this.list = nlist;
		return out;
	}
	get empty(){ return !this.list.length }
}

/** Creates a new object that wraps the value; a predefined set of properties (which can be
 * data, accessors, or methods) will be overridden on the wrapper to notify subscribers
 */
export class ReactiveWrapper extends Reactive{

	/** Used to generate a custom 
	 * @callback ReactiveWrapper~Custom
	 * @param {ReactiveWrapper~Options} opts Parent options for wrapping this property
	 * @param {object} prop Property definition found from `roots`, or falsey if not searched
	 * @param {object} unwrap An object giving instructions on how to unwrap the property to restore
	 *  data properties to the target. By default no restoration will be performed. Set the
	 *  `opts.property` / `prop.property` key to a property descriptor to be restored. The `value`
	 *  for the descriptor must be a function which will be called to fetch the current value (e.g.
	 *  to fetch the value from private storage).
	 * @returns {?object} Mutable property descriptor to be used. If falsey, the property is assumed
	 *	to be not wrapped
	 */

	/** Used to specify when a wrapped method should notify. It is bound to the same `this` as the
	 * wrapped method
	 * @callback ReactiveWrapper~Notify
	 * @param {...any} args Same arguments as the wrapped method
	 * @returns {boolean} Whether to notify subscribers
	 */

	/** Defines how a property is wrapped
	 * @typedef {object} ReactiveWrapper~Options
	 * @property {string} property the property that is wrapped
	 * @property {?object[]} [roots=["value"]] An ordered list of root objects to search for the
	 *  `prop` property's descriptor. Use the keyword "value" as a substitute for the currently
	 *  wrapped value. This can also be falsey, indicating that the wrapped value is not based on
	 *  the current property, and so does not need to be searched for
	 * @property {?string} type Can be one of `"data"`, `"accessor"`, or `"method"`, indicating what
	 *  type you expect the property to be for validation. If falsey, any type is accepted. Note if
	 *  `roots` is null, this option is ignored
	 * @property {?boolean} [bind_value=false] Specifies that the wrapped method should be bound to
	 *  the wrapped value, rather than using the wrapper's `this`. Certain builtin objects will not
	 *  work if `this` points to a wrapper, e.g. `Map`.
	 * @property {?ReactiveWrapper~Custom} custom Defines a custom function for generating the
	 *  wrapped property descriptor. If not specified, a generic wrapper is generated. This
	 *  overrides the `notify` option.
	 * @property {?ReactiveWrapper~Notify | false} notify A function for a generic wrapper that
	 *  tells when to notify subscribers. If not provided, the generic wrapper always notifies. If
	 *  `false`, a wrapper is generated that doesn't notify; in this case, `bind_value` must be
	 *  true. A `custom` function can also make use of this parameter if desired.
	 */

	/** Create a new property wrapper. Arguments are forwarded to
	 * {@link ReactiveWrapper#initDescriptors}
	 */
	constructor(){
		super();
		this.initDescriptors(...arguments);
	}
	#getDescriptor(opts, prop){
		if (opts.type){
			const type = prop.data ? prop.value instanceof Function ? "method" : "data" : "accessor";
			if (type !== opts.type)
				throw TypeError(`Expected ${opts.type} for property ${prop.property} but got ${type}`);

		}
		this._unwrap[opts.property] = null;
		const desc = opts.custom.call(this, opts, prop, this._unwrap);
		if (!desc) return;
		// fill in missing descriptor options
		if (prop){
			for (const k of ["configurable","enumerable"])
				if (!(k in desc))
					desc[k] = prop[k];
			if ("value" in desc && !("writable" in desc))
				desc.writable = prop.writable ?? true;
		}
		return desc;
	}
	/** Initialize the property wrapper. This allows super initialization to be done after any
	 * prerequisite subclass setup
	 * @param value initial value to wrap
	 * @param {(string | ReactiveWrapper~Wrapper)[]} properties A list of properties to be wrapped,
	 *  optionally with detailed configuration for how to wrap each. Plain strings are equivalent to
	 *  `{property: string}`, which will use `defaults` for missing options.
	 * @param {ReactiveWrapper~Wrapper} defaults Default options to apply to each of `properties`.
	 */
	initDescriptors(value, properties, defaults={}){
		/** Property descriptors that are not value dependent, so are cached for reuse
		 * @private
		 */
		this._descs = {};
		/** Used by {@link ReactiveWrapper#unwrap} to restore data value properties
		 * @private
		 */
		this._unwrap = {};
		const default_roots = ["value"];
		/** Applies defaults to each property config */
		function option(obj, key, fallback){
			if (key in obj)
				return obj[key];
			if (key in defaults)
				return defaults[key];
			return fallback;
		}
		/** sanitized, internal list of properties */
		const options = {};
		/** roots for searching for properties to wrap */
		const roots_list = this._roots = new RootsList();
		for (let prop of properties){
			if (typeof prop === "string")
				prop = {property:prop};
			const name = prop.property;
			const roots = option(prop, "roots", default_roots) || false;
			if (roots)
				roots_list.add(roots, name);
			const type = roots ? option(prop, "type") || false : roots;
			const bind_value = !!option(prop, "bind_value");
			let custom = option(prop, "custom");
			const notify = option(prop, "notify");
			if (!custom){
				custom = generic_wrapper;
				if (notify === false && !bind_value)
					throw TypeError("'notify' can't be false for generic wrapper with 'bind_value' false");
			}
			options[name] = { property:name, type, bind_value, custom, notify };
		}
		// wrappers independent of value can be initialized now and cached
		const props = roots_list.extractGenericProperties();
		for (const name of Reflect.ownKeys(props)){
			const prop = props[name];
			const opts = options[name];
			const desc = this.#getDescriptor(opts, prop);
			if (!desc) continue;
			this._descs[name] = desc;
			// only need to keep bind_value
			if (opts.bind_value)
				options[name] = { property:name, bind_value: true };
			else delete options[name];
		}
		// convert options to list
		this._properties = [];
		for (const name of Reflect.ownKeys(options))
			this._properties.push(options[name]);
		// late copy so roots_list.add matching can use strict equality check
		roots_list.finalize();
		// initial value
		this.assume(value);
	}
	assume(value){
		// same value; don't create another wrapper
		if (this._target === value || this._value === value)
			return false;
		this._target = value;
		// primitives can't be wrapped
		if (!(value instanceof Object))
			this._value = value;
		else{
			let descs;
			// need to dynamically build some/all descriptors using current value
			if (this._properties.length){
				descs = {};
				const props = this._roots.getProperties(value);
				for (const opts of this._properties){
					const name = opts.property;
					let desc;
					// missing custom means it just needs to be bound; it was precomputed inside
					// initDescriptors, since it doesn't depend on value except for binding
					if (!opts.custom)
						desc = this._descs[name];
					// otherwise, full initialization
					else{
						const prop = props[name];
						desc = this.#getDescriptor(opts, prop);
						if (!desc) continue;
					}
					// bind to value
					if (opts.bind_value){
						if (desc.value)
							desc.value = desc.value.bind(value);
						else{
							if (desc.get)
								desc.get = desc.get.bind(value);
							if (desc.set)
								desc.set = desc.set.bind(value);
						}
					}
					descs[name] = desc;
				}
			}
			else descs = this._descs;
			this._value = Object.create(value, descs);
		}
		return true;
	}
	get value(){
		return this._value;
	}
	set value(value){
		if (this.assume(value))
			this.notify();
	}
	unwrap(){
		if (this._target === null)
			return {value: this._value};
		// restore properties defined on wrapper to the original target
		const descs_restore = {};
		const descs = Object.getOwnPropertyDescriptors();
		for (let name in descs){
			let desc = this._unwrap[name];
			if (desc === null)
				continue;
			// fetch value from private storage
			if (desc)
				desc.value = desc.value();
			// new value, probably a data prop
			else desc = descs[name];
			descs_restore[name] = desc;
		}
		Object.defineProperties(this._target, descs_restore);
		return this._target;
	}
}
export default ReactiveWrapper;