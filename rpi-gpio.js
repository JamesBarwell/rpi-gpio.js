/*jslint node: true, white: true */
var fs = require('fs'),
	Q = require('q'),
	exec = Q.denodeify(require('child_process').exec),
	Epoll = require('epoll').Epoll,
	gpiodebug = require('debug')('gpio-manager'),
	gpiopindebug = require('debug')('gpio-pin'),
	gpiorpidebug = require('debug')('gpio-pin');

function RaspberryPiVirtualHardware() {
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
		pinVersion,
		currentPins;

	function detectHardwareVersion() {
		var data = fs.readFileSync('/proc/cpuinfo', 'utf8');
		// Match the last 4 digits of the number following "Revision:"
		var match = data.match(/Revision\s*:\s*[0-9a-f]*([0-9a-f]{4})/);
		var revisionNumber = parseInt(match[1], 16);
		var version = (revisionNumber < 4) ? 'v1' : 'v2';

		gpiorpidebug(
			'Detected hardware revision %d; using pin mode %s',
			revisionNumber,
			version
		);

		return version;
	}

	function getPinRpi(channel) {
		return currentPins[channel].toString();
	}

	function getPinBcm(channel) {
		var parsedChannel = parseInt(channel, 10),
			bcmPins = PINS[pinVersion + 'BCM'];

		return(!!bcmPins && bcmPins.indexOf(parsedChannel) !== -1) ? channel : null;
	}

	self.getPinForChannel = function (channel, mode) {
		switch(mode.toLowerCase()) {
		case 'rpi':
			return getPinRpi(channel);
		case 'bcm':
			return getPinBcm(channel);
		default:
			throw new Error('Could not find a pin set for channel ' + channel + ' using mode ' + mode);
		}
	};

	self.getPinGpioPath = function (pin) {
		return PATH + '/gpio' + pin;
	};

	self.getPinGpioValuePath = function (pin) {
		return PATH + '/gpio' + pin + '/value';
	};

	PINS.v1BCM = Object.keys(PINS.v1)
		.map(function (pin) {
			return PINS.v1[pin];
		});

	PINS.v2BCM = Object.keys(PINS.v2)
		.map(function (pin) {
			return PINS.v2[pin];
		});

	pinVersion = detectHardwareVersion();
	currentPins = PINS[pinVersion];
}

function GpioPin(options) {
	// Sanitize before even trying to initialize
	if(!options || typeof options !== 'object') {
		throw new Error('An options object is required to setup a pin.' + options);
	}

	if(!options.pin) {
		throw new Error('A valid pin must be specified.');
	}

	if(!options.pinFilePath) {
		throw new Error('A valid pin filepath must be specified.');
	}

	if(!options.channel) {
		throw new Error('A valid channel assignment must be specified.');
	}

	if(!options.direction || (options.direction !== 'in' && options.direction !== 'out')) {
		throw new Error('A valid pin direction must be specified.');
	}

	// Private Variables
	var self = this,
		isInput = options.direction === 'in',
		promiseChain,
		poller,
		pollerValueFile,
		pollerBuffer = new Buffer(1),
		// Commands
		exportCommand = 'gpio export ' + options.pin + ' ' + options.direction,
		edgeCommand = 'gpio edge ' + options.pin + ' both',
		unexportCommand = "gpio unexport " + options.pin;

	// private methods
	function writeToPin(value) {
		if(isInput) {
			throw new Error('Cannot write "' + value + '" to read-only input pin ' + options.pin + '.');
		}

		value = (!!value && value !== '0') ? '1' : '0';
		return Q.nfcall(fs.writeFile, options.pinFilePath, value);	
	}

	function readFromPin() {
		return Q.nfcall(fs.readFile, options.pin, 'utf-8')
			.then(function (data) {
				data = (data.toString()).trim() || '0';

				return data === '1';
			});
	}

	function createPoller() {
		pollerValueFile = fs.openSync(options.pinFilePath, 'r');
		poller = new Epoll(function (err, fd) {
			if(err) {
				gpiopindebug('An error occurred attempt to setup a poller for pin %d, channel %s: %s', options.pin, options.channel, err.stack);
				return;
			}

			fs.readSync(fd, pollerBuffer, 0, 1, 0);
			var bufferedValue = pollerBuffer.toString();

			self.onChange(bufferedValue === '1');
		});

		fs.readSync(pollerValueFile, pollerBuffer, 0, 1, 0);

		poller.add(pollerValueFile, Epoll.EPOLLPRI);
	}

	function unexport() {
		if(poller) {
			poller.remove(pollerValueFile).close();
			poller = null;
		}

		return exec(unexportCommand, {});
	}

	// Public Properties
	self.Channel = options.channel;
	self.Pin = options.pin;
	self.PinFilePath = options.pinFilePath;
	self.Direction = options.direction;

	// Public Methods
	self.write = writeToPin;

	self.read = readFromPin;

	self.destroy = unexport;

	self.onChange = function(value) {
		gpiopindebug('Value for pin %d, channel %s, changed to %s', options.pin, options.channel, value);
		return;
	};

	// Return promise to initialize

	gpiopindebug('Exporting pin %d', options.pin);

	promiseChain = exec(exportCommand, {});

	// If this is an input, we need to set the edge value
	// so that we can get proper readings
	if(isInput) {
		promiseChain = promiseChain.then(function(){
			return exec(edgeCommand, {});
		});
	}

	return promiseChain
		.then(createPoller)
		.then(function() {
			gpiopindebug('Finished creating GPIO Pin mapping to pin %d, channel %s', options.pin, options.channel);
		})
		.then(function() {
			return self;
		});
}

