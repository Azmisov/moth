import { keys, wrappable, get_property, wrap_property, attach_config } from "../wrapper.mjs";

const wrappable_conf = {
	value: true,
	unwrap(){
		// unwrap all properties
		ObjectWrapper.unwrap(this);
		delete this[keys.prop_index];
		delete this[keys.config];
		// any extraneous properties attached to this need to be transferred to prototype
		const value = Object.getPrototypeOf(this);
		Object.defineProperties(value, Object.getOwnPropertyDescriptors(this));
		return {value};
	}
};
/** Creates a new ObjectWrapper which wraps an existing Object. This allows you to wrap values
 * that are non-configurable. It also stores default wrapper values for properties
 */
export function ObjectWrapper(root, ...config){
	const obj = Object.create(root);
	attach_config(obj, ...config);
	// in case they want to inject as wrappable later on
	if (!new.target)
		wrappable(obj, wrappable_conf)
	return obj;
}
wrappable(ObjectWrapper.prototype, wrappable_conf);
// static members
function object_unwrap_single(prop, unwrap){
	// restore old prop
	const unwrapped = unwrap();
	const restore_data = "value" in unwrapped;
	let desc;
	if (restore_data)
		desc = {
			configurable: true,
			enumerable: prop.enumerable,
			writable: prop.writable,
			value: unwrapped.value
		};
	// only need to restore accessor if it was overwritten or used to be a data descriptor
	else if (prop.root === prop.owner || restore_data !== prop.data)
		desc = {
			configurable: true,
			enumerable: prop.enumerable,
			get: unwrapped.get,
			set: unwrapped.set
		};
	// data is never stored on the prototype, and accessor is only restored if it is on root
	if (desc)
		Object.defineProperty(prop.root, prop.property, desc);
	// removes accessor override
	else delete prop.root[prop.property];
}
Object.assign(ObjectWrapper, {
	wrap(root, property, wrappable, ...args){
		// ensure index
		let index = root[keys.prop_index];
		if (index){
			// already attached?
			const attached = index[property];
			if (attached)
				return attached.value;
		}
		// determine property descriptor
		const prop = get_property(root, property);
		// need to be able to overwrite it; they can use n
		if (root === prop.owner && !prop.configurable)
			throw TypeError(`Cannot wrap own non-configurable property ${prop.property}; consider wrapping object in an ObjectWrapper`);
		// wrap the value
		let {value, config} = wrap_property(wrappable, args, prop);
		let desc;
		// data desriptor
		if (config.value){
			desc = {
				configurable: true,
				enumerable: prop.enumerable,
				writable: prop.writable,
				value
			};
		}
		// accessor descriptor
		else{
			let a = config.accessor;
			// this allows user to bind to value if needed
			if (a instanceof Function)
				a = a(value);
			desc = {
				configurable: true,
				enumerable: prop.enumerable,
				get: a.get,
				set: a.set
			};
		}
		Object.defineProperty(root, property, desc);
		// only store index if we know wrapping the property was successful
		if (!index){
			index = {};
			Object.defineProperty(root, keys.prop_index, {
				configurable: true, // allow cleanup
				value: index
			});
		}
		// add to index
		index[property] = {
			value,
			// used to restore the unwrapped value
			unwrap: config.unwrap.bind(value),
			property: prop
		};
		return value;
	},
	unwrap(root, property){
		let index = root[keys.prop_index];
		// nothing wrapped
		if (!index) return;
		// unwrap single
		if (property){
			const attached = index[property];
			// property not wrapped
			if (!attached) return;
			delete index[property];
			object_unwrap_single(attached.property, attached.unwrap);
			// if non-empty, don't delete index
			for (const p in index)
				return
		}
		// unwrap all
		else{
			for (const p in index){
				const attached = index[p];
				delete index[p];
				object_unwrap_single(attached.property, attached.unwrap);
			}
		}
		// cleanup index if no props left; cleanup allows object to be reused for derived class
		delete root[keys.prop_index];
	}
});
export default ObjectWrapper;