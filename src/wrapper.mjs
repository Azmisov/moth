/** Mixins and functions to help create wrapper objects;
 * split out from wrappable.mjs since otherwise it would create circular dependency
 * @module wrapper
 */
import { keys, wrappable } from "./wrappable.mjs";
import { ReactiveValue } from "./Reactive.mjs";
import { ReactiveAccessor, ReactiveProxy } from "./reactives/barrel.mjs";
export { keys, wrappable };

/** Returns the default `[[Set]]` property descriptor. The default may be overridden by some objects
 * @param {Object} root Object which owns `property`
 * @param {string | Symbol} property Property name
 */
export function default_property(root, property){
	return {
		root,
		owner: root,
		property,
		data: true,
		value: undefined,
		writable: true,
		enumerable: true,
		configurable: true
	};
}

/** Figures out which object in the prototype chain owns the property, and fetches the property
 * descriptor. If no property descriptor currently exists in the chain, it assumes one will be
 * defined with [[Set]] as a data descriptor with default behavior/options. Warning, this function
 * doesn't automatically look at constructors' `prototype` property, which is not part of the
 * prototype chain.
 * @param {Object} root Object to search for `property`
 * @param {string | Symbol} property Property name to search for
 */
export function get_property(root, property){
	let proto = root;
	do {
		const desc = Object.getOwnPropertyDescriptor(proto, property);
		if (desc){
			return {
				root,
				owner: proto,
				property,
				data: "writable" in desc,
				...desc
			};
		}
		// walk up the prototype chain
		proto = Object.getPrototypeOf(proto);
	} while (proto);
	return default_property(root, property);
}

/** Same as {@link get_property}, but can search multiple roots and properties simultaneously. When
 * a property descriptor is not found, it assumes one will be defined on the first root.
 * @param {Object[]} roots Ordered list of objects to search for properties. The search looks in
 *  each root, falling back to the next if no property is found. The first root whose prototype
 *  chain contains a property will be used. Must be nonempty
 * @param {Array.<string | Symbol>} props List of properties to search for. Must be nonempty
 * @param {Object} descs Optional object to output results to. If not provided, a new object is
 * 	created and values returned
 * @returns {Object.<string | Symbol, Object>} Object with properties as keys and property descriptors as
 *  values. Only `props` properties will be added to the object. If `descs` was provided, that is
 *  the object that is both modified and returned.
 */
export function get_properties(roots, props, descs={}){
	/** Properties we have not yet found. Values are deleted from the set as they are found.
	 * This is an array, but we treat it like a set. Arrays are faster for < 10 elements, which
	 * is the most common scenario for this function https://stackoverflow.com/a/75514478/379572
	 * @type {Set<string>}
	 */
	const props_remaining = Array.from(props);
	// try each root in sequence until we find all properties
	for (const root of roots){
		let proto = root;
		do{
			let i = 0
			while (true) {
				const prop = props_remaining[i];
				const last = ++i == props_remaining.length;
				const desc = Object.getOwnPropertyDescriptor(proto, prop);
				if (desc) {
					descs[prop] = {
						root,
						owner: proto,
						property: prop,
						data: "writable" in desc,
						...desc
					};
					// remove prop from array; replace current index with last
					const prop_replace = props_remaining.pop();
					if (!last) {
						props_remaining[i-1] = prop_replace;
						continue;
					}
					else if (!props_remaining.length)
						return descs;
					else break;
				}
				else if (last)
					break;
			}
			// walk up the prototype chain
			proto = Object.getPrototypeOf(proto);
		} while (proto);
	}
	// remaining props are not yet defined
	const root = roots[0];
	for (const prop of props_remaining)
		descs[prop] = default_property(root, prop);
	return descs;
}

/** Analyzes a property definition and creates an appropriate default Reactive value.
 * Use this as the `wrappable` argument to Wrapper.wrap
 */
function autoreactive(prop, ...args){
	if (prop.data)
		return new (prop.writable ? ReactiveValue : ReactiveProxy)(prop.value, ...args);
	// accessor descriptor
	if (!(prop.set && prop.get))
		throw TypeError(`Cannot make incomplete accessor '${prop.property}' reactive. Both [[Set]] and [[Get]] must be implemented.`);
	return new ReactiveAccessor(prop.get, prop.set, ...args);
}

/** Get a wrappable instance of a property definition
 * @param wrappable this can be either:
 * 1. falsey, searches for the predefined wrappable config attached to the object; if not found
 *    it uses {@link autoreactive} as the wrappable
 * 2. an object that implements the wrappable interface, which is assumed to be a pre-constructed
 *    wrappable object
 * 3. a constructor (as given by the existence of wrappable.prototype.constructor) whose prototype
 *    implements the wrappable interface; the constructor is called, passing the current property
 *    definition— either the value or a getter/setter pair depending on the property descriptor type
 * 4. a function which returns an object implementing the wrappable interface; it is
 *    passed the full property definition and must return an instance; note the function itself
 *    cannot implement the wrappable interface or it will be considered one of the previous syntaxes
 * @param args extra arguments to pass to wrappable constructor or function
 * @param {{value, config}} prop property definition
 */
export function wrap_property(wrappable, args, prop){
	// case #1: lookup from attached config
	if (!wrappable){
		const defs = prop.root[keys.config];
		if (defs)
			wrappable = defs.wrappers[prop.property] || defs.default_wrapper;
		if (!wrappable){
			// wrapping explicitly disabled?
			if (wrappable !== undefined)
				throw TypeError(`Property ${prop.property} is not wrappable`);
			// global default
			wrappable = autoreactive;
		}
	}
	/** wrappable interface definition */
	let config = wrappable[keys.wrappable];
	let value;
	// case #2: pre-constructed instance
	if (config)
		value = wrappable;
	else{
		// case #3: constructor for wrappable object
		const proto = wrappable.prototype;
		if (proto && proto.constructor && (config = proto[keys.wrappable])){
			if (prop.data)
				value = new wrappable(prop.value, ...args);
			else value = new wrappable(prop.get, prop.set, ...args);
		}
		// case #4: function that returns instance
		else if (wrappable instanceof Function){
			value = wrappable(prop, ...args);
			config = value[keys.wrappable];
			if (!config)
				throw TypeError("'wrappable' function didn't return a wrappable instance");
		}
		else throw TypeError("'wrappable' doesn't implement the wrappable interface");
	}
	return {value, config}
}

/** Attach configuration for wrap_property
 * @param {object} wrappers property to wrappable mapping; this can be ommitted and the first
 * 	arg be `default_wrapper` instead
 * @param default_wrapper default wrappable for unknown properties; by default this will use
 * 	`autoreactive` function if undefined; set to false to disallow defaults
 */
export function attach_config(root, wrappers, default_wrapper){
	// wrappers ommitted?
	if (!wrappers || wrappers instanceof Function){
		default_wrapper = wrappers;
		wrappers = {};
	}
	// attach to object
	Object.defineProperty(root, keys.config, {
		configurable: true, // allow cleanup
		value: {wrappers, default_wrapper}
	});
}