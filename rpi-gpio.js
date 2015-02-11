/*jslint node: true, white: true */
var fs = require('fs');
var util = require('util');
var EventEmitter = require('events').EventEmitter;
var async = require('async');
var debug = require('debug')('rpi-gpio');

var PATH = '/sys/class/gpio';
var PINS = {
    v1: {
        // 1: 3.3v
        // 2: 5v
        '3': 0,
        // 4: 5v
        '5': 1,
        // 6: ground
        '7': 4,
        '8': 14,
        // 9: ground
        '10': 15,
        '11': 17,
        '12': 18,
        '13': 21,
        // 14: ground
        '15': 22,
        '16': 23,
        // 17: 3.3v
        '18': 24,
        '19': 10,
        // 20: ground
        '21': 9,
        '22': 25,
        '23': 11,
        '24': 8,
        // 25: ground
        '26': 7
    },
    v2: {
        // 1: 3.3v
        // 2: 5v
        '3': 2,
        // 4: 5v
        '5': 3,
        // 6: ground
        '7': 4,
        '8': 14,
        // 9: ground
        '10': 15,
        '11': 17,
        '12': 18,
        '13': 27,
        // 14: ground
        '15': 22,
        '16': 23,
        // 17: 3.3v
        '18': 24,
        '19': 10,
        // 20: ground
        '21': 9,
        '22': 25,
        '23': 11,
        '24': 8,
        // 25: ground
        '26': 7,

        // Model B+ pins
        // 27: ID_SD
        // 28: ID_SC
        '29': 5,
        // 30: ground
        '31': 6,
        '32': 12,
        '33': 13,
        // 34: ground
        '35': 19,
        '36': 16,
        '37': 26,
        '38': 20,
        // 39: ground
        '40': 21
    }
};

function setDirection(pin, direction, cb) {
    debug('set direction %s on pin %d', direction.toUpperCase(), pin);
    fs.writeFile(PATH + '/gpio' + pin + '/direction', direction, function (err) {
        if(cb) {
            return cb(err);
        }
    });
}

function exportPin(pin, cb) {
    debug('export pin %d', pin);
    fs.writeFile(PATH + '/export', pin, function (err) {
        if(cb) {
            return cb(err);
        }
    });
}

function unexportPin(pin, cb) {
    debug('unexport pin %d', pin);
    fs.unwatchFile(PATH + '/gpio' + pin + '/value');
    fs.writeFile(PATH + '/unexport', pin, function (err) {
        if(cb) {
            return cb(err);
        }
    });
}

function isExported(pin, cb) {
    fs.exists(PATH + '/gpio' + pin, function (exists) {
        return cb(null, exists);
    });
}

