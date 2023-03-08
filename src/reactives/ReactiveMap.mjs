import ReactiveWrapper from "./ReactiveWrapper.mjs";

function notify_size_change(opts, prop, unwrap){
	const that = this;
	const fn = prop.value;
	return {value: function(){
		const s = this.size;
		const ret = fn.apply(this, arguments);
		if (s !== this.size) that.notify();
		return ret;
	}};
}

const base_props = [
	"set",
	{property:"size", type:"accessor", notify:false},
	// final arg needs to be the wrapper object for safety
	{property:"forEach", roots:false, custom(opts, prop, unwrap){
		const that = this;
		return {
			configurable: true,
			writable: true,
			value: function(cbk, thisArg){
				for (const [k,v] of this)
					cbk.call(thisArg, k, v, that._value);
			}
		};
	}}
];
for (const property of ["get","has","keys","values","entries",Symbol.iterator])
	base_props.push({property, notify:false});

/** Wraps a `Map` object and notifies whenever any of its keys change */
export class ReactiveMap extends ReactiveWrapper{
	/** Initialize the map wrapper
	 * @param {object} value Map or Map-like object to wrap
	 * @param {boolean} [optimized=true] use optimized wrappers that don't notify if no-op
	 * @param {boolean} [override=false] assume properties could be overridden from the base Map
	 *  class, e.g. for a Map subclass; this causes descriptors to be rebuilt for each value to
	 *  ensure they use the proper base
	 */
	initDescriptors(value, optimized=true, override=false){
		const props = Array.from(base_props);
		if (optimized){
			props.push(
				{property:"delete", custom:notify_size_change},
				{property:"clear", custom:notify_size_change}
			);
		}
		else props.push("delete", "clear");
		super.initDescriptors(value, props, {
			type: "method",
			bind_value: true,
			roots: [override ? "value" : Map.prototype]
		});
	}
}
export default ReactiveMap;