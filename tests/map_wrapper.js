x = new Map();
// Map.prototype.set.apply(x,[0,1]);
// console.log(x);

class Wrapper extends Map{}
z = new Wrapper();
z.set(5,6);



// function Superclass(superProperty) {
//     this.superProperty = superProperty;
// }
// Superclass.prototype.method = function() {
//     console.log("Superclass's method says: " + this.superProperty);
// };
function Subclass(subProperty) {
    Map.call(this);
    this.subProperty = subProperty;
}
Subclass.prototype = Object.create(Map.prototype);
Subclass.prototype.constructor = Subclass;

Subclass.prototype.method = function() {
    Superclass.prototype.method.call(this); // Optional, do it if you want super's logic done
    console.log("Subclass's method says: " + this.subProperty);
};

var o = new Subclass("foo");
console.log("subProperty", o.subProperty);
console.log("method():");
o.method();
