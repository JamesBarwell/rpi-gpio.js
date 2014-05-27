var fs           = require('fs');
var util         = require('util');
var EventEmitter = require('events').EventEmitter;
var async        = require('async');
var debug        = require('debug')('rpi-gpio');

var PATH = '/sys/class/gpio';

var pins = {
    v1: {
        '1':  null,
        '2':  null,
        '3':  0,
        '4':  null,
        '5':  1,
        '6':  null,
        '7':  4,
        '8':  14,
        '9':  null,
        '10': 15,
        '11': 17,
        '12': 18,
        '13': 21,
        '14': null,
        '15': 22,
        '16': 23,
        '17': null,
        '18': 24,
        '19': 10,
        '20': null,
        '21': 9,
        '22': 25,
        '23': 11,
        '24': 8,
        '25': null,
        '26': 7
    },
    v2: {
        '1':  null,
        '2':  null,
        '3':  2,
        '4':  null,
        '5':  3,
        '6':  null,
        '7':  4,
        '8':  14,
        '9':  null,
        '10': 15,
        '11': 17,
        '12': 18,
        '13': 27,
        '14': null,
        '15': 22,
        '16': 23,
        '17': null,
        '18': 24,
        '19': 10,
        '20': null,
        '21': 9,
        '22': 25,
        '23': 11,
        '24': 8,
        '25': null,
        '26': 7
    }
};

function Gpio() {
    var currentPins;
    var exportedPins = {};
    var getPinForCurrentMode = getPinRpi;

    this.DIR_IN   = 'in';
    this.DIR_OUT  = 'out';
    this.MODE_RPI = 'mode_rpi';
    this.MODE_BCM = 'mode_bcm';

    /**
     * Set pin reference mode. Defaults to 'mode_rpi'.
     *
     * @param {string} mode Pin reference mode, 'mode_rpi' or 'mode_bcm'
     */
    this.setMode = function(mode) {
        if (mode === this.MODE_RPI) {
            getPinForCurrentMode = getPinRpi;
        } else if (mode === this.MODE_BCM) {
            getPinForCurrentMode = getPinBcm;
        } else {
            throw new Error('Cannot set invalid mode');
        }

        this.emit('modeChange', mode);
    };

    /**
     * Setup a channel for use as an input or output
     *
     * @param {number}   channel   Reference to the pin in the current mode's schema
     * @param {string}   direction The pin direction, either 'in' or 'out'
     * @param {function} cb        Optional callback
     */
    this.setup = function(channel, direction, cb /*err*/) {
        if (!channel) {
            return process.nextTick(function() {
                cb(new Error('Channel not specified'));
            });
        }

        direction = direction || this.DIR_OUT;

        if (typeof direction === 'function') {
            cb = direction;
            direction = this.DIR_OUT;
        }

        if (direction !== this.DIR_IN && direction !== this.DIR_OUT) {
            return process.nextTick(function() {
                cb(new Error('Cannot set invalid direction'));
            });
        }


        var pin;
        async.waterfall([
            function(next) {
                setRaspberryVersion(function(err, pinSchema) {
                    if (err) next(err);
                    if (pinSchema) {
                        currentPins = pinSchema;
                    }
                    next();
                });
            },
            function(next) {
                pin = getPinForCurrentMode(channel);
                debug('set up pin %d', pin);
                isExported(pin, next);
            },
            function(isExported, next) {
                if (isExported) {
                    return unexportPin(pin, next);
                }
                return next(null);
            },
            function(next) {
                exportPin(pin, next);
            },
            function(next) {
                exportedPins[pin] = true;
                this.emit('export', channel);
                createListener.call(this, channel, pin);
                setDirection(pin, direction, next);
            }.bind(this)
        ], cb);
    };

    /**
     * Write a value to a channel
     *
     * @param {number}   channel The channel to write to
     * @param {boolean}  value   If true, turns the channel on, else turns off
     * @param {function} cb      Optional callback
     */
    this.write = this.output = function(channel, value, cb /*err*/ ) {
        var pin = getPinForCurrentMode(channel);

        if (!exportedPins[pin]) {
            return process.nextTick(function() {
                cb(new Error('Pin has not been exported'));
            });
        }

        value = (!!value && value !== '0') ? '1' : '0';
        fs.writeFile(PATH + '/gpio' + pin + '/value', value, cb || function () {});
    };

    /**
     * Read a value from a channel
     *
     * @param {number}   channel The channel to read from
     * @param {function} cb      Callback which receives the channel's boolean value
     */
    this.read = this.input = function(channel, cb /*err,value*/) {
        var pin = getPinForCurrentMode(channel);

        if (!exportedPins[pin]) {
            return process.nextTick(function() {
                cb(new Error('Pin has not been exported'));
            });
        }

        fs.readFile(PATH + '/gpio' + pin + '/value', 'utf-8', function(err, data) {
            data = (data + '').trim() || '0';
            return cb(err, data === '1');
        });
    };

    /**
     * Unexport any pins setup by this module
     *
     * @param {function} cb Optional callback
     */
    this.destroy = function(cb) {
        var tasks = Object.keys(exportedPins).map(function(pin) {
            return function(done) {
                unexportPin(pin, done);
            }
        });
        async.parallel(tasks, cb);
    };

    /**
     * Reset the state of the module
     */
    this.reset = function() {
        exportedPins = {};
        this.removeAllListeners();

        currentPins = undefined;
        exportedPins = {};
        getPinForCurrentMode = getPinRpi;
    };

    // Init
    EventEmitter.call(this);
    this.reset();


    // Private functions requring access to state
    function setRaspberryVersion(cb) {
        if (currentPins) {
            return cb(null);
        }

        fs.readFile('/proc/cpuinfo', 'utf8', function(err, data) {
            if (err) return cb(err);

            // Match the last 4 digits of the number following "Revision:"
            var match = data.match(/Revision\s*:\s*[0-9a-f]*([0-9a-f]{4})/);
            var revisionNumber = parseInt(match[1], 16);
            var pinVersion = (revisionNumber < 4) ? 'v1' : 'v2';

            debug(
                'seen hardware revision %d; using pin mode %s',
                revisionNumber,
                pinVersion
            );

            return cb(null, pins[pinVersion]);
        });
    };

    function getPinRpi(channel) {
        return currentPins[channel] + '';
    };

    function getPinBcm(channel) {
        return channel + '';
    };

    function createListener(channel, pin) {
        debug('listen for pin %d', pin);
        var Gpio = this;
        fs.watchFile(PATH + '/gpio' + pin + '/value', function() {
            Gpio.read(channel, function(err, value) {
                if (err) return cb(err);
                Gpio.emit('change', channel, value);
            });
        });
    }
}
util.inherits(Gpio, EventEmitter);

function setDirection(pin, direction, cb) {
    debug('set direction %s on pin %d', direction.toUpperCase(), pin);
    fs.writeFile(PATH + '/gpio' + pin + '/direction', direction, function(err) {
        if (cb) return cb(err);
    });
}

function exportPin(pin, cb) {
    debug('export pin %d', pin);
    fs.writeFile(PATH + '/export', pin, function(err) {
        if (cb) return cb(err);
    });
}

function unexportPin(pin, cb) {
    debug('unexport pin %d', pin);
    fs.unwatchFile(PATH + '/gpio' + pin + '/value');
    fs.writeFile(PATH + '/unexport', pin, function(err) {
        if (cb) return cb(err);
    });
}

function isExported(pin, cb) {
    fs.exists(PATH + '/gpio' + pin, function(exists) {
        return cb(null, exists);
    });
}

module.exports = new Gpio;
