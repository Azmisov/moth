/* Clock ranking; testing when and how often certain scheduuled async tasks run

   Each row blocks execution of subsequent rows; within a row, they are ordered from most frequent to least
   NODEJS (animation, idle not supported):
   1. sync
   2. microtask = promise
   3. tick
   4. message > immediate = timeout > timeout(N)
   FIREFOX (tick, immediate not supported):
   1. sync
   2. microtask = promise
   3. message > animation ≈ idle > idle(N) > timeout > timeout(N)

*/

/** clock tick counts */
let counters = {};
/** avg counters delta between clock ticks */
let deltas = {};
/** avg rank of counters */
let ranks = {};
/** ranking samples taken */
let ranks_n = 0;

function abstractClock(name, scheduler){
	let i = counters[name] = ranks[name] = 0;
	let prev = null;
	function tick(){
		// update counter
		counters[name] = ++i;
		// update avg delta
		let delta = counters;
		if (prev) {
			delta = {};
			for (const key in counters)
				delta[key] = counters[key] - prev[key];
		}
		const avg = deltas[name];
		if (!avg)
			deltas[name] = Object.assign({}, delta);
		else {
			for (const key in delta)
				avg[key] += (delta[key]-avg[key])/i;
		}
		// update avg rank
		const freq = Object.entries(counters).sort((a,b) => b[1]-a[1])
		ranks_n++;
		let rank = 0;
		for (const entry of freq) {
			const rn = entry[0];
			ranks[rn] += (rank - ranks[rn])/ranks_n;
			rank++;
		}

		console.log("rank", ranks)
		console.log("counters", counters)

		// next tick
		prev = Object.assign({}, counters);
		scheduler(tick);
	}
	scheduler(tick);
}

// abstractClock('timeout', f => setTimeout(f, 25));
// abstractClock('timeout50', f => setTimeout(f, 50));
// abstractClock('animation', f => requestAnimationFrame(f));
abstractClock('idle', f => requestIdleCallback(f));
abstractClock('idle50', f => requestIdleCallback(f, {timeout: 50}));
// abstractClock('tick', f => process.nextTick(f));
abstractClock('promise', f => Promise.resolve().then(f));
// abstractClock('microtask', f => queueMicrotask(f));
// abstractClock('message', (() => {
// 	const c = new MessageChannel();
// 	return f => {
// 		c.port1.onmessage = f;
// 		c.port2.postMessage(null);
// 	}
// })());
// abstractClock('immediate', f => setImmediate(f));

setInterval(() => {
	console.log("Ranks:", ranks);
}, 1000)