import { Reactive } from "../Reactive.mjs";

/** Wraps a `Map` object and notifies whenever any of its keys change */
export default class ReactiveMap extends Reactive{
	constructor(value){

	}
	assume(value){
		const wrapped = Object.create(value);
		const that = this;
		Object.defineProperties(wrapped, {
			set(k, v){
				value.set(k, v)
			},
			delete,
			clear:
		});

	}
}