function Gpio() {
    var self = this,
        currentPins,
        exportedInputPins = {},
        exportedOutputPins = {},
        getPinForCurrentMode,
        pollFrequency = 5007,
        bcmChannels = [
            3,
            5,
            7,
            8,
            10,
            11,
            12,
            13,
            15,
            16,
            18,
            19,
            21,
            22,
            23,
            24,
            26,
            29,
            31,
            32,
            33,
            35,
            36,
            37,
            38,
            40
        ];

    self.DIR_IN = 'in';
    self.DIR_OUT = 'out';
    self.MODE_RPI = 'mode_rpi';
    self.MODE_BCM = 'mode_bcm';

    // Private functions requring access to state
    function setRaspberryVersion(cb) {
        if(currentPins) {
            return cb(null);
        }

        fs.readFile('/proc/cpuinfo', 'utf8', function (err, data) {
            if(err) {
                return cb(err);
            }

            // Match the last 4 digits of the number following "Revision:"
            var match = data.match(/Revision\s*:\s*[0-9a-f]*([0-9a-f]{4})/);
            var revisionNumber = parseInt(match[1], 16);
            var pinVersion = (revisionNumber < 4) ? 'v1' : 'v2';

            debug(
                'seen hardware revision %d; using pin mode %s',
                revisionNumber,
                pinVersion
            );

            currentPins = PINS[pinVersion];

            return cb(null);
        });
    }

    function getPinRpi(channel) {
        return currentPins[channel].toString();
    }

    function getPinBcm(channel) {
        var parsedChannel = parseInt(channel, 10);
        return bcmChannels.indexOf(parsedChannel) !== -1 ? channel : null;
    }

    function createListener(channel, pin) {
        var channelPath = PATH + '/gpio' + pin + '/value';

        debug('listen for pin %d at ' + channelPath, pin);

        fs.watchFile(
            channelPath,
            {
                persistent: true,
                interval: pollFrequency
            },
            function (current, previous) {
                if((current && previous) && current.mtime > previous.mtime) {
                    self.read(channel, function (err, value) {
                        debug(
                            'failed to read value after a change on channel %d:' + err,
                            channel
                        );
                        self.emit('change', channel, value);
                    });
                }
            }
        );
    }

    /**
     * Set pin reference mode. Defaults to 'mode_rpi'.
     *
     * @param {string} mode Pin reference mode, 'mode_rpi' or 'mode_bcm'
     */
    self.setMode = function (mode) {
        if(mode === self.MODE_RPI) {
            getPinForCurrentMode = getPinRpi;
        } else if(mode === self.MODE_BCM) {
            getPinForCurrentMode = getPinBcm;
        } else {
            throw new Error('Cannot set invalid mode');
        }

        self.emit('modeChange', mode);
    };

    /**
     * Set a custom polling frequency for watching pin changes
     *
     * @param {number} value The frequency to poll at, in milliseconds
     */
    self.setPollFrequency = function (value) {
        if(typeof value === 'number') {
            pollFrequency = value;
        }
    };

    /**
     * Setup a channel for use as an input or output
     *
     * @param {number}   channel   Reference to the pin in the current mode's schema
     * @param {string}   direction The pin direction, either 'in' or 'out'
     * @param {function} onSetup   Optional callback
     */
    self.setup = function (channel, direction, onSetup /*err*/ ) {
        if(arguments.length === 2 && typeof direction === 'function') {
            onSetup = direction;
            direction = self.DIR_OUT;
        }

        direction = direction || self.DIR_OUT;
        onSetup = onSetup || function () {
            return;
        };

        if(!channel) {
            return process.nextTick(function () {
                onSetup(new Error('Channel must be a number'));
            });
        }

        if(direction !== self.DIR_IN && direction !== self.DIR_OUT) {
            return process.nextTick(function () {
                onSetup(new Error('Cannot set invalid direction'));
            });
        }

        var pinForSetup;
        async.waterfall([
            setRaspberryVersion,
            function (next) {
                pinForSetup = getPinForCurrentMode(channel);
                if(!pinForSetup) {
                    return next(new Error('Channel ' + channel + ' does not map to a GPIO pin'));
                }
                debug('set up pin %d', pinForSetup);
                isExported(pinForSetup, next);
            },
            function (isExported, next) {
                if(isExported) {
                    return unexportPin(pinForSetup, next);
                }
                return next(null);
            },
            function (next) {
                exportPin(pinForSetup, next);
            },
            function (next) {
                self.emit('export', channel);
                createListener.call(this, channel, pinForSetup);

                if(direction === self.DIR_IN) {
                    exportedInputPins[pinForSetup] = true;
                } else {
                    exportedOutputPins[pinForSetup] = true;
                }

                setDirection(pinForSetup, direction, next);
            }.bind(this)
        ], onSetup);
    };

    /**
     * Write a value to a channel
     *
     * @param {number}   channel The channel to write to
     * @param {boolean}  value   If true, turns the channel on, else turns off
     * @param {function} cb      Optional callback
     */
    self.write = self.output = function (channel, value, cb /*err*/ ) {
        var pin = getPinForCurrentMode(channel);

        if(!exportedOutputPins[pin]) {
            var message;
            if(exportedInputPins[pin]) {
                message = 'Pin ' + pin + ' (Channel ' + channel + ') has been exported for input so cannot be written to';
            } else {
                message = 'Pin ' + pin + ' (Channel ' + channel + ') has not been exported';
            }

            return process.nextTick(function () {
                cb(new Error(message));
            });
        }

        value = (!!value && value !== '0') ? '1' : '0';
        fs.writeFile(PATH + '/gpio' + pin + '/value', value, cb || function () {
            return;
        });
    };

    /**
     * Read a value from a channel
     *
     * @param {number}   channel The channel to read from
     * @param {function} cb      Callback which receives the channel's boolean value
     */
    self.read = self.input = function (channel, cb /*err,value*/ ) {
        var pin = getPinForCurrentMode(channel);

        if(!exportedInputPins[pin]) {
            return process.nextTick(function () {
                cb(new Error('Pin ' + pin + ' (Channel ' + channel + ') has not been exported'));
            });
        }

        fs.readFile(PATH + '/gpio' + pin + '/value', 'utf-8', function (err, data) {
            data = (data.toString()).trim() || '0';
            return cb(err, data === '1');
        });
    };

    /**
     * Unexport any pins setup by this module
     *
     * @param {function} cb Optional callback
     */
    self.destroy = function (cb) {
        var tasks = Object.keys(exportedOutputPins)
            .concat(Object.keys(exportedInputPins))
            .map(function (pin) {
                return function (done) {
                    unexportPin(pin, done);
                };
            });

        async.parallel(tasks, cb);
    };

    /**
     * Reset the state of the module
     */
    self.reset = function () {
        exportedOutputPins = {};
        exportedInputPins = {};
        self.removeAllListeners();

        currentPins = undefined;
        getPinForCurrentMode = getPinRpi;
        pollFrequency = 5007;
    };

    // Init
    EventEmitter.call(this);
    self.reset();
}
util.inherits(Gpio, EventEmitter);

module.exports = new Gpio();
