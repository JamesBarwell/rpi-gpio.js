const fs = require('fs');
const util = require('util');
const EventEmitter = require('events').EventEmitter;
const retry = require('async-retry');
const debug = require('debug')('rpi-gpio');
const Epoll = require('epoll').Epoll;

const PATH = '/sys/class/gpio';
const PINS = {
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

const RETRY_OPTS = {
    retries: 100,
    minTimeout: 10,
    factor: 1
}

const DIR_IN = 'in';
const DIR_OUT = 'out';
const DIR_LOW = 'low';
const DIR_HIGH = 'high';

const MODE_RPI = 'mode_rpi';
const MODE_BCM = 'mode_bcm';

const EDGE_NONE = 'none';
const EDGE_RISING = 'rising';
const EDGE_FALLING = 'falling';
const EDGE_BOTH = 'both';

function Gpio() {
    let currentPins;
    let currentValidBcmPins;
    let exportedInputPins = {};
    let exportedOutputPins = {};
    let getPinForCurrentMode = getPinRpi;
    let pollers = {};

    this.DIR_IN = DIR_IN;
    this.DIR_OUT = DIR_OUT;
    this.DIR_LOW = DIR_LOW;
    this.DIR_HIGH = DIR_HIGH;

    this.MODE_RPI = MODE_RPI;
    this.MODE_BCM = MODE_BCM;

    this.EDGE_NONE = EDGE_NONE;
    this.EDGE_RISING = EDGE_RISING;
    this.EDGE_FALLING = EDGE_FALLING;
    this.EDGE_BOTH = EDGE_BOTH;

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
     * Setup a channel for use as an input or output
     *
     * @param {number}   channel   Reference to the pin in the current mode's schema
     * @param {string}   direction The pin direction, either 'in' or 'out'
     * @param edge       edge Informs the GPIO chip if it needs to generate interrupts. Either 'none', 'rising', 'falling' or 'both'. Defaults to 'none'
     * @param {function|string} onSetup   Optional callback
     */
    this.setup = function (channel, direction, edge, onSetup /*err*/) {
        if (arguments.length === 2 && typeof direction == 'function') {
            onSetup = direction;
            direction = this.DIR_OUT;
            edge = this.EDGE_NONE;
        } else if (arguments.length === 3 && typeof edge == 'function') {
            onSetup = edge;
            edge = this.EDGE_NONE;
        }

        channel = parseInt(channel.toString())
        direction = direction || this.DIR_OUT;
        edge = edge || this.EDGE_NONE;
        onSetup = onSetup || function () {
        };

        if (typeof channel !== 'number') {
            return process.nextTick(function () {
                onSetup(new Error('Channel must be a number'));
            });
        }

        if (direction !== this.DIR_IN &&
            direction !== this.DIR_OUT &&
            direction !== this.DIR_LOW &&
            direction !== this.DIR_HIGH
        ) {
            return process.nextTick(function () {
                onSetup(new Error('Cannot set invalid direction'));
            });
        }

        if ([
            this.EDGE_NONE,
            this.EDGE_RISING,
            this.EDGE_FALLING,
            this.EDGE_BOTH
        ].indexOf(edge) === -1) {
            return process.nextTick(function () {
                onSetup(new Error('Cannot set invalid edge'));
            });
        }

        let pinForSetup;

        const onListen = function (readChannel) {
            this.read(readChannel, function (err, value) {
                if (err) {
                    debug(
                        'Error reading channel value after change, %d',
                        readChannel
                    );
                    return
                }
                debug(
                    'emitting change on channel %s with value %s',
                    readChannel,
                    value
                );
                this.emit('change', readChannel, value);
            }.bind(this));
        }.bind(this);

        setRaspberryVersion()
            .then(function () {
                pinForSetup = getPinForCurrentMode(channel);
                if (!pinForSetup) {
                    throw new Error(
                        'Channel ' + channel + ' does not map to a GPIO pin'
                    );
                }
                debug('set up pin %d', pinForSetup);
                return isExported(pinForSetup)
            })
            .then(function (isExported) {
                if (isExported) {
                    return unexportPin(pinForSetup);
                }
            })
            .then(function () {
                return exportPin(pinForSetup);
            })
            .then(function () {
                return retry(function () {
                    return setEdge(pinForSetup, edge);
                }, RETRY_OPTS);
            })
            .then(function () {
                if (direction === DIR_IN) {
                    exportedInputPins[pinForSetup] = true;
                } else {
                    exportedOutputPins[pinForSetup] = true;
                }

                return retry(function () {
                    return setDirection(pinForSetup, direction)
                }, RETRY_OPTS);
            })
            .then(function () {
                listen(channel, onListen);
            })
            .then(function () {
                onSetup();
            })
            .catch(function (err) {
                onSetup(err);
            });
    };

    /**
     * Write a value to a channel
     *
     * @param {number}   channel The channel to write to
     * @param {boolean|string}  value   If true, turns the channel on, else turns off
     * @param {function} cb      Optional callback
     */
    this.write = this.output = function (channel, value, cb /*err*/) {
        const pin = getPinForCurrentMode(channel);
        cb = cb || function () {
        }

        if (!exportedOutputPins[pin]) {
            return process.nextTick(function () {
                cb(new Error('Pin has not been exported for write'));
            });
        }

        value = (!!value && value !== '0') ? '1' : '0';

        if (process.platform === 'linux') {
            debug('writing pin %d with value %s', pin, value);
            fs.writeFile(PATH + '/gpio' + pin + '/value', value, cb);
        } else {
            debug('simulating writing pin %d with value %s', pin, value);
        }
    };

    /**
     * Read a value from a channel
     *
     * @param {number}   channel The channel to read from
     * @param {function} cb      Callback which receives the channel's boolean value
     */
    this.read = this.input = function (channel, cb /*err,value*/) {
        if (typeof cb !== 'function') {
            throw new Error('A callback must be provided')
        }

        const pin = getPinForCurrentMode(channel);

        if (!exportedInputPins[pin] && !exportedOutputPins[pin]) {
            return process.nextTick(function () {
                cb(new Error('Pin has not been exported'));
            });
        }

        if (process.platform === 'linux') {
            fs.readFile(PATH + '/gpio' + pin + '/value', 'utf-8', function (err, data) {
                if (err) {
                    return cb(err)
                }
                data = (data + '').trim() || '0';
                debug('read pin %s with value %s', pin, data);
                return cb(null, data === '1');
            });
        } else {
            debug('simulating read pin %s with value %s', pin, '1');
            return cb(null, true);
        }
    };

    /**
     * Unexport any pins setup by this module
     *
     * @param {function} cb Optional callback
     */
    this.destroy = function (cb) {
        const tasks = Object.keys(exportedOutputPins)
            .concat(Object.keys(exportedInputPins))
            .map(function (pin) {
                return new Promise(function (resolve, reject) {
                    removeListener(pin, pollers)
                    unexportPin(pin)
                        .then(resolve)
                        .catch(reject);
                });
            });

        Promise.all(tasks)
            .then(function () {
                return cb();
            })
            .catch(function (err) {
                return cb(err);
            });
    };

    /**
     * Reset the state of the module
     */
    this.reset = function () {
        exportedOutputPins = {};
        exportedInputPins = {};
        this.removeAllListeners();

        currentPins = undefined;
        currentValidBcmPins = undefined;
        getPinForCurrentMode = getPinRpi;
        pollers = {}
    };

    // Init
    EventEmitter.call(this);
    this.reset();


    // Private functions requiring access to state
    function setRaspberryVersion() {
        if (currentPins) {
            return Promise.resolve();
        }

        return new Promise(function (resolve, reject) {
            if (process.platform === 'linux') {
                fs.readFile('/proc/cpuinfo', 'utf8', function (err, data) {
                    if (err) {
                        return reject(err);
                    }

                    // Match the last 4 digits of the number following "Revision:"
                    const match = data.match(/Revision\s*:\s*[0-9a-f]*([0-9a-f]{4})/);

                    if (!match) {
                        const errorMessage = 'Unable to match Revision in /proc/cpuinfo: ' + data;
                        return reject(new Error(errorMessage));
                    }

                    const revisionNumber = parseInt(match[1], 16);
                    const pinVersion = (revisionNumber < 4) ? 'v1' : 'v2';

                    debug(
                        'seen hardware revision %d; using pin mode %s',
                        revisionNumber,
                        pinVersion
                    );

                    // Create a list of valid BCM pins for this Raspberry Pi version.
                    // This will be used to validate channel numbers in getPinBcm
                    currentValidBcmPins = []
                    Object.keys(PINS[pinVersion]).forEach(
                        function (pin) {
                            // Lookup the BCM pin for the RPI pin and add it to the list
                            currentValidBcmPins.push(PINS[pinVersion][pin]);
                        }
                    );

                    currentPins = PINS[pinVersion];

                    return resolve();
                });
            } else {
                // Match the last 4 digits of the number following "Revision:"
                const pinVersion = 'v2';

                // Create a list of valid BCM pins for this Raspberry Pi version.
                // This will be used to validate channel numbers in getPinBcm
                currentValidBcmPins = []
                Object.keys(PINS[pinVersion]).forEach(
                    function (pin) {
                        // Lookup the BCM pin for the RPI pin and add it to the list
                        currentValidBcmPins.push(PINS[pinVersion][pin]);
                    }
                );

                currentPins = PINS[pinVersion];

                return resolve();
            }
        });
    }

    function getPinRpi(channel) {
        return currentPins[channel] + '';
    }

    function getPinBcm(channel) {
        channel = parseInt(channel, 10);
        return currentValidBcmPins.indexOf(channel) !== -1 ? (channel + '') : null;
    }

    /**
     * Listen for interrupts on a channel
     *
     * @param {number}      channel The channel to watch
     * @param {function}    onChange Callback which receives the channel's err
     */
    function listen(channel, onChange) {
        if (process.platform !== 'linux')
            return;

        const pin = getPinForCurrentMode(channel);

        if (!exportedInputPins[pin] && !exportedOutputPins[pin]) {
            throw new Error(`Channel ${channel} has not been exported`);
        }

        debug('listen for pin %d', pin);
        const poller = new Epoll(function (err, innerfd) {
            if (err) throw err
            clearInterrupt(innerfd);
            onChange(channel);
        });

        const fd = fs.openSync(PATH + '/gpio' + pin + '/value', 'r+');
        clearInterrupt(fd);
        poller.add(fd, Epoll.EPOLLPRI);
        // Append ready-to-use remove function
        pollers[pin] = function () {
            poller.remove(fd).close();
        }
    }
}

util.inherits(Gpio, EventEmitter);

function setEdge(pin, edge) {
    debug('set edge %s on pin %d', edge.toUpperCase(), pin);
    return new Promise(function (resolve, reject) {
        if (process.platform === 'linux') {
            fs.writeFile(PATH + '/gpio' + pin + '/edge', edge, function (err) {
                if (err) {
                    return reject(err);
                }
                return resolve();
            });
        } else {
            resolve();
        }
    });
}

function setDirection(pin, direction) {
    debug('set direction %s on pin %d', direction.toUpperCase(), pin);
    return new Promise(function (resolve, reject) {
        if (process.platform === 'linux') {
            fs.writeFile(PATH + '/gpio' + pin + '/direction', direction, function (err) {
                if (err) {
                    return reject(err);
                }
                return resolve();
            });
        } else {
            resolve();
        }

    });
}

function exportPin(pin) {
    debug('export pin %d', pin);
    return new Promise(function (resolve, reject) {
        if (process.platform === 'linux') {
            fs.writeFile(PATH + '/export', pin, function (err) {
                if (err) {
                    return reject(err);
                }
                return resolve();
            });
        } else {
            resolve();
        }
    });
}

function unexportPin(pin) {
    debug('unexport pin %d', pin);
    return new Promise(function (resolve, reject) {
        if (process.platform === 'linux') {
            fs.writeFile(PATH + '/unexport', pin, function (err) {
                if (err) {
                    return reject(err);
                }
                return resolve();
            });
        } else {
            resolve();
        }
    });
}

function isExported(pin) {
    return new Promise(function (resolve) {
        if (process.platform === 'linux') {
            fs.access(PATH + '/gpio' + pin, fs.F_OK, function (err) {
                return resolve(!err);
            });
        } else {
            resolve(true);
        }
    });
}

function removeListener(pin, pollers) {
    if (!pollers[pin]) {
        return
    }
    debug('remove listener for pin %d', pin)
    pollers[pin]()
    delete pollers[pin]
}

function clearInterrupt(fd) {
    fs.readSync(fd, Buffer.alloc(1), 0, 1, 0);
}

const GPIO = new Gpio();

// Promise
GPIO.promise = {
    DIR_IN: DIR_IN,
    DIR_OUT: DIR_OUT,
    DIR_LOW: DIR_LOW,
    DIR_HIGH: DIR_HIGH,

    MODE_RPI: MODE_RPI,
    MODE_BCM: MODE_BCM,

    EDGE_NONE: EDGE_NONE,
    EDGE_RISING: EDGE_RISING,
    EDGE_FALLING: EDGE_FALLING,
    EDGE_BOTH: EDGE_BOTH,

    /**
     * @see {@link Gpio.setup}
     * @param channel
     * @param direction
     * @param edge
     * @returns {Promise}
     */
    setup: function (channel, direction, edge) {
        return new Promise(function (resolve, reject) {
            function done(error) {
                if (error) return reject(error);
                resolve();
            }

            GPIO.setup(channel, direction, edge, done)
        })
    },

    /**
     * @see {@link Gpio.write}
     * @param channel
     * @param value
     * @returns {Promise}
     */
    write: function (channel, value) {
        return new Promise(function (resolve, reject) {
            function done(error) {
                if (error) return reject(error);
                resolve();
            }

            GPIO.write(channel, value, done)
        })
    },

    /**
     * @see {@link Gpio.read}
     * @param channel
     * @returns {Promise}
     */
    read: function (channel) {
        return new Promise(function (resolve, reject) {
            function done(error, result) {
                if (error) return reject(error);
                resolve(result);
            }

            GPIO.read(channel, done)
        })
    },

    /**
     * @see {@link Gpio.destroy}
     * @returns {Promise}
     */
    destroy: function () {
        return new Promise(function (resolve, reject) {
            function done(error) {
                if (error) return reject(error);
                resolve();
            }

            GPIO.destroy(done)
        })
    },

    on: GPIO.on.bind(GPIO),
    once: GPIO.once.bind(GPIO),
    addListener: GPIO.addListener.bind(GPIO),
    removeListener: GPIO.removeListener.bind(GPIO),
    removeAllListeners: GPIO.removeAllListeners.bind(GPIO),
};

module.exports = GPIO;
