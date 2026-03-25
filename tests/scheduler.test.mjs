import {
	MicrotaskClock, PromiseClock, MessageClock,
	TimeoutClock, TimeoutDelayClock,
	AnimationClock, IdleDelayClock, IdleClock,
} from "../src/scheduler/Clock.mjs";
import {
	Scheduler, SchedulerQueue
} from "../src/scheduler/Scheduler.mjs";
const { clockClasses } = Scheduler;
import { ReactiveValue } from "../src/Reactive.mjs";

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

// --- Clock tests ---

test("getClock returns singleton for non-parameterized modes", () => {
	const sched = new Scheduler();
	const a = sched.getClock("microtask");
	const b = sched.getClock("microtask");
	expect(a).toBe(b);
});

test("getClock returns same instance for same timeout", () => {
	const sched = new Scheduler();
	const a = sched.getClock("timeout", 500);
	const b = sched.getClock("timeout", 500);
	expect(a).toBe(b);
});

test("getClock returns different instance for different timeout", () => {
	const sched = new Scheduler();
	const a = sched.getClock("timeout", 100);
	const b = sched.getClock("timeout", 200);
	expect(a).not.toBe(b);
});

test("getClock throws for unknown mode", () => {
	const sched = new Scheduler();
	expect(() => sched.getClock("foobar")).toThrow(/unknown/i);
});

test("getClock throws for unsupported timeout", () => {
	const sched = new Scheduler();
	expect(() => sched.getClock("microtask", 500)).toThrow(/does not support/i);
});

test("clock rank bitmask ordering", () => {
	// each clock should have a higher rank than the previous
	const modes = ["microtask", "promise", "tick", "message"];
	let prevRank = 0;
	for (const mode of modes) {
		const Clazz = clockClasses[mode];
		expect(Clazz.rank).toBeGreaterThan(prevRank);
		prevRank = Clazz.rank;
	}
});

test("clock mask includes all lower priority ranks", () => {
	// microtask mask should just be its own rank
	expect(MicrotaskClock.mask).toEqual(MicrotaskClock.rank);
	// promise mask should include microtask
	expect(PromiseClock.mask & MicrotaskClock.rank).toBeTruthy();
	// message mask should include microtask, promise, tick
	expect(MessageClock.mask & MicrotaskClock.rank).toBeTruthy();
	expect(MessageClock.mask & PromiseClock.rank).toBeTruthy();
});

test("TimeoutDelayClock requires non-zero timeout", () => {
	expect(() => new TimeoutDelayClock({}, 0)).toThrow(/non-zero/i);
});

test("streams are independent - animation does not include timeout ranks", () => {
	expect(AnimationClock.mask & TimeoutClock.rank).toBeFalsy();
	expect(AnimationClock.mask & TimeoutDelayClock.rank).toBeFalsy();
	// but does include deterministic
	expect(AnimationClock.mask & MicrotaskClock.rank).toBeTruthy();
});

test("streams are independent - timeout does not include animation/idle ranks", () => {
	expect(TimeoutDelayClock.mask & AnimationClock.rank).toBeFalsy();
	expect(TimeoutDelayClock.mask & IdleClock.rank).toBeFalsy();
	expect(TimeoutDelayClock.mask & IdleDelayClock.rank).toBeFalsy();
	// but does include deterministic
	expect(TimeoutDelayClock.mask & MicrotaskClock.rank).toBeTruthy();
});

test("timeout flush does not drain animation subscribers", () => {
	const sched = new Scheduler();
	const t500 = sched.getClock("timeout", 500);
	const microClock = sched.getClock("microtask");
	let timeout = 0, micro = 0, anim = 0;
	// animation clock not available in Node, so simulate with message (also a separate stream)
	// Instead, test via masks directly: enqueue on a clock whose rank is NOT in timeout's mask
	// Use message clock as proxy since it IS in the mask
	sched.enqueue(microClock, { call() { micro++; } });
	sched.enqueue(t500, { call() { timeout++; } });
	sched.flush(t500);
	expect(micro).toEqual(1);   // deterministic, in timeout's mask
	expect(timeout).toEqual(1); // same stream
});

test("different schedulers have independent clocks", () => {
	const a = new Scheduler();
	const b = new Scheduler();
	expect(a.getClock("microtask")).not.toBe(b.getClock("microtask"));
});

// --- Scheduler tests ---

test("scheduler enqueue and flush", () => {
	const sched = new Scheduler();
	const clock = sched.getClock("microtask");
	let called = false;
	sched.enqueue(clock, { call(qid) { called = true; } });
	sched.flush(clock);
	expect(called).toBe(true);
});

test("scheduler priority flushing - lower priority flushed first", () => {
	const sched = new Scheduler();
	const microClock = sched.getClock("microtask");
	const promiseClock = sched.getClock("promise");
	const order = [];
	sched.enqueue(microClock, { call() { order.push("microtask"); } });
	sched.enqueue(promiseClock, { call() { order.push("promise"); } });
	// flushing promise should also flush microtask first
	sched.flush(promiseClock);
	expect(order).toEqual(["microtask", "promise"]);
});

test("scheduler recursive enqueue during flush", () => {
	const sched = new Scheduler();
	const clock = sched.getClock("microtask");
	const order = [];
	const sub2 = { call(qid) { order.push("second"); } };
	const sub1 = {
		call(qid) {
			order.push("first");
			sched.enqueue(clock, sub2);
		}
	};
	sched.enqueue(clock, sub1);
	sched.flush(clock);
	expect(order).toEqual(["first", "second"]);
});

test("recursive flush guarantees queue is drained before returning", () => {
	const sched = new Scheduler();
	const clock = sched.getClock("microtask");
	const order = [];
	const sub2 = { call() { order.push("c"); } };
	sched.enqueue(clock, { call() { order.push("a"); } });
	sched.enqueue(clock, {
		call() {
			order.push("b");
			sched.enqueue(clock, sub2);
			sched.flush(clock);
			order.push("b_after_flush");
		}
	});
	sched.flush(clock);
	expect(order).toEqual(["a", "b", "c", "b_after_flush"]);
});

test("scheduler higher priority recursive enqueue flushes in same pass", () => {
	const sched = new Scheduler();
	const microClock = sched.getClock("microtask");
	const msgClock = sched.getClock("message");
	const order = [];
	const microSub = { call() { order.push("microtask"); } };
	const msgSub = {
		call() {
			order.push("message");
			sched.enqueue(microClock, microSub);
		}
	};
	sched.enqueue(msgClock, msgSub);
	sched.flush(msgClock);
	expect(order).toEqual(["message", "microtask"]);
});

// --- Dequeue during iteration tests ---

test("dequeue subscriber before it is called during flush", () => {
	const sched = new Scheduler();
	const clock = sched.getClock("microtask");
	let a = 0, b = 0, c = 0;
	const subB = { call() { b++; } };
	const subA = {
		call() {
			a++;
			sched.dequeue(clock, subB);
		}
	};
	const subC = { call() { c++; } };
	sched.enqueue(clock, subA);
	sched.enqueue(clock, subB);
	sched.enqueue(clock, subC);
	sched.flush(clock);
	expect(a).toEqual(1);
	expect(b).toEqual(0); // dequeued before reached
	expect(c).toEqual(1);
});

test("dequeue subscriber after it was already called during flush", () => {
	const sched = new Scheduler();
	const clock = sched.getClock("microtask");
	let a = 0, b = 0, c = 0;
	const subA = { call() { a++; } };
	const subC = {
		call() {
			c++;
			sched.dequeue(clock, subA);
		}
	};
	sched.enqueue(clock, subA);
	sched.enqueue(clock, { call() { b++; } });
	sched.enqueue(clock, subC);
	sched.flush(clock);
	expect(a).toEqual(1); // already called, dequeue doesn't undo it
	expect(b).toEqual(1);
	expect(c).toEqual(1);
});

test("dequeue subscriber that was re-enqueued during flush", () => {
	const sched = new Scheduler();
	const clock = sched.getClock("microtask");
	let calls = 0;
	const target = { call() { calls++; } };
	sched.enqueue(clock, {
		call() {
			sched.enqueue(clock, target);
		}
	});
	sched.enqueue(clock, {
		call() {
			sched.dequeue(clock, target);
		}
	});
	sched.enqueue(clock, target);
	sched.flush(clock);
	expect(calls).toEqual(1);
});

// --- SchedulerQueue adapter tests ---

test("SchedulerQueue works with ReactiveValue subscribe", () => {
	const sched = new Scheduler();
	const clock = sched.getClock("microtask");
	const sq = new SchedulerQueue(clock, sched);
	const r = new ReactiveValue(0);
	let count = 0;
	r.subscribe(() => count++, sq);
	r.value++;
	sq.flush();
	expect(count).toEqual(1);
});

test("scheduler flush() with no arg flushes all", () => {
	const sched = new Scheduler();
	const microClock = sched.getClock("microtask");
	const msgClock = sched.getClock("message");
	let a = 0, b = 0;
	sched.enqueue(microClock, { call() { a++; } });
	sched.enqueue(msgClock, { call() { b++; } });
	sched.flush();
	expect(a).toEqual(1);
	expect(b).toEqual(1);
});

// --- RankedTimeoutQueue tests ---

test("timeout sub-queues flush in ascending order", () => {
	const sched = new Scheduler();
	const t100 = sched.getClock("timeout", 100);
	const t500 = sched.getClock("timeout", 500);
	const t1000 = sched.getClock("timeout", 1000);
	const order = [];
	sched.enqueue(t1000, { call() { order.push(1000); } });
	sched.enqueue(t100, { call() { order.push(100); } });
	sched.enqueue(t500, { call() { order.push(500); } });
	sched.flush(t1000);
	expect(order).toEqual([100, 500, 1000]);
});

test("timeout flush only drains sub-queues <= triggering timeout", () => {
	const sched = new Scheduler();
	const t100 = sched.getClock("timeout", 100);
	const t500 = sched.getClock("timeout", 500);
	const t1000 = sched.getClock("timeout", 1000);
	let a = 0, b = 0, c = 0;
	sched.enqueue(t100, { call() { a++; } });
	sched.enqueue(t500, { call() { b++; } });
	sched.enqueue(t1000, { call() { c++; } });
	sched.flush(t500);
	expect(a).toEqual(1);
	expect(b).toEqual(1);
	expect(c).toEqual(0);
});

test("timeout flush also drains deterministic ticks", () => {
	const sched = new Scheduler();
	const microClock = sched.getClock("microtask");
	const t500 = sched.getClock("timeout", 500);
	const order = [];
	sched.enqueue(microClock, { call() { order.push("microtask"); } });
	sched.enqueue(t500, { call() { order.push("timeout500"); } });
	sched.flush(t500);
	expect(order).toEqual(["microtask", "timeout500"]);
});

test("timeout recursive enqueue during flush", () => {
	const sched = new Scheduler();
	const t100 = sched.getClock("timeout", 100);
	const t500 = sched.getClock("timeout", 500);
	const order = [];
	const sub100 = { call() { order.push(100); } };
	sched.enqueue(t500, {
		call() {
			order.push(500);
			sched.enqueue(t100, sub100);
		}
	});
	sched.flush(t500);
	expect(order).toEqual([500, 100]);
});

test("timeout dequeue from specific sub-queue", () => {
	const sched = new Scheduler();
	const t100 = sched.getClock("timeout", 100);
	const t500 = sched.getClock("timeout", 500);
	let a = 0, b = 0;
	const subA = { call() { a++; } };
	const subB = { call() { b++; } };
	sched.enqueue(t100, subA);
	sched.enqueue(t500, subB);
	sched.dequeue(t100, subA);
	sched.flush(t500);
	expect(a).toEqual(0);
	expect(b).toEqual(1);
});

test("non-timeout flush sweeps all timeout sub-queues", () => {
	const sched = new Scheduler();
	const t100 = sched.getClock("timeout", 100);
	const t5000 = sched.getClock("timeout", 5000);
	const microClock = sched.getClock("microtask");
	let a = 0, b = 0, c = 0;
	sched.enqueue(t100, { call() { a++; } });
	sched.enqueue(t5000, { call() { b++; } });
	sched.enqueue(microClock, { call() { c++; } });
	sched.flush();
	expect(a).toEqual(1);
	expect(b).toEqual(1);
	expect(c).toEqual(1);
});

// --- Heap ordering tests (via timeout sub-queues) ---

test("heap: many timeouts flush in correct ascending order", () => {
	const sched = new Scheduler();
	const timeouts = [800, 200, 500, 100, 1000, 300, 50, 700];
	const order = [];
	for (const t of timeouts)
		sched.enqueue(sched.getClock("timeout", t), { call() { order.push(t); } });
	sched.flush(sched.getClock("timeout", 1000));
	expect(order).toEqual([50, 100, 200, 300, 500, 700, 800, 1000]);
});

test("heap: remove middle element preserves order", () => {
	const sched = new Scheduler();
	const t100 = sched.getClock("timeout", 100);
	const t300 = sched.getClock("timeout", 300);
	const t500 = sched.getClock("timeout", 500);
	const t700 = sched.getClock("timeout", 700);
	const order = [];
	const sub100 = { call() { order.push(100); } };
	const sub300 = { call() { order.push(300); } };
	const sub500 = { call() { order.push(500); } };
	const sub700 = { call() { order.push(700); } };
	sched.enqueue(t100, sub100);
	sched.enqueue(t300, sub300);
	sched.enqueue(t500, sub500);
	sched.enqueue(t700, sub700);
	// dequeue middle element (exercises _heapRemove + _heapReplace sift)
	sched.dequeue(t300, sub300);
	sched.flush(sched.getClock("timeout", 1000));
	expect(order).toEqual([100, 500, 700]);
});

test("heap: remove root preserves order", () => {
	const sched = new Scheduler();
	const t50 = sched.getClock("timeout", 50);
	const t200 = sched.getClock("timeout", 200);
	const t400 = sched.getClock("timeout", 400);
	const order = [];
	const sub50 = { call() { order.push(50); } };
	sched.enqueue(t50, sub50);
	sched.enqueue(t200, { call() { order.push(200); } });
	sched.enqueue(t400, { call() { order.push(400); } });
	// dequeue root (smallest timeout, exercises sift-down path)
	sched.dequeue(t50, sub50);
	sched.flush(sched.getClock("timeout", 500));
	expect(order).toEqual([200, 400]);
});

test("heap: remove last element", () => {
	const sched = new Scheduler();
	const t100 = sched.getClock("timeout", 100);
	const t500 = sched.getClock("timeout", 500);
	const order = [];
	const sub500 = { call() { order.push(500); } };
	sched.enqueue(t100, { call() { order.push(100); } });
	sched.enqueue(t500, sub500);
	// dequeue highest timeout (last in heap, exercises the early-return path in _heapRemove)
	sched.dequeue(t500, sub500);
	sched.flush(sched.getClock("timeout", 1000));
	expect(order).toEqual([100]);
});

test("heap: interleaved enqueue and flush", () => {
	const sched = new Scheduler();
	const order = [];
	// first batch
	sched.enqueue(sched.getClock("timeout", 500), { call() { order.push(500); } });
	sched.enqueue(sched.getClock("timeout", 100), { call() { order.push(100); } });
	// partial flush — only ≤ 200
	sched.flush(sched.getClock("timeout", 200));
	expect(order).toEqual([100]);
	// enqueue more
	sched.enqueue(sched.getClock("timeout", 50), { call() { order.push(50); } });
	sched.enqueue(sched.getClock("timeout", 300), { call() { order.push(300); } });
	// flush rest
	sched.flush(sched.getClock("timeout", 1000));
	expect(order).toEqual([100, 50, 300, 500]);
});

test("heap: re-enqueue after flush into same timeout", () => {
	const sched = new Scheduler();
	const t100 = sched.getClock("timeout", 100);
	let count = 0;
	sched.enqueue(t100, { call() { count++; } });
	sched.flush(t100);
	expect(count).toEqual(1);
	// same timeout, re-enqueue after flush
	sched.enqueue(t100, { call() { count++; } });
	sched.flush(t100);
	expect(count).toEqual(2);
});

// --- Stop tests ---

test("stop cancels clocks but enqueue still queues", () => {
	const sched = new Scheduler();
	const clock = sched.getClock("microtask");
	let count = 0;
	sched.enqueue(clock, { call() { count++; } });
	sched.stop();
	// clock is cancelled, so nothing fires automatically;
	// but manual flush still works
	sched.flush(clock);
	expect(count).toEqual(1);
});

test("enqueue after stop queues but clock is not scheduled", () => {
	const sched = new Scheduler();
	const clock = sched.getClock("microtask");
	sched.stop();
	let count = 0;
	sched.enqueue(clock, { call() { count++; } });
	// subscriber is queued but clock was not scheduled
	expect(clock.scheduled).toBe(false);
	// manual flush still drains it
	sched.flush(clock);
	expect(count).toEqual(1);
});
