var gpio = require('../rpi-gpio');

gpio.setup(7, gpio.DIR_OUT, write);

function write(err) {
    if (err) throw err;
    gpio.write(7, true, function(err) {
        if (err) throw err;
        console.log('Written to pin');
    });
}
