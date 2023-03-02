import { ReactiveAccessor, ReactiveProxy, ReactiveValue } from "../src/Value.mjs";
import { add, run } from "./tests.mjs";
import wrappable from "../src/wrappable.mjs";
import ObjectWrapper from "../src/wrappers/ObjectWrapper.mjs";

add("basic objectwrapper", (passed, failed) => {
	let count = 0;
	const o = {a: 0};
	ObjectWrapper.wrap(o, "a").subscribe(() => count++);
	o.a++;
	setTimeout(() => {
		if (count != 1)
			failed("wrong count");
		passed();
	});
});
add("wrapper error cases", (passed, failed) => {
	const o = {a:0};
	try{
		ObjectWrapper.wrap(o,"a",false);
		failed("wrapping disabled");
	}catch{}
	try{
		// will be called as function
		class X{}
		ObjectWrapper.wrap(o,"a",X);
		failed("doesn't implement wrappable");
	}catch{}
	try{
		ObjectWrapper(false).wrap(o,"a");
		failed("wrapping disabled");
	}catch{}
	try{
		ObjectWrapper({a:"bad"}).wrap(o,"a");
		failed("bad default value");
	}catch{}

	passed();
});
add("wrapper defaults", (passed, failed) => {
	const o = {a:0};
	let count = 0;
	class X{
		constructor(val){
			this._val = val;
		}
		test(){ count++; }
	}
	wrappable(X.prototype, {
		value: true,
		unwrap(){ return this._val; }
	});
	let x = ObjectWrapper(o, {a:X});
	ObjectWrapper.wrap(x,"a");
	x.a.test();
	if (count !== 1)
		failed("wrong count");
	passed();
});
add("autoreactive", (passed, failed) => {
	const o = {};
	let _b = 0;
	let _e = 12;
	function add_configurable(obj){
		Object.defineProperties(obj, {
			a: {
				configurable:true,
				value: [0,1,2]
			}, // proxy, can overwrite
			b: {
				configurable:true,
				get(){ return _b; },
				set(v){ _b = v; }
			}, // accessor, can overwrite
			c: {
				configurable:true,
				writable:true,
				value: 7	
			}, // value, can overwrite
		});
	}
	function add_unconfigurable(obj){
		Object.defineProperties(obj, {
			b: {
				value: [0,1,2]
			}, // proxy, cannot overwrite
			c: {
				get(){ return _e; },
				set(v){ _e = v; }
			}, // accessor, cannot overwrite
			a: {
				writable:true,
				value: 36
			}, // value, cannot overwrite
		});
	}
	add_unconfigurable(o);
	// should fail
	for (const attr of "abc"){
		try{
			ObjectWrapper.wrap(o, attr);
			failed("unconfigurable");
		}catch{}
	}
	const w = ObjectWrapper(o);
	const expected_types = [ReactiveValue, ReactiveProxy, ReactiveAccessor];
	for (let i=0; i<3; i++){
		const r = ObjectWrapper.wrap(w, "abc".charAt(i));
		if (!(r instanceof expected_types[i]))
			failed("wrong autodetected type");
	}
	const m = Object.create(o);
	add_configurable(m);
	const expected_types_m = [ReactiveProxy, ReactiveAccessor, ReactiveValue];
	for (let i=0; i<3; i++){
		const r = ObjectWrapper.wrap(m, "abc".charAt(i));
		if (!(r instanceof expected_types_m[i])){
			console.error(i, r);
			failed("wrong autodetected type");
		}
	}
	passed();
})

// run(["autoreactive"]);
run();