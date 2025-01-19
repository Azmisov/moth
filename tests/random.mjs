
function *x(){
	let i = 0;
	while (i < 10)
		yield i++;
}

let g = x();


function a() {
	console.log("a")
	// while (true) {
	for (const value of g) {
		// const {done, value} = g.next();
		// if (done) break;
		console.log(value);
		if (value > 6) {
			break;
		}
	}
	console.log("a done")
}

function b(){
	console.log("b")
	let transfer = false;
	// while (true) {
	for (const value of g){
		// const {done, value} = g.next();
		// if (done) break;
		console.log(value);
		if (!transfer && value > 3) {
			a();
			transfer = true;
		}
	}
	console.log("b done")
}

b();