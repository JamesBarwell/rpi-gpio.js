var gpio = require('../../rpi-gpio');
var gpio_p = gpio.promise;
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

        gpio_p.setup(writePin, gpio.DIR_OUT)
          .then(() => {
            return gpio_p.setup(readPin, gpio.DIR_IN, gpio.EDGE_BOTH)
          })
          .then(() => {
            return gpio_p.write(writePin, 1)
          })
          .then(() => {
            setTimeout(function() {
	      return Promise.resolve()
	    },100)
          })
          .then(() => {
            return gpio_p.read(readPin)
          })
          .then((value) => {
            readValue = value;
            done()
          })
          .catch((err) => {
            done(err)
          })
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
