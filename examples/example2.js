var gpio = require('../rpi-gpio');

var awesome = Promise.all([
    gpio.setup(simpleSetup(3)),
    gpio.setup(simpleSetup(5)),
    gpio.setup(customSetup(7, "Hello World!!"))])
    .then(function (array) {
        console.log(array)
        return array.forEach(function(element) {
            return delayedWrite(element, true)
        })
    });

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

function simpleSetup(pin) {
    return {'channel': pin}
}

function customSetup(pin, other) {
    return {'channel': pin, 'other': other}
}

function delayedWrite(pin, value) {
    return new Promise(function (resolve, reject) {
        setTimeout(function () {
            return gpio.write(pin, value)
                .then(resolve, reject);
        }, 500);
    });
}