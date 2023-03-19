const m = new Map();
const proto = Object.getPrototypeOf(m);
const wrapper_proto = Object.create(proto, {
	set:{
		configurable:true,
		writable:true,
		value(){
			console.log("calling set!");
			return proto.set.apply(this, arguments);
		}
	}
});
Object.setPrototypeOf(m, wrapper_proto);
m.set("butt","cheek");
console.log(m);