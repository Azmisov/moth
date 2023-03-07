/* TODO:
	- queue limit
	- idle time slicing
	- proxy with private properties
*/
import {
	AutoQueue, MicrotaskQueue, TrackingSubscriber, Reactive, ReactiveValue,
	ReactiveAccessor
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

const nodejs_blacklist = new Set(["animation","idle"])
// Edge did support immediate, but it is now deprecated
const browser_blacklist = new Set(["tick","immediate"]);
const blacklist = typeof window === "undefined" ? nodejs_blacklist : browser_blacklist;

// Test that changes are getting batched
test("batch", async () => {
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
		expect(v.value).toEqual(8);
	}
	await delay(10);
	expect(count).toEqual(1);
});
test("already [un]subscribed", () => {
	const r = new ReactiveValue(0);
	function cbk(){}
	r.subscribe(cbk)
	expect(r.subscribe.bind(r,cbk)).toThrow(/already subscribed/i);
	r.unsubscribe(cbk);
	expect(r.unsubscribe.bind(r,cbk)).toThrow(/not subscribed/i);
});
// Test recursive sync
test("recursive sync", async () => {
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
	await delay();
	expect(count2).toEqual(1);
	expect(count).toEqual(2);
});
// test batching with sync
test("batch sync", async () => {
	let a = new ReactiveValue(0);
	let b = new ReactiveValue(0);
	let count = 0;
	function cbk(){ count++ }
	a.subscribe(cbk);
	b.subscribe(cbk, null);
	a.value++;
	b.value++;
	await delay();
	expect(count).toEqual(1);
});
// test basic unsubscribe
test("unsubscribe", async () => {
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
	await delay();
	expect(count).toEqual(0);
});
// unsubscribe all; testing that async and sync both get reset properly
test("unsubscribe all", async () => {
	const r = new ReactiveValue(0);
	let count = 0;
	let bits = 0;
	const c1 = () => {
		count++;
		bits |= 0b1;
		// should not continue on to c2
		r.unsubscribe();
	};
	const c2 = () => {
		count++;
		bits |= 0b10;
	}
	const c3 = () => {
		count++;
		bits |= 0b100;
	}
	r.subscribe(c1,"sync");
	r.subscribe(c2,"sync");
	r.subscribe(c3);
	r.value++;
	r.value++
	await delay();
	r.value++;
	await delay();
	expect(count).toBe(1);
	expect(bits).toBe(0b1);
});
// small reap test (manually tested via debugging interface)
test("reap (manually tested)", () => {
	let v = new ReactiveValue(0);
	let count = 0;
	v.subscribe(() => count++, "timeout", 50);
	v.value++;
});
// recursive unsubscribe inside sync
test("recursive sync unsubscribe", async () => {
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
	await delay();
	expect(count).toEqual(0b111);
});

// test recursive microtask (uses RecursiveQueue)
test("recursive microtask", async () => {
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
		expect(r.value).toEqual(3);
	}, "timeout");
	r.value++;
	await delay(10);
	expect(count).toEqual(4);
});
// test flush
test("flush", () => {
	let r = new ReactiveValue(0);
	let count = 0;
	r.subscribe(() => count++);
	r.value++;
	AutoQueue.flush(false);
	expect(count).toEqual(1);
});
// this tests that the Queue.count dirty optimization in Reactive.notify works
test("queue optimization", async () => {
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
	await delay();
	expect(count).toEqual(3);
});
// test non-autoqueue subscribe
test("non-autoqueue", async () => {
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
	expect(a).toEqual(1);
	await delay(10);
	expect(a).toEqual(1);
	expect(b).toEqual(1);
});
// subscribe options: default queue
test("default queue", async () => {
	const r = new ReactiveValue(0);
	const old = Reactive.subscribe_defaults.queue;
	Reactive.subscribe_defaults.queue = AutoQueue("timeout",10);
	let a = 0, b = 0;
	r.subscribe(() => a++);
	Reactive.subscribe_defaults.queue = old;
	r.subscribe(() => b++);
	r.value++;
	await delay(5);
	expect(a).toEqual(0);
	expect(b).toEqual(1);
	await delay(10);
	expect(a).toEqual(1);
	expect(b).toEqual(1);
});
// subscribe options: queue syntaxes
test("queue syntaxes", async () => {
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
	await delay_microtask();
	expect(count).toEqual(1);
	await delay(5);
	expect(count).toEqual(15);
});
// new AutoQueue should reference the same queue on backend
test("new autoqueue", () => {
	const r = new ReactiveValue(0);
	let count = 0;
	r.subscribe(() => count++, ["timeout",4]);
	r.value++;
	(new AutoQueue("timeout",4)).flush();
	expect(count).toEqual(1);
});
// flush while in notifying loop should do nothing
test("nonrecursive flush", async () => {
	const r = new ReactiveValue(0);
	let a = 0, b = 0;
	r.subscribe(() => {
		a++;
		AutoQueue().flush(false);
		// wrong count after flush?
		expect(a).toEqual(1);
		expect(b).toEqual(0);
	});
	r.subscribe(() => b++);
	r.value++;
	await delay();
	expect(a).toEqual(1);
	expect(b).toEqual(1);
});
// forcing flush while in notifying loop
test("recursive flush", async () => {
	const r = new ReactiveValue(0);
	let a = 0, b = 0;
	r.subscribe(() => {
		a++;
		AutoQueue().flush(true);
		// wrong count after flush?
		expect(a).toEqual(1);
		expect(b).toEqual(1);
	});
	r.subscribe(() => b++);
	r.value++;
	await delay();
	expect(a).toEqual(1);
	expect(b).toEqual(1);
});
// subscriber notified when first subscribes
test("first notify", async () => {
	const r = new ReactiveValue(0);
	let x = 0;
	r.subscribe(() => x |= 0b1, {notify:false});
	r.subscribe(() => x |= 0b10, {notify:true});
	r.subscribe(() => x |= 0b100, {notify:null});
	r.subscribe(() => x |= 0b1000, {notify:"sync"});
	// sync notify wrong?
	expect(x).toEqual(0b1100);
	await delay();
	expect(x).toEqual(0b1110);
});
// test that default subscribe notify option works
test("default first notify", () => {
	const r = new ReactiveValue(0);
	let x = 0;
	let old = Reactive.subscribe_defaults.notify;
	Reactive.subscribe_defaults.notify = "sync";
	r.subscribe(() => x++);
	Reactive.subscribe_defaults.notify = old;
	// default not used?
	expect(x).toEqual(1);
});
// return bound unsubscribe function from subscribe
test("return unsubscribe", async () => {
	const r = new ReactiveValue(0);
	let count = 0;
	const unsubscribe = r.subscribe(() => count++, {unsubscribe: true});
	r.value++;
	await delay();
	// first notify failed?
	expect(count).toEqual(1);
	// now try unsubscribe
	r.value++;
	unsubscribe();
	await delay();
	expect(count).toEqual(1);
});
test("default unsubscribe", async () => {
	const r = new ReactiveValue(0);
	let count = 0;
	let old = Reactive.subscribe_defaults.unsubscribe;
	Reactive.subscribe_defaults.unsubscribe = true;
	const unsubscribe = r.subscribe(() => count++);
	Reactive.subscribe_defaults.unsubscribe = old;
	r.value++;
	unsubscribe();
	await delay();
	// didn't unsubscribe?
	expect(count).toEqual(0);
});
// check all TrackingSubscriber args/pass options
test("tracking subscriber", done => {
	const a = new ReactiveValue(0);
	let b_fetches
	const b = new ReactiveAccessor(() => {
		b_fetches++;
		return 99;
	});
	const c = new ReactiveValue(0);
	const deps = [a,b,c];
	let count = 0;
	let already_done = false;
	function cbk(amode, pmode, arg_count, ...args){
		try{
			count++;
			// convert all to array of flat arguments
			switch (pmode){
				case "expand":
					//bad expand signature?
					expect(args).toHaveLength(arg_count);
					break;
				case "single":
					if (arg_count == 1){
						// bad single signature
						expect(args).toHaveLength(1);
						expect(Array.isArray(args[0])).toBe(false);
						break;
					}
				// otherwise, same as array
				case "array":
					//bad array signature
					expect(args).toHaveLength(1);
					expect(args[0]).toBeInstanceOf(Array);
					expect(args[0]).toHaveLength(arg_count);
					args = args[0];
					break;
			}
			// verify types
			switch (amode){
				case "deps":
					for (let i=0; i<args.length; i++)
						expect(args[i]).toEqual(deps[i]);
					break;
				case "vals":
				case "cache":
					for (let i=0; i<args.length; i++)
						expect(args[i]).toEqual(deps[i].value);
					break;
			}
		}catch(err){
			already_done = true;
			done(err);
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
		if (already_done)
			return;
		// check that cache worked for b.value, which was unchanged
		try{
			expect(b_fetches).toEqual(expected_b_fetches);
			expect(count).toEqual(expected_count);
		}catch(err){
			done(err);
			return;
		}
		done();
	});
});
// unsubscribe from tracking subscriber should remove as an argument
test("tracking subscriber unsubscribe", done => {
	let count = 0;
	const a = new ReactiveValue(0);
	const b = new ReactiveValue(10);
	const c = new ReactiveValue(20);
	const deps = [a,b,c];
	let already_done = false;
	const t = new TrackingSubscriber((...args) => {
		count++;
		// wrong arg count?
		try{
			expect(args.length).toEqual(deps.length);
			for (let i=0; i<args.length; i++)
				expect(args[i]).toEqual(deps[i])
		}catch(err){
			done(err);
			already_done = true;
		}
	}, "deps", "expand");
	for (const dep of deps)
		dep.subscribe(t);
	a.value++;
	setTimeout(() => {
		if (already_done)
			return;
		deps.splice(1,1);
		b.unsubscribe(t);
		a.value++;
		setTimeout(() => {
			try{
				expect(count).toEqual(2);
			}catch(err){
				done(err);
				return;
			}
			done();
		});
	});
});
test("tracking subscribe option", done => {
	const r = new ReactiveValue(0);
	let count = 0;
	let already_done = false;
	r.subscribe((v) => {
		count++;
		try{
			expect(r).toEqual(v);
		}catch(err){
			done(err);
			already_done = true;
		}
	}, {tracking:["deps","expand"]})
	r.value++;
	setTimeout(() => {
		if (already_done)
			return;
		try{
			expect(count).toEqual(1);
		}catch(err){
			done(err);
			return;
		}
		done();
	})
});
// subscribe_defaults.tracking works
test("tracking default subscribe", done => {
	const r = new ReactiveValue(0);
	let count = 0;
	let old = Reactive.subscribe_defaults.tracking;
	Reactive.subscribe_defaults.tracking = ["deps","expand"];
	let already_done = false;
	r.subscribe((v) => {
		count++;
		try{
			expect(r).toEqual(v);
		}catch(err){
			done(err);
			already_done = true;
		}
	})
	Reactive.subscribe_defaults.tracking = old;
	r.value++;
	setTimeout(() => {
		if (already_done)
			return;
		try{ expect(count).toEqual(1); }
		catch(err){ return done(err); }
		done();
	})
});
// if tracking is non-array, it pulls from TrackingSubscriber.defaults
test("tracking unspecified subscribe", async () => {
	let count = 0;
	const r = new ReactiveValue(0);
	r.subscribe((arr) => {
		expect(Array.isArray(arr)).toBe(true);
		expect(arr[0]).toBe(r);
		count++
	}, {tracking:true});
	r.value++;
	await delay();
	expect(count).toBe(1);
});
// TrackingSubscriber defaults
test("tracking subscriber defaults", done => {
	const r = new ReactiveValue(0);
	let count = 0;
	let old = TrackingSubscriber.defaults;
	TrackingSubscriber.defaults = ["vals","expand"];
	let already_done = false;
	r.subscribe(new TrackingSubscriber((v) => {
		count++;
		try{ expect(r.value).toEqual(v); }
		catch(err){
			already_done = true;
			done(err);
		}
	}));
	TrackingSubscriber.defaults = old;
	r.value++;
	setTimeout(() => {
		if (already_done)
			return;
		try{ expect(count).toEqual(1); }
		catch(err){ return done(err); }
		done();
	})
});
test("tracking subscriber keyword error", () => {
	expect(() => new TrackingSubscriber(() => {}, "values")).toThrow(/unknown keyword/i);
	expect(() => new TrackingSubscriber(() => {}, "vals","arr")).toThrow(/unknown keyword/i);
})