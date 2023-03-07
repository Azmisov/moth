# Moth Reactive Library

The programming pattern comes in many forms, all slightly different: reactivity, dependency
injection, listeners, signals, observables, or pub/sub. This library uses the concept of a
*subscriber*. You subscribe to a variable with a callback function. Every time the variable
changes, the callback will be called to notify of that change.

The most basic example:
```js
const r = new ReactiveValue("Hello");
// respond to changes of r's value
r.subscribe(() => {
	console.log("Changed:", r.value);
});
r.value += " world!";
```
How you *react* to the data change is up to you. You could have the subscriber transform, sanitize,
serialize, transmit, or store the data. If running in a web browser, you might update a template
or DOM.

Subscriptions are many-to-many. Here a callback subscribes to two values:
```js
function sum(){
	console.log("Sum:", ra.value + rb.value);
}
ra.subscribe(sum);
rb.subscribe(sum);
```
A subscriber can modify reactive values itself, or even do so recursively:
```js
function clamp(){
  if (r.value > 10)
    r.value = 10;
}
r.subscribe(clamp);
r.value = 25;
```

## Wrappers

Limitations:
- Code can hold references to unwrapped variables, and modifications to those references will not
  be reactive.
- Top-level global or local variables in general cannot be wrapped. In some cases you could use
  `window` or `global` as the containing object, or you use a `ReactiveProxy` if you only care
  about deep variable changes.
- Own nonconfigurable properties cannot be wrapped without wrapping the containing object in an
  `ObjectWrapper`. The old object becomes the prototype of the wrapper, which can break code that
  relied on `prototype`, `getOwnPropertyDescriptor`, or similar.
- A wrapped property can be overridden manually either from `defineProperty` or a derived class.
  This messes with the wrapped value, and `wrap`/`unwrap` methods will not work as expected anymore.