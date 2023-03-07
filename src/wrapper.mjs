/** Mixins and functions to help create wrapper objects;
 * split out from wrappable.mjs since otherwise it would create circular dependency
 * @module wrapper
 */
import { keys, wrappable } from "./wrappable.mjs";
import { ReactiveValue } from "./Reactive.mjs";
import { ReactiveAccessor, ReactiveProxy } from "./reactives/barrel.mjs";
export { keys, wrappable };

/** Figures out which object in the prototype chain owns the property, and fetches the property
 * descriptor; if property is not defined, it assumes one will be defined with [[Set]] as a data
 * descriptor with default behavior/options. Warning, this function doesn't automatically look at
 * constructors' `prototype` property, which is not part of the prototype chain
 * @param {object} root object to search for `property`
 * @param {string} property property name to search for
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
		proto = Object.getPrototypeOf(proto);
	} while (proto);
	// not yet defined
	// this is the default [[Set]] behavior, but note it could be overriden for some objects
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

/** Same as {@link get_property}, but can search multiple roots and properties simultaneously.
 * @param {object[]} roots list of objects to search for properties; the first root whose prototype
 * 	chain contains a property will be used
 * @param {string[]} props list of properties to search for
 */
export function get_properties(roots, props){
	props = new Set(props);
	const descs = {};
	done: for (const root of roots){
		let proto = root;
		do{
			for (const prop of props){
				const desc = Object.getOwnPropertyDescriptor(proto, prop);
				if (!desc) continue;
				props.delete(prop);
				descs[prop] = {
					root,
					owner: proto,
					property: prop,
					data: "writable" in desc,
					...desc
				};
			}
			if (!props.size)
				break done;
			proto = Object.getPrototypeOf(proto);
		} while (proto);
	}
	// not yet defined
	const root = roots[0];
	for (const prop of props){
		// this is the default [[Set]] behavior, but note it could be overriden for some objects
		descs[prop] = {
			root,
			owner: root,
			property: prop,
			data: true,
			value: undefined,
			writable: true,
			enumerable: true,
			configurable: true
		};
	}
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
		throw TypeError("Cannot make incomplete accessor reactive: "+prop.property);
	return new ReactiveAccessor(prop.get, prop.set, ...args);
}

/** Get a wrappable instance of a property definition
 * @param wrappable this can be either:
 * - a constructor (as given by the existence of wrappable.prototype.constructor) whose prototype
 *   implements the wrappable interface; the constructor is called, passing the current property
 *   definition— either the value or a getter/setter pair depending on the property descriptor type
 * - any object without a constructor that implements the wrappable interface, which is assumed
 *   to be a pre-constructed wrappable object
 * - a function which returns an object implementing the wrappable interface; it is
 *   passed the full property definition and must return an instance; note the function itself
 *   cannot implement the wrappable interface or it will be considered one of the previous syntaxes
 * @param args extra arguments to pass to wrappable constructor or function
 * @param {object} prop property definition
 */
export function wrap_property(wrappable, args, prop){
	// get default wrappable argument
	if (!wrappable){
		// lookup from attached config
		const defs = prop.root[keys.config];
		if (defs)
			wrappable = defs.wrappers[prop.property] || defs.default_wrapper;
		// global default
		if (!wrappable){
			if (wrappable !== undefined)
				throw TypeError(`Property ${prop.property} is not wrappable`);
			wrappable = autoreactive;
		}
	}
	/** wrappable interface definition */
	let config = wrappable[keys.wrappable];
	let value;
	// pre-constructed instance
	if (config)
		value = wrappable;
	else{
		// constructor for wrappable object
		const proto = wrappable.prototype;
		if (proto && proto.constructor && (config = proto[keys.wrappable])){
			if (prop.data)
				value = new wrappable(prop.value, ...args);
			else value = new wrappable(prop.get, prop.set, ...args);
		}
		// function that returns instance
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