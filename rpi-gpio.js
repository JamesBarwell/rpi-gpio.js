var fs = require('fs');
var util = require('util');
var EventEmitter = require('events').EventEmitter;
var Promise = require('promise');
var debug = require('debug')('rpi-gpio');
var Epoll = require('epoll').Epoll;
var PATH = '/sys/class/gpio';
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
    var pollers = {};
    var setupResolveType = false;

    this.DIR_IN = 'in';
    this.DIR_OUT = 'out';

    this.MODE_RPI = 'mode_rpi';
    this.MODE_BCM = 'mode_bcm';

    this.EDGE_NONE = 'none';
    this.EDGE_RISING = 'rising';
    this.EDGE_FALLING = 'falling';
    this.EDGE_BOTH = 'both';

    /**
     * Set pin reference mode. Defaults to 'mode_rpi'.
     *
     * @param {string} mode Pin reference mode, 'mode_rpi' or 'mode_bcm'
     */
    this.setMode = function (mode) {
        if (mode === this.MODE_RPI) {
            getPinForCurrentMode = getPinRpi;
        } else if (mode === this.MODE_BCM) {
            getPinForCurrentMode = getPinBcm;
        } else {
            throw new Error('Cannot set invalid mode');
        }
    };

    /**
     * Sets global function return type to objects, Defaults to false
     *
     * @param {boolean}         boolean     When true return objects, false for channel number / `read` value state
     */
    this.setResolveWithObject = function (boolean) {
        setupResolveType = (boolean === true);
    };

    /**
     * Get current global function return type
     *
     * @returns {boolean}      When true objects, false for channel number / `read` value state
     */
    this.getResolveWithObject = function () {
        return (setupResolveType === true);
    };

    /**
     * Setup a channel for use as an input or output
     *
     * @param {number, object}  channel     Reference to the pin in the current mode's schema or
     * @param {string}          direction   The pin direction, either 'in' or 'out'
     * @param edge              edge        Informs the GPIO chip if it needs to generate interrupts. Either 'none', 'rising', 'falling' or 'both'. Defaults to 'none'
     * @param {boolean}         type        Defines the resolve value
     * @param {function}        onSetup     Optional callback
     * @returns {Promise}       Returns a Promise when callback is null.
     *                          Promise resolves with channel number or the channel object and the resulting values for keys: 'channel', 'direction', 'edge', 'type'
     *                          can be changed globally with `setupResolveType` or given the key 'type'.
     */
    this.setup = function (channel, direction, edge, type, onSetup /*err*/) {
        if (arguments.length === 2 && typeof direction == 'function') {
            onSetup = direction;
            direction = this.DIR_OUT;
            edge = this.EDGE_NONE;
        } else if (arguments.length === 3 && typeof edge == 'function') {
            onSetup = edge;
            edge = this.EDGE_NONE;
        }
        else if (arguments.length === 4 && typeof type == 'function') {
            onSetup = type;
            type = setupResolveType;
        }

        var params = {
            'channel':   null,
            'direction': direction || this.DIR_OUT,
            'edge':      edge || this.EDGE_NONE,
            'type':      type || setupResolveType
        };

        // Assign channel to params
        if (channel && typeof(channel) == 'object') {
            params = Object.assign(params, channel);
        } else {
            params['channel'] = channel;
        }

        channel = parseInt(params['channel']);
        direction = params['direction'];
        edge = params['edge'];
        onSetup = (typeof onSetup == 'function') ? onSetup : null;

        debug('channel: %d, direction: %d, edge : %d', channel, direction, edge);
        if (isNaN(channel)) {
            return new Promise.reject(new Error('Channel must be a number')).nodeify(onSetup);
        }
        if (direction !== this.DIR_IN && direction !== this.DIR_OUT) {
            return new Promise.reject(new Error('Cannot set invalid direction')).nodeify(onSetup);
        }
        if (!params.hasOwnProperty('type') || (params['type'] !== true && params['type'] !== false)) {
            return new Promise.reject(new Error('Cannot set invalid resolve mode true or false')).nodeify(onSetup);
        }
        if ([
                this.EDGE_NONE,
                this.EDGE_RISING,
                this.EDGE_FALLING,
                this.EDGE_BOTH
            ].indexOf(edge) == -1) {
            return new Promise.reject(new Error('Cannot set invalid edge')).nodeify(onSetup);
        }

        var pinForSetup;
        return setRaspberryVersion()
            .then(function () {
                    pinForSetup = getPinForCurrentMode(channel);
                    if (!pinForSetup) {
                        return new Promise.reject(new Error('Channel ' + channel + ' does not map to a GPIO pin'));
                    }
                    debug('set up pin %d', pinForSetup);

                    return isExported(pinForSetup)
                        .then(function (data) {
                            if (data) return unexportPin(pinForSetup)
                        })
                }
            )
            .then(function () {
                return exportPin(pinForSetup)
            })
            .then(function () {
                return setEdge(pinForSetup, edge)
            })
            .then(function () {
                if (direction === this.DIR_IN) {
                    exportedInputPins[pinForSetup] = true;
                } else {
                    exportedOutputPins[pinForSetup] = true;
                }

                return setDirection(pinForSetup, direction);
            }.bind(this))
            .then(function () {
                listen(channel, function (readChannel) {
                    this.read(readChannel)
                        .then(function (value) {
                                debug('emitting change on channel %s with value %s', readChannel, value);
                                this.emit('change', readChannel, value);
                            },
                            function (err) {
                                debug(
                                    'Error reading channel value after change, %d',
                                    readChannel
                                );
                            })
                }.bind(this));
            }.bind(this))
            .then(function () {
                return (params['type'] ? params : channel);
            })
            .nodeify(onSetup);
    };

    /**
     * Write a value to a channel
     *
     * @param {number, object}   channel    The channel to write to
     * @param {boolean}  value   If true, turns the channel on, else turns off
     * @param {function} cb      Optional callback
     * @returns {Promise}        Returns a Promise when callback is null
     *                           Promise resolves with channel number or the channel object and the resulting values for keys: 'channel', 'value', 'type'
     *                           can be changed globally with `setupResolveType` or given the key 'type'.
     */
    this.write = this.output = function (channel, value, type, cb /*err*/) {
        if (arguments.length === 3 && typeof type == 'function') {
            cb = type;
            type = setupResolveType;
        }

        var params = {
            'channel': null,
            'value':   value,
            'type':    type || setupResolveType
        };
        if (channel && typeof(channel) == 'object') {
            Object.assign(params, channel);
        } else {
            params['channel'] = channel;
        }

        channel = params['channel'];
        value = params['value'];
        type = params['type'];

        var pin = getPinForCurrentMode(channel);
        if (!exportedOutputPins[pin]) {
            return new Promise.reject(new Error('Pin has not been exported for write')).nodeify(cb);
        }

        value = (!!value && value !== '0') ? '1' : '0';

        debug('writing pin %d with value %s', pin, value);
        return writeToPath(PATH + '/gpio' + pin + '/value', value)
            .then(function () {
                return (type === true ? params : channel)
            })
            .nodeify(cb);

    };

    /**
     * Read a value from a channel
     *
     * @param {number, object}   channel    The channel to read from
     * @param {function} cb      Callback   which receives the channel's boolean value
     * @returns {Promise}        Returns a Promise when callback is null
     *                           Promise resolves with read value or the channel object and the resulting values for keys: 'channel', 'value', 'type'
     *                           can be changed globally with `setupResolveType` or given the key 'type'.
     */
    this.read = this.input = function (channel, type, cb /*err,value*/) {
        if (arguments.length === 2 && typeof type == 'function') {
            cb = type;
            type = setupResolveType;
        }

        var params = {
            'channel': null,
            'type':    type || setupResolveType
        };
        if (channel && typeof(channel) == 'object') {
            Object.assign(params, channel);
        } else {
            params['channel'] = channel;
        }

        channel = params['channel'];
        type = params['type'];

        var pin = getPinForCurrentMode(channel);
        if (!exportedInputPins[pin] && !exportedOutputPins[pin]) {
            return new Promise.reject(new Error('Pin has not been exported')).nodeify(cb);
        }

        return readFromPath(PATH + '/gpio' + pin + '/value', 'utf-8')
            .then(function (data) {
                data = (data + '').trim() || '0';
                debug('read pin %s with value %s', pin, data);
                return (data === '1');
            })
            .then(function (readResult) {
                if (params['type']) {
                    params['value'] = readResult;
                    return params;
                } else {
                    return readResult;
                }
            })
            .nodeify(cb);
    };

    /**
     * Unexport any pins setup by this module
     *
     * @param {function} cb      Callback which receives the channel's boolean value
     * @returns {Promise}        Returns a Promise when callback is null
     */
    this.destroy = function (cb /*err*/) {
        return Promise.all(
            Object.keys(exportedOutputPins)
                .concat(Object.keys(exportedInputPins))
                .map(function (pin) {
                    return Promise.all([removeListener(pin, pollers), unexportPin(pin)])
                }))
            .nodeify(cb);
    };

    /**
     * Reset the state of the module
     */
    this.reset = function () {
        exportedOutputPins = {};
        exportedInputPins = {};
        this.removeAllListeners();

        currentPins = undefined;
        getPinForCurrentMode = getPinRpi;
        pollers = {}
    };

// Init
    EventEmitter.call(this);
    this.reset();


// Private functions requiring access to state
    function setRaspberryVersion(cb) {
        return new Promise(function (resolve, reject) {
            if (currentPins) return resolve();

            readFromPath('/proc/cpuinfo', 'utf8')
                .then(function (data) {
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

                    resolve();
                }, reject)
        }).nodeify(cb);
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

    /**
     * Listen for interrupts on a channel
     *
     * @param {number}      channel The channel to watch
     * @param {function}    onChange Callback which receives the channel's err
     */
    function listen(channel, onChange) {
        var pin = getPinForCurrentMode(channel);

        if (!exportedInputPins[pin] && !exportedOutputPins[pin]) {
            throw new Error('Channel %d has not been exported', channel);
        }

        debug('listen for pin %d', pin);
        var poller = new Epoll(function (err, innerfd, events) {
            if (err) throw err
            clearInterrupt(innerfd);
            onChange(channel);
        });

        var fd = fs.openSync(PATH + '/gpio' + pin + '/value', 'r+');
        clearInterrupt(fd);
        poller.add(fd, Epoll.EPOLLPRI);
        // Append ready-to-use remove function
        pollers[pin] = function () {
            poller.remove(fd).close();
        }
    };
}
util.inherits(Gpio, EventEmitter);

function setEdge(pin, edge, cb) {
    debug('set edge %s on pin %d', edge.toUpperCase(), pin);
    return writeToPath(PATH + '/gpio' + pin + '/edge', edge).nodeify(cb);
}

function setDirection(pin, direction, cb) {
    debug('set direction %s on pin %d', direction.toUpperCase(), pin);
    return writeToPath(PATH + '/gpio' + pin + '/direction', direction).nodeify(cb);
}

function exportPin(pin, cb) {
    debug('export pin %d', pin);
    return writeToPath(PATH + '/export', pin).nodeify(cb);
}

function unexportPin(pin, cb) {
    debug('unexport pin %d', pin);
    return writeToPath(PATH + '/unexport', pin).nodeify(cb);
}

function writeToPath(fullPATH, pin) {
    return new Promise(function (resolve, reject) {
        fs.writeFile(fullPATH, pin, function (err) {
            if (err) return reject(err);
            resolve();
        })
    })
}

function readFromPath(fullPATH, encoding) {
    return new Promise(function (resolve, reject) {
        fs.readFile(fullPATH, encoding, function (err, data) {
            if (err) return reject(err);
            resolve(data);
        })
    })
}

function isExported(pin, cb) {
    return new Promise(function (resolve, reject) {
        fs.exists(PATH + '/gpio' + pin, function (exists) {
            resolve(exists);
            reject(null);
        });
    }).nodeify(cb);
}

function removeListener(pin, pollers) {
    if (!pollers[pin]) {
        return
    }
    debug('remove listener for pin %d', pin);
    pollers[pin]();
    delete pollers[pin]
}

function clearInterrupt(fd) {
    fs.readSync(fd, new Buffer(1), 0, 1, 0);
}

module.exports = new Gpio;