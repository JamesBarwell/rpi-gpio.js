var gpio = require('../rpi-gpio');

var awesome = Promise.all([
    gpio.setup(3, gpio.DIR_OUT),
    gpio.setup(5, gpio.DIR_OUT),
    gpio.setup(7, gpio.DIR_OUT)])
    .then(function () {
        return delayedWrite(3, true)
            .then(function () {
                return delayedWrite(7, true)
            }).then(function () {
                return gpio.read(5)
            })
    });

// Promise holds the result from read pin 5
awesome
    .then(function (result) {
        if (!result)
            return delayedWrite(5, true)
    })
    .then(function () {
        return delayedWrite(3, false)
    })
    .then(function () {
        return delayedWrite(5, false)
    })
    .then(function () {
        return delayedWrite(7, false)
    })
    .then(function () {
        return gpio.destroy()
    });

function delayedWrite(pin, value) {
    return new Promise(function (resolve, reject) {
        setTimeout(function () {
            return gpio.write(pin, value)
                .then(resolve, reject);
        }, 500);
    });
}