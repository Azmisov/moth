import { performance } from "node:perf_hooks";
import { ReactiveProxy } from "../src/moth.mjs";

const samples = 5;
const len = 1000;
function reactive(){
	let arr = new Array(len);
	const r = new ReactiveProxy(arr);
	// setup a subscriber
	let count = 0;
	r.subscribe(() => count++);
	// modify the array
	const s = performance.now();
	for (let i=0; i<samples; i++){
		while (arr.length)
			r.value.shift();
		while (arr.length < len)
			r.value.push(null);
	}
	const e = performance.now();
	return (e-s);
}
function nonreactive(){
	let arr = new Array(len);
	const s = performance.now();
	for (let i=0; i<samples; i++){
		while (arr.length)
			arr.shift();
		while (arr.length < len)
			arr.push(null);
	}
	const e = performance.now();
	return (e-s);
}

reactive();
nonreactive();
// after warmup
const r = reactive();
const n = nonreactive();
console.log(r, n, r/n);