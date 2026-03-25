# Roadmap

## Priority 1 — Settle the execution model

### Finish the v2.0 Scheduler

The priority-based queue flushing design is one of moth's key differentiators, and the
scheduler defines the execution model that everything else sits on top of. Lazy evaluation,
auto-dependency tracking, and batch semantics all need to know how the scheduler resolves
priorities and flushes queues — so this must be settled first.

Clock.mjs currently has undefined references and Scheduler.mjs has incomplete TODO sections.

**What it solves:**
- Guarantees that flushing tick X also drains all higher-priority ticks
- Prevents janky half-updated UIs from staggered updates across animation frames
- Recursive notifications at different priority levels complete in a single tick
- Establishes the execution semantics that computed, batch, and auto-tracking will build on

**Complexity:** Medium. The design is already documented in architecture.md. Main work is
fixing the Clock.mjs bugs, completing RankedQueue/FIFOBufferedQueue, and integrating the
clock system with the existing queue infrastructure. Needs thorough testing of edge cases
around recursive flushing.

---

## Priority 2 — Build the reactive primitives on top

### ReactiveComputed

A new Reactive subclass whose getter wraps a memoized function call. It subscribes to its
input reactives (via auto-tracking or explicit subscription). When inputs change, it marks
itself dirty but does not recompute — recomputation happens lazily on the next `.value` read.
If the recomputed result differs (`!==`), it notifies its own downstream subscribers.

`set()`/`assume()` manually override the memoized value, bypassing the function (useful for
optimistic updates or testing).

This fits the existing type hierarchy naturally:
- `ReactiveValue` — private value, get/set manipulate it
- `ReactiveCache` — same, but only notifies on `!==`
- `ReactiveComputed` — get runs memoized function, only notifies on `!==`

**Pull vs push falls out of the existing subscription model:**
- No subscribers → pure pull. Read `.value` whenever, it resolves if dirty.
- Has subscribers → pull + push. Inputs change → computed marks dirty → downstream
  links are queued on their respective queues. When the subscriber runs and reads
  `.value`, the computed resolves. If something reads it earlier (higher-priority
  subscriber, manual access), it resolves then and the later subscriber sees the
  already-resolved value.

The queue belongs to the Link, not the computed. A computed is just a Reactive — you
subscribe to it like any other, with whatever queue makes sense for the downstream work.
This preserves moth's per-link scheduling model without special-casing computed.

**What it solves:**
- Eliminates manual subscriber-to-ReactiveValue wiring for derived state
- Enables declarative data transformation chains (e.g. search term -> filtered list -> selected index)
- Pull-based evaluation gives glitch-free reads for free — a subscriber reading multiple
  computeds always sees consistent state, since dirty computeds resolve on read before
  the subscriber's own logic runs
- Eliminates the "derived state as independent state + useEffect sync" anti-pattern that
  was a major source of complexity in real React code

**Complexity:** Medium. Internally, a ReactiveComputed is a Reactive that also owns a
Subscriber (or is one) for its inputs. The memoization and dirty-flag machinery largely
exists in ReactiveCache and the Link dirty flag. Main design work: how auto-tracking
hooks in (see below), and how the dirty flag propagates through chains of computeds
(a computed whose input is another computed).

---

### Auto-dependency tracking

Automatically detect which reactives a subscriber/computed reads during execution, instead of
requiring explicit `subscribe()` calls. This hooks into the scheduler because auto-tracked
dependencies need to be assigned to the correct queue — either inheriting the subscriber's
queue or following rules the scheduler defines.

**What it solves:**
- Removes boilerplate when wiring up computed chains or effects with many dependencies
- Brings ergonomics in line with Solid/Vue/Svelte without adopting their implicit downsides
- Pairs with computed to make the full reactive graph declarative

**Complexity:** Low-medium. Standard approach: global stack of the currently-executing subscriber,
populated on reactive `get` traps, cleared on return. Only works for synchronous access. The
architecture doc already outlines this approach.

---

### Batch / Transaction

**Status: Needs further design. May not need a dedicated primitive.**

Async queues already batch naturally — multiple `.value =` calls in a single synchronous block
are batched into one flush per queue. The dirty flag deduplication means a subscriber to
multiple reactives only fires once per flush. Examining real-world React code (Pyris log
viewer), most multi-state update pain points were actually:

- **Derived state implemented as independent state** — `selectedTimestamp` was always
  `rows[selectedRowIndex].timestamp`, never set independently. Computed/derived primitives
  eliminate these entirely.
- **Intentionally different timing** — search error display fires immediately, filtering
  fires after 300ms debounce. This is a scheduling requirement, not a batching failure.
  Different queue modes per subscriber handle it naturally.

The remaining gaps are narrow:
- **Sync queue**: multiple updates fire separate immediate notifications. Could be solved
  by pausable queues (see Priority 4) or a temporary queue override
  (e.g. `reactive.set(value, {queue: "microtask"})`) to force one update through async.
- **Mixed queues**: subscribers on different clock ticks won't flush together. The v2.0
  scheduler's priority flushing partially addresses this (flushing animation drains
  microtask first).

A full `batch()` API (global counter, suppress notify, flush on exit) may be overengineered.
Revisit after computed and the scheduler are implemented — they may cover all practical cases.
If a batch primitive is still needed, it would most naturally integrate as a scheduler-level
pause/flush operation.

---

### Disposal / Ownership scopes

A scope mechanism where child subscriptions are automatically cleaned up when the parent
scope is disposed. Something like:

```js
const dispose = createScope(() => {
  const derived = computed(() => a.value + b.value);
  effect(() => console.log(derived.value));
});
// later:
dispose(); // all subscriptions within cleaned up
```

**What it solves:**
- Prevents memory leaks from orphaned subscriptions (the GC problem noted in TODO.md)
- Required for integration with any component framework (maps to component mount/unmount)
- Eliminates manual `unsubscribe()` bookkeeping

**Complexity:** Medium. Needs a global scope stack. Each `subscribe()` call registers with the
current scope. `dispose()` iterates and unsubscribes all. Nested scopes should propagate
disposal to children. The WeakRef approach from TODO.md could complement this but shouldn't
replace it — explicit ownership is more predictable.

---

## Priority 3 — Prove the model end-to-end and make it adoptable

### Glitch-free execution / Topological ordering

When a reactive value changes, ensure downstream computeds are evaluated in dependency order so
no subscriber ever sees an inconsistent intermediate state.

**What it solves:**
- Prevents the "A depends on B and C, both change, A sees half-updated state" problem
- Avoids redundant recomputations (a computed only runs once per batch, not once per input)
- Required for correctness in complex reactive graphs
- Directly addresses the cascading effect chain problems seen in real apps

**Complexity:** Medium-high. Requires tracking the dependency graph at runtime. Standard approach:
mark direct dependents as dirty, indirect descendants as maybe-dirty, then resolve lazily
before reading. The architecture doc discusses this. Can be deferred for push-based subscribers
if batch() is implemented first (batch covers most practical cases).

---

### Minimal DOM renderer

A thin rendering layer to prove moth's reactivity model drives real UI. Tagged template
literals (like Lit) would avoid needing a compiler:

```js
const el = html`<div class=${computed(() => active.value ? "on" : "off")}>
  ${computed(() => state.value.count)}
</div>`;
```

**What it solves:**
- Provides a concrete answer to "how do I use moth to build a UI"
- Validates the scheduling design (animation queue for DOM writes, microtask for computations)
- Gives potential adopters something to actually try
- Serves as the reference integration that other renderers can follow

**Complexity:** Medium-high. Needs: template parsing, reactive text/attribute binding, conditional
rendering, list rendering with keyed reconciliation, and integration with disposal scopes for
cleanup. A minimal version (text + attribute binding only) is much simpler and could come first.

---

### TypeScript type definitions

At minimum a `.d.ts` file covering the public API. Ideally convert source to `.ts` over time.

**What it solves:**
- Autocompletion and type checking for library consumers
- Most JS library users expect types today; absence is a real adoption barrier
- Catches API misuse at compile time

**Complexity:** Low-medium for `.d.ts` declarations. High if converting all source to TypeScript.

---

### DevTools — Dependency graph visualization

A development tool to visualize the live reactive graph: which reactives exist, their
subscribers, notification frequency, dead subscribers, and redundant notifications.

**What it solves:**
- Moth's dependency injection makes dependencies more implicit (the architecture doc
  acknowledges this); visualization turns that weakness into a strength
- Debug aid for tracking down unexpected notifications or missing updates
- Better observability than frameworks with implicit tracking but no graph viewer
- Clock tick visualization helps users understand scheduling behavior

**Complexity:** High. Needs instrumentation hooks in the reactive core, a serialization format
for the graph, and a UI to render it. Could start with a simple console-based dump before
building a visual tool. The Context-object-in-notification-chain idea from TODO.md is a
good approach for tracing without AOT analysis.

---

### Integration recipes

Documented patterns for using moth as a state layer inside React, Solid, Svelte, and
vanilla JS applications.

**What it solves:**
- Pragmatic adoption path: people can try moth without abandoning their current framework
- Demonstrates moth's framework-agnostic value proposition concretely
- For React specifically: a `useMothReactive()` hook that subscribes on mount, disposes on
  unmount, and triggers re-render on notification

**Complexity:** Low per recipe. Mainly documentation and small adapter utilities.

---

## Priority 4 — Defer until needed

### Priority queue within a tick

Ordering subscribers by priority rather than FIFO within a single queue flush.

**Deferral rationale:** No concrete UI use case identified. For typical UI work, all subscribers
within a tick should complete before the next frame regardless of order. Revisit when a real
workload demonstrates benefit.

---

### Compiler for static dependencies

Statically analyze subscriber functions to determine their reactive dependencies at build time,
eliminating runtime tracking overhead.

**Deferral rationale:** Premature optimization. Auto-tracking must work dynamically first.
Only worth investigating after profiling shows tracking overhead is a bottleneck in real
applications.

---

### Pausable subgraphs

Temporarily pause notifications for a subset of the reactive graph (e.g. during mouse drag),
then flush on resume.

**Deferral rationale:** Niche use case. The disposal/ownership model from Priority 1 is more
fundamental. Pausing can be approximated by unsubscribing and resubscribing, or by using a
manual queue that is only flushed on demand. Revisit after the core is complete.

---

### Time-based subscription primitives (throttle, debounce, rate limit)

The `timeout(N)` clock defines a global periodic tick — "N ms resolution." Multiple
subscribers batch together and cascading flush (lower timeout drains before higher) ensures
consistency. This is correct for the "at most this stale" use case.

However, there are cases where you want per-subscription timing, not a global clock:
- **Rate limiting**: "don't call this subscriber more often than every N ms" — timer anchored
  to the last invocation, not a global clock. A cascading flush from a lower-frequency clock
  could trigger a rate-limited subscriber early, violating the minimum interval.
- **Debouncing**: "only call after N ms of inactivity" — timer resets on each change.
- **Throttling**: "call at most once per N ms, but always call on the trailing edge."

These are not queue/clock concerns — they're filters on individual subscriptions. The right
design is probably a per-Link or per-Subscriber property that suppresses notifications based
on timing, orthogonal to which clock queue the subscriber is on:

```js
// conceptual — queue controls when, throttle controls how often
r.subscribe(callback, { queue: "animation", throttle: 500 });
r.subscribe(callback, { queue: "microtask", debounce: 300 });
```

**Deferral rationale:** The clock/queue system handles the common batching/resolution cases.
Per-subscription timing is a separate feature that can be layered on top without changing the
scheduler. Needs survey of which primitives (debounce, throttle, rate limit, others?) are
needed and whether they belong in core or as a utility.

---

### WebWorker integration

Offloading heavy subscriber computations to web workers.

**Deferral rationale:** Requires serialization boundaries, message passing, and async
coordination that would significantly complicate the reactive model. Interesting for compute-heavy
applications but far from the current focus.

---

## Critical path

```
v2.0 Scheduler ──> Computed ──> Auto-tracking ──> Batch ──> Disposal ──> Minimal renderer
```

The scheduler comes first because it defines the execution model: how priorities interact, when
flushes happen, and how recursive notifications resolve. Computed's lazy evaluation strategy,
auto-tracking's queue assignment, and batch's flush-on-exit behavior all depend on these
semantics being settled. Once the scheduler is solid, the reactive primitives build on it
sequentially — each unlocking the next. The renderer is what proves the full stack works
together.
