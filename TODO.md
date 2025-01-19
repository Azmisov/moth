- Come up with an end result API to target
- New queue which is tick based
- Development tools:
  - Dependency graph: The issue with dependency injection is it makes it more implicit, so this
    would track the reactives and their subscribers in a graph that can be visualized. It can show
    the frequency of notifications, what's occupying the most time (possible?), dead subscribers
    (one's that never get called), subscribers whose value is always overwritten (e.g. deep
    reactive not needed). I was thinking you can pass a Context object in the notification chain
    to trace the graph, without needing to do AOT code analysis to determine what modifications
    a subscriber triggers recursively
  - Visualize clock ticks somehow
  - Vite/rollup integration


- ReactiveWrapper:
  - Less common case, but you could have [foo, bar, "value"]. We can check if [foo, bar] contain
    the property ahead of time; if not trim to just ["value"]. In fact, we could check
	  ["value", foo, bar] as well, and trim off whichever roots don't have the property. You can
	  divide any root list into fixed_prefix + dynamic_value + fixed_suffix. Fixed_prefix we want
	  to precompute and then they can be ignored afterwards. In assume() we'd search dynamic_value
	  first for all remaining properties. For remaining properties not found, search fixed_suffix;
	  you can cache the fixed_suffix results for faster searching later.
  - Rename this to ReactiveProperties or something like that. Naming too similar to ObjectWrapper
    stuff. Or else we can rename ObjectWrapper to something else
- ReactiveMap:
  - Is this faster than ReactiveProxy? What are the advantages? Which should users choose? Need
    to benchmark and then document recommendations.
- Mass subscribe. E.g. maybe someway to annotate a subscriber function with the list of Reactives
  it will depend on. And it subscribes to all from there
  - Proxy Wrapper
- Allow deadline logic for queues besides idle
- Maybe non-recursive versions of microtask/tick/promise? in that same vein, I'm thinking recursive
  versions of all queues should be available, e.g. what if you have a chain of animation frame
  reactivity, shouldn't they all run in the same loop? The main case is chained/recursive
  notifications. What to do if you have a chain of N notifications all going through an animation
  queue, or a mix of them? Do they run on separate animation frames? Maybe we define an ordering for
  queues: e.g. microtask > tick > promise > animation. When the promise queue flushes, we do not
  move on until all notifications >= promise are flushed (e.g. microtask + tick + promise). So
  maybe instead we have just a single queue, but different periodic "clocks" which flush that
  single queue. You may rarely want a notification to run on the next tick of a clock, rather than
  the current
- Priority queue:
  - Queue.iterate() theoretically can be implemented as a priority queue, rather than FIFO
  - Dependency graph analysis. Like visualizing the rendering loop and showing priorities of each
    path? Not sure what else I was thinking here
  - I'm wondering how useful this would actually be, and in what scenarios it would benefit
    significantly to do priority queueing. I imagine it would be more when you have heavy workloads,
	in conjunction with WebWorkers or something as subscriber callbacks. Should probably come up
	with use cases before implementing, as I can't think of cases regular UI development would
	really need this. E.g. UI all subscription handlers should complete by the next render frame,
	so it doesn't really matter which handlers ran first vs last.
- Compiler for statically known dependencies. Would need a small experiment first to demonstrate
  common use cases that would result in large speedup from this.
- Some kind of pausable queue or subgraph? E.g. use case is where we want to temporarily pause
  some updates while mouse is dragging, and as soon as its released, update

wrapMany syntax: ObjectWrapper.wrap(obj, [props]) -> {prop: reactive, ...}

Garbage collection problem: I have a list of objects, all subscribing to a central store. If
one of the objects is removed from the list, it will get garbage collected, but it won't
automatically unsubscribe. In fact, the subscription may prevent GC, e.g. the subscription
function holds a reference to the object. How to fix this? Maybe you could have the fn be a weakref,
and save the fn as a prop on the object; subscriber doesn't hold a reference to it, and when object
gets GC'ed, the fn gets taken with.

Old notes, don't remember exactly what these were for:
=======================================================
- Wrapper ported to work for proxy and prototype (see map_proto.mjs)
- wrapper interface
	- proxy wrapper
- temporary queue mode override when setting a value
- derived
	- lazy derived
- interface with Svelte
- ReactivePropertyProxy, old file I copied from ReactiveProxyArray. I'm not sure what the idea
  was for this one. Maybe intended to be like ReactiveWrapper, where we can easily pass in
  a config to customize the ReactiveProxy handlers for a subclass?