var gpio = require('../rpi-gpio');

// Set true so that setup, write and read return objects
gpio.setResolveWithObject(true);

gpio.setup(customSetup(3, gpio.DIR_OUT, false, 'mydata'))
    .then(function (result) {
        result['value'] = !result['value'];
        console.log(result);
        return delayedWrite(result);
    })
    .then(function (result) {
        result['value'] = !result['value'];
        console.log(result);
        return delayedWrite(result);
    })
    .then(function (result) {
        result['other'] = 'something else';
        result['value'] = !result['value'];
        result['type'] = false;
        console.log(result);
        return delayedWrite(result);
    })
    .then(function (result) {
        console.log(result);
        return delayedWrite(customSetup(result, null, true));
    }).then(function () {
        return gpio.destroy();
    });

function customSetup(pin, direction, value, other) {
    var setup = {'channel': pin, 'other': other};
    if (direction)
        setup['direction'] = direction;
    if (!isNaN(value))
        setup['value'] = value;
    return setup
}

function delayedWrite(writeobject) {
    return new Promise(function (resolve, reject) {
        setTimeout(function () {
            return gpio.write(writeobject)
                .then(resolve, reject);
        }, 1500);
    })
}