function GpioManager(raspberryPiHardware) {
	var self = this,
		raspberryPi = raspberryPiHardware || new RaspberryPiVirtualHardware(),
		currentMode,
		exportedPins = {};

	// Private functions
	function resolvePinAddress(config) {
		var pin = raspberryPi.getPinForChannel(config.channel, currentMode);

		if(!pin) {
			throw new Error('Channel ' + config.channel + ' does not map to a GPIO pin');
		}

		config.pin = pin;
		gpiodebug('set up pin %d', pin);

		return config;
	}

	function resolvePinFilePath(config) {
		var filepath = raspberryPi.getPinGpioValuePath(config.pin);
		config.pinFilePath = filepath;

		return config;
	}

	function createGpioPinMapping(config) {
		if(!!exportedPins[config.pin]) {
			throw new Error('The pin %d, channel %s, has already been assigned!', config.pin, config.channel);
		}

		var gpioPin = new GpioPin(config);

		exportedPins[config.pin] = gpioPin;

		return exportedPins[config.pin];
	}

	// Public Properties
	self.DIR_IN = 'in';
	self.DIR_OUT = 'out';
	self.MODE_RPI = 'rpi';
	self.MODE_BCM = 'bcm';

	// Public Methods

	/**
	 * Set pin reference mode. Defaults to 'mode_rpi'.
	 */
	self.setMode = function (mode) {
		currentMode = mode;

		return currentMode;
	};

	/**
	 * Setup a channel for use as an input or output
	 */
	self.setup = function (config) {
		if(!config && typeof config !== 'object') {
			throw new Error('A valid configuration object must be supplied.');
		}
		if(!config.channel) {
			throw new Error('Channel must be defined.');
		}

		if(config.direction !== self.DIR_IN && config.direction !== self.DIR_OUT) {
			throw new Error('Cannot set invalid direction');
		}

		return Q.fcall(function () {
				return config;
			})
			.then(resolvePinAddress)
			.then(resolvePinFilePath)
			.then(createGpioPinMapping)
			.catch(function (err) {
				gpiodebug('An error occurred during setup.', err.stack);
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
	self.write = self.output = function (config) {
		gpiodebug('Attempting to write to channel %d a value of %s', config.channel, config.value);
		var pin = raspberryPi.getPinForChannel(config.channel, currentMode),
			gpioPin = exportedPins[pin];

		if(!gpioPin) {
			throw new Error('Could not find exported GPIO pin %d, channel %s.', pin, config.channel);
		}

		return gpioPin.write(config.value);
	};

	/**
	 * Read a value from a channel
	 */
	self.read = self.input = function (config) {
		gpiodebug('Attempting to read from channel %d', config.channel);

		var pin = raspberryPi.getPinForChannel(config.channel, currentMode),
			gpioPin = exportedPins[pin];

		if(!gpioPin) {
			throw new Error('Could not find exported GPIO pin %d, channel %s.', pin, config.channel);
		}

		return gpioPin.read();
	};

	/**
	 * Unexport any pins setup by this module
	 */
	self.destroy = function (data) {
		gpiodebug('Cleaning up GPIO');

		var commandText = 'gpio unexportall',
			pinsToUnexport = Object.keys(exportedPins);

		return pinsToUnexport
			.reduce(function (chain, pin) {
				return chain
					.then(function () {
						var gpio = pinsToUnexport[pin];

						return gpio.destroy();
					});
			}, exec(commandText, {}))
			.then(function () {
				// allow data pass-through
				return data;
			});
	};

	/**
	 * Reset the state of the module
	 */
	self.reset = function () {
		currentMode = self.MODE_RPI;

		return null;
	};

	// Init
	return self.reset();
}

module.exports = new GpioManager();
