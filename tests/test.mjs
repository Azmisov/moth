import colors from 'colors';
import AutoQueue from "../src/AutoQueue.mjs";
import { ReactiveValue, ReactiveAccessor, ReactivePointer, ReactiveProxy } from "../src/Value.mjs";

const nodejs_blacklist = new Set(["animation","idle"])
// Edge did support immediate, but it is now deprecated
const browser_blacklist = new Set(["tick","immediate"]);
const blacklist = typeof window === "undefined" ? nodejs_blacklist : browser_blacklist;

const tests = {};
/** Add a test */
function add(name, fn){
	if (name in tests)
		failed("duplicate test name: "+name);
	tests[name] = fn;
}
/** Run tests */
async function run(whitelist){
	if (!whitelist)
		whitelist = Object.keys(tests);
	let promises = [];
	const pass = "passed".brightGreen;
	const fail = "failed".brightRed;
	for (let name of whitelist){
		const fn = tests[name];
		let err = null;
		const promise = new Promise(fn)
			.catch(e => err = e)
			.finally(() => {
				console.log(`Test ${name}: `+(err ? fail : pass));
				if (err)
					console.error("\t",err);
			});
		promises.push(promise);
	}
	await Promise.all(promises);
	console.log("all tests completed".cyan);
	process.exit();
}

/// TEST CASES ---------------------------

