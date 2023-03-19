import { ReactiveValue } from "../ReactiveValue.mjs";

/** Same as ReactiveValue, but checks the current value for strict equality before setting */
export class ReactiveCache extends ReactiveValue{
	get value(){
		return this._value;
	}
	set value(value){
		if (value !== this._value){
			this._value = value;
			this.notify();
		}
	}
}
export default ReactiveCache;