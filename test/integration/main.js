var gpio = require('../../rpi-gpio');
var gpiop = gpio.promise;
var assert = require('assert');
var sinon = require('sinon');

var message =
    'Please ensure that your Raspberry Pi is set up with physical pins ' +
    '7 and 11 connected via a 1kΩ resistor (or similar) to make this test work';
console.log(message);
console.log('');
console.log('|-----------------------------------...');
console.log('|-  [02][04][06][08][10][12][14][16]...');
console.log('|-  [01][03][05][07][09][11][13][15]...');
console.log('|-                |      |          ...');
console.log('|-                |-<1k>-|          ...');
console.log('');

var writePin = 7;
var readPin = 11;

function sleep() {
    return new Promise((resolve) => {
        setTimeout(resolve, 100);
    });
}

describe('rpi-gpio integration', function() {
    context('write and read pins', function() {
        var readValue;
        var onChange = sinon.spy();

        before(function() {
            gpio.on('change', onChange);

            return Promise.all([
                gpiop.setup(writePin, gpio.DIR_OUT),
                gpiop.setup(readPin, gpio.DIR_IN, gpio.EDGE_BOTH),
            ])
            .then(() => {
                return gpiop.write(writePin, 1);
            })
            .then(sleep)
            .then(() => {
                return gpiop.read(readPin);
            })
            .then((value) => {
                readValue = value;
            });
        });

        after(gpiop.destroy);

        it('should trigger the change listener', function() {
            sinon.assert.calledOnce(onChange);
            sinon.assert.calledWith(onChange, 11, true);
        });

        it('should set the read pin on', function() {
            assert.equal(readValue, true);
        });
    });
});