// Test that changes are getting batched
add("batch", (passed, failed) => {
	let count = 0;
	function cbk(){ count++; }
	let vals = [];
	for (let m in AutoQueue.modes){
		if (blacklist.has(m))
			continue;
		const v = new ReactiveValue(0)
		vals.push(v);
		v.subscribe(cbk, m);
	}
	for (let v of vals){
		v.value = 5;
		v.set(6);
		v.update(v => v+1);
		v.value++;
		if (v.value !== 8)
			failed("incorrect value:"+v.value);
	}
	setTimeout(() => {
		if (count != 1)
			failed("wrong count:"+count);
		passed();
	}, 10);
})
// Test recursive sync
add("recursive sync", (passed, failed) => {
	let v = new ReactiveValue(0);
	let count = 0;
	v.subscribe(() => {
		if (v.value > 10)
			v.value = 10;
		count++;
	}, null);
	let count2 = 0;
	v.subscribe(() => {
		count2++;
	}, null);
	v.value = 12;
	setTimeout(() => {
		if (count2 != 1 || count != 2 )
			failed("wrong counts");
		passed();
	});
});
// test batching with sync
add("batch sync", (passed, failed) => {
	let a = new ReactiveValue(0);
	let b = new ReactiveValue(0);
	let count = 0;
	function cbk(){ count++ }
	a.subscribe(cbk);
	b.subscribe(cbk, null);
	a.value++;
	b.value++;
	setTimeout(() => {
		if (count != 1)
			failed("wrong ocunt");
		passed();
	});
});
// test basic unsubscribe
add("unsubscribe", (passed, failed) => {
	let count = 0;
	let v = new ReactiveValue(0);
	let cbks = [];
	for (let m in AutoQueue.modes){
		if (blacklist.has(m))
			continue;
		const c = () => count++;
		cbks.push(c);
		v.subscribe(c, m);		
	}
	v.value++;
	for (const c of cbks)
		v.unsubscribe(c);
	setTimeout(() => {
		if (count !== 0)
			failed("wrong count")
		passed();
	})
});
// small reap test (manually tested via debugging interface)
add("reap (manually tested)", (passed, failed) => {
	let v = new ReactiveValue(0);
	let count = 0;
	v.subscribe(() => count++, "timeout", 50);
	v.value++;
	passed();
});
// recursive unsubscribe inside sync
add("recursive sync unsubscribe", (passed, failed) => {
	let v = new ReactiveValue(0);
	let count = 0;
	const a = () => count |= 0b1;
	const b = () => {
		v.unsubscribe(a);
		v.unsubscribe(b);
		count |= 0b10;
	}
	const c = () => {
		// should be called correctly with a/b getting unsubscribed
		v.unsubscribe(d);
		count |= 0b100;
	};
	const d = () => {
		// shouldn't get called
		count |= 0b1000;
	};
	for (const cbk of [a,b,c,d])
		v.subscribe(cbk, null);
	v.value++;
	setTimeout(() => {
		if (count !== 0b111)
			failed("wrong count: "+count);
		passed();
	})
});
// basic reactive pointer
add("reactive pointer", (passed, failed) => {
	let count = 0;
	const o = {p: 10};
	let p = new ReactivePointer(o, "p");
	p.subscribe(() => count++);
	p.value++;
	setTimeout(() => {
		if (count != 1 || o.p !== 11)	
			failed("wrong count/value");
		passed();
	});
});
// basic reactive accessor
add("reactive accessor", (passed, failed) => {
	class C{
		_x = 11;
		get x(){ return this._x; }
		set x(v) { this._x = v; }
		assert(){
			if (this._x !== 11)
				failed("wrong value");
		}
	}
	const c = new C();
	const desc = Object.getOwnPropertyDescriptor(
		Object.getPrototypeOf(c),
		"x"
	);
	let a = new ReactiveAccessor(desc.get, desc.set);
	let count = 0;
	a.subscribe(() => count++);
	a.value++;
	setTimeout(() => {
		c.assert();
		if (count != 1)
			failed("wrong count: "+count);
		passed();
	});
});
// basic reactive proxy
add("reactive proxy", (passed, failed) => {
	let v = [4,3,2,1];
	let p = new ReactiveProxy(v);
	let count = 0;
	p.subscribe(() => count++);
	p.value.sort();
	setTimeout(() => {
		if (count != 1)
			failed("wrong count: "+count);
		passed();
	});
});
// deep reactive proxy
add("deep reactive proxy", (passed, failed) => {
	let v = {arr:[0,1],obj:{prop:0}};
	let p = new ReactiveProxy(v, true);
	let count = 0;
	p.subscribe(() => count++);
	p.value.obj.prop++;
	setTimeout(() => {
		if (count != 1)
			failed("wrong count: "+count);
		passed();
	})
});
// deep reactive proxy failure case
add("deep reactive proxy failure", (passed, failed) => {
	let val = {a:{val:10}, b:{val:5}};
	let rp = new ReactiveProxy(val, true);
	let count = 0;
	rp.subscribe(() => count++, null);
	let p = rp.value;
	let cached = p.a; // orphaned proxy
	p.a = p.b; // first change
	p.a.val++; // second change
	if (count != 2)
		failed("wrong count");
	// ideally, this wouldn't trigger another notify
	cached.val++;
	if (count != 3)
		failed("wrong count, orphaned");
	// but we can deproxy it and should work
	cached = ReactiveProxy.deproxy(cached)
	cached.val++;
	if (count != 3)
		failed("wrong count, deproxied");
	// we expect it to have the wrong value
	passed();
});
// test recursive microtask (uses RecursiveQueue)
add("recursive microtask", (passed, failed) => {
	let r = new ReactiveValue(0);
	let count = 0;
	r.subscribe(() => {
		count++;
		if (r.value < 3)
			r.value++
	});
	// should run after all recursive microtasks
	r.subscribe(() => {
		count++;
		if (r.value !== 3)
			failed("microtasks didn't run before");
	}, "timeout");
	r.value++;
	setTimeout(() => {
		if (count !== 4)
			failed("wrong count:"+count);
		passed();
	}, 10);
});
// test flush
add("flush", (passed, failed) => {
	let r = new ReactiveValue(0);
	let count = 0;
	r.subscribe(() => count++);
	r.value++;
	AutoQueue.flush(false);
	if (count != 1)
		failed("wrong count");
	passed();
});
// this tests that the Queue.count dirty optimization in Reactive.notify works
add("queue optimization", (passed, failed) => {
	let r1 = new ReactiveValue(0);
	let r2 = new ReactiveValue(0);
	let count = 0;
	function fn(){
		count++;
		// console.log("call fn", count);
		if (r1.value === 1){
			// step #2: queues fn
			r1.value++
			// step #3: fn run syncrhonously, step #2 dequed; count 1->2
			r2.value++;
		}
	}
	r1.subscribe(fn);
	r2.subscribe(fn, null);
	r2.subscribe(() => {
		// step #4: fn queued a last time; count 2->3
		r1.value++;
	});
	// step #1 trigger reactive flow; count 0->1
	r1.value++;
	setTimeout(() => {
		if (count !== 3)
			failed("wrong count: "+count);
		passed();
	});
})

// run(["recursive sync"]);
run();