In some cases, you want to be notified of *deep* changes to an object. For example, changes to an object's properties,
nested JSON, or maybe the elements of an array.

### Using class methods

A traditional way of doing so might be to create a new class type to encapsulate the data. Then, only manipulate the
data using methods that trigger a notify call. In many cases, this can be a great object-oriented approach. As a small
example:

```js
class Greeting{
	constructor(){
		this.changed = new ReactiveValue();
		this._name = "Anonymous";
		this._planet = "world";
	}
	set name(value){
		this._name = value;
		this.changed.notify();
	}
	set planet(value){
		this._planet = value;
		this.changed.notify();
	}	
	toString(){
		return `Dear ${this.name}, Hello ${this.message}!`;
	}
}
```
We store a single {@link ReactiveValue} to encapsulate all changes to the object. Each of the methods (in this case, the
settors of some accessor properties), calls its {@link Reactive#notify} method.

### Using ReactiveProxy

The {@link ReactiveProxy} class provides a quick alternative to listen to shallow or deep changes within an object. It
wraps the object in a [Proxy](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy/Proxy)
object, a somewhat newer JavaScript feature that has good browser support. Any `[[Set]]` operation will trigger
notification.

Shallow reactivity:
```js
const data = {counter:0, message:"Hello"};
const r = new ReactiveProxy(data);
r.value.counter++;
r.value.message += " world!";
```

Deep reactivity:
```js
const data = {child:{counter:0}};
const r = new ReactiveProxy(data, true);
r.value.child.counter++;
```

While powerful, there are some things you need to be careful of:

When you fetch {@link ReactiveProxy#value}, a proxied version of the raw value is returned.
Modifying old references to the non-proxied raw value will *not* notify subscribers:
```js
const data = {counter:0};
const r = new ReactiveProxy(data);
// data is not proxied so doesn't trigger notifications
data.counter++;
```

You can store references to {@link ReactiveProxy#value} and they will be bound to the reactive object. Deep proxies are
recreated each time they are fetched (via `[[Get]]`), so it can even help to store references in this case. However, be
aware that primitive types *don't* return a proxy. Primitives must be modified in-place:
```js
const data = {child:{counter:0}};
const r = new ReactiveProxy(data, true);
// this is reactive
const child = r.value.child;
child.counter++;
// but this is not
let counter = r.value.child.counter;
counter++;
``` 

References to the proxy will continue to be reactive for the lifetime of the variable. In the event you want to
"deproxy" the value to detach it from the reactive wrapper, there is a method {@link ReactiveProxy.deproxy} which does
just that.
```js
const data = {child:{counter:0}};
const r = new ReactiveProxy(data, true);
// this is reactive
const child_proxy = r.value.child;
// but this is not
const child_raw = ReactiveProxy.deproxy(child_proxy);
```

### Working with native types
You can use {@link ReactiveProxy} to wrap special native types like `Array`:
```js
const arr = [1,2,3,5,7,11,13];
const r = new ReactiveProxy(arr);
// all these operations are reactive!
r.value[5] = 17;
r.value.splice(3,2);
r.value.length = 4;
r.value.unshift();
```

This makes it quick and easy to react to array changes, without needing to create a wrapper or manually indicate
array changes. Be aware that certain array methods can cause ``[[Set]]`` to be called many times. As a demonstration:
```js
const arr = [1,2,3,5,7,11,13];
const r = new ReactiveProxy(arr);
// setup a subscriber
let count = 0;
r.subscribe(() => count++, "sync");
// modify
arr.unshift();
console.log(count); // 7
```
We are notified 7 times for the single `unshfit` call! This is because the array shifts each of the elements down, `[1]`
to `[0]`, `[2]` to `[1]`, etc and finally updates the length of the array. Each of these changes calls ``[[Set]]``,
which triggers a notification.

If we use an asynchronous queue, as is the default...
```
r.subscribe(() => count++);
```
...we'll only be notified once. Async subscriptions are batched, so many modifications in the same code segment only
trigger one notification. Additionally, the {@link Reactive} class is optimized for this particular scenario, so
can detect if a notification has been queued already and perform minimal work.

That said, there is still non-negligible overhead in using a `Proxy`, and it can add up quickly. While methods like
`pop` and `push` are efficient with only one ``[[Set]]`` call, the O(n) operations like `shift` and `splice` become
noticeably slower at 1000 elements, and unbearably slow at 10k elements! Suffice it to say, using {@link ReactiveProxy}
for arrays is only recommended for smaller lengths.

### Using ReactiveProxyArray
Given the slowness in using the generic {@link ReactiveProxy} for arrays, as illustrated in the previous section, there
is another proxy type available optimized specifically for Array-like objects: {@link ReactiveProxyArray}. This class
wraps the mutating array methods, like `push` or `shift`, and calls {@link Reactive#notify} at the end of each. Recall
the similarity to the [class method](using-class-methods) approach mentioned earlier. These functions are called on
the raw array target rather than the Proxy, so don't suffer the slowness of many, repeated calls to ``[[Set]]``.

```js
const arr = new Array(10000);
const r = new ReactiveProxyArray(arr);
// much faster now!
const r_arr = r.value;
while (r_arr.length)
	r_arr.shift();
// property access is still reactive like before
r_arr[2] = "Hello world";
r_arr.length = 20;
```
