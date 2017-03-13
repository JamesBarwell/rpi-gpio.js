var gpio = require('../rpi-gpio');

// Set true so that setup, wrtie and read return objects
gpio.setResolveWithObject(true);

gpio.setup(customeSetup(3, gpio.DIR_OUT, false, 'mydata'))
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
        return delayedWrite(customeSetup(result, null, true));
    }).then(function () {
        return gpio.destroy();
    });

function customeSetup(pin, direction, value, other) {
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
            return gpio.write(writeobject).then(resolve, reject);
        }, 1500);
    })
}