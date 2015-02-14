/*jslint node: true, white: true */
var fs = require('fs'),
	util = require('util'),
	EventEmitter = require('events').EventEmitter,
	Q = require('q'),
	exec = Q.denodeify(require("child_process").exec),
    Epoll = require('epoll').Epoll,
	debug = require('debug')('rpi-gpio');

function Gpio() {
	var self = this,
		PATH = '/sys/class/gpio',
		PINS = {
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
			},
			BCM: [
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
			]
		},
		currentPins,
		exportedInputPins = {},
		exportedOutputPins = {},
		getPinForCurrentMode,
		pollers = {};

	self.DIR_IN = 'in';
	self.DIR_OUT = 'out';
	self.MODE_RPI = 'mode_rpi';
	self.MODE_BCM = 'mode_bcm';

	// Private functions
	function exportPin(pinAndChannelConfig) {
		var pin = pinAndChannelConfig.Pin,
			direction = pinAndChannelConfig.Direction,
			exportCommand = 'gpio export ' + pin + ' ' + direction,
			edgeCommand = 'gpio edge ' + pin + ' both';

		debug('Exporting pin %d', pin);

		return exec(exportCommand, {})
			.then(function () {
				if(direction === self.DIR_IN){
					debug('setting edge for pin %d', pin);

					return exec(edgeCommand, {}).then(function(){
						return pinAndChannelConfig;
					});
				} 

				return pinAndChannelConfig;
			})
			.then(function(config){
				self.emit('export', config.Channel);
				return config;
			});
	}

	function unexportPin(pinAndChannelConfig) {
		var pin = pinAndChannelConfig.Pin;
		debug('unexport pin %d', pin);

		var unexportCommand = "gpio unexport " + pin,
			poller;

		if(pollers.hasOwnProperty(pin)){
			poller = pollers[pin];
			debug('Removing poller %d', pin);
			poller.Poller.remove(poller.ValueFile).close();
			delete pollers[pin];
		}
		
		return exec(unexportCommand, {})
			.then(function(){
				return pinAndChannelConfig;
			});
	}

	function isExported(pinAndChannelConfig) {
		return Q.nfcall(fs.exists, PATH + '/gpio' + pinAndChannelConfig.Pin)
			.then(function(exists){
				pinAndChannelConfig.Exported = exists;
				return pinAndChannelConfig;
			});
	}

	function setRaspberryVersion() {		
		if(currentPins) {
			return null;
		}

		return Q.nfcall(fs.readFile, '/proc/cpuinfo', 'utf8')
			.then(function(data){
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

				return currentPins;
			});
	}

	function getPinRpi(channel) {
		return currentPins[channel].toString();
	}

	function getPinBcm(channel) {
		var parsedChannel = parseInt(channel, 10);
		return PINS.BCM.indexOf(parsedChannel) !== -1 ? channel : null;
	}

	function createListener(pinAndChannelConfig) {
		debug('Creating a listener for Channel ' + pinAndChannelConfig.Channel + ', Pin ' + pinAndChannelConfig.Pin);
		var channel = pinAndChannelConfig.Channel,
			pin = pinAndChannelConfig.Pin,
			channelPath = PATH + '/gpio' + pin + '/value',
			valuefd = fs.openSync(channelPath, 'r'),
			buffer = new Buffer(1),
			poller = new Epoll(function(err, fd, events) {
				if(err){
					console.error(err);
				}
				fs.readSync(fd, buffer, 0, 1, 0);
				var bufferedValue = buffer.toString();
				debug(events, bufferedValue);
				self.emit('change', channel, bufferedValue === '1');
			});

		fs.readSync(valuefd, buffer, 0, 1, 0);

		poller.add(valuefd, Epoll.EPOLLPRI);

		pollers[pin] = {
			Poller: poller,
			ValueFile: valuefd
		};

		return pinAndChannelConfig;
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

		return mode;
	};

	/**
	 * Setup a channel for use as an input or output
	 *
	 * @param {number}   channel   Reference to the pin in the current mode's schema
	 * @param {string}   direction The pin direction, either 'in' or 'out'
	 * @param {function} onSetup   Optional callback
	 */
	self.setup = function (channel, direction) {
		direction = direction || self.DIR_OUT;

		if(!channel) {
			throw new Error('Channel must be a number, was given ' + channel);
		}

		if(direction !== self.DIR_IN && direction !== self.DIR_OUT) {
			throw new Error('Cannot set invalid direction');
		}

		return Q.fcall(setRaspberryVersion)
			.then(function () {
				var pinAndChannelConfig = {
					Channel: channel,
					Direction: direction,
					Pin: getPinForCurrentMode(channel)
				};

				if(!pinAndChannelConfig.Pin) {
					throw new Error('Channel ' + channel + ' does not map to a GPIO pin');
				}

				debug('set up pin %d', pinAndChannelConfig.Pin);
				return pinAndChannelConfig;
			})
			.then(isExported)
			.then(function(pinAndChannelConfig){
				if(pinAndChannelConfig.Exported) {
					return unexportPin(pinAndChannelConfig);
				}

				return pinAndChannelConfig;
			})
			.then(exportPin)
			.then(createListener)
			.then(function(pinAndChannelConfig){
				if(direction === self.DIR_IN) {
					exportedInputPins[pinAndChannelConfig.Pin] = true;
				} else {
					exportedOutputPins[pinAndChannelConfig.Pin] = true;
				}
			})
			.catch(function(err){
				debug('An error occurred during setup.', err.stack);
				throw err;
			});
	};

	/**
	 * Write a value to a channel
	 *
	 * @param {number}   channel The channel to write to
	 * @param {boolean}  value   If true, turns the channel on, else turns off
	 * @param {function} cb      Optional callback
	 */
	self.write = self.output = function (channel, value) {
		var pin = getPinForCurrentMode(channel);

		if(!exportedOutputPins[pin]) {
			var message;
			if(exportedInputPins[pin]) {
				message = 'Pin ' + pin + ' (Channel ' + channel + ') has been exported for input so cannot be written to';
			} else {
				message = 'Pin ' + pin + ' (Channel ' + channel + ') has not been exported';
			}

			return process.nextTick(function () {
				throw new Error(message);
			});
		}

		value = (!!value && value !== '0') ? '1' : '0';
		return Q.nfcall(fs.writeFile, PATH + '/gpio' + pin + '/value', value);
	};

	/**
	 * Read a value from a channel
	 *
	 * @param {number}   channel The channel to read from
	 * @param {function} cb      Callback which receives the channel's boolean value
	 */
	self.read = self.input = function (channel) {
		var pin = getPinForCurrentMode(channel);

		if(!exportedInputPins[pin]) {
			return process.nextTick(function () {
				throw new Error('Pin ' + pin + ' (Channel ' + channel + ') has not been exported');
			});
		}

		return Q.nfcall(fs.readFile, PATH + '/gpio' + pin + '/value', 'utf-8')
			.then(function (data) {
				data = (data.toString()).trim() || '0';
				return data === '1';
			});
	};

	/**
	 * Unexport any pins setup by this module
	 *
	 * @param {function} cb Optional callback
	 */
	self.destroy = function (data) {
		debug('Cleaning up GPIO');

		var commandText = 'gpio unexportall',
			tasks = Object.keys(exportedOutputPins)
				.concat(Object.keys(exportedInputPins))
				.map(function (pin) {
					return unexportPin({
						Pin: pin
					});
				});

		return exec(commandText, {})
			.all(tasks)
			.then(function(){
				// allow data pass-through
				return data;
			});
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

		return null;
	};

	// Init
	EventEmitter.call(self);
	self.reset();
}
util.inherits(Gpio, EventEmitter);

module.exports = new Gpio();
