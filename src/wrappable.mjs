/** Mixins for creating a wrappable object */

/** Unique keys for storing wrappable/wrapper data */
export const keys = {
	/** Config for a Wrapper class
	 * @see attach_config
	 */
	config: Symbol(),
	/** Wrappable interface definition
	 * @see wrappable
	 */
	wrappable: Symbol(),
	/** Index of overwritten properties */
	prop_index: Symbol(),
	/** Index of proxied properties */
	proxy_index: Symbol()
};

/** Configuration that defines an object as implementing the "wrappable" interface
 * @typedef {object} WrappableConfig
 * @property {?boolean} value flag indicates that the value should be used directly
 * @property {function} get used if `value` is falsey; getter accessor for the value; the function
 * 	will be bound to the wrapped value
 * @property {function} set used if `value` is falsey; setter accessor for the value; the function
 * 	will be bound to the wrapped value
 * @property {function} unwrap returns an object `{value}` or `{get,set}` which is used to restore
 * 	the original, unwrapped value; again, the function is bound to the wrapped value, and should
 * 	perform any logic necessary to detach the value
 * @see wrappable
 */

/** Mixin to add or overwrite the wrappable interface definition to an object. The definition is
 * stored as a unique unenumerable property on the object
 * @param {?WrappableConfig} config if not defined, it removes the wrappable definition
 */
export function wrappable(obj, config){
	// must delete from owning object
	if (!config){
		delete_property(prop.owner, keys.wrappable);
		return;
	}
	Object.defineProperty(obj, keys.wrappable, {
		configurable: true, // allow cleanup
		value: config
	});
}
export default wrappable;