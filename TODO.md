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
- compiler for statically known dependency graphs