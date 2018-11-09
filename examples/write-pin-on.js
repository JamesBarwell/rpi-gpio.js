//This example shows how to setup the pin for write mode with the default state as "on". Why do this? It can sometimes be useful to reverse the default initial state due to wiring or uncontrollable circumstances.
var gpio = require('../rpi-gpio');

gpio.setup(7, gpio.DIR_HIGH, write);

function write(err) {
    if (err) throw err;
    gpio.write(7, false, function(err) {
        if (err) throw err;
        console.log('Written to pin');
    });
}
