var fs     = require('fs'),
    util   = require('util'),
    EventEmitter = require('events').EventEmitter,
    // path.exists for 0.6.x support
    path = require('path');

// Constants
var PATH = '/sys/class/gpio';

// Constructor
function Gpio() {
    EventEmitter.call(this);
    this.reset();
}
util.inherits(Gpio, EventEmitter);

// Class constants
Gpio.prototype.DIR_IN  = 'in';
Gpio.prototype.DIR_OUT = 'out';
Gpio.prototype.MODE_RPI = function(channel) {
    return {
        // RPi to BCM
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
    }[channel] + '';
};
Gpio.prototype.MODE_BCM = function(channel) {
    return channel + '';
};

/**
 * Set pin reference mode. Defaults to 'rpi'.
 *
 * @param {string} mode Pin reference mode, 'rpi' or 'bcm'
 */
Gpio.prototype.setMode = function(mode) {
    if (mode !== this.MODE_RPI && mode !== this.MODE_BCM) {
        throw new Error('Cannot set invalid mode');
    }
    this.getPin = mode;
    this.emit('modeChange', mode);
}

/**
 * Setup a channel for use as an input or output
 *
 * @param {number}   channel   Reference to the pin in the current mode's schema
 * @param {string}   direction The pin direction, either 'in' or 'out'
 * @param {function} cb        Optional callback
 */
Gpio.prototype.setup = function(channel, direction, cb /*err*/) {
    if (!channel) {
        return cb(new Error('Channel not specified'));
    }

    direction = direction || this.DIR_OUT;

    if (typeof direction === 'function') {
        cb = direction;
        direction = this.DIR_OUT;
    }

    if (direction !== this.DIR_IN && direction !== this.DIR_OUT) {
        return cb(new Error('Cannot set invalid direction'));
    }

    var pin = this.getPin(channel);

    var self = this;
    function doExport() {
        exportPin(pin, function() {
            self.exportedPins[pin] = true;
            self.emit('export', channel);
            setListener(pin, function() {
                self.read(channel, function(err, value) {
                    if (err) return cb(err);
                    self.emit('change', channel, value);
                });
            });
            setDirection(pin, direction, cb);
        });
    }

    // Unexport pin if already open
    isExported(pin, function(isOpen) {
        if (isOpen) {
            unexportPin(pin, doExport);
        } else {
            doExport();
        }
    }.bind(this));
}

/**
 * Write a value to a channel
 *
 * @param {number}   channel The channel to write to
 * @param {boolean}  value   If true, turns the channel on, else turns off
 * @param {function} cb      Optional callback
 */
Gpio.prototype.write = function(channel, value, cb /*err*/ ) {
    var pin = this.getPin(channel);
    value = (!!value && value !== '0') ? '1' : '0';
    fs.writeFile(PATH + '/gpio' + pin + '/value', value, function(err) {
        if (cb) return cb(err);
    }.bind(this));
};
Gpio.prototype.output = Gpio.prototype.write;

/**
 * Read a value from a channel
 *
 * @param {number}   channel The channel to read from
 * @param {function} cb      Callback which receives the channel's boolean value
 */
Gpio.prototype.read = function(channel, cb /*err,value*/) {
    var pin = this.getPin(channel);
    fs.readFile(PATH + '/gpio' + pin + '/value', 'utf-8', function(err, data) {
        data = (data + '').trim() || '0';
        return cb(err, (data === '1' ? true : false));
    });
}
Gpio.prototype.input = Gpio.prototype.read;

/**
 * Unexport any open pins
 *
 * @param {function} cb Optional callback
 */
Gpio.prototype.destroy = function(cb) {
    var pins = Object.keys(this.exportedPins);
    var pinCount = pins.length;
    while (pinCount--) {
        var pin = pins[pinCount];
        if (pinCount === 0 && cb) {
            unexportPin(pin, cb);
        } else {
            unexportPin(pin);
        }
    }
}

/**
 * Reset the state of the module
 */
Gpio.prototype.reset = function() {
    this.getPin = this.MODE_RPI;
    this.exportedPins = {};
}

function setDirection(pin, direction, cb) {
    fs.writeFile(PATH + '/gpio' + pin + '/direction', direction, function(err) {
        if (cb) return cb(err);
    });
}

function exportPin(pin, cb) {
    fs.writeFile(PATH + '/export', pin, function(err) {
        if (cb) return cb(err);
    });
}

function unexportPin(pin, cb) {
    unexportPin(pin, cb);
    fs.unwatchFile(PATH + '/gpio' + pin + '/value');
}

function unexportPin(pin, cb) {
    fs.writeFile(PATH + '/unexport', pin, function(err) {
        if (cb) return cb(err);
    });
}

function isExported(pin, cb) {
    // path.exists deprecated in 0.8.0
    (fs.exists || path.exists)(PATH + '/gpio' + pin, function(exists) {
        if (cb) return cb(exists);
    });
}

function setListener(pin, cb) {
    fs.watchFile(PATH + '/gpio' + pin + '/value', cb);
}

module.exports = new Gpio;
