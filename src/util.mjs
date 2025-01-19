/** Coerces a value to be an integer, as described here:
 * https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number#integer_conversion
 * @private
 */
export function toInt(v){
	v = Math.trunc(+v);
	return isNaN(v) || v === -0 ? 0 : v;
}

/** Indexing conversion for many array methods */
export function toIndex(v, l){
	v = toInt(v);
	return v < 0 ? Math.max(0, v + l) : v;
}