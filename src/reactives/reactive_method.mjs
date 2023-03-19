import { get_property } from "../wrapper.mjs";

/** Builds the handler for use in a Proxy reactive object
 * @param {object} value the value whose methods are being wrapped; most likely, you'll want
 * 	this to be the prototype of an object, not the object itself
 * @param {Reactive} target reactive object wrapping the value
 * @param {object} manual manually implemented methods
 * @param {string[]} generic methods that should be wrapped with a generic reactive implementation;
 * 	notify is called after the function is called
 * @param {string[]} proxied list of properties that need to be proxied
 */
function build_handler(value, target, manual, generic, proxied){
	const that = target;
	wrap_methods(value, target, generic, manual);
	const handler = {
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
			// only want to proxy methods if expliclty requested so; the special manual methods will
			// take care of notifying, rather than going through [[Set]]
			let val;
			if (key in manual)
				val = manual[key];
			else if (proxied.indexOf(key) !== -1)
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
	return handler;
}