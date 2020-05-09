import { EventEmitter } from 'events';
import  retry from 'async-retry'
import { exists, writeFile, readFile, readSync, openSync } from 'fs';
import { Epoll } from 'epoll';

const debug = require('debug')('rpi-gpio');

type Pins = {[key: string]: number | undefined};
type PinVersion = 'v1' | 'v2';

const PATH = '/sys/class/gpio';
const PINS: Record<PinVersion, Pins> = {
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

const RETRY_OPTS = {
    retries: 100,
    minTimeout: 10,
    factor: 1
}

type MODE = 'mode_rpi' | 'mode_bcm';
type DIR = 'in' | 'out' | 'low' | 'high';
type EDGE = 'none' | 'rising' | 'falling' | 'both';

type ValueCallback<T> = (err?: Error | null, value?: T) => void
type ErrorCallback = (err?: Error | null) => void

const DIR_IN: DIR   = 'in';
const DIR_OUT: DIR  = 'out';
const DIR_LOW: DIR  = 'low';
const DIR_HIGH: DIR = 'high';

const MODE_RPI: MODE = 'mode_rpi';
const MODE_BCM: MODE = 'mode_bcm';

const EDGE_NONE: EDGE    = 'none';
const EDGE_RISING: EDGE  = 'rising';
const EDGE_FALLING: EDGE = 'falling';
const EDGE_BOTH: EDGE    = 'both';

class Gpio extends EventEmitter {

    constructor(){
        super();
        this.reset();
    }

    private currentPins: Pins | undefined;
    private currentValidBcmPins: number[] = [];
    private exportedInputPins: {[key: string]: boolean | undefined} = {};
    private exportedOutputPins: {[key: string]: boolean | undefined} = {};
    private getPinForCurrentMode = this.getPinRpi;
    private pollers: {[key: string]: (() => void) | undefined} = {};

    public readonly DIR_IN   = DIR_IN;
    public readonly DIR_OUT  = DIR_OUT;
    public readonly DIR_LOW  = DIR_LOW;
    public readonly DIR_HIGH = DIR_HIGH;

    public readonly MODE_RPI = MODE_RPI;
    public readonly MODE_BCM = MODE_BCM;

    public readonly EDGE_NONE    = EDGE_NONE;
    public readonly EDGE_RISING  = EDGE_RISING;
    public readonly EDGE_FALLING = EDGE_FALLING;
    public readonly EDGE_BOTH    = EDGE_BOTH;

    /**
     * Set pin reference mode. Defaults to 'mode_rpi'.
     *
     * @param {string} mode Pin reference mode, 'mode_rpi' or 'mode_bcm'
     */
    public setMode(mode: MODE) {
        if (mode === MODE_RPI) {
            this.getPinForCurrentMode = this.getPinRpi;
        } else if (mode === MODE_BCM) {
            this.getPinForCurrentMode = this.getPinBcm;
        } else {
            throw new Error('Cannot set invalid mode');
        }
    };

    /**
     * Setup a channel for use as an input or output
     *
     * @param {number}   channel   Reference to the pin in the current mode's schema
     * @param {string}   _direction The pin direction, either 'in' or 'out'
     * @param _edge       edge Informs the GPIO chip if it needs to generate interrupts. Either 'none', 'rising', 'falling' or 'both'. Defaults to 'none'
     * @param {function} _onSetup  callback
     */
    public setup(channel: number, onSetup?: ValueCallback<boolean>): void;
    public setup(channel: number, direction?: DIR, onSetup?: ValueCallback<boolean>): void;
    public setup(channel: number, direction?: DIR, edge?: EDGE, onSetup?: ValueCallback<boolean>): void;
    public setup(channel: number, direction?: DIR | ValueCallback<boolean>, edge?: EDGE | ValueCallback<boolean>, onSetup?: ValueCallback<boolean>) {

        let _direction = typeof direction === "string" ? direction : this.DIR_OUT;
        let _edge: EDGE = typeof edge === "string" ? edge : this.EDGE_NONE;
        let _onSetup: ValueCallback<boolean>;

        if (arguments.length === 2 && typeof direction == 'function') {
            _onSetup = direction;
        } else if (arguments.length === 3 && typeof edge == 'function') {
            _onSetup = edge;
        } else {
            _onSetup = onSetup || function() {};
        }

        if (typeof channel !== 'number') {
            return process.nextTick(() => {
                _onSetup(new Error('Channel must be a number'));
            });
        }

        if (_direction !== this.DIR_IN &&
            _direction !== this.DIR_OUT &&
            _direction !== this.DIR_LOW &&
            _direction !== this.DIR_HIGH
        ) {
            return process.nextTick(function() {
                _onSetup(new Error('Cannot set invalid direction'));
            });
        }

        if ([
            this.EDGE_NONE,
            this.EDGE_RISING,
            this.EDGE_FALLING,
            this.EDGE_BOTH
        ].indexOf(_edge) == -1) {
            return process.nextTick(function() {
                _onSetup(new Error('Cannot set invalid edge'));
            });
        }

        let pinForSetup: string | undefined;

        const onListen = (readChannel: string) => {
            this.read(parseInt(readChannel), (err?: Error | null, value?: boolean) => {
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
            });
        };

        this.setRaspberryVersion()
            .then(() => {
                pinForSetup = this.getPinForCurrentMode(channel);
                if (!pinForSetup) {
                    throw new Error(
                        'Channel ' + channel + ' does not map to a GPIO pin'
                    );
                }
                debug('set up pin %d', pinForSetup);
                return isExported(pinForSetup!)
            })
            .then(isExported => {
                if (isExported) {
                    return unexportPin(pinForSetup!);
                }
            })
            .then(() => {
                return exportPin(pinForSetup!);
            })
            .then(() => {
                return retry(() => {
                    return setEdge(pinForSetup!, _edge);
                }, RETRY_OPTS);
            })
            .then(() => {
                if (_direction === DIR_IN) {
                    this.exportedInputPins[pinForSetup!] = true;
                } else {
                    this.exportedOutputPins[pinForSetup!] = true;
                }

                return retry(() => {
                    return setDirection(pinForSetup!, _direction)
                }, RETRY_OPTS);
            })
            .then(() => {
                this.listen(channel, onListen);
            })
            .then(() => {
                _onSetup();
            })
            .catch(function(err) {
                _onSetup(err);
            });
    };

    /**
     * Write a value to a channel
     *
     * @param {number}   channel The channel to write to
     * @param {boolean}  value   If true, turns the channel on, else turns off
     * @param {function} cb      Optional callback
     */
    public write(channel: number, value: boolean, cb?: ErrorCallback) {
        var pin = this.getPinForCurrentMode(channel);
        const callback = cb || function() {}

        if (!pin || !this.exportedOutputPins[pin]) {
            return process.nextTick(function() {
                callback(new Error('Pin has not been exported for write'));
            });
        }

        const writtenValue = (!!value && (value as any) !== '0') ? '1' : '0';

        debug('writing pin %d with value %s', pin, value);
        writeFile(PATH + '/gpio' + pin + '/value', writtenValue, callback);
    };

    /**
     * Write a value to a channel
     *
     * @param {number}   channel The channel to write to
     * @param {boolean}  value   If true, turns the channel on, else turns off
     * @param {function} cb      Optional callback
     */
    public output(channel: number, value: boolean, cb?: ErrorCallback){
        this.write(channel, value, cb);
    }

    /**
     * Read a value from a channel
     *
     * @param {number}   channel The channel to read from
     * @param {function} cb      Callback which receives the channel's boolean value
     */
    public read(channel: number, cb: ValueCallback<boolean> /*err,value*/) {
        if (typeof cb !== 'function') {
            throw new Error('A callback must be provided')
        }

        const pin = this.getPinForCurrentMode(channel);

        console.log(`READ ${pin} ${typeof pin}`);

        if (!pin || !this.exportedInputPins[pin] && !this.exportedOutputPins[pin]) {
            return process.nextTick(function() {
                cb(new Error('Pin has not been exported'));
            });
        }

        readFile(PATH + '/gpio' + pin + '/value', 'utf-8', function(err, data) {
            if (err) {
                return cb(err)
            }
            data = (data + '').trim() || '0';
            debug('read pin %s with value %s', pin, data);
            return cb(null, data === '1');
        });
    };

    /**
     * Read a value from a channel
     *
     * @param {number}   channel The channel to read from
     * @param {function} cb      Callback which receives the channel's boolean value
     */
    public input(channel: number, cb: ValueCallback<boolean>) {
        this.read(channel, cb);
    }

    /**
     * Unexport any pins setup by this module
     *
     * @param {function} cb callback
     */
    public destroy(cb: ErrorCallback) {
        var tasks = Object.keys(this.exportedOutputPins)
            .concat(Object.keys(this.exportedInputPins))
            .map((pin) => {
                return new Promise((resolve, reject) => {
                    removeListener(pin, this.pollers)
                    unexportPin(pin)
                        .then(resolve)
                        .catch(reject);
                });
            });

        Promise.all(tasks)
            .then(function() {
                return cb();
            })
            .catch(function(err) {
                return cb(err);
            });
    };

    /**
     * Reset the state of the module
     */
    public reset() {
        this.exportedOutputPins = {};
        this.exportedInputPins = {};
        this.removeAllListeners();

        this.currentPins = undefined;
        this.currentValidBcmPins = [];
        this.getPinForCurrentMode = this.getPinRpi;
        this.pollers = {}
    };



    // Private functions requiring access to state
    private setRaspberryVersion() {
        if (this.currentPins) {
            return Promise.resolve();
        }

        return new Promise((resolve, reject) => {
            readFile('/proc/cpuinfo', 'utf8', (err, data) => {
                if (err) {
                    return reject(err);
                }


                // Match the last 4 digits of the number following "Revision:"
                var match = data.match(/Revision\s*:\s*[0-9a-f]*([0-9a-f]{4})/);

                if (!match) {
                    var errorMessage = 'Unable to match Revision in /proc/cpuinfo: ' + data;
                    return reject(new Error(errorMessage));
                }

                var revisionNumber = parseInt(match[1], 16);
                var pinVersion: PinVersion = (revisionNumber < 4) ? 'v1' : 'v2';

                debug(
                    'seen hardware revision %d; using pin mode %s',
                    revisionNumber,
                    pinVersion
                );

                // Create a list of valid BCM pins for this Raspberry Pi version.
                // This will be used to validate channel numbers in getPinBcm
                this.currentValidBcmPins = []
                Object.keys(PINS[pinVersion]).forEach(
                  (pin) => {
                    const pinName = PINS[pinVersion][pin];
                    if(pinName == null){
                        return;
                    }
                    // Lookup the BCM pin for the RPI pin and add it to the list
                    this.currentValidBcmPins.push(pinName);
                  }
                );

                this.currentPins = PINS[pinVersion];

                return resolve();
            });
        });
    };

    private getPinRpi(channel: number): string | undefined {
        return this.currentPins != null ? this.currentPins[channel]?.toString() : undefined;
    };

    private getPinBcm(channel: number): string | undefined {
        return this.currentValidBcmPins.indexOf(channel) !== -1 ? channel.toString() : undefined;
    };

    /**
     * Listen for interrupts on a channel
     *
     * @param {number}      channel The channel to watch
     * @param {function}    cb Callback which receives the channel's err
     */
    private listen(channel: number, onChange: (channel: string) => void) {
        var pin = this.getPinForCurrentMode(channel);

        if (!pin || !this.exportedInputPins[pin] && !this.exportedOutputPins[pin]) {
            throw new Error(`Channel ${channel} has not been exported`);
        }

        debug('listen for pin %d', pin);
        var poller = new Epoll((err: any, innerfd: number) => {
            if (err) throw err
            clearInterrupt(innerfd);
            onChange(pin!);
        });

        var fd = openSync(PATH + '/gpio' + pin + '/value', 'r+');
        clearInterrupt(fd);
        poller.add(fd, Epoll.EPOLLPRI);
        // Append ready-to-use remove function
        this.pollers[pin] = () => {
            poller.remove(fd).close();
        }
    };

    public readonly promise = {
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
        setup: (channel: number, direction: DIR, edge: EDGE) => {
            return new Promise((resolve, reject) => {
                function done(error: any) {
                    if (error) return reject(error);
                    resolve();
                }
    
                this.setup(channel, direction, edge, done)
            })
        },
    
        /**
         * @see {@link Gpio.write}
         * @param channel
         * @param value
         * @returns {Promise}
         */
        write: (channel: number, value: boolean) => {
            return new Promise((resolve, reject) => {
                function done(error: any) {
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
        read:  (channel: number) => {
            return new Promise((resolve, reject) => {
                function done(error: any, result?: boolean) {
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
        destroy: () => {
            return new Promise((resolve, reject) => {
                function done(error: any) {
                    if (error) return reject(error);
                    resolve();
                }
    
                GPIO.destroy(done)
            })
        }
    }
}

function setEdge(pin: string, edge: EDGE) {
    debug('set edge %s on pin %d', edge.toUpperCase(), pin);
    return new Promise(function(resolve, reject) {
        writeFile(PATH + '/gpio' + pin + '/edge', edge, (err) => {
            if (err) {
                return reject(err);
            }
            return resolve();
        });
    });
}

function setDirection(pin: string, direction: DIR) {
    debug('set direction %s on pin %d', direction.toUpperCase(), pin);
    return new Promise(function(resolve, reject) {
        writeFile(PATH + '/gpio' + pin + '/direction', direction, (err) => {
            if (err) {
                return reject(err);
            }
            return resolve();
        });
    });
}

function exportPin(pin: string) {
    debug('export pin %d', pin);
    return new Promise(function(resolve, reject) {
        writeFile(PATH + '/export', pin, (err) => {
            if (err) {
                return reject(err);
            }
            return resolve();
        });
    });
}

function unexportPin(pin: string) {
    debug('unexport pin %d', pin);
    return new Promise(function(resolve, reject) {
        writeFile(PATH + '/unexport', pin, (err) => {
            if (err) {
                return reject(err);
            }
            return resolve();
        });
    });
}

function isExported(pin: string) {
    return new Promise<boolean>((resolve) => {
        exists(PATH + '/gpio' + pin, exists => {
            return resolve(exists);
        });
    });
}

function removeListener(pin: string, pollers: {[key: string]: (() => void) | undefined}) {
    const poller = pollers[pin];
    if (poller == null) {
        return
    }
    debug('remove listener for pin %d', pin)
    poller()
    delete pollers[pin]
}

function clearInterrupt(fd: number) {
    readSync(fd, Buffer.alloc(1), 0, 1, 0);
}

const GPIO = new Gpio();

export = GPIO;
