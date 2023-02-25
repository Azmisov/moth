import QueueManager from "../src/Queue.mjs";
import { ReactiveValue, ReactiveProxy } from "../src/Value.mjs";
import { wrap } from "../src/Wrapper.mjs";

const json = {
	a: 0,
	b: {
		c: 10,
		d: "string"
	}
};

const ra = wrap(json, "a", ReactiveValue);
ra.subscribe(v => {
	console.log("changed");
}, "promise")
const rb = wrap(json, "b", ReactiveProxy);
rb.subscribe(v => {
	console.log("b changed");
}, "sync");

json.a += 10;
json.a = "test";
json.b.d += "_blah";
const str = JSON.stringify(json);
console.log(str);

QueueManager.flushAll();
QueueManager.reap();