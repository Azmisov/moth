import { add, run } from "./tests.mjs";
import AutoQueue from "../src/AutoQueue.mjs";
import { MicrotaskQueue } from '../src/Queue.mjs';
import { TrackingSubscriber } from '../src/Subscriber.mjs';
import { Reactive, ReactiveValue, ReactiveAccessor, ReactivePointer, ReactiveProxy } from "../src/Value.mjs";

const nodejs_blacklist = new Set(["animation","idle"])
// Edge did support immediate, but it is now deprecated
const browser_blacklist = new Set(["tick","immediate"]);
const blacklist = typeof window === "undefined" ? nodejs_blacklist : browser_blacklist;

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
	let v = [1,2,4,3];
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
			failed("microtasks didn't run before:"+r.value);
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
});
// test non-autoqueue subscribe
add("non-autoqueue", (passed, failed) => {
	const mine = new MicrotaskQueue();
	let r1 = new ReactiveValue(0);
	let r2 = new ReactiveValue(0);
	let a = 0, b = 0;
	function cbk(){ a++; }
	r1.subscribe(cbk);
	r2.subscribe(cbk, mine);
	r1.subscribe(() => b++);
	r1.value++;
	r2.value++;
	mine.flush(false);
	if (a !== 1)
		failed("manual queue not flushed");
	setTimeout(() => {
		if (a !== 1 || b !== 1)
			failed("wrong counts");
		passed();
	}, 10);
});
// subscribe options: default queue
add("default queue", (passed, failed) => {
	const r = new ReactiveValue(0);
	const old = Reactive.subscribe_defaults.queue;
	Reactive.subscribe_defaults.queue = AutoQueue("timeout",10);
	let a = 0, b = 0;
	r.subscribe(() => a++);
	Reactive.subscribe_defaults.queue = old;
	r.subscribe(() => b++);
	r.value++;
	setTimeout(() => {
		if (a != 0 || b != 1)
			failed(`wrong queues probably: ${a}, ${b}`);
	},5);
	setTimeout(() => {
		if (a != 1 || b != 1)
			failed("wrong counts")
		passed();
	},15);
});
// subscribe options: queue syntaxes
add("queue syntaxes", (passed, failed) => {
	const r = new ReactiveValue(0);
	let count = 0;
	r.subscribe(() => count++, AutoQueue("timeout"));
	r.subscribe(() => count++, AutoQueue("timeout",-1));
	r.subscribe(() => count++, new AutoQueue("timeout"));
	r.subscribe(() => count++, new AutoQueue("timeout",-1));
	r.subscribe(() => count++, "timeout");
	r.subscribe(() => count++, ["timeout",-1]);
	r.subscribe(() => count++, {queue:"timeout"});
	r.subscribe(() => count++, {queue:["timeout",-1]});
	r.subscribe(() => count++, {queue:AutoQueue("timeout")});
	r.subscribe(() => count++, {queue:AutoQueue("timeout",-1)});
	r.subscribe(() => count++, {queue:new AutoQueue("timeout")});
	r.subscribe(() => count++, {queue:new AutoQueue("timeout",-1)});
	r.subscribe(() => count++, {mode:"timeout"});
	r.subscribe(() => count++, {mode:"timeout",timeout:-1});
	r.subscribe(() => count++);
	r.value++;
	// make sure they're all queud on timeout queue
	queueMicrotask(() => {
		if (count !== 1)
			failed("wrong count");
	})
	setTimeout(() => {
		if (count !== 15)
			failed("wrong count");
		passed();
	},5)
});
// new AutoQueue should reference the same queue on backend
add("new autoqueue", (passed, failed) => {
	const r = new ReactiveValue(0);
	let count = 0;
	r.subscribe(() => count++, ["timeout",4]);
	r.value++;
	(new AutoQueue("timeout",4)).flush();
	if (count != 1)
		failed("wrong count:"+count);
	passed();
});
// flush while in notifying loop should do nothing
add("nonrecursive flush", (passed, failed) => {
	const r = new ReactiveValue(0);
	let a = 0, b = 0;
	r.subscribe(() => {
		a++;
		AutoQueue().flush(false);
		if (a !== 1 || b !== 0)
			failed("wrong count after flush");
	});
	r.subscribe(() => b++);
	r.value++;
	setTimeout(() => {
		if (a !== 1 || b !== 1)
			failed("wrong counts");
		passed();
	});
});
// forcing flush while in notifying loop
add("recursive flush", (passed, failed) => {
	const r = new ReactiveValue(0);
	let a = 0, b = 0;
	r.subscribe(() => {
		a++;
		AutoQueue().flush(true);
		if (a !== 1 || b !== 1)
			failed("wrong count after flush");
	});
	r.subscribe(() => b++);
	r.value++;
	setTimeout(() => {
		if (a !== 1 || b !== 1)
			failed("wrong counts");
		passed();
	});
});
// subscriber notified when first subscribes
add("first notify", (passed, failed) => {
	const r = new ReactiveValue(0);
	let x = 0;
	r.subscribe(() => x |= 0b1, {notify:false});
	r.subscribe(() => x |= 0b10, {notify:true});
	r.subscribe(() => x |= 0b100, {notify:null});
	r.subscribe(() => x |= 0b1000, {notify:"sync"});
	if (x !== 0b1100)
		failed("sync notify wrong");
	setTimeout(() => {
		if (x !== 0b1110)
			failed("wrong bits")
		passed();
	});
});
// test that default subscribe notify option works
add("default first notify", (passed, failed) => {
	const r = new ReactiveValue(0);
	let x = 0;
	let old = Reactive.subscribe_defaults.notify;
	Reactive.subscribe_defaults.notify = "sync";
	r.subscribe(() => x++);
	Reactive.subscribe_defaults.notify = old;
	if (x !== 1)
		failed("default not used")
	passed();
});
// return bound unsubscribe function from subscribe
add("return unsubscribe", (passed, failed) => {
	const r = new ReactiveValue(0);
	let count = 0;
	const unsubscribe = r.subscribe(() => count++, {unsubscribe: true});
	r.value++;
	setTimeout(() => {
		if (count !== 1)
			failed("first notify failed");
		// now try unsubscribe
		r.value++;
		unsubscribe();
		setTimeout(() => {
			if (count !== 1)
				failed("wrong count");
			passed();
		});
	});
});
add("default unsubscribe", (passed, failed) => {
	const r = new ReactiveValue(0);
	let count = 0;
	let old = Reactive.subscribe_defaults.unsubscribe;
	Reactive.subscribe_defaults.unsubscribe = true;
	const unsubscribe = r.subscribe(() => count++);
	Reactive.subscribe_defaults.unsubscribe = old;
	r.value++;
	unsubscribe();
	setTimeout(() => {
		if (count !== 0)
			failed("didn't unsubscribe")
		passed();
	});
});
// check all TrackingSubscriber args/pass options
add("tracking subscriber", (passed, failed) => {
	const a = new ReactiveValue(0);
	let b_fetches
	const b = new ReactiveAccessor(() => {
		b_fetches++;
		return 99;
	});
	const c = new ReactiveValue(0);
	const deps = [a,b,c];
	let count = 0;
	function cbk(amode, pmode, arg_count, ...args){
		count++;
		// convert all to array of flat arguments
		switch (pmode){
			case "expand":
				if (args.length !== arg_count)
					failed("bad expand signature");
				break;
			case "single":
				if (arg_count == 1){
					if (args.length !== 1 || Array.isArray(args[0]))
						failed("bad single signature");
					break;
				}
			// otherwise, same as array
			case "array":
				if (args.length !== 1 || !Array.isArray(args[0]) || args[0].length != arg_count)
					failed("bad array signature");
				args = args[0];
				break;
		}
		// verify types
		switch (amode){
			case "deps":
				for (let i=0; i<args.length; i++)
					if (args[i] !== deps[i])
						failed("wrong deps arg: "+i);
				break;
			case "vals":
			case "cache":
				for (let i=0; i<args.length; i++){
					if (args[i] !== deps[i].value)
						failed("wrong vals arg: "+i);
				}
				break;
		}
	}
	let expected_count = 0;
	let expected_b_fetches = 0;
	const amodes = ["deps","vals","cache"];
	const pmodes = ["expand","single","array"];
	for (const amode of amodes){
		for (const pmode of pmodes){
			const t1 = new TrackingSubscriber(cbk.bind(null, amode, pmode, 1), amode, pmode);
			const t2 = new TrackingSubscriber(cbk.bind(null, amode, pmode, 3), amode, pmode);
			// t2 fetches of b.value, to check that cache mode is not fetching
			if (amode == "vals")
				expected_b_fetches++;
			// some extra fetches when verifying correct value
			if (amode != "deps")
				expected_b_fetches++;
			expected_count += 2;
			a.subscribe(t1);
			for (const dep of deps)
				dep.subscribe(t2);
		}
	}
	// b gets fetched for cache on init, reset count
	b_fetches = 0;
	a.value += 1;
	c.value += 8;
	setTimeout(() => {
		// check that cache worked for b.value, which was unchanged
		if (b_fetches !== expected_b_fetches)
			failed(`cache mode not working: ${b_fetches}, expected ${expected_b_fetches}`);
		if (count !== expected_count)
			failed("wrong count");
		passed();
	});
});
// unsubscribe from tracking subscriber should remove as an argument
add("tracking subscriber unsubscribe", (passed, failed) => {
	let count = 0;
	const a = new ReactiveValue(0);
	const b = new ReactiveValue(10);
	const c = new ReactiveValue(20);
	const deps = [a,b,c];
	const t = new TrackingSubscriber((...args) => {
		count++;
		if (args.length !== deps.length)
			failed("wrong arg count");
		for (let i=0; i<args.length; i++)
			if (args[i] !== deps[i])
				failed("wrong ")
	}, "deps", "expand");
	for (const dep of deps)
		dep.subscribe(t);
	a.value++;
	setTimeout(() => {
		deps.splice(1,1);
		b.unsubscribe(t);
		a.value++;
		setTimeout(() => {
			if (count != 2)
				failed("wrong count");
			passed();
		});
	});
});
add("tracking subscribe option", (passed, failed) => {
	const r = new ReactiveValue(0);
	let count = 0;
	r.subscribe((v) => {
		count++;
		if (r !== v)
			failed("not correct")
	}, {tracking:["deps","expand"]})
	r.value++;
	setTimeout(() => {
		if (count != 1)
			failed("wrong count");
		passed();
	})
});
// subscribe_defaults.tracking works
add("tracking default subscribe", (passed, failed) => {
	const r = new ReactiveValue(0);
	let count = 0;
	let old = Reactive.subscribe_defaults.tracking;
	Reactive.subscribe_defaults.tracking = ["deps","expand"];
	r.subscribe((v) => {
		count++;
		if (r !== v)
			failed("not correct")
	})
	Reactive.subscribe_defaults.tracking = old;
	r.value++;
	setTimeout(() => {
		if (count != 1)
			failed("wrong count");
		passed();
	})
});
// TrackingSubscriber defaults
add("tracking subscriber defaults", (passed, failed) => {
	const r = new ReactiveValue(0);
	let count = 0;
	let old = TrackingSubscriber.defaults;
	TrackingSubscriber.defaults = ["vals","expand"];
	r.subscribe(new TrackingSubscriber((v) => {
		count++;
		if (r.value !== v)
			failed("not correct")
	}));
	TrackingSubscriber.defaults = old;
	r.value++;
	setTimeout(() => {
		if (count != 1)
			failed("wrong count");
		passed();
	})
});


/* TODO:
	- queue limit
	- idle time slicing
	- proxy with private properties
*/

// run(["reactive proxy"]); // single
run(null, false); // serial
// run(null, true); // parallel