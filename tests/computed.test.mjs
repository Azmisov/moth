import {
	ReactiveValue, ReactiveComputed, ReactiveCache, ReactivePointer
} from "../src/moth.mjs";

function delay(time){
	return new Promise(resolve => {
		setTimeout(resolve, time);
	});
}

// --- Basic computed ---

test("basic computed", () => {
	const a = new ReactiveValue(2);
	const b = new ReactiveValue(3);
	const sum = new ReactiveComputed(() => a.value + b.value);
	expect(sum.value).toEqual(5);
	a.value = 10;
	expect(sum.value).toEqual(13);
	b.value = 7;
	expect(sum.value).toEqual(17);
});

test("computed is lazy on first read", () => {
	let calls = 0;
	const a = new ReactiveValue(1);
	const c = new ReactiveComputed(() => {
		calls++;
		return a.value * 2;
	});
	// no computation until first read
	expect(calls).toEqual(0);
	// first read triggers computation
	expect(c.value).toEqual(2);
	expect(calls).toEqual(1);
	// reading again without change should not recompute
	expect(c.value).toEqual(2);
	expect(calls).toEqual(1);
	// change input marks stale but doesn't recompute (no subscribers = pure pull)
	a.value = 5;
	expect(calls).toEqual(1);
	// reading triggers recomputation
	expect(c.value).toEqual(10);
	expect(calls).toEqual(2);
});

test("computed only notifies on value change", async () => {
	const a = new ReactiveValue(1);
	const c = new ReactiveComputed(() => a.value > 0 ? "positive" : "non-positive");
	let count = 0;
	c.subscribe(() => count++, null);
	// initial read
	expect(c.value).toEqual("positive");
	// change a, but computed result stays "positive"
	a.value = 2;
	expect(count).toEqual(0);
	// read to resolve — value unchanged, subscriber should not have been called again
	expect(c.value).toEqual("positive");
	// now actually change the result
	a.value = -1;
	// computed was notified (marked stale), downstream sync subscriber called
	// but the actual value check happens on read
	expect(c.value).toEqual("non-positive");
});

// --- Auto-dependency tracking ---

test("auto-tracking subscribes to read dependencies", () => {
	const a = new ReactiveValue(1);
	const b = new ReactiveValue(2);
	const c = new ReactiveComputed(() => a.value + b.value);
	expect(c.value).toEqual(3);
	a.value = 10;
	expect(c.value).toEqual(12);
	b.value = 20;
	expect(c.value).toEqual(30);
});

test("auto-tracking handles conditional dependencies", () => {
	const flag = new ReactiveValue(true);
	const a = new ReactiveValue(1);
	const b = new ReactiveValue(2);
	let calls = 0;
	const c = new ReactiveComputed(() => {
		calls++;
		return flag.value ? a.value : b.value;
	});
	expect(c.value).toEqual(1);
	expect(calls).toEqual(1);
	// b changes but c doesn't depend on b currently
	b.value = 20;
	expect(c.value).toEqual(1);
	expect(calls).toEqual(1); // should NOT recompute
	// a changes, c depends on a
	a.value = 10;
	expect(c.value).toEqual(10);
	expect(calls).toEqual(2);
	// switch flag, now depends on b
	flag.value = false;
	expect(c.value).toEqual(20);
	expect(calls).toEqual(3);
	// now a changes but c no longer depends on a
	a.value = 100;
	expect(c.value).toEqual(20);
	expect(calls).toEqual(3); // should NOT recompute
	// b changes, c depends on b now
	b.value = 30;
	expect(c.value).toEqual(30);
	expect(calls).toEqual(4);
});

test("chained computeds", () => {
	const a = new ReactiveValue(2);
	const doubled = new ReactiveComputed(() => a.value * 2);
	const quadrupled = new ReactiveComputed(() => doubled.value * 2);
	expect(quadrupled.value).toEqual(8);
	a.value = 3;
	expect(quadrupled.value).toEqual(12);
});

test("diamond dependency", () => {
	const a = new ReactiveValue(1);
	const b = new ReactiveComputed(() => a.value + 1);
	const c = new ReactiveComputed(() => a.value * 2);
	let calls = 0;
	const d = new ReactiveComputed(() => {
		calls++;
		return b.value + c.value;
	});
	expect(d.value).toEqual(4); // (1+1) + (1*2) = 4
	expect(calls).toEqual(1);
	a.value = 3;
	// without topological ordering, d may recompute more than once (once per input);
	// the final result is still correct
	expect(d.value).toEqual(10); // (3+1) + (3*2) = 10
	expect(calls).toBeGreaterThanOrEqual(2);
});

// --- Manual override ---

test("set overrides computed value", () => {
	const a = new ReactiveValue(1);
	const c = new ReactiveComputed(() => a.value * 2);
	expect(c.value).toEqual(2);
	// manual override
	c.value = 99;
	expect(c.value).toEqual(99);
	// changing input doesn't affect override until next stale
	// actually, set makes it not stale and overridden, so input change marks stale again
	a.value = 5;
	expect(c.value).toEqual(10); // recomputes from function
});

test("assume overrides without notify", async () => {
	const a = new ReactiveValue(1);
	const c = new ReactiveComputed(() => a.value * 2);
	let count = 0;
	c.subscribe(() => count++);
	expect(c.value).toEqual(2);
	c.assume(99);
	expect(c.value).toEqual(99);
	await delay();
	expect(count).toEqual(0);
});

// --- Circular dependency ---

test("circular dependency throws", () => {
	const a = new ReactiveComputed(() => a.value);
	expect(() => a.value).toThrow(/circular/i);
});

// --- Dispose ---

test("dispose unsubscribes from all deps", () => {
	const a = new ReactiveValue(1);
	const b = new ReactiveValue(2);
	let calls = 0;
	const c = new ReactiveComputed(() => {
		calls++;
		return a.value + b.value;
	});
	expect(c.value).toEqual(3);
	expect(calls).toEqual(1);
	c.dispose();
	a.value = 10;
	b.value = 20;
	// disposed, so still returns cached value and doesn't recompute
	expect(c.value).toEqual(3);
	expect(calls).toEqual(1);
});

// --- Manual dependency tracking ---

test("manual dependency tracking (autotrack=false)", () => {
	const a = new ReactiveValue(5);
	const b = new ReactiveValue(10);
	const c = new ReactiveComputed(() => a.value + b.value, false);
	// manually register dependencies
	c.depend(a);
	c.depend(b);
	expect(c.value).toEqual(15);
	a.value = 7;
	expect(c.value).toEqual(17);
	c.undepend(b);
	b.value = 100;
	// b no longer tracked, so c doesn't recompute
	expect(c.value).toEqual(17);
});

// --- With async subscribers ---

test("computed with async subscriber", async () => {
	const a = new ReactiveValue(1);
	const c = new ReactiveComputed(() => a.value * 3);
	// must read once to establish auto-tracked dependencies
	expect(c.value).toEqual(3);
	let result = 0;
	c.subscribe(() => {
		result = c.value;
	});
	a.value = 5;
	await delay();
	expect(result).toEqual(15);
});

test("computed with sync subscriber", () => {
	const a = new ReactiveValue(1);
	const c = new ReactiveComputed(() => a.value * 3);
	// must read once to establish auto-tracked dependencies
	expect(c.value).toEqual(3);
	let result = 0;
	c.subscribe(() => {
		result = c.value;
	}, null);
	a.value = 5;
	expect(result).toEqual(15);
});

// --- Integration with ReactiveCache ---

test("computed reads from ReactiveCache", () => {
	const a = new ReactiveCache(1);
	const c = new ReactiveComputed(() => a.value + 10);
	expect(c.value).toEqual(11);
	// setting same value on cache shouldn't trigger recompute
	a.value = 1;
	let calls = 0;
	const c2 = new ReactiveComputed(() => {
		calls++;
		return a.value + 10;
	});
	c2.value; // initial
	a.value = 1; // same value
	c2.value; // should not recompute
	expect(calls).toEqual(1);
});

// --- Integration with ReactivePointer ---

test("computed reads from ReactivePointer", () => {
	const obj = {x: 5};
	const p = new ReactivePointer(obj, "x");
	const c = new ReactiveComputed(() => p.value * 2);
	expect(c.value).toEqual(10);
	p.value = 8;
	expect(c.value).toEqual(16);
});
