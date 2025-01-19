You can control how a subscriber is notified by specifying a *queue*:

```js
// subscriber's notifications are queued on the microtask queue:
r.subscribe(subscriber, "microtask");
```

No queue (`null`) indicates *synchronous* notification. These subscribers are notified immediately
when a value changes. While this provides the strongest guarantees about the program's state, it
has disadvantages:
- A very long chain of recursive notifications could risk stack overflow (e.g. mobile browsers can
  have a stack limit of ~7k)
- For a subscriber with multiple dependencies, there is no way to batch changes to its dependencies.
  Each individual dependency change will trigger a notification.
- Accumulating changes to a value many times in the same code segment will trigger a notification
  for each intermediate value. For heavy computations (e.g. network requests, DOM updates) you'd
  like to wait until a value has been finalized before updating.
- Sometimes immediate notifications are inconsequential or invisible, and we'd prefer to throttle
  them instead (e.g. we don't need to redraw the user interface 300 times per second)

```js
// stack overflow?
ra.subscribe(() => {
	if (ra.value < 10000)
		ra.value++;
}, null);
ra.value++;

// subscriber notified twice
rb.subscribe(subscriber, null);
rc.subscribe(subscriber, null);
rb.value *= 2;
rc.value -= rb.value;

// heavy computation run 49 extra times!
rd.subscribe(heavy_computation, null);
for (let i=0; i<50; i++)
	rd.value += reduce_arr[i];
```

If a queue is specified, the subscriber will instead be notified *asynchronously*. Asynchronous
notifications are automatically batched, so changes to multiple dependencies, or many changes to
a single dependency will only trigger one notification. Assuming recursive changes are also
asynchronous, there will be no risk of stack overflow either.

Note that while asynchronous mode has optimizations in-place to minimize the amount of overhead in
accumulating values, it is still a non-zero overhead. For performance conscious code, using a
non-reactive temporary value for the computation will be faster.

```js
// heavy computation runs once
r.subscribe(heavy_computation, "microtask");
for (const num of reduce_arr)
	r.value += num;
// however for performance conscious code, consider instead:
let tmp = 0;
for (const num of reduce_arr)
	tmp += num;
r.value = tmp;
```

The timing of the notification depends on the type of queue you choose. The following builtin queues
are available:

<table>
  <tr>
    <th><code>microtask</code></th>
    <td>
      Notified as a microtask via <code>queueMicrotask</code>, which runs immediately after
      the current code finishes running (e.g. after the execution stack completely unwinds)
    </td>
  </tr>
  <tr>
    <th><code>promise</code></th>
    <td>
      Notified as a promise via <code>Promise.resolve</code>. The promise queue is resolved as
      a microtask, so the timing will be nearly identical to microtask notifications
    </td>
  </tr>
  <tr>
    <th><code>tick</code></th>
    <td>
      <i>(NodeJS only)</i> Notified on the next event loop tick via <code>process.nextTick</code>
    </td>
  </tr>
  <tr>
    <th><code>immediate</code></th>
    <td>
      <i>(NodeJS only)</i> Notified as a task triggered from <code>setImmediate</code>. This runs
      immediately after any microtasks have finished— effectively a true, zero delay timeout.
    </td>
  </tr>
  <tr>
    <th><code>message</code></th>
    <td>
      Notified as a task triggered from a <code>MessageChannel</code>. This runs <i>almost</i> immediately,
      and is included as it has historically been used to simulate a zero delay timeout.
    </td>
  </tr>
  <tr>
    <th><code>timeout</code></th>
    <td>
      Notified as a task triggered from <code>setTimeout</code>. This accepts a timeout argument giving
      the minimum delay before running. JavaScript runtimes typically cannot fire faster than 4ms.
    </td>
  </tr>
  <tr>
    <th><code>animation</code></th>
    <td>
      <i>(Browser only)</i> Notified as a task triggered from <code>requestAnimationFrame</code>. The notification will
      occur right before the browser repaints, which is typically 30 or 60fps. When running in a
      background tab, repaints may be deferred indefinitely. This mode supports an optional deadline
      that forces notification after the deadline timer has expired.
    </td>
  </tr>
  <tr>
    <th><code>idle</code></th>
    <td>
      <i>(Browser only)</i> Notified as a task triggered from <code>requestIdleCallback</code>. This is
      fired only when the browser is <i>idle</i>, having no other tasks to perform. Like <code>animation</code>,
      it can be delayed indefinitely, so supports a deadline parameter. Unlike the other modes, the
      <code>idle</code> notification will pause intermittently if it cannot finish within a runtime
      defined time slice. Depending on how much load the browser is under this can run faster or
      slower than animation frames.
    </td>
  </tr>
  <tr>
    <th><code>manual</code></th>
    <td>
      Notifications are queued indefinitely. You must manually flush the queue to notify subscribers.
    </td>
  </tr>
</table>

Each individual queue is FIFO (first-in first-out), meaning the earliest changes are broadcast
first. However, the order each queue is scheduled to flush is determined by the JavaScript runtime
event loop.

In the rarer cases where you need exact guarantees about your program's state, you can synchronously
flush any of the asynchronous queues. You can create a new queue object to create subscriber groups
that can be flushed together.

You can mix different modes. The earliest notification dequeues the subscriber from any other
queues.

You can manually enqueue a subscriber by calling Subscriber.enqueue. This allows you to use a mixture
of Reactive driven dependencies and hard-coded dependencies.

This library guarantees:
- A subscriber will only be notified when one of its dependencies has changed
- After unsubscribing, any pending notifications are discarded