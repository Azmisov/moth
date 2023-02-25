import { ReactiveValue, ReactiveProxy, ReactiveAccessor } from "./Value.mjs";

/** Figures out which object in the prototype chain owns the property, and fetches the property
 * descriptor; if property is not defined, it assumes one will be defined with [[Set]]
 * @param {object} root object to search for `property`
 * @param {string} property property name to search for
 * @param {boolean} check_self whether to check `root` for the property, or else start immediately
 * 	checking the prototype chain
 */
function getProperty(root, property, check_self=true){
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
	const prop = {
		root, property,
		owner: proto,
		data: "writable" in desc,
		...desc
	};
}

export function wrap(root, property, clazz){
	// Determine property descriptor
	const prop = getProperty(root, property);
	/* We assume property descriptor is not going to be changed. If property is not on root, we can
		always add a wrapper. If on root, it needs to be configurable.
		
		Data values are set on the root, and only default to using the prototype if not currently
		set. An object could technically do operations on the prototype value, but would have to
		explicitly do so. Unwritable data only makes sense to make reactive if using some form of
		reactive proxy.
	*/
	if (prop.root === prop.owner && !prop.configurable)
		throw TypeError("Cannot make unconfigurable own property reactive: "+prop.property);
	let reactive;
	// data descriptor
	if (prop.data){
		if (clazz !== ReactiveValue && clazz !== ReactiveProxy)
			throw TypeError("Muste use ReactiveValue or ReactiveProxy for data property: "+prop.property);
		if (!prop.writable && clazz !== ReactiveProxy)
			throw TypeError("Must use ReactiveProxy for unwritable property: "+prop.property);
		reactive = new clazz(prop.value);
	}
	// accessor descriptor
	else{
		if (!(prop.set && prop.get))
			throw TypeError("Cannot make incomplete accessor reactive: "+prop.property);
		if (clazz !== ReactiveAccessor)
			throw TypeError("Must use ReactiveAccessor for accessor property: "+prop.property);
		reactive = new clazz(prop.get, prop.set);
	}
	Object.defineProperty(prop.root, prop.property, {
		enumerable: prop.enumerable,
		configurable: true,
		get(){ return reactive.value; },
		set(v){ reactive.value = v; },
	});
	return reactive;
}

// hasOwn polyfill, which can handle Object.create(null) or overridden hasOwnProperty
const hasOwn = Object.hasOwn || ((...args) => Object.prototype.hasOwnProperty.call(...args));

class ReactiveWrapper{
	static key = Symbol("reactive_values");
	constructor(...args){
		// super(...args);
		Object.defineProperty(this, ReactiveWrapper.key, {value: {}});
	}
	subscribe(property, ...args){
		let r = this[ReactiveWrapper.key][property];
		// Replace the property with a reactive version that proxies to the raw value
		if (!r){
			console.log("wrapping property:", this[property]);
			r = this[ReactiveWrapper.key][property] = new Reactive(this[property]);
			Object.defineProperty(this, property, {
				configurable:false,
				enumerable:true,
				get: () => {
					console.log("get reactive");
					return r._value;
				},
				set: (v) =>{
					console.log("set reactive");
					r.value = v
				}
			});
		}
		r.subscribe(...args);
	}
	unsubscribe(property, ...args){
		let r = this[ReactiveWrapper.key][property];
		r.unsubscribe(...args);
	}
}
