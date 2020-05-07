var gpio = require('../rpi-gpio');

gpio.setMode('mode_bcm');

gpio.setup(7, gpio.DIR_IN, readInput);

function readInput(err) {
    if (err) throw err;
    gpio.read(7, function(err, value) {
        if (err) throw err;
        console.log('The value is ' + value);
    });
}
