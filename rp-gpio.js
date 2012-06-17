var fs     = require('fs'),
    path   = require('path'),
    util   = require('util');

var logError = function(err) { if(err) util.debug(err); };

// Constants
var PATH = '/sys/class/gpio',
    PIN_MAP = {
        // RPi to BCM
        // @todo Map any other useful pins
        '0': 17,
        '1': 18,
        '2': 21,
        '3': 22,
        '4': 23,
        '5': 24,
        '6': 25,
        '7': 4
    },
    MODE = {
        rpi: 'rpi',
        bcm: 'bcm'
    },
    DIRECTION = {
        'in':  'in',
        'out': 'out'
    };

exports.MODE      = MODE;
exports.DIRECTION = DIRECTION;

_write = function(path, value, cb) {
    fs.writeFile(path, value, cb);
}

// Settings
var activeMode = MODE.rpi;
var openPins = [];

// Clean up on shutdown
// @todo this currently fails to destroy the symlink
process.on('exit', function () {
    destroy();
});

exports.setMode = setMode;
function setMode(mode) {
    if (!(mode in MODE)) {
        throw new Error('Cannot set invalid mode [' + mode + ']');
    }
    activeMode = mode;
}

exports.setup = setup;
function setup(channel, direction, cb) {
    if (!channel) {
        throw new Error('Channel not specified');
    }
    if (direction && !(direction in DIRECTION)) {
        throw new Error('Cannot set invalid direction [' + direction + ']');
    }
    direction = direction || DIRECTION.out;

    function doExport() {
        exportChannel(channel, function() {
            setDirection(channel, direction, cb);
        });
    }

    // Unexport channel if already open
    isExported(channel, function(isOpen) {
        if (isOpen) {
            unexportChannel(channel, doExport);
        } else {
            doExport();
        }
    });
}

exports.write = exports.output = write;
function write(channel, value, cb) {
    var pin = getPin(channel);
    value = (!!value) ? '1' : '0';
    _write(PATH + '/gpio' + pin + '/value', value, function(err) {
        console.log('Output ' + channel + ' set to ' + value);
        if (err) logError(err);
        if (cb) cb();
    });
};

exports.read = exports.input = read;
function read(channel, cb) {
    var pin = getPin(channel);
	fs.readFile(PATH = '/gpio' + pin, 'utf-8', function(err, data) {
		if (err) logError(err);
        if (cb) cb(data);
	});
}

function setDirection(channel, direction, cb) {
    if (!(direction in DIRECTION)) {
        throw new Error('Cannot set invalid direction [' + direction + ']');
    }
    var pin = getPin(channel);
    _write(PATH + '/gpio' + pin + '/direction', direction, function(err) {
        if (err) logError(err);
        if (cb) cb();
    });
}

function exportChannel(channel, cb) {
    var pin = getPin(channel);
    _write(PATH + '/export', pin, function(err) {
        if (err) logError(err);
        openPins.push(pin);
        if (cb) cb();
    });
}

// Expose this until the destructor works reliably
exports.unexportChannel = unexportChannel;
function unexportChannel(channel, cb) {
    unexportPin(getPin(channel), cb);
}

function unexportPin(pin, cb) {
    _write(PATH + '/unexport', pin, function(err) {
        if (err) logError(err);
        if (cb) cb();
    });
}

function isExported(channel, cb) {
    var pin = getPin(channel);
    path.exists(PATH + '/gpio' + pin, function(exists) {
        if (cb) cb(exists);
    });
}

function getPin(channel) {
    var pin = channel;
    if (activeMode === MODE.rpi) {
        pin = PIN_MAP[channel];
    }
    //@todo validate this properly

    return pin;
}

function destroy() {
    openPins.forEach(function(pin) {
        unexportPin(pin);
    });
}
