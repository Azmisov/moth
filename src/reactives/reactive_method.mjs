/**
 * @param target reactive object wrapping the value
 * @param {object} manual manually implemented methods
 * @param {string[]} generic methods that should be wrapped with a generic reactive implementation;
 * 	notify is called after the function is called
 * @param {string[]} proxied list of properties or methods that need to be proxied
 */
build_proxy_handler(target, manual, generic, proxied){
	const that = this;
	let overrides = Object.assign({}, manual);
	// unoptimized methods which always notify
	for (const method of generic){
		if (method in overrides)
			continue;
		const fn = Array.prototype[method];
		overrides[method] = function(){
			const ret = fn.apply(this, arguments);
			that.notify();
			return ret;
		}
	}
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
			// only want to proxy the `iterating` methods, and ony if requested; the special
			// overrides methods will take care of notifying, rather than going through [[Set]]
			let val;
			if (key in overrides)
				val = overrides[key];
			else if (safe_iterating && ReactiveProxyArray.iterating.has(key))
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
}