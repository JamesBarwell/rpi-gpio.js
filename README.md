rp-gpio.js
==========


Control Raspberry Pi GPIO pins with node.js

### Setup
See this guide on how to get [node.js running on Raspberry Pi](http://elsmorian.com/post/23474168753/node-js-on-raspberry-pi)

### Example
Voltage cycling on RPi GPIO #7 (or BCM GPIO #4)
```js
var gpio = new require('./rp-gpio');

var pin   = 7;
var delay = 3000;
var count = 0;
var max   = 3;

gpio.setup(pin, 'out', on);

function on() {
    if (count >= max) {
        process.exit(0);
        return;
    }

    setTimeout(function() {
        gpio.write(pin, 1, off);
        count += 1;
    }, delay);
}

function off() {
    setTimeout(function() {
        gpio.write(pin, 0, on);
    }, delay);
}
```
