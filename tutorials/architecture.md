## Architecture

This page documents the overall architecture and code layout for the library. This is mainly for
those interested in learning more about the internals, or contributing to the project.

### Reactive

A Reactive wraps a single JavaScript value. It provides various methods to manipulate that value and
then notify a list of subscribers of that change. The subscribers are not stored directly, instead
{@link Link} objects. Synchronous and asynchronous subscribers need to be handled differently, so
are stored in separate lists. , while sync
subscribers will be notified immediately.

Notifying async subscribers is delegated to {@link Queue}. The sync notification logic is slightly
more complicated. We want to guarantee subscribers are only notified once, which becomes tricky when
there are recursive reactive updates being notified synchronously. A dirty flag is used on each
{@link Link} to track whether the subscriber has been notified of a value update and to avoid double
calls. 

There are various Reactive subclasses which customize how the value is wrapped, or when subscribers
are notified. The base {@link Reactive} class stores its value as a member, and all access and
manipulation of that value occur through class methods. All the builtin subclasses additionally
provide `[[Get]]` and `[[Set]]` accessors to be able to manipulate the value more transparently.
For example:

```js
let r = ReactiveValue("Hello")
r.value += " world!" // notifies subscribers!
```

<table>
	<tr>
		<th>{@link ReactiveValue}</th>
		<td>
			Stores an internal, private value which `[[Get]]` and `[[Set]]` manipulate. This is
			the simplest subclass type.
		</td>
	</tr>
	<tr>
		<th>{@link ReactivePointer}</th>
		<td>
			Stores an object and property pair. Modifications to the reactive value will point to
			that object's property.
		</td>
	</tr>
	<tr>
		<th>{@link ReactiveAccessor}</th>
		<td>
			Stores a user-supplied `[[Set]]` and `[[Get]]` accessor. The Reactive will call these
			to manipulate and retrieve the underlying value. One can use `getOwnPropertyDescriptor`
			or similar to get the accessor for an object.
		</td>
	</tr>
	<tr>
		<th>
</table>

### Subscriber

A Subscriber holds a callback function, and a set of reactive dependencies. When </td> </tr>
			<tr> <th>Queue</th> <td>test</td> </tr>
</table>