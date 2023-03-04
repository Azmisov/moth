import { performance } from "node:perf_hooks";

let tot = 0;
let m = new Map();
let mr = new Map();
let o = {};

function time(lbl, fn, samples = 10000){
	const s = performance.now();
	for (let i=0; i<samples; i++)
		fn();
	const e = performance.now();
	console.log(lbl, e-s);
}

time("map insert", () => {
	for (let i=0; i<100; i++)
		m.set(String(i), 1);
})
time("map ref insert", () => {
	for (let i=0; i<100; i++)
		mr.set(String(i), {c:1});
})
time("obj insert", () => {
	for (let i=0; i<100; i++)
		o[i] = 1;
})
time("map size", () => {
	tot += m.size
})
time("map ref size", () => {
	tot += mr.size
})
time("obj size", () => {
	tot += Object.entries(o).length;
})
time("map increment", () => {
	for (let i=0; i<100; i++){
		const s = String(i);
		m.set(s, m.get(s)+1);
	}
})
time("map ref increment", () => {
	for (let i=0; i<100; i++)
		mr.get(String(i)).c++;
})
time("obj increment", () => {
	for (let i=0; i<100; i++)
		o[i]++;
})