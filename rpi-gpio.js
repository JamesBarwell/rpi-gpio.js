var fs           = require('fs');
var util         = require('util');
var EventEmitter = require('events').EventEmitter;
var async        = require('async');
var debug        = require('debug')('rpi-gpio');
var Epoll        = require('epoll').Epoll;

var PATH = '/sys/class/gpio';
var POLLERS = [];
var PINS = {
    v1: {
        // 1: 3.3v
        // 2: 5v
        '3':  0,
        // 4: 5v
        '5':  1,
        // 6: ground
        '7':  4,
        '8':  14,
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
        '3':  2,
        // 4: 5v
        '5':  3,
        // 6: ground
        '7':  4,
        '8':  14,
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

function Gpio() {
    var currentPins;
    var exportedInputPins = {};
    var exportedOutputPins = {};
    var getPinForCurrentMode = getPinRpi;

    this.DIR_IN   = 'in';
    this.DIR_OUT  = 'out';
    this.MODE_RPI = 'mode_rpi';
    this.MODE_BCM = 'mode_bcm';

    this.EDGE_NONE    = 'none';
    this.EDGE_RISING  = 'rising';
    this.EDGE_FALLING = 'falling';
    this.EDGE_BOTH    = 'both';

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
     * @param edge       edge Informs the GPIO chip if it needs to generate interrupts. Either 'none', 'rising', 'falling' or 'both'. Defaults to 'none'
     * @param {function} onSetup   Optional callback
     */
    this.setup = function(channel, direction, edge, onSetup /*err*/) {
        if (arguments.length === 2 && typeof direction == 'function') {
            onSetup = direction;
            direction = this.DIR_OUT;
            edge = this.EDGE_NONE;
        } else if (arguments.length === 3 && typeof edge == 'function') {
            onSetup = edge;
            edge = this.EDGE_NONE;
        }

        direction = direction || this.DIR_OUT;
        edge = edge || this.EDGE_NONE;
        onSetup = onSetup || function() {};

        if (!channel) {
            return process.nextTick(function() {
                onSetup(new Error('Channel must be a number'));
            });
        }

        if (direction !== this.DIR_IN && direction !== this.DIR_OUT) {
            return process.nextTick(function() {
                onSetup(new Error('Cannot set invalid direction'));
            });
        }

        if (edge !== this.EDGE_NONE && edge !== this.EDGE_RISING && edge !== this.EDGE_FALLING && edge !== this.EDGE_BOTH) {
            return process.nextTick(function() {
                onSetup(new Error('Cannot set invalid edge'));
            });
        }

        var pinForSetup;
        async.waterfall([
            setRaspberryVersion,
            function(next) {
                pinForSetup = getPinForCurrentMode(channel);
                if (!pinForSetup) {
                    return next(new Error('Channel ' + channel + ' does not map to a GPIO pin'));
                }
                debug('set up pin %d', pinForSetup);
                isExported(pinForSetup, next);
            },
            function(isExported, next) {
                if (isExported) {
                    return unexportPin(pinForSetup, next);
                }
                return next(null);
            },
            function(next) {
                exportPin(pinForSetup, next);
            },
            function(next) {
                setEdge(pinForSetup, edge, next);
            },
            function(next) {
                this.emit('export', channel);

                if (direction === this.DIR_IN) {
                    exportedInputPins[pinForSetup] = true;
                } else {
                    exportedOutputPins[pinForSetup] = true;
                }

                setDirection(pinForSetup, direction, next);
            }.bind(this),
            function(next) {
                this.listen(channel, next);
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
    this.write = this.output = function(channel, value, cb /*err*/) {
        var pin = getPinForCurrentMode(channel);

        if (!exportedOutputPins[pin]) {
            var message;
            if (exportedInputPins[pin]) {
                message = 'Pin has been exported for input so cannot be written to';
            } else {
                message = 'Pin has not been exported';
            }

            return process.nextTick(function() {
                cb(new Error(message));
            });
        }

        value = (!!value && value !== '0') ? '1' : '0';
        fs.writeFile(PATH + '/gpio' + pin + '/value', value, cb || function() {});
    };

    /**
     * Read a value from a channel
     *
     * @param {number}   channel The channel to read from
     * @param {function} cb      Callback which receives the channel's boolean value
     */
    this.read = this.input = function(channel, cb /*err,value*/) {
        var pin = getPinForCurrentMode(channel);

        if (!exportedInputPins[pin] && !exportedOutputPins[pin]) {
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
     * Listen for interrupts on a channel
     *
     * @param {number}      channel The channel to watch
     * @param {function}    cb Callback which receives the channel's err
     */
    this.listen = function(channel, cb /*err*/) {

        var _this = this;
        var pin = getPinForCurrentMode(channel);
        if (!exportedInputPins[pin] && !exportedOutputPins[pin]) {
            return process.nextTick(function() {
                cb(new Error('Pin has not been exported'));
            });
        }

        POLLERS.forEach(function(map) {
            if (map.pin == pin) {
                return process.nextTick(function() {
                    cb(new Error('Already watching that pin!'));
                });
            }
        });

        createListener(channel, pin, function(readChannel) {

            _this.read(readChannel, function(err, value) {
                debug(
                    'failed to read value after a change on channel %d',
                    readChannel
                );
                _this.emit('change', readChannel, value);
            });
        });
        return cb(null)
    };

    /**
     * Stop listening for interrupts on a channel
     *
     * @param {number}      channel The channel to stop watching
     * @param {function}    cb Callback which receives the channel's err
     */
    this.stopListening = function(channel, cb /*err*/) {
        pin = getPinForCurrentMode(channel);
        cb = cb || function() {};

        if (!exportedInputPins[pin] && !exportedOutputPins[pin]) {
            return process.nextTick(function() {
                cb(new Error('Pin has not been exported'));
            });
        }

        removeListener(pin, cb)
    };

    /**
     * Unexport any pins setup by this module
     *
     * @param {function} cb Optional callback
     */
    this.destroy = function(cb) {
        var _this = this;
        var tasks = Object.keys(exportedOutputPins)
            .concat(Object.keys(exportedInputPins))
            .map(function(pin) {
                return function(done) {
                    removeListener(pin, function() { })
                    unexportPin(pin, done);
                }
            });

        async.parallel(tasks, cb);
    };

    /**
     * Reset the state of the module
     */
    this.reset = function() {
        exportedOutputPins = {};
        exportedInputPins = {};
        this.removeAllListeners();

        currentPins = undefined;
        getPinForCurrentMode = getPinRpi;
        POLLERS = []
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

            currentPins = PINS[pinVersion];

            return cb(null);
        });
    };

    function getPinRpi(channel) {
        return currentPins[channel] + '';
    };

    function getPinBcm(channel) {
        channel = parseInt(channel, 10);
        return [
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
        ].indexOf(channel) !== -1 ? (channel + '') : null;
    };
}
util.inherits(Gpio, EventEmitter);

function setEdge(pin, edge, cb) {
    debug('set edge %s on pin %d', edge.toUpperCase(), pin);
    fs.writeFile(PATH + '/gpio' + pin + '/edge', edge, function(err) {
        if (cb) return cb(err);
    });
}

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
    fs.writeFile(PATH + '/unexport', pin, function(err) {
        if (cb) return cb(err);
    });
}

function isExported(pin, cb) {
    fs.exists(PATH + '/gpio' + pin, function(exists) {
        return cb(null, exists);
    });
}

function createListener(channel, pin, cb) {
    debug('listen for pin %d', pin);
    var fd = fs.openSync(PATH + '/gpio' + pin + '/value', 'r+');

    var poller = new Epoll(function(err, fd, events) {

        clearInterrupt(fd);
        cb(channel);
    });

    clearInterrupt(fd);
    poller.add(fd, Epoll.EPOLLPRI);
    POLLERS.push({pin: pin, poller: poller, fd: fd});
}

function removeListener(pin, cb) {
    POLLERS.forEach(function(map, index) {
        if (map.pin == pin) {
            map.poller.remove(map.fd).close();
            POLLERS.splice(index, 1);
            return cb(null);
        }
    });
}

function clearInterrupt(fd) {
    fs.readSync(fd, new Buffer(1), 0, 1, 0);
}

module.exports = new Gpio;
