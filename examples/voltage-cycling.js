//This example shows how to set up a channel for output mode. After it is set up, it executes a callback which in turn calls another, causing the voltage to alternate up and down three times.
var gpio = require('rpi-gpio');

var writePin = 7;
var readPin = 11;
var delay = 2000;
var count = 0;
var max   = 3;

gpio.on('change', function(channel, value) {
    console.log('Channel ' + channel + ' value is now ' + value);
});

gpio.setup(writePin, gpio.DIR_OUT, setupRead);

function setupRead() {
    gpio.setup(readPin, gpio.DIR_IN, gpio.EDGE_BOTH, on);
}

function on() {
    if (count >= max) {
        gpio.destroy(function() {
            console.log('Closed writePins, now exit');
        });
        return;
    }

    setTimeout(function() {
        gpio.write(writePin, 1, off);
        count += 1;
    }, delay);
}

function off() {
    setTimeout(function() {
        gpio.write(writePin, 0, on);
    }, delay);
}
