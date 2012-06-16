var fs = require('fs'),
    util = require('util');

var PATH = '/sys/class/gpio';

var logError = function(err) { if(err) util.debug(err); };

// @todo Add full set of usable pins
var pinMap = {
    '0': 17,
    '1': 18,
    '2': 21,
    '3': 22,
    '4': 23,
    '5': 24,
    '6': 25,
    '7': 4
};

var modes = {
        rpi: 'rpi',
        bcm: 'bcm'
    },
    defaultMode = modes.rpi,
    directions = {
        'input':  'in',
        'output': 'out'
    }

exports.setMode = setMode;
function setMode(mode) {
    if (mode in modes) {
        throw new Error('Invalid mode');
    }
    defaultMode = mode;
};

exports.setup = setup;
function setup(channel, direction, cb) {

    if (undefined === direction && cb) {
        cb = direction;
        direction = directions.input;
    }

    // @todo validation here please
    if (!channel) {
        throw new Error('Invalid channel');
    }
    if (!(direction in directions)) {
        throw new Error('Invalid direction');
    }

    direction = directions[direction];

    // @todo if it exists, unexport it first

    // export it, write direction then trigger callback
    _export(channel, function(normalChannel) {
        fs.writeFile(PATH + '/gpio' + normalChannel + '/direction', direction, function(err) {
            if (err) logError(err);
            cb();
        });
    });

};

/**
 * Write to the channel
 */
exports.output = output;
function output(channel, value, cb) {
    channel = _getChannel(channel);
    value = (!!value) ? '1' : '0';
    fs.writeFile(PATH + '/gpio' + channel + '/value', value, function(err) {
        console.log('Output ' + channel + ' set to ' + value);
        if (err) logError(err);
        if (cb) cb();
    });
};

/**
 * Read from the channel
 */
exports.input = input;
function input(channel, cb) {
    channel = _getChannel(channel);
	fs.readFile(PATH = '/gpio' + channel, 'utf-8', function(err, data) {
		if (err) logError(err);
        if (cb) cb(data);
	});
}

// @todo need to clean up on destruct
exports.unexport = _unexport;
function _unexport(channel, cb) {
    channel = _getChannel(channel);
    fs.writeFile(PATH + '/unexport', channel, function(err) {
        if (err) logError(err);
        if (cb) cb();
    });
}

function _export(channel, cb) {
    channel = _getChannel(channel);
    fs.writeFile(PATH + '/export', channel, function(err) {
        if (err) logError(err);
        if (cb) cb(channel);
    });
}

function _getChannel(channel) {
    if (defaultMode === modes.rpi) {
        return pinMap[parseInt(channel, 10)];
    }
    if (pinMap.indexOf(channel) !== -1) {
        return channel;
    }
    throw new Error(
        'Invalid channel [' + channel + ']. Check that you are in the correct mode.'
    );
}
