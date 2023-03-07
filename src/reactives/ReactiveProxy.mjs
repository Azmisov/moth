import Reactive from "../Reactive.mjs";

/** Wraps an object as a `Proxy`, where `[[Set]]` triggers notifications.
 * @extends Reactive
 */
export class ReactiveProxy extends Reactive{
	static owner = Symbol();
	static target = Symbol();
	static deproxy(value){
		try{
			const target = value[this.target];
			if (target)
				return target;
		} catch{}
		return value;
	}
	constructor(value, ...args){
		super();
		this.build_handler(...args);
		this.assume(value);
	}
	/** Build the proxy handler which will be used. This is split out from the constructor
	 * so it can be overriden by subclasses
	 * @protected
	 */
	build_handler(deep=false, native=false){
		const that = this;
		if (deep){
			/* No use trying to recursively wrap on initialization, since user may have already
				stored a reference to a non-proxied sub-value. In general, this can't handle all
				types of code, for instance:
					let cache = reactive.a;
					reactive.a = other
					cache += 10
				Here cache is still a proxy attached to reactive, but it has been implicitly
				detached by being overriden by other. 
			*/
			this._handler = {
				set(target, property, value, receiver){
					const ret = Reflect.set(target, property, ReactiveProxy.deproxy(value), receiver);
					if (ret)
						that.notify();
					return ret;
				},
				get(target, key, receiver){
					if (key === ReactiveProxy.owner)
						return that;
					if (key === ReactiveProxy.target)
						return target;
					// rebind to handle native objects
					let val;
					if (native){
						val = target[key];
						if (val instanceof Function)
							return function (...args){
								return val.apply(this === receiver ? target : this, args);
							};
					}
					else val = Reflect.get(...arguments);
					// for non-primitives, return a deep proxy
					if (val instanceof Object)
						return new Proxy(val, that._handler);
					return val;
				}
			}
		}
		else{
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
					// rebind to handle native objects
					let val;
					if (native){
						const val = target[key];
						if (val instanceof Function)
							return function (...args){
								return val.apply(this === receiver ? target : this, args);
							};
					}
					else val = Reflect.get(...arguments);
					return val;
				}
			};
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
		// same value; don't create another proxy
		if (this._target === value || this._value === value)
			return false;
		this._target = value;
		// primitives that can't be proxied
		if (value instanceof Object)
			this._value = new Proxy(value, this._handler);
		else this._value = value;
		return true;
	}
	unwrap(){
		return {value: ReactiveProxy.deproxy(this._value)};
	}
}