import { ReactiveProxyArray } from "../src/reactives/ReactiveProxyArray.mjs";

let count = 0;
const arr = [9,5,1,12,3,1];
const r = new ReactiveProxyArray(arr);
r.subscribe(() => count++, "sync");
const p = r.value;
p[1] = 3;
console.log(count);
