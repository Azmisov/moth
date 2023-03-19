import jest from "jest-mock";
import {
	ReactiveAccessor, ReactivePointer, ReactiveProxy, ReactiveWrapper,
	ReactiveMap
} from "../src/moth.mjs";

function delay(time){
	return new Promise(resolve => {
		setTimeout(resolve, time);
	});
}
function delay_microtask(){
	return new Promise(resolve => {
		queueMicrotask(resolve);
	});
}

// basic reactive pointer
test("reactive pointer", async () => {
	let count = 0;
	const o = {p: 10};
	let p = new ReactivePointer(o, "p");
	p.subscribe(() => count++);
	p.value++;
	await delay();
	expect(count).toEqual(1);
	expect(o.p).toEqual(11);
});
// basic reactive accessor
test("reactive accessor", async () => {
	class C{
		_x = 11;
		get x(){ return this._x; }
		set x(v) { this._x = v; }
		assert(){
			expect(this._x).toEqual(13);
		}
	}
	const c = new C();
	const desc = Object.getOwnPropertyDescriptor(
		Object.getPrototypeOf(c),
		"x"
	);
	let count = 0;
	// aot binding
	let a = new ReactiveAccessor(desc.get.bind(c), desc.set.bind(c));
	a.subscribe(() => count++);
	// deferred binding
	let b = new ReactiveAccessor(desc.get, desc.set);
	b.subscribe(() => count++);
	const accessor = Object.getOwnPropertyDescriptor(b,"value");
	const b_get = accessor.get.bind(c);
	const b_set = accessor.set.bind(c);
	// modify
	a.value++;
	b_set(b_get()+1);
	// check result
	await delay();
	expect(count).toEqual(2);
	expect(c.x).toEqual(13);
	c.assert();
});
// basic reactive proxy
test("reactive proxy", async () => {
	let v = [1,2,4,3];
	let p = new ReactiveProxy(v);
	let count = 0;
	p.subscribe(() => count++);
	p.value.sort();
	await delay();
	expect(count).toEqual(1);
});
// deep reactive proxy
test("deep reactive proxy", async () => {
	let v = {arr:[0,1],obj:{prop:0}};
	let p = new ReactiveProxy(v, true);
	let count = 0;
	p.subscribe(() => count++);
	p.value.obj.prop++;
	await delay();
	expect(count).toEqual(1);
});
// deep reactive proxy failure case
test("deep reactive proxy failure", () => {
	let val = {a:{val:10}, b:{val:5}};
	let rp = new ReactiveProxy(val, true);
	let count = 0;
	rp.subscribe(() => count++, null);
	let p = rp.value;
	let cached = p.a; // orphaned proxy
	p.a = p.b; // first change
	p.a.val++; // second change
	expect(count).toEqual(2);
	// ideally, this wouldn't trigger another notify
	cached.val++;
	expect(count).toEqual(3);
	// but we can deproxy it and should work
	cached = ReactiveProxy.deproxy(cached)
	cached.val++;
	expect(count).toEqual(3);
	// we expect it to have the wrong value
});
test("basic reactive property wrapper", async () => {
	class X{
		x = 5
		set y(v){ this._y = v; }
		get y(){ return this._y; }
		z(){ this._y *= Math.sqrt(this.x); }
	}
	const x = new X();
	const r = new ReactiveWrapper(x, ["x","y","z"]);
	const s = jest.fn();
	r.subscribe(s, "sync");
	r.value.x++;
	r.value.y = 10;
	r.value.z();
	expect(s).toHaveBeenCalledTimes(3);
	r.value = 5;
	expect(s).toHaveBeenCalledTimes(4);
	const y = new X();
});
test("reactive map", async () => {
	const m = new Map();
	const r = new ReactiveMap(m);
	const s = jest.fn();
	r.subscribe(s, "sync");
	console.log("value:", r.value);
	r.value.set("x",0);
	r.value.set("y",0);
	r.value.delete("x");
	r.value.clear();
	r.value.delete("y")
	r.value.clear();
	expect(s).toHaveBeenCalledTimes(4);

	// safe to call others?
	let sum = 0;
	r.value.set("y",10);
	if (r.value.has("y") && r.value.size == 1){
		sum = r.value.get("y");
		r.value.forEach(k => r.value.set(k,11));
		for (const [k,v] of r.value)
			sum += v;
	}
	expect(sum).toEqual(21)
	expect(s).toHaveBeenCalledTimes(6);
});