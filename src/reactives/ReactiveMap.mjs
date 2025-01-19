import ReactiveWrapper from "./ReactiveWrapper.mjs";

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

/** {@link ReactiveWrapper~Custom} callback which only notifies subscribers if `delete()` mutates */
function _optimized_delete(opts, prop, unwrap){
	const that = this;
	const fn = prop.value;
	return {value: function(){
		const ret = fn.apply(this, arguments);
		if (ret) that.notify();
		return ret;
	}};
}

/** {@link ReactiveWrapper~Custom} callback which only notifies subscribers if `clear()` mutates */
function _optimized_clear(opts, prop, unwrap){
	const that = this;
	const fn = prop.value;
	return {value: function(){
		const s = this.size;
		const ret = fn.apply(this, arguments);
		if (s) that.notify();
		return ret;
	}};
}

/** Wraps a `Map` object and notifies whenever any of its keys change */
export class ReactiveMap extends ReactiveWrapper{
	/** Initialize the map wrapper
	 * @param {object} value Map or Map-like object to wrap
	 * @param {boolean} [optimized=true] Use optimized wrappers that don't notify if no-op. The
	 * 	builtin `Map` behavior is assumed, so potentially unsafe for subclassed or otherwise
	 * 	customized Map instances.
	 * @param {boolean} [override=false] assume properties could be overridden from the base Map
	 *  class, e.g. for a Map subclass; this causes descriptors to be rebuilt for each value to
	 *  ensure they use the proper base
	 */
	initDescriptors(value, optimized=true, override=false){
		const props = Array.from(base_props);
		if (optimized){
			props.push(
				{property:"delete", custom:_optimized_delete},
				{property:"clear", custom:_optimized_clear}
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