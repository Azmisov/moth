This page documents the overall architecture and code layout for the library. This is mainly for
those interested in learning more about the internals, or contributing to the project.

## Philosophy

As there are quite a few reactive frontend frameworks by this point, I'll outline some of
the motivations for creating yet another.

To start, let me mention a few pet peeves I've had about other reactive frameworks which have shaped
the design philosophy for this framework. Note that some frameworks have evolved signficantly from
version to version, so my opinions may be outdated. I mention frameworks by name not to bash on
them, but as a reference point to relate to your own experiences.

- React:
  - The boilerplate required to route data can become a nuisance. Routing data up or sideways in
    the DOM tree is nontrivial. I feel Redux and other state management libraries were partially
	a reaction to the added complexity in needing to route state, and may not have been necessary
	given a different design.
  - The preference for all data to be immutable or copied. The design choice was likely a constraint
    due to the difficulties in detecting state changes on mutable structures. Some people really
	like the idea of immutable state, "safety" being one lauded attribute; it's also closer to a
	functional programming style, which seems to have grown in popularity. However, it hinders
	a lot of imperative and object-oriented design ideas. It's difficult to incorporate classes
	which encapsulate and manage mutable state. Ideally the reactive framework should not impose a
	particular programming style for its use.
- Svelte:
  - The dependency tracking for an effect is automatic, so you must be aware of implicit rules. This
    has definitely gotten better with runes, which have much less implicit logic. If the chain of
    reactive dependencies/effects is long or crosses multiple files, it starts to become difficult
	tracking where data is flowing. It is sort of the opposite of React: where React's data routing
	is too explicit, Svelte I find too implicit.
  - I found myself injecting Svelte reactivity into code that I felt should have been isolated from
    Svelte. If I wanted to make the user interface react to the output of a calculation or class
	member, I had to "corrupt" my calculation code with Svelte stores or runes for them to
	communicate with the UI. To be fair, this is the same story for many frameworks (e.g.
	SolidJS, RxJS).
  - When code had many reactive dependencies, it was unclear when it would run and how often it
    would run. I wished there were stronger guarantees about reactive execution.
- RxJS:
  - In some ways, I like the idea of a data transformation pipeline, transforming a signal all the
    way to render. However RxJS doubles down on the functional programming style, and provides a
	large API of custom operators and transformations. There's a bigger learning curve in memorizing
	the API; its complex enough that they have an interactive decision tree for picking out which
	API is appropriate in their documentation. You almost have to commit to using RxJS for
	everything. As someone who only uses functional programming techniques for a minority of my
	code, it's too opinionated for my taste.

Another more mild complaint is the fact that every framework has its own syntax for making HTML
templates. JSX is common, but each framework customizes it in minor ways. The conversion from
template to rendering logic is implicit, and so can be trickier to optimize performance when needed.

### Survey of existing frameworks

- *Value which notifies dependents when it changes*: state, hook, ref, signal, rune, observable,
reactive, computed, cell
- *Function which runs when a dependency changes*: effect, observer, subscriber, watch
- *Function which transforms a reactive value*: derived, computed, operator, memo

When reactive values get modified recursively, a lot of people call this a "side effect".

**React**:

- *Hook* is a reactive type. React only provides one low level type, the rest are high level
  design patterns. The "hook" name is not used in the API, just documentation.
- API design is to return tuple `[value, updater]`; functions are named `useX`
- reactive update infrastructure is all transpiled; e.g. references to a hook implicitly are reactive
- updates are double buffered and update on the next tick
- input hooks (output is reactive):
  - *state* type is the basic reactive type that holds a single value that can be replaced
  - *reducer* type is the same as *state*, but every time the value is changed it is sent through
    a reducer/transformation function first
- transforming hooks (input and output is reactive):
  - *context* type is essentially a full UI component that manages and broadcasts a state
  - *memo* caches a calculation
- output hooks (input is reactive):
  - *ref* type is mainly used to reference a template's DOM node; it is reactive with the template,
    but the ref value itself doesn't trigger further reactivity downstream, like a state hook; you can
    also store plain JS primitives in a ref, which is only necessary because of some limitations in
    how React components can use variables; in vanilla JS you'd just use a plain closure variable
  - *effect* type takes N dependencies and runs a function when they change; can return a cleanup
    function to run when the values change; API is `useEffect(transform, [dependencies, ...])`

**Vue**:

- *Ref* is probably the primary name for a reactive value
- updates happen at end of tick, except for watch/watchEffect, which you can specially indicate they
  should run synchronously whenever a ref changes
- *ref* holds primitive state; API design is to return an object whose value can be updated via `ref.value += 5`
- *computed* wraps a getter/setter
- *reactive* wraps an object as a Proxy; by default deeply reactive, created on the fly when an
  attribute is accessed; there is an option for shallow reactive as well; it notifies when any of
  its
- *watch*: run function when reactive values change; API is `watch([dependences...], fn([cur_vals...], [prev_vals...], cleanup_cbk))`;
  it returns stop/pause/resume functions
- *watchEffect*: run function immediately and tracks which reactive values were accessed; reruns
  whenever the accessed variables change; can't track dependencies reliably when effect is async

**Solid**:

- *Signal* is the reactive type
- API design is to return tuple `[getter, setter]`; functions are named `createX`
- updates happen synchronously by default; async can be enabled which runs on each tick
- input signals:
  - *signal* makes a signal
- transforming signals:
  - *memo* same as `createEffect` but outputs a signal that can be used downstream
  - *resource* when a source signal changes, it runs a function; optimized API for "resources",
    so has reactive attributes like "loading", "error", etc
- output signals (input is reactive):
  - *effect* tracks dependencies synchronously and reruns when they change; can't track through
    async code

**Svelte**:

- *Rune* is the reactive type
- functions are named `$X`
- $ prefix on a variable indicates implicilty marks it reactive;
- *state* is reactive array, object, or primitive; there are special objects for Set/Map etc you
  can use if you want deep reactivity for those;  it uses Proxy for this, but the original object
  is not mutated, so they're doing something differently
  - `state.raw` forces shallow reactive
  - `state.snapshot` deproxies a state variable
- state is passed by value, unreactive
- *derived* computes a value from expression or function; the input is reactive, but output is not
- *effect* runs function when dependencies change in microtask; autodetects
- *props* are passed from parent components to children
- *bindable* are passed from child components to parents

**Angular**:

- *Signal* is the reactive type
- functions are named `X`
- *signal* is basic type; API is to call set or update to modify; to access, call as function
- *computed* is a derived value; it autodetects accessed dependencies; call `untracked(val)` to
  force a value to be non-tracked
- *effect* is same as *computed* but doesn't output a value

**RxJS**:

- *Observable* provides a stream of data, like a topic, subscription, listener, or queue. It is
  reactive in a loose sense
- *Observer* or *Subsriber* listens to an observable. In RxJS, *subscriber* is distinguished as
  the thing that manages subscribing/unsubscribing, whereas the *observer* is
  the function(s) that consume the values.
- *Operator* transforms the stream
- API is very pandas-like

**Lit**:

- *Reactive property* is the reactive types
- Uses `@property` decorator to mark a class member as reactive; this replaces with accessor.
  Reactive properties are only usable in a component
- Can be used with vanilla JS
- State is treated as immutable; it uses !== to trigger updates (or an overridden `hasChanged`)
- component is updated async whenever its reactives change

**TC39 Signals Proposal**:

- *Signal* is the reactive type, sometimes called a *cell*
- implemented as class; uses `get` and `set` method calls to fetch value
- *watcher* is notified when a signal changes; this is in charge of async scheduling, etc; it
  is like a plain function subscriber
- *computed* is a signal which automatically tracks sync dependencies as it runs
- proposal has a bunch of internal implementation details it forces on the user


### Goal: Separate reactivity from state

The idea here is to implement a kind of <em>dependency injection</em> for reactivity. A subscriber
marks what state it depends on, and the framework magically takes care of routing changes to the
subscriber. You write your state using plain, unreactive Javascript, and the framework injects all
the logic behind-the-scenes to make dependent state variables reactive.

A theoretical implementation might look like:

```js
const state = {items: []}
// subscribe to state changes
subscribe(state.items, console.log)
// mutate state
state.items.push("Hello world!")
```

The actual implementation might need additional annotations to control behavior, but we can try
to get close to this. This advantages being:

- Routing state is mostly abstracted away
- Any variable can be treated as reactive or unreactive without additional logic or special types
- Rendering logic remains separate from data processing logic
- State doesn't need to know details about its dependencies

Since dependency injection in some ways makes dependencies more implicit, another goal is to
build a development tool to visualize the dependency graph and other tools like seeing: how many
reactive values are live, number of subscribers being notified per tick, subscribers per clock tick
type.

### Goal: Strong notification guarantees

- Precisely define when subscribers will be notified. Provide interfaces to guarantee program
  state (e.g. flush notifications to guarantee all reactive dependencies are updated).
- Guarantee subscribers are only notified once when a value changes
- Guarantee subscribers are only notified when subscribed

### Goal: First-class JavaScript interface

Design an interface that is clean and easy to write from vanilla JavaScript. Avoid creating a
custom superset of JavaScript or another template syntax if possible. Those could be implemented
later as extra transpiled syntactic sugar for the vanilla interface.

One of the goals is to encourage an ecosystem of customization. Instead of relying on a single,
builtin template implementation, users can contribute different ways of rendering data, new
template methods, etc.

## Design

```js
const state = {...}
effect({
	name: "test",
	schedule: clock.timeout(1000), // clock.microtask
	queue: queue.default
	watch: [[var, ["a","b","c"]]]
}, function test(){
	...
})
// defaults to ReactiveValue
const state = computed({...}, () => {})

```

**Naming:**
- *reactive* for a reactive value
- *computed* for a value derived from a callback
- *effect* for a plain callback

- Use Object.is for assume

## Reactive

A {@link Reactive} is conceptually similar to a signal or observable. A Reactive wraps a single
JavaScript value. It provides various methods to manipulate that value and then notify a list of
subscribers of that change. I've chosen the name "Reactive" as an adjective to describe different
concrete, reactive types such as {@link ReactiveAccessor} or {@link ReactiveMap}. Existing
frameworks for essentially the same concept: state, hook, ref, signal, rune, observable,
reactive, computed, cell. They all clarify in their documentation that it is a *reactive value* so
it makes more sense to just call it "reactive."

The subscribers are not stored directly, instead {@link Link} objects. Synchronous and asynchronous
subscribers need to be handled differently, so are stored in separate lists. Notifying async
subscribers is delegated to {@link Queue}. The sync notification logic is slightly more complicated.
We want to guarantee subscribers are only notified once, which becomes tricky when there are
recursive reactive updates being notified synchronously. A dirty flag is used on each {@link Link}
to track whether the subscriber has been notified of a value update and to avoid double calls.

In implementing the Reactive classes, one main assumption is that reactive values and subscriptions
will be setup once, but there values manipulated many times. So its okay for initialization to be
cleaner, easier on users, and powerful at the expense of additional overhead, as long as the
reactive modifications and notifications remain fast.

There are various Reactive subclasses which customize how the value is wrapped, or when subscribers
are notified:

<table>
	<tr>
		<th>{@link ReactiveValue}</th>
		<td>
			Stores an internal, private value which <code>[[Get]]</code> and <code>[[Set]]</code> manipulate. This is
			the simplest subclass type.
		</td>
	</tr>
	<tr>
		<th>{@link ReactiveCache}</th>
		<td>
			Checks that the new value is strictly unequal to its old before setting the value.
			This can avoid spurious notifications to subscribers when the value is not changing.
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
			Stores a user-supplied <code>[[Set]]</code> and <code>[[Get]]</code> accessor. The Reactive
			will call these to manipulate and retrieve the underlying value. One can use <code>getOwnPropertyDescriptor</code>
			or similar to get the accessor for an object. The only tricky part of this implementation
			is allowing the accessor to have deferred binding. You can pass in <code>[[Set]]</code>
			and <code>[[Get]]</code> pre-bound to an object, or deferred, meaning you bind them to an
			object sometime after the Reactive has been created. TODO: What exactly is it doing
			to do this?
		</td>
	</tr>
	<tr>
		<th>{@link ReactiveProxy}</th>
		<td>
			<p>Wraps its value as a <a href='https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy/'>Proxy</a>.
			This subclass notifies subscribers if any of the value's <em>properties</em> are modified.
			The Proxy is very powerful and allows us to transparently hook into property access you
			normally couldn't in JavaScript, for example notifying subscribers when a Set, Map, or
			Array's elements are modified.</p>
			<p>The subclass also supports deep reactivity. Nested values are wrapped as proxies
			on the fly, as they are accessed; so there is some overhead. It was decided that pre-creating
			deep proxies on construction would be ill defined (should all properties be wrapped?) and
			too complex to be worth it. Additionally, if references of nested members have already
			been stored elsewhere, it is impossible to retroactively replace these with proxied
			versions.</p>
			<p>Native objects like Array need special handling when proxying, which is perhaps the
			only tricky part of the implementation. <em>TODO: explain why the code is that way. If
			I recall, a native operation like Map.set fails when it is bound to the proxy. So for
			native we ensure the `[[Get]]` returns values and functions that are not bound to the
			proxy, but rather the original unwrapped value. Does this mean native doesn't support
			deep reactivity?</em></p>
		</td>
	</tr>
	<tr>
		<th>{@link ReactiveProxyArray}</th>
		<td>
			<p>A subclass of {@link ReactiveProxy} optimized for notifying of shallow updates to
			an Array. A degradation with ReactiveProxy is the builtin mutating functions like splice
			end up calling `[[Set]]` many times, rather than just once for the call. For the
			optimized array proxy, we leave `[[Set]]` the same, which notifies when individual array
			elements are replaced. However, all the mutating Array methods we replace with unproxied
			wrappers which notify just once after the call is complete. Additionally, there is
			the option to do extra checks to see if the call actually made any changes to the array
			before notifying, similar to {@link ReactiveCache}</p>
			<p>As Array is a native object, it uses the same special native handling as ReactiveProxy</p>
		</td>
	<tr>
		<th>{@link ReactiveWrapper}</th>
		<td>
			<p>The ReactiveWrapper is conceptually similar to {@link ReactiveProxy}. Instead of wrapping the
			value as a Proxy, it wraps as an Object. The object's prototype is set to the original
			value, and properties are overridden with versions that notify subscribers. Unlike a
			Proxy, only the properties needed to implement reactivity are overridden.</p>
			<p>You can wrap properties on the reactive value itself, or elswhere like a class
			prototype function. The {@link RootsList} helper class implements searching these
			various <em>roots</em> for the property that will be wrapped. The <code>"value"</code>
			keyword is used as a placeholder for the reactive value. When the property can be
			determined ahead of time, we can build the reactive property descriptor wrapper
			immediately. Otherwise, we need to search on the reactive value and build the
			descriptor on the fly, whenever its value is replaced.</p>
			<p>The <code>generic_wrapper</code> function provides a good default implementation
			for wrapping a property to make it reactive. But you can pass in a custom function
			for any property to build your own wrapper.</p>
		</td>
	</tr>
	<tr>
		<th>{@link ReactiveMap}</th>
		<td>A subclass of {@link ReactiveWrapper} which configures wrapped properties for a Map.</td>
	</tr>
</table>

<p>All the previously listed subclasses require the value to be manipulated through the
Reactive object for notifications to work. You have to either call methods like
{@link Reactive#set} or use the <code>[[Set]]</code> accessor on {@link Reactive#value}. For the
reactivity to be truly transparent, we'd like to be able to do things like <code>value += 10</code>
instead of <code>reactive.value += 10</code>. In general vanilla JavaScript does not have any
language mechanism to do this. However, it is possible when the value is a property of
a container object. The {@link ReactiveWrapper} subclass replaces an object's properties
in-place with ones that forward manipulation to a private Reactive.</p>


## Subscriber

For v1.0, I made subscribers be very flexible. Each dependency of a subscriber could be scheduled on
a different queue. You could also manually specify a queue to place the subscriber on. I think I
will change this to just allow a single queue per subscriber. 99% of cases, the subscriber
notification guarantees will remain constant. E.g. DOM manipulation will always stay on
the `animation` queue; I can't think of cases off the top of my head where they wouldn't belong
to the same queue.


## Wrapper

The idea is to replace the properties of an object with an accessor backed by a {@link Reactive}
type. There are a bunch of ways to do this, so we allow you to define default replacement behavior
for an object/type. This is stored under the `keys.config` Symbol on the object/type; when we see
that object/type we can look up its config directly on the object. The {@link attach_config}
function will attach a config to an object. The format for the config is like so:

```js
{
	wrappers: {property: wrappable},
	default_wrapper: wrappable
}
```

If `wrappable` is false, it explicitly disables wrapping that property, or disabling wrapping
by default. Otherwise, the global fallback is the {@link autoreactive} wrappable function.

What is a `wrappable`? It is something that implements the "wrappable" interface. This means it
has a `keys.wrappable` Symbol on the object/type, with value matching {@link WrappableConfig}.
The {@link wrap_property} function supports the following wrappable types:
- a wrappable interface value (foo)
- a value with a wrappable interface, constructable prototype (e.g. new Foo())
- a function that returns a wrappabe interface value
So technically `wrappable` can be any of those three. The naming is a bit of a mess right now.

{@link ObjectWrapper} constructor creates an object whose prototype is the value. If called
as `ObjectWrapper(...)` without `new` it also adds a wrappable configuration. E.g. if you want
to wrap a class to make a reactive version of it, e.g. `ReactiveFoo = ObjectWrapper(Foo)`.


ObjectWrapper stores an index of wrapped properties in a Symbol key. The private Symbol key
comes from `wrapper.mjs/.keys`. The property config follows the format:

```js
{
	value,
	unwrap,
	property
}
```

## Queue

There are various ways to trigger an async task to run. I will call these clock ticks. Here I list
the timing results in NodeJS and Firefox (2025-01-18). Tasks in a list item are completely drained
before the next list item can be run. Within a list item, the frequency of execution is shown:

Node *(unsupported: animation, idle)*:
- sync
- microtask = promise
- tick
- message > immediate = timeout > timeout(N)

Firefox *(unsupported: tick, immediate)*:
- sync
- microtask = promise
- message > animation ≈ idle > idle(N) > timeout > timeout(N)

The `idle(N)` case is perhaps the only odd one. I wasn't able to simulate the browser never being
idle, but theoretically if it were the idle(N) should have fired where idle was not. So I would
treat `idle(N)` as higher frequency even though the timings don't show it.

A few of these have been used historically, but aren't very useful anymore. The useful are sync,
microtask, animation, idle, and timeout... still quite a few options for scheduling.

To handle recursive reactivity, my idea is to give each clock tick a priority and trigger flushes
for all notifications <= the current clock tick's priority. For example, if you have an animation
effect that has microtask side effects, the idea is to run the microtasks during the animation tick.
Based on timing results, I'm defining the priorities as:

1. sync
2. microtask
3. promise
4. tick
5. message

The remaining clock ticks depend on some nondeterministic timeout, so those we treat as separate
streams:

**Animation:**

7. animation

**Idle:**

7. idle(N)
8. idle

The `idle(N)` case is special since it can contain 1+ entries for unique values of N. In this case
the plain `idle` can be thought of the case where N = infinity.

**Timing:**

7. immediate
8. timeout
9. timeout(N)

The `timeout(N)` case is special since it can contain 1+ entries for unique values of N.

---

The flushing rules can now be stated very simply:

> To flush tick of priority X, all ticks with priority < X must be flushed and empty

For example, to flush the `tick` queue, we must do the equivalent of:

```js
let ticks = [microtask, promise, tick]
for (let i=0; i<ticks.length;) {
	// ensure all higher priority ticks are flushed
	for (let j=0; j<i; j++) {
		if (!ticks[j].empty()){
			i = j;
			continue;
		}
	}
	// flush tick
	ticks[i].flush()
	i++;
}
```

When will a subsriber/effect be notified of a change?

> If a tick with higher priority (<=) is currently flushing, or scheduled to flush, it will be
  notified with that tick. Otherwise, a new tick is scheduled to notify.

This means that recursive `animation` effects will run during the current animation frame, rather
than the next. It also means `microtask` or `timout(500)` effects may run before their next clock
tick. This allows recursive side-effects of differing clock tick priorities to complete in a single
tick, rather than being spread out across many. In addition to efficiency, it prevents from having
janky, half-updated user interfaces due to staggered updates across multiple animation frames.

I want to add the ability to make separate queues which can be paused/resumed. Paired with the
enforcement of one queue per subscriber, this means a queue can encapsulate all the values in a
graph and pause/resume that graph. The clock tick and flushing logic should still be global, so
perhaps we can have a *Scheduler* class and a *Queue* class. Scheduler manages scheduling clock
ticks, and flushing the appropriate unpaused queues.

In v1.0 I had a feature to forcibly flush a queue after some deadline has been reached. This was
just enabled for animation, but I considered adding it to all the others too. However, considering
the timing test results, the only case this would ever be needed is for animation and idle; idle
already supports it natively. And now that I think of it I don't think enabling it for animation
is actually that useful.

