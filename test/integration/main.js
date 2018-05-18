var gpio = require('../../rpi-gpio');
var async = require('async');
var assert = require('assert');
var sinon = require('sinon');

var message =
    'Please ensure that your Raspberry Pi is set up with physical pins ' +
    '7 and 11 connected via a 1kΩ resistor (or similar) to make this test work'
console.log(message)
console.log('')
console.log('|-----------------------------------...')
console.log('|-  [02][04][06][08][10][12][14][16]...')
console.log('|-  [01][03][05][07][09][11][13][15]...')
console.log('|-                |      |          ...')
console.log('|-                |-<1k>-|          ...')
console.log('')


var writePin = 7
var readPin = 11

describe('rpi-gpio integration', function() {

    var readValue;
    var onChange = sinon.spy()

    before(function(done) {
        gpio.on('change', onChange);

        async.waterfall([
            function(next) {
                gpio.setup(writePin, gpio.DIR_OUT, next)
            },
            function(next) {
                gpio.setup(readPin, gpio.DIR_IN, gpio.EDGE_BOTH, next)
            },
            function(next) {
                gpio.write(writePin, 1, next);
            },
            function(next) {
                setTimeout(next, 100)
            },
            function(next) {
                gpio.read(readPin, function(err, value) {
                    readValue = value;
                    next();
                });
            }
        ], function(err) {
            done(err)
        });
    });

    after(function(done) {
        gpio.destroy(done)
    });

    it('should trigger the change listener', function() {
        sinon.assert.calledOnce(onChange)
        sinon.assert.calledWith(onChange, 11, true)
    });

    it('should set the read pin on', function() {
        assert.equal(readValue, true)
    });

});
