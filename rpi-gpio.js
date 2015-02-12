/*jslint node: true, white: true */
var fs = require('fs'),
	util = require('util'),
	EventEmitter = require('events').EventEmitter,
	async = require('async'),
	exec = require("child_process").exec,
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
			}
		},
		currentPins,
		currentExportUtility,
		exportedInputPins = {},
		exportedOutputPins = {},
		getPinForCurrentMode,
		pollers = {},
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
	self.EXPORT_GPIO_ADMIN = 'gpio-admin';
	self.EXPORT_WIRING_PI_GPIO = 'gpio';

	// Private functions
	function exportPin(pin, cb, direction) {
		debug('export pin %d', pin);
		var exportCommand = currentExportUtility + ' export ' + pin,
			edgeCommand = currentExportUtility + ' edge ' + pin + ' both';

		// Wiring Pi requires a direction
		if(currentExportUtility === self.EXPORT_WIRING_PI_GPIO){
			exportCommand += ' ' + direction;
		}

		exec(exportCommand, {}, function () {
			if(direction === self.DIR_IN && currentExportUtility === self.EXPORT_WIRING_PI_GPIO){
				debug('setting edge for pin %d', pin);

				exec(edgeCommand, {}, function () {
					cb();
				});
			} else {
				cb();
			}
		});
	}

	function unexportPin(pin, cb) {
		debug('unexport pin %d', pin);

		var unexportCommand = currentExportUtility + " unexport " + pin,
			poller;

		if(pollers.hasOwnProperty(pin)){
			poller = pollers[pin];
			poller.Poller.remove(poller.ValueFile).close();
			delete pollers[pin];
		}
		
		exec(unexportCommand, {}, function () {
			cb();
		});
	}

	function isExported(pin, cb) {
		fs.exists(PATH + '/gpio' + pin, function (exists) {
			return cb(null, exists);
		});
	}

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
		debug('Creating a listener for Channel ' + channel + ', Pin ' + pin);
		var channelPath = PATH + '/gpio' + pin + '/value',
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
	 * Set Export Utility. Defaults to 'EXPORT_WIRING_PI_GPIO'.
	 *
	 * @param {string} exportUtility, 'EXPORT_GPIO_ADMIN' or 'EXPORT_WIRING_PI_GPIO'
	 */
	self.setExportUtility = function (exportUtility) {
		if(exportUtility === self.EXPORT_GPIO_ADMIN || exportUtility === self.EXPORT_WIRING_PI_GPIO) {
			currentExportUtility = exportUtility;
		} else {
			throw new Error('Cannot set invalid export utility ' + exportUtility);
		}

		self.emit('exportUtilityChange', exportUtility);
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
				exportPin(pinForSetup, next, direction);
			},
			function (next) {
				self.emit('export', channel);

				if(direction === self.DIR_IN) {
					createListener.call(self, channel, pinForSetup);
					exportedInputPins[pinForSetup] = true;
				} else {
					exportedOutputPins[pinForSetup] = true;
				}

				return next(null);
			}.bind(self)
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
		currentExportUtility = self.EXPORT_WIRING_PI_GPIO;
	};

	// Init
	EventEmitter.call(self);
	self.reset();
}
util.inherits(Gpio, EventEmitter);

module.exports = new Gpio();
