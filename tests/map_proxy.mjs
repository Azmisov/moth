const m = new Map();
const p = new Proxy(m, {
	get(target, prop, rec){
		console.log("getting:", this, target, prop, rec);
		let v = target[prop];
		if (v instanceof Function){
			return function(...args){
				return v.apply(this === rec ? target : this, args);
			}
		}
		return v;
	},
	set(target, prop, val, rec){
		console.log("setting:", this, target, prop, val, rec);
		return Reflect.set(...arguments);
	}
});

p.set("x", 90);
console.log(p);