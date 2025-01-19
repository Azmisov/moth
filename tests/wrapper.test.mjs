import jest from "jest-mock";
import { wrappable, ObjectWrapper, ReactiveAccessor, ReactiveProxy, ReactiveValue } from "../src/moth.mjs";

function delay(time){
	return new Promise(resolve => {
		setTimeout(resolve, time);
	});
}

test("basic objectwrapper", async () => {
	let count = 0;
	const o = {a: 0};
	ObjectWrapper.wrap(o, "a").subscribe(() => count++);
	o.a++;
	await delay();
	expect(count).toEqual(1);
});
// already wrapped will return old wrapped value
test("already wrapped", () => {
	let o = {a: 0};
	const r1 = ObjectWrapper.wrap(o,"a");
	class X{};
	const r2 = ObjectWrapper.wrap(o,"a",X);
	expect(r1).toBe(r2);
});
test("preconstructed reactive", async () => {
	const o = {a:2};
	const r = new ReactiveValue(o.a);
	ObjectWrapper.wrap(o,"a",r);
	const s = jest.fn();
	r.subscribe(s);
	o.a++;
	await delay();
	expect(o.a).toBe(3);
	expect(s).toHaveBeenCalledTimes(1);
});
test("wrapper error cases", () => {
	const o = {a:0};
	// wrapping disabled
	expect(ObjectWrapper.wrap.bind(null, o,"a",false)).toThrow();
	// returns unwrappable
	expect(ObjectWrapper.wrap.bind(null,o,"a", () => "bad")).toThrow();
	// will be called as function
	// doesn't implement wrappable
	class X{}
	expect(ObjectWrapper.wrap.bind(null,o,"a",X)).toThrow();
	// wrapping disabled
	const ow1 = ObjectWrapper(o,false);
	expect(ObjectWrapper.wrap.bind(null,ow1,"a")).toThrow();
	// bad default value
	const ow2 = ObjectWrapper(o,{a:"bad"});
	expect(ObjectWrapper.wrap.bind(null,ow2,"a")).toThrow();
});
// from attach_config, default configuration for "wrapped"
test("wrapper defaults", () => {
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
	expect(count).toEqual(1);
});
test("manually wrap accessor class", async () => {
	class X{
		constructor(v){ this._v = v; }
		get v(){ return this._v; }
		set v(v){ this._v = v; }
	}
	const x = new X(7);
	const s = jest.fn();
	ObjectWrapper.wrap(x,"v",ReactiveAccessor).subscribe(s);
	x.v++;
	await delay();
	expect(s).toHaveBeenCalledTimes(1);
	expect(x.v).toEqual(8);
	expect(x._v).toEqual(8);
});
// check that autoreactive is detecting the correct type, even w/ inheritence
test("autoreactive", async () => {
	const o = {_b:1, _e:12};
	function add_configurable(obj){
		Object.defineProperties(obj, {
			a: {
				configurable:true,
				value: [0,1,2]
			}, // proxy, can overwrite
			b: {
				configurable:true,
				get(){ return this._b; },
				set(v){ this._b = v; }
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
				get(){ return this._e; },
				set(v){ this._e = v; }
			}, // accessor, cannot overwrite
			a: {
				writable:true,
				value: 36
			}, // value, cannot overwrite
			z: {
				configurable:true,
				get(){ return _e; }
				// no setter; should fail
			}
		});
	}
	add_unconfigurable(o);
	// should fail
	for (const attr of "abcz")
		expect(ObjectWrapper.wrap.bind(null, o, attr)).toThrow();
	const w = ObjectWrapper(o);
	const expected_types = [ReactiveValue, ReactiveProxy, ReactiveAccessor];
	for (let i=0; i<3; i++){
		const r = ObjectWrapper.wrap(w, "abc".charAt(i));
		// wrong autodetected type?
		expect(r).toBeInstanceOf(expected_types[i]);
	}
	const m = Object.create(o);
	add_configurable(m);
	const expected_types_m = [ReactiveProxy, ReactiveAccessor, ReactiveValue];
	let count = 0;
	for (let i=0; i<3; i++){
		const r = ObjectWrapper.wrap(m, "abc".charAt(i));
		// wrong autodetected type?
		expect(r).toBeInstanceOf(expected_types_m[i]);
		// quick check that reactivity is working
		r.subscribe(() => count++);
	}
	m.a.push("another");
	m.b += 10;
	m.c += 5;
	await delay();
	expect(count).toEqual(3);
	expect(m.b).toEqual(11);
	expect(m._b).toEqual(11);
	expect(m.c).toEqual(12);
});
// test that unwrap restores the correct value
test("unwrap", async () => {
	const o = {a:3};
	let _b = 7;
	Object.defineProperty(o,"b",{
		configurable: true,
		get(){ return _b; },
		set(v){ _b = v; }
	});
	const ra = ObjectWrapper.wrap(o,"a");
	const rb = ObjectWrapper.wrap(o,"b");
	let count = 0;
	ra.subscribe(() => count++);
	rb.subscribe(() => count++);
	o.a++;
	o.b++;

	await delay();
	// wrapping worked?
	expect(count).toEqual(2);
	expect(o.b).toEqual(8);
	expect(_b).toEqual(8);
	expect(o.a).toEqual(4);
	ObjectWrapper.unwrap(o,"a");
	ObjectWrapper.unwrap(o,"b");
	o.a++;
	o.b++;

	await delay();
	// unwrap worked?
	expect(count).toEqual(2);
	expect(o.b).toEqual(9);
	expect(_b).toEqual(9);
	expect(o.a).toEqual(5);
	// ra/rb subscribe should do nothing
	ra.subscribe(() => count++);
	rb.subscribe(() => count++);
	o.a++;
	o.b++;

	await delay();
	expect(count).toEqual(2);
	expect(o.b).toEqual(10);
	expect(_b).toEqual(10);
	expect(o.a).toEqual(6);
});
// unwrapping objectwrapper should detach all data props
test("objectwrapper unwrap", async () => {
	const o = {a: {b:1, c:5}};
	class X{
		constructor(v){ this._v = v; }
		increment(v){ this._v += v; }
		value(v){ return this._v; }
	}
	wrappable(X.prototype, {
		value:true,
		unwrap(){ return {value:this._v}; }
	});
	ObjectWrapper.wrap(o,"a",ObjectWrapper,{b:X});
	const xb = ObjectWrapper.wrap(o.a, "b");
	const rc = ObjectWrapper.wrap(o.a, "c");
	if (!(xb instanceof X && rc instanceof ReactiveValue))
		failed("wrong types");
	o.a.b.increment(12);
	let count = 0;
	rc.subscribe(() => count++);
	o.a.c += 3

	await delay();
	// make sure wrapped correctly
	expect(count).toEqual(1);
	expect(o.a.b.value()).toEqual(13);
	expect(o.a.c).toEqual(8);
	// now unwrap
	ObjectWrapper.unwrap(o,"a");
	expect(typeof o.a.b).toEqual("number");
	expect(typeof o.a.c).toEqual("number");
	o.a.b++;
	o.a.c++;
	xb.increment(7);
	rc.value++;

	await delay();
	expect(count).toEqual(1);
	expect(o.a.b).toEqual(14);
	expect(o.a.c).toEqual(9);
});
test("wrap nonexistent prop", async () => {
	const o = {};
	const r = ObjectWrapper.wrap(o,"a");
	expect(r).toBeInstanceOf(ReactiveValue);
	const s = jest.fn();
	r.subscribe(s);
	r.assume(5);
	r.value++;
	await delay();
	expect(s).toHaveBeenCalledTimes(1);
	expect(r.get()).toEqual(6);
	ObjectWrapper.unwrap(o,"a");
	r.value++;
	await delay();
	expect(o.a).toEqual(6);
});
// wrappable with no config will delete old wrappable config
test("make unwrappable", () => {
	class X{
		constructor(v){ this._v = v; }
	}
	class Y extends X{}
	wrappable(X.prototype, {
		value: true,
		unwrap(){ return {value: this._v} }
	})
	let o = {};
	const w = ObjectWrapper(o,{"a":X});
	// should succeed
	ObjectWrapper.wrap(w,"a");
	// should also succeed
	ObjectWrapper.wrap(w,"b",Y);
	wrappable(Y);
	// should still succeed
	ObjectWrapper.wrap(w,"c",Y);
	// should fail
	wrappable(X.prototype);
	expect(ObjectWrapper.wrap.bind(null,w,"d",Y)).toThrow();
})
// accessor on prototype; can just delete to restore old
test("accessor fallback", async () => {
	class X{
		constructor(v){ this._v = v; }
		get v(){ return this._v; }
		set v(v){ this._v = v; }
	}
	class Y extends X{}
	const y = new Y(7);
	const r = ObjectWrapper.wrap(y,"v");
	let count = 0;
	r.subscribe(() => count++)
	y.v++;
	await delay();
	expect(count).toBe(1);
	expect(y.v).toBe(8);
	ObjectWrapper.unwrap(y,"v");
	r.value++;
	expect(count).toBe(1);
	expect(y.v).toBe(8);
});

/*
accessor doesn't work as raw reactive?
	reactive = ObjectWrapper.wrap(obj, "accessor")
	reactive.value++
	obj.accessor++;

	You'd think reactive.value should be pre-bound to obj, but that would mean inheritence is no
	longer possible. Object.create(obj).accessor++ will still work, and won't operate on the
	prototype.

	What about the same but with data values, will those operate on the prototype? E.g.
		ObjectWrapper.wrap(obj, "data", ReactiveValue)
		a = Object.create(obj)
		b = Object.create(obj)
		a.data++;
		b.data++;
	Will these share the same RectiveValue?
	Seems you have the same problem with prototype ReactiveAccessor, since even though it can
	use deferred binding, it is sharing the same notify call, or async/sync list

*/