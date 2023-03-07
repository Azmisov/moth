import Reactive from "../Reactive.mjs";
import { get_properties } from "../wrapper.mjs";

/** Creates a new object that wraps the value; a predefined set of properties (which can be
 * data, accessors, or methods) will be overridden on the wrapper to notify subscribers
 */
export class ReactiveWrapper extends Reactive{

	/** 
	 * @callback ReactiveWrapper~Custom
	 * @param {ReactiveWrapper~Options} opts Parent options for wrapping this property
	 * @param {object} prop Property definition found from `roots`, or `null` if not searched
	 * @param {object} descs Property descriptors for the wrapped object. The function should add
	 *  the new property descriptor to this object, under the `opts.property` / `prop.property` key
	 * @param {object} unwrap An object giving instructions on how to unwrap the property to restore
	 *  data properties to the target. By default no restoration will be performed. Set the
	 *  `opts.property` / `prop.property` key to a property descriptor to restore to opt in. The
	 *  `value` for the descriptor must be a function which will be called to fetch the current
	 *  value (e.g. to fetch the value from private storage).
	 */

	/** Defines how a property is wrapped
	 * @typedef {object} ReactiveWrapper~Options
	 * @property {string} property the property that is wrapped
	 * @property {?object[]} roots An ordered list of root objects to search for the `prop`
	 *  property's descriptor. Use the keyword "value" as a substitute for the currently wrapped
	 *  value. This can also be `null`, indicating that the wrapped value is not based on the
	 *  current property, and so does not need to be searched for.
	 * @property {?string} type Can be one of `"data"`, `"accessor"`, or `"method"`, indicating what
	 *  type you expect the property to be for validation; if not provided, any type is accepted
	 * @property {?string} bind specifies binding for a generic wrapper; either `"this"`, binding to
	 *  the wrapper, or `"value"`, binding to the wrapped value
	 * @property {?function} notify Specifies a function for a generic wrapper that specifies when
	 *  to notify subscribers. It receives the same arguments as the input and should return a
	 *  boolean; it has the same `this` binding as the wrapper function. If not provided, the
	 *  wrapper always notifies.
	 * @property {?ReactiveWrapper~Custom} custom Defines a custom function for generating the
	 *  wrapped property descriptor. This overrides the `bind` and `notify` options, and no generic
	 *  wrapper will be generated.
	 */

	/** Options for constructing the object
	 * @typedef {object} ReactiveWrapper~Properties
	 
	 * @property {function} custom a function of the same form as, and called immediately prior to,
	 *  {@link ReactiveWrapper#build_descriptors}; use this as an alternative to creating a
	 *  subclass that only overrides {@link ReactiveWrapper#build_descriptors}
	 * @property {object[]} roots roots to search for properties that should be wrapped; use null
	 * 	as a placeholder which will be replaced with the currently wrapped value
	 */

	/** Create a new property wrapper. Arguments are forwarded to
	 * {@link ReactiveWrapper#init_descriptors}
	 */
	constructor(){
		super();
		this.init_descriptors(...arguments);
	}
	/** Initialize the property wrapper. This allows super initialization to
	 * be done after any prerequisite subclass setup
	 * @param value initial value to wrap
	 * @param {(string | ReactiveWrapper~Wrapper)[]} properties A list of properties to be wrapped,
	 * 	optionally with detailed configuration for how to wrap each.
	 * @param {ReactiveWrapper~Wrapper} defaults Default options to apply to each of `properties`.
	 */
	init_descriptors(value, properties, defaults){
		this._generic = generic;
		this._roots = roots;
		this._placeholder = this._roots.indexOf(null);
		// alternative to creating a new subclass
		this._custom = custom;
		// methods are all non-value specific, can cache descriptors 
		if (this._placeholder === -1)
			this._descs = this.#build_descriptors();
		this.assume(value);
	}
	/** Builds the descriptors, handling placeholder and custom options
	 * @param value value to substitute for the null root
	 * @returns {object} wrapped property descriptors
	 * @private
	 */
	#build_descriptors(value){
		this._unwrap = {};
		const descs = {};
		if (this._placeholder !== -1)
			this._roots[this._placeholder] = value;
		if (this._custom)
			this._custom.call(this, descs, this._unwrap, this._roots);
		if (this._generic)
			this.build_descriptors(descs, this._unwrap, this._roots);
		return descs;
	}
	/** 
	 * @protected 
	 * @param {object} descs object of property descriptors we're building; the method should
	 * @param {function} unwrap maps property names to instructions for unwrapping; null indicates the
	 * 	property should not be unwrapped; otherwise, it is a data descriptor whose value is a
	 * 	function that will be called to retrieve the current value
	 * @param {object[]} roots ordered list of objects to search for properties in
	 */
	build_descriptors(descs, unwrap, roots){
		const that = this;
		// remove descriptors already handled by custom_descriptors or a subclass
		let generic = this._generic;
		for (const _ in descs){
			generic = generic.filter(v => !(v in descs));
			break;
		}
		const props = get_properties(roots, generic);
		console.log(props);
		/** Private storage for wrapping data properties */
		const private_vars = {};
		for (const name in props){
			const prop = props[name];
			let desc;
			if (prop.data){	
				const base = prop.value;
				// wrap method
				if (base instanceof Function){
					// if (!base.hasOwnProperty("prototype"))
					//	 throw Error("bound function");
					desc = {
						writable: prop.writable,
						value: function(k,v){
							console.log("calling generic:", base, this instanceof Map, this, arguments, that);
							// this is assumed to be `value` or some wrapped version of it
							const ret = base.bind(this)(k,v);
							// const ret = base.apply(this, arguments);
							that.notify();
							return ret;
						}
					};
					unwrap[name] = null;
				}
				// wrap data
				else if (!prop.writable)
					throw TypeError("Refusing to wrap non-writable property: "+name);
				else{
					private_vars[name] = base;
					// turn it into an accessor
					desc = {
						get(){
							return private_vars[name];
						},
						set(val){
							private_vars[name] = val;
							that.notify();
						}
					};
					this._unwrap[name] = {
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
				desc = {
					get,
					set(val){
						set.call(this, val);
						that.notify();
					}
				};
				unwrap[name] = null;
			}
			desc.configurable = prop.configurable;
			desc.enumerable = prop.enumerable;
			descs[name] = desc;
		}
	}

	/** Helper method to customize {@link ReactiveWrapper#build_descriptors} for simple use
	 * cases. It only works for methods, or special data values that 
	 * @param {object} custom each value a callback, `(unwrap, reactive, prop)`, and should return a
	 * 	(partial) property descriptor; setting unwrap is optional, and is `null` by default
	 */
	static simple_customize(descs, unwrap, roots, custom){
		const props = get_properties(roots, Object.keys(custom));
		for (const name in props){
			const prop = props[name];
			unwrap[name] = null;
			const desc = custom[name](unwrap, this, prop);
			for (const k of ["configurable","enumerable"]){
				if (!(k in desc))
					desc[k] = prop[k];
			}
			if ("value" in custom && !("writable" in desc))
				desc.writable = prop.writable;
			descs[name] = desc;
			unwrap[name] = null;
		}
	}

	get value(){
		return this._value;
	}
	set value(value){
		if (this.assume(value))
			this.notify();
	}
	assume(value){
		// same value; don't create another wrapper
		if (this._target === value || this._value === value)
			return false;
		this._target = value;
		// primitives can't be wrapped
		if (value instanceof Object){
			let descs;
			if (this._placeholder === -1)
				descs = this._descs
			else descs = this.#build_descriptors(value);
			this._value = Object.create(value, descs);
		}
		else this._value = value;
		return true;
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