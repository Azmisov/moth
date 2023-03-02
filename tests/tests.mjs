import colors from 'colors';

const tests = {};
/** Add a test */
function add(name, fn){
	if (name in tests)
		failed("duplicate test name: "+name);
	tests[name] = fn;
}
/** Run tests
 * @param {Iterable} whitelist which tests to run; if falsey, all tests will be run
 * @param {boolean} parallel run all tests in parallel
 */
async function run(whitelist=null, parallel=false){
	if (!whitelist)
		whitelist = Object.keys(tests);
	let promises = [];
	const pass = "passed".brightGreen;
	const fail = "failed".brightRed;
	for (let name of whitelist){
		const fn = tests[name];
		let err = null;
		const promise = new Promise((passed, failed) => {
			fn(passed, (msg) => { throw new Error(msg); })
		})
			.catch(e => err = e)
			.finally(() => {
				console.log(`Test ${name}: `+(err ? fail : pass));
				if (err)
					console.error("\t",err);
			});
		if (parallel)
			promises.push(promise);
		else await promise;
	}
	if (parallel)
		await Promise.all(promises);
	console.log("all tests completed".cyan);
	process.exit();
}

export { add, run };