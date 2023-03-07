import ReactivePropertyWrapper from "./ReactivePropertyWrapper.mjs";

function notify_size_change(unwrap, that, prop){
	const fn = prop.value;
	return {value: function(){
		const s = this.size;
		const ret = fn.apply(this, arguments);
		if (s !== this.size) that.notify();
		return ret;
	}};
}
const custom = {
	delete: notify_size_change,
	clear: notify_size_change
};

/** Wraps a `Map` object and notifies whenever any of its keys change */
export class ReactiveMap extends ReactivePropertyWrapper{
	/** Initialize the map wrapper
	 * @param {object} value Map or Map-like object to wrap
	 * @param {boolean} [optimized=true] use optimized wrappers that don't notify if no-op
	 * @param {boolean} [override=false] assume properties could be overridden from the base Map
	 *  class, e.g. for a Map-like or a Map subclass; this causes descriptors to be rebuilt for each
	 *  value to ensure they use the proper base
	 */
	init_descriptors(value, optimized=true, override=false){
		this._optimized = optimized;
		super.init_descriptors(value, {
			generic: optimized ? ["set"] : ["set","delete","clear"],
			roots: [override ? null : Map.prototype]
		});
	}
	build_descriptors(descs, unwrap, roots){
		if (this._optimized)
			ReactivePropertyWrapper.simple_customize(descs, unwrap, roots, custom);
		super.build_descriptors(descs, unwrap, roots);
	}
}
export default ReactiveMap;