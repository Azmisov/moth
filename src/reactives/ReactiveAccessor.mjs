import Reactive from "../Reactive.mjs";
import wrappable from "../wrappable.mjs";

/** Wraps an accessor, with a getter and setter function. Access to the raw underlying value is
 * mediated by these functions. You can bind the getter/setter to an object ahead of time before
 * passing to the constructor. Alternatively, this class has been specially designed to allow
 * deferred binding for get, set, and assume methods. This allows transparent forwarding of the
 * binding to the getter/setter.
 * @extends Reactive
 */
export class ReactiveAccessor extends Reactive{
	/** Create a new {@link ReactiveAccessor}
	 * @param {function} getter Function that returns the current raw, underlying value
	 * @param {function} setter Function that is passed a new value and should update the raw
	 * 	underlying value to match it
	 */
	constructor(getter, setter){
		super();
		const that = this;
		const set = function(value){
			// small tweaks to allow deferred binding
			setter.call(this, value);
			that.notify();
		}
		Object.defineProperties(this, {
			// while we only *need* to override value accessor, the accessor is a pain to do
			// deferred binding on: it can only be accessed via getOwnPropertyDescriptor, and may
			// require traversing the prototype chain to find its owner
			get: {
				configurable: true,
				writable: true,
				value: getter
			},
			assume: {
				configurable: true,
				writable: true,
				value: setter
			},
			set: {
				configurable: true,
				writable: true,
				value: set
			},
			value: {
				configurable: true,
				get: getter,
				set: set
			},
			unwrap: {
				configurable: true,
				writable: true,
				value(){ return {get:getter, set:setter}; }
			},
		});
	}
}
wrappable(ReactiveAccessor.prototype, {
	// makes use of the deferred binding to forward to ctor's getter/setter
	accessor(value){
		return {
			get: value.get,
			set: value.set
		};
	},
	unwrap(){
		this.unsubscribe();
		return this.unwrap();
	}
});
export default ReactiveAccessor;