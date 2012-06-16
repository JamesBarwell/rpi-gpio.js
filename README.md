rp-gpio.js
==========


Control Raspberry Pi GPIO pins

### Example
Voltage cycling on RPi GPIO #7 (or BCM GPIO #4)
```js
var gpio = require('./rp-gpio');

var pin = 7;

gpio.setup(pin, 'output', flip);

var on = true;

function flip() {
    setInterval(function() {
        if (on) {
            gpio.output(pin, 0);
        } else {
            gpio.output(pin, 1);
        }
        on = !on;
    }, 2000);
}

// Cleanup must be done manually for now
function cleanup() {
    gpio.unexport(7);
}
```
