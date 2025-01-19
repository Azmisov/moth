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
			else if (notify === true){
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
			if (notify === true){
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

/** Holds `roots` option for {@link ReactiveWrapper}. The goal is to search for property
 * descriptor's that should be wrapped. This container holds the ordered list of root objects to
 * search for these properties. We first check on the first root, then the second, etc. This is
 * primarily a helper class for {@link RootsList}
 */
class Roots{
	/** Create a new container for roots
	 * @param {Object[]} roots Value for {@link Roots#roots}
	 * @param {string | Symbol} property Initial property to be added to {@link Roots#properties}
	 */
	constructor(roots, property){
		/** Ordered list of root objects to search for property descriptors. This should ideally
		 * be a reference to a common array to make equality checks in {@link Roots#matches} faster.
		 * Its expected this value is immutable. Make a copy if you intend to modify it
		 * @type {Object[]}
		 */
		this.roots = roots;
		/** Index into roots of the placeholder "value", which indicates a root which should be
		 * substituted with the current {@link ReactiveWrapper#value}
		 * @type {number}
		*/
		this.placeholder = roots.indexOf("value");
		/** List of properties to search for in the roots
		 * @type {Array.<string | Symbol>}
		 */
		this.properties = [property];
	}
	/** Checks if a roots definition matches this one, and if so adds to {@link Roots#properties}
	 * @param {object[]} roots List of root objects whose properties we want to search. The list
	 * 	of roots is ordered and must match {@link Roots#roots} exactly for a match
	 * @param {string | Symbol} property Search for this property. It is assume this property does
	 *  not already exist in {@link Roots#properties}
	 * @returns {boolean} True if the roots match and the property was added
	 */
	matches(roots, property){
		// check deep equality
		if (roots !== this.roots){
			if (roots.length !== this.roots.length)
				return false;
			for (let i=0; i<roots.length; i++)
				if (roots[i] !== this.roots[i])
					return false;
		}
		// roots match, can include this property in search
		this.properties.push(property);
		return true;
	}
}

/** Holds list of unique `roots` options for {@link ReactiveWrapper}. Different properties can
 * have different root priorities for the search. Each of those unique root sets are stored in
 * {@link Roots} objects.
 */
class RootsList{
	constructor(){
		/** List of unique {@link Roots} objects, where each has a different set of fallback root
		 * objects for property descriptor searching.
		 * @type {Roots[]}
		 */
		this.roots = [];
	}
	/** Mark a `property` to be searched for in `roots`. This method will search for a compatible
	 * {@link Roots} object, whose roots match and include the property in its search list. If no
	 * compatible object is found, a new one is created.
	 * @param {object[]} roots List of root objects whose properties we want to search. This is an
	 * 	ordered list, specifying the fallback priority when properties are not found.
	 * @param {string | Symbol} property Search for this property
	 */
	add(roots, property){
		for (const r of this.roots)
			if (r.matches(roots, property))
				return;
		const r = new Roots(roots, property);
		this.roots.push(r);
	}
	/** Fetch property descriptors for all {@link Roots} objects. This is intended to be called
	 * after {@link RootsList#}
	 * @param {object} value Value to substitute for "value" roots
	 * @returns {object.<string | Symbol, object>} Mapping from property name to descriptor
	 */
	getProperties(value){
		const out = {};
		for (const r of this.roots){
			if (r.placeholder !== -1)
				r.roots[r.placeholder] = value;
			get_properties(r.roots, r.properties, out);
		}
		return out;
	}
	/** Fetch property descriptors for all {@link Roots} that are non-value dependent; e.g. do not
	 * include "value" as one of their roots to search. These {@link Roots} will be removed, so
	 * subsequent calls to {@link RootsList#getProperties} will not include these properties
	 * @returns {object.<string | Symbol, object>} Mapping from property name to descriptor
	 */
	extractGenericProperties(){
		// new list of Roots that do depend on value
		const nlist = [];
		// properties extracted from all other Roots
		const out = {};
		for (const r of this.roots){
			if (r.placeholder !== -1){
				nlist.push(r);
				continue;
			}
			get_properties(r.roots, r.properties, out);
		}
		this.roots = nlist;
		return out;
	}
	get empty(){ return !this.roots.length }
}

/** Creates a new object that wraps the value; a predefined set of properties (which can be
 * data, accessors, or methods) will be overridden on the wrapper to notify subscribers
 */
export class ReactiveWrapper extends Reactive{
	/** Default {@link ReactiveWrapper~Options#roots}. We want this to be a reference to quickly
	 * check for equality in {@link Roots#matches}
	 * @type {object[]}
	 */
	static #defaultRoots = ["value"];

	/** Callback which can generate a custom reactive property descriptor wrapper
	 * @callback ReactiveWrapper~Custom
	 * @param {ReactiveWrapper~Options} opts Parent options for wrapping this property
	 * @param {object | false} prop Property definition found from `roots` search. This will be
	 * 	`false` if {@link ReactiveWrapper~Options#roots} was falsey, indicating the reactive wrapper
	 * 	does not need the original property.
	 * @param {object} unwrap An object giving instructions on how to unwrap the property to restore
	 *  data properties to the target. By default no restoration will be performed. Set the
	 *  `opts.property` / `prop.property` key to a property descriptor to be restored. The `value`
	 *  for the descriptor must be a function which will be called to fetch the current value (e.g.
	 *  to fetch the value from private storage).
	 * @returns {?object} Mutable property descriptor to be used. A falsey value can be returned, in
	 * 	which case the property won't be wrapped
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
	 *  `property` descriptor that is to be wrapped/replace. Use the keyword "value" as a substitute
	 *  for the currently wrapped value. The list is assumed to be immutable; pass a copy if and
	 *  only if you intend to mutate the array; initialization will be slightly more efficient if
	 *  you use a common reference across multiple properties. This can also be falsey, indicating
	 *  that the wrapped value is not based on the current property, and so does not need to be
	 *  searched for.
	 * @property {?string} type Can be one of `"data"`, `"accessor"`, or `"method"`, indicating what
	 *  type you expect `property` descriptor to be for validation. If falsey, any type is accepted.
	 *  Note if `roots` is falsey, this option is ignored
	 * @property {?boolean} [bind_value=false] Specifies that the wrapped method should be bound to
	 *  the wrapped value, rather than using the wrapper's `this`. Certain builtin objects will not
	 *  work if `this` points to a wrapper, e.g. `Map`.
	 * @property {?ReactiveWrapper~Custom} custom Defines a custom function for generating the
	 *  wrapped property descriptor. If not specified, a generic wrapper is generated. This
	 *  overrides the `notify` option.
	 * @property {?ReactiveWrapper~Notify | boolean} [notify=true] When `custom` is not specified,
	 *  this is used to tweak when the generic wrapped, reactive property descriptor notifies
	 *  subsribers. It can be a callback, returning a boolean indicating whether to notify
	 *  subscribers; or you can pass a fixed boolean to always/never notify. The fixed `false`
	 *  option is a special case to accommodate wrapping some native objects, so is only allowed
	 *  when `bind_value` is true. The default is `true`, to always notify.
	 *
	 * 	This option is preserved even if `custom` is specified. So your `custom` wrapper generator
	 * 	can make use of this option to tweak its own notification behavior.
	 */

	/** Wrapping configuration for properties which depend on the current {@link Reactive#value}.
	 * They need to be wrapped on the fly whenever {@link Reactive@value} is updated. These config
	 * options have been sanitized, with defaults applied. The `roots` option will be omitted.
	 * Precomputed properties stored in {@link ReactiveWrapper#fixed_descs} will have all but
	 * `property` omitted; these fixed properties only need to be bound to the current value.
	 * @type {ReactiveWrapper~Options[]}
	 * @private
	 */
	dynamic_props = [];
	/** Reactive property descriptors that are not {@link Reactive#value} dependent, so have been
	 * pre-created for reuse. This is a mapping from property name to reactive property descriptor
	 * @type {object.<string | Symbol, object>}
	 * @private
	 */
	fixed_descs = {};
	/** Used by {@link ReactiveWrapper#unwrap} to restore data value properties. It is a mapping
	 * from property name to a descriptor to replace the wrapper when restoring. The `value`
	 * for the descriptor must be a function that fetches the current value (e.g. fetches the
	 * current value from private storage). See {@link ReactiveWrapper~Custom#unwrap} also
	 * @type {object.<string | Symbol, object>}
	 * @private
	 */
	unwrap_descs = {};
	/** The value that is currently wrapped
	 * @type {object}
	 * @private
	 */
	target = null;
	/** The reactive wrapper around {@link ReactiveWrapper#target}. If the value could not be
	 * wrapped, e.g. a primitive, it will equal target instead.
	 */
	_value = null;

	/** Create a new property wrapper. Arguments are forwarded to
	 * {@link ReactiveWrapper#initDescriptors}
	 */
	constructor(){
		super();
		this.initDescriptors(...arguments);
	}

	/** Create the reactive property descriptor which wraps the original property
	 * @param {ReactiveWrapper~Options} opts Configuration for how to wrap the property
	 * @param {ReactiveWrapper~Wrapper} prop The original property descriptor found, and which will
	 * 	be wrapped as a reactive one
	 * @returns {?object} Reactive property descriptor to be used in place of the original property.
	 *  If falsey, the property should not be wrapped
	 */
	#getDescriptor(opts, prop){
		// validate the property we found matches the expected type
		if (opts.type){
			const type = prop.data ? prop.value instanceof Function ? "method" : "data" : "accessor";
			if (type !== opts.type)
				throw TypeError(`Expected ${opts.type} for property ${prop.property} but got ${type}`);
		}
		this.unwrap_descs[opts.property] = null;
		const desc = opts.custom.call(this, opts, prop, this.unwrap_descs);
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

	/** Initialize the property wrapper. Subclasses can override this to do any prerequisite
	 * initialization before the descriptors are initialized
	 * @param value initial value to wrap
	 * @param {Array.<string | Symbol | ReactiveWrapper~Options>} properties A list of properties to
	 *  be wrapped, optionally with detailed configuration for how to wrap each. Plain
	 *  strings/symbol are equivalent to `{property}`, which will use `defaults` for missing
	 *  options.
	 * @param {ReactiveWrapper~Wrapper} defaults Default options to apply to each of `properties`.
	 */
	initDescriptors(value, properties, defaults={}){
		/** Sanitized, internal list of properties; defaults have been applied
		 * @type {Object.<string | Symbol, ReactiveWrapper~Options>}
		 */
		const options = {};
		/** Roots for searching for properties to wrap
		 * @type {RootsList}
		 */
		const roots_list = this._roots = new RootsList();

		/** Fetches an option from a `properties` property, applying `defaults`
		 * @param {ReactiveWrapper~Options} prop Property options whose key you want to fetch
		 * @param {string} key Key to fetch from `prop`
		 * @param {object} fallback Value to return if not in `obj` or `defaults`
		 */
		function option(prop, key, fallback){
			if (key in prop)
				return prop[key];
			if (key in defaults)
				return defaults[key];
			return fallback;
		}

		// sanitize `properties` as `options`; track `roots_list` while we go
		for (let prop of properties){
			// convert to ReactiveWrapper~Options syntax
			if (typeof prop === "string" || typeof prop === "symbol")
				prop = {property:prop};
			const name = prop.property;
			// apply default roots; convert falsey roots -> false
			const roots = option(prop, "roots", ReactiveWrapper.#defaultRoots) || false;
			if (roots)
				roots_list.add(roots, name);
			// convert falsey type -> false; ignore if roots is false
			const type = roots ? option(prop, "type") || false : false;
			// bind_value to boolean
			const bind_value = !!option(prop, "bind_value");
			let custom = option(prop, "custom");
			const notify = option(prop, "notify", true);
			if (!custom){
				custom = generic_wrapper;
				if (notify === false && !bind_value)
					throw TypeError("'notify' can't be false for generic wrapper with 'bind_value' false");
			}
			// sanitized options
			options[name] = { property:name, type, bind_value, custom, notify };
		}

		// wrappers independent of "value" root (e.g. {@link Reactive#value}) can be initialized now
		// and cached; we will just need to bind them to the value when set in {@link Reactive#assume}
		const props = roots_list.extractGenericProperties();
		for (const name of Reflect.ownKeys(props)){
			const prop = props[name];
			const opts = options[name];
			const desc = this.#getDescriptor(opts, prop);
			if (!desc) continue;
			this.fixed_descs[name] = desc;
			// if bind_value option was specified, the property does not come from "value" but
			// we need to bind it to "value" for things to work; so we leave
			if (opts.bind_value)
				options[name] = { property:name };
			else delete options[name];
		}

		// convert options to list
		for (const name of Reflect.ownKeys(options))
			this.dynamic_props.push(options[name]);

		// initial value
		this.assume(value);
	}

	assume(value){
		// same value; don't create another wrapper
		if (this.target === value || this._value === value)
			return false;
		this.target = value;
		// primitives can't be wrapped
		if (!(value instanceof Object))
			this._value = value;
		else{
			let descs;
			// need to dynamically build some/all descriptors using current value
			if (this.dynamic_props.length){
				descs = {};
				const props = this._roots.getProperties(value);
				for (const opts of this.dynamic_props){
					const name = opts.property;
					let desc, bind_value;
					// missing custom means it just needs to be bound; it was precomputed inside
					// initDescriptors, since it doesn't depend on value except for binding
					if (!opts.custom){
						desc = this.fixed_descs[name];
						bind_value = true;
					}
					// otherwise, full initialization
					else{
						const prop = props[name];
						desc = this.#getDescriptor(opts, prop);
						if (!desc) continue;
						bind_value = opts.bind_value
					}
					// bind to value
					if (bind_value){
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
			else descs = this.fixed_descs;
			this._value = Object.create(value, descs);
		}
		return true;
	}

	get value(){
		return this.value;
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
			let desc = this.unwrap_descs[name];
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