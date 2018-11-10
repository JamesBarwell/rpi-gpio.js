//This example shows how to set up a channel for output mode. After it is set up, it executes a callback which in turn calls another, causing the voltage to alternate up and down three times.
var gpio = require('../rpi-gpio');

var pin = 7;
var delay = 2000;
var count = 0;
var max   = 3;

gpio.setup(pin, gpio.DIR_OUT, on);

function on() {
    if (count >= max) {
        gpio.destroy(function() {
            console.log('Closed writePins, now exit');
        });
        return;
    }

    setTimeout(function() {
        console.log('Off');
        gpio.write(pin, 1, off);
        count += 1;
    }, delay);
}

function off() {
    setTimeout(function() {
        console.log('On');
        gpio.write(pin, 0, on);
    }, delay);
}
