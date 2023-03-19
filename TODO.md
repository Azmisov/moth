- Proxy Wrapper
- Wrapper ported to work for proxy and prototype (see map_proto.mjs)


- wrapper interface
	- proxy wrapper
- mass subscribe
- temporary queue mode override when setting a value
- derived
	- lazy derived
- interface with Svelte
- allow deadline logic for queues besides idle
- maybe non-recursive versions of microtask/tick/promise? in that same vein, I'm thinking recursive
	versions of all queues should be available, e.g. what if you have a chain of animation frame
	reactivity, shouldn't they all run in the same loop?

- priority queue
- priority queue with dependency graph analysis
- compiler for statically known dependency 
- some kind of pausable queue or subgraph? E.g. use case is where we want to temporarily pause
	some updates while mouse is dragging, and as soon as its released, update

wrapMany syntax: ObjectWrapper.wrap(obj, [props]) -> {prop: reactive, ...}

Garbage collection problem: I have a list of objects, all subscribing to a central store. If
one of the objects is removed from the list, it will get garbage collected, but it won't
automatically unsubscribe. In fact, the subscription may prevent GC, e.g. the subscription
function holds a reference to the object. How to fix this? Maybe you could have the fn be a weakref,
and save the fn as a prop on the object; subscriber doesn't hold a reference to it, and when object
gets GC'ed, the fn gets taken with.