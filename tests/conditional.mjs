/** Tests method for making conditionals reactive */

function condition(branch){
	/* When dependency changes:
			Find branches <= current branch that dependent on value, mark all as dirty. The else
				branch can be implicit, and is just last branch + 1. If only subscribing to
				branches <= current, then you of course don't need to do the <= current check.
			If any branches were dirty, queue evaluation loop, if not already running.
		Evaluation loop:
			Keep a min heap with dirty branches.
			ebranch = pop min heap value
			Evaluate ebranch's expression (e.g. from an array of lambdas, each corresponding to an expression)
			If expression is true:
				Set current branch to ebranch
				If min heap is <= ebranch, the evaluation had nested synchronous dependencies:
					trim heap and continue
				Else: clear heap and return

		derived([x,y,z], () => x+y+z == 5);
		if (x+y+z == 5)
			eval_branch()


		x ? a : y ? z ? b : c : d
		if (x) a 
		else if (y){
			if (z) b
			else c
		}
		else d

		switch (x){
			case a: break
			case b:
			case c:
			case d: break;
			case e: break;
			default:
		}
		switch: {
			if (x === a){
				do_a;
				break switch;
			}
			if (x === b){
				do_b
				fallthrough = true;
			}
			if (fallthrough || x === c){
				do_c
				fallthrough = true;
			}
			if (fallthrough || x === d){
				do_d
				break switch;
			}
			if (x === e){
				do_e;
				break switch;
			}
			do_default;
		}
	*/
}

