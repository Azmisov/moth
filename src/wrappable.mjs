/** Mixins for creating a wrappable object
 * @module wrappable
 */

/** Unique keys for storing wrappable/wrapper data. These can be used when creating a new wrapper
 * class. See source code
 * @protected
 */
export const keys = {
	/** Config for a Wrapper class
	 * @see attach_config
	 */
	config: Symbol("wrapper_config"),
	/** Wrappable interface definition
	 * @see wrappable
	 */
	wrappable: Symbol("wrappable"),
	/** Index of overwritten properties */
	prop_index: Symbol("wrapper_prop_index"),
	/** Index of proxied properties */
	proxy_index: Symbol("wrapper_proxy_index")
};

/** Configuration that defines an object as implementing the "wrappable" interface
 * @typedef {object} WrappableConfig
 * @property {?boolean} value Flag indicating that the value should be used directly
 * @property {?(function | object)} accessor Must be present if `value` is falsey. A `{get,set}`
 *  object to be used as the accessor methods, or a function that returns such. If a function is
 *  given, it will be passed the wrapped value, which you could use to bind or fetch get/set methods
 *  from.
 * @property {function} unwrap A function that returns an object `{value}` or `{get,set}` which is
 *  used to restore the original, unwrapped value. The function is bound to the wrapped value, and
 *  should perform any logic necessary to detach the value.
 */

/** Mixin to add or overwrite the wrappable interface definition to an object. The definition is
 * stored as a unique unenumerable property on the object. Use it like so:
 * ```js
 * // apply to *all* instances
 * wrappable(MyClass.prototype, config);
 * // apply to a single instance
 * wrappable(instance, config);
 * // make "unwrappable" later, if needed
 * wrappable(obj);
 * ```
 * @function module:wrappable#wrappable
 * @param obj Object that you want to make wrappable
 * @param {?WrappableConfig} config Specifies how the type is wrapped. If not provided, the
 *	wrappable definition is removed from `obj`
 */
export function wrappable(obj, config){
	// while we could walk prototype chain and delete from owning object, I think it is safer not
	// to, and force user to be explicit about wanting to remove from prototype; e.g. they may think
	// that it is just making that instance unwrappable, but it really is making all instances such
	if (!config){
		delete obj[keys.wrappable];
		return;
	}
	Object.defineProperty(obj, keys.wrappable, {
		configurable: true, // allow cleanup
		value: config
	});
}
export default wrappable;