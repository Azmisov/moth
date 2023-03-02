/** Mixins and functions to help create wrapper objects;
 * split out from wrappable.mjs since otherwise it would create circular dependency
 */
import { keys, wrappable } from "./wrappable.mjs";
import { ReactiveValue, ReactiveProxy, ReactiveAccessor } from "./Value.mjs";
export { keys, wrappable };

/** Figures out which object in the prototype chain owns the property, and fetches the property
 * descriptor; if property is not defined, it assumes one will be defined with [[Set]] as a data
 * descriptor with default behavior/options
 * @param {object} root object to search for `property`
 * @param {string} property property name to search for
 * @param {boolean} check_self whether to check `root` for the property, or else start immediately
 * 	checking the prototype chain
 */
export function get_property(root, property, check_self=true){
	let desc;
	let proto = root;
	if (!check_self)
		proto = Object.getPrototypeOf(proto);
	while (true){
		// not yet defined
		if (proto === null){
			// this is the default [[Set]] behavior, but note it could be overriden for some objects
			desc = {
				value: undefined,
				writable: true,
				enumerable: true,
				configurable: true
			};
			proto = root;
			break;
		}
		desc = Object.getOwnPropertyDescriptor(proto, property);
		if (desc !== undefined)
			break;
		proto = Object.getPrototypeOf(proto);
	}
	return {
		root, property,
		owner: proto,
		data: "writable" in desc,
		...desc
	};
}

/** Polyfill for hasOwn that supports Object.create(null)
 * see https://stackoverflow.com/questions/69561596/object-hasown-vs-object-prototype-hasownproperty
 */
const hasOwn = Object.hasOwn ?
	Object.hasOwn :
	(obj, prop) => Object.prototype.hasOwnProperty.call(obj, prop);

/** Delete a property, wherever it is in the prototype chain; this is unlike the delete operator,
 * which only works on own properties
 * @returns {boolean} whether the property was deleted
 */
export function delete_property(root, property){
	let proto = root;
	while (proto){
		if (hasOwn(proto, property))
			return delete proto[property];
		proto = Object.getPrototypeOf(proto);
	}
	return false;
}

/** Analyzes a property definition and creates an appropriate default Reactive value.
 * Use this as the `wrappable` argument to Wrapper.wrap
 */
function autoreactive(prop){
	if (prop.data)
		return new (prop.writable ? ReactiveValue : ReactiveProxy)(prop.value);
	// accessor descriptor
	if (!(prop.set && prop.get))
		throw TypeError("Cannot make incomplete accessor reactive: "+prop.property);
	return new ReactiveAccessor(prop.get, prop.set);
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
 * @param {object} prop property definition
 */
export function wrap_property(wrappable, prop){
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
				value = new wrappable(prop.value);
			else value = new wrappable(prop.get, prop.set);
		}
		// function that returns instance
		else if (wrappable instanceof Function){
			value = wrappable(prop);
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