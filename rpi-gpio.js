/*jslint node: true, white: true */
var fs = require('fs'),
	util = require('util'),
	EventEmitter = require('events').EventEmitter,
	Q = require('q'),
	exec = Q.denodeify(require('child_process').exec),
    Epoll = require('epoll').Epoll,
	debug = require('debug')('rpi-gpio');

function RaspberryPiVirtualHardware(){
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

		debug(
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

		return (!!bcmPins && bcmPins.indexOf(parsedChannel) !== -1) ? channel : null;
	}

	self.getPinForChannel = function(channel, mode) {
		switch(mode.toLowerCase()) {
			case 'rpi':
				return getPinRpi(channel);
			case 'bcm':
				return getPinBcm(channel);
			default:
				throw new Error('Could not find a pin set for channel ' + channel + ' using mode ' + mode);
		}
	};

	self.getPinGpioPath = function(pin) {
		return PATH + '/gpio' + pin; 
	};

	self.getPinGpioValuePath = function(pin) {
		return PATH + '/gpio' + pin + '/value'; 
	};

	PINS.v1BCM = Object.keys(PINS.v1).map(function(pin) {
		return PINS.v1[pin];
	});

	PINS.v2BCM = Object.keys(PINS.v2).map(function(pin) {
		return PINS.v2[pin];
	});

	pinVersion = detectHardwareVersion();
	currentPins = PINS[pinVersion];
}

function Gpio() {
	var self = this,
		raspberryPi = new RaspberryPiVirtualHardware(),
		currentMode,
		exportedInputPins = {},
		exportedOutputPins = {},
		pollers = {};

	// Private functions
	function exportPin(channelConfig) {
		var pin = channelConfig.pin,
			direction = channelConfig.direction,
			exportCommand = 'gpio export ' + pin + ' ' + direction,
			edgeCommand = 'gpio edge ' + pin + ' both';

		debug('Exporting pin %d', pin);

		return exec(exportCommand, {})
			.then(function() {
				if(direction === self.DIR_IN){
					debug('setting edge for pin %d', pin);

					return exec(edgeCommand, {}).then(function() {
						self.emit('export', channelConfig.Channel);
						return channelConfig;
					});
				} 

				self.emit('export', channelConfig.Channel);
				return channelConfig;
			});
	}

	function unexportPin(channelConfig) {
		var pin = channelConfig.pin;

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
				return channelConfig;
			});
	}

	function mapChannelToPin(channelConfig) {
		var channel = channelConfig.channel,
			pin = raspberryPi.getPinForChannel(channel, currentMode);

		if(!pin) {
			throw new Error('Channel ' + channel + ' does not map to a GPIO pin');
		}

		debug('set up pin %d', pin);
		channelConfig.pin = pin;

		return channelConfig;
	}

	function cachePinDirection(channelConfig) {
		debug('Caching config direction for pin %d, with a direction of %s', channelConfig.pin, channelConfig.direction);
		if(channelConfig.direction === self.DIR_IN) {
			exportedInputPins[channelConfig.pin] = true;
		} else {
			exportedOutputPins[channelConfig.pin] = true;
		}

		return channelConfig;
	}

	function createListener(channelConfig) {
		debug('Creating a listener for Channel ' + channelConfig.channel + ', Pin ' + channelConfig.pin);
		var channel = channelConfig.channel,
			pin = channelConfig.pin,
			channelPath = raspberryPi.getPinGpioValuePath(pin),
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

		return channelConfig;
	}

	self.DIR_IN = 'in';
	self.DIR_OUT = 'out';
	self.MODE_RPI = 'rpi';
	self.MODE_BCM = 'bcm';

	/**
	 * Set pin reference mode. Defaults to 'mode_rpi'.
	 *
	 * @param {string} mode Pin reference mode, 'mode_rpi' or 'mode_bcm'
	 */
	self.setMode = function (mode) {
		currentMode = mode;

		self.emit('modeChange', mode);

		return currentMode;
	};

	/**
	 * Setup a channel for use as an input or output
	 *
	 * @param {number}   channel   Reference to the pin in the current mode's schema
	 * @param {string}   direction The pin direction, either 'in' or 'out'
	 * @param {function} onSetup   Optional callback
	 */
	self.setup = function (channelConfig) {
		var channel = channelConfig.channel,
			direction = channelConfig.direction;

		if(!channel) {
			throw new Error('Channel must be a number, was given ' + channel);
		}

		if(direction !== self.DIR_IN && direction !== self.DIR_OUT) {
			throw new Error('Cannot set invalid direction');
		}

		return Q.fcall(function () {
				return channelConfig;
			})
			.then(mapChannelToPin)
			// Force an unexport just in case
			.then(unexportPin)
			.then(exportPin)
			.then(createListener)
			.then(cachePinDirection)
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
	self.write = self.output = function (channelValue) {
		var channel = channelValue.channel,
			value = channelValue.value,
			pin = raspberryPi.getPinForChannel(channel, currentMode);

		if(!exportedOutputPins[pin]) {
			var message;
			if(exportedInputPins[pin]) {
				message = 'Pin ' + pin + ' (Channel ' + channel + ') has been exported for input so cannot be written to';
			} else {
				message = 'Pin ' + pin + ' (Channel ' + channel + ') has not been exported';
			}

			throw new Error(message);
		}

		value = (!!value && value !== '0') ? '1' : '0';
		return Q.nfcall(fs.writeFile, raspberryPi.getPinGpioValuePath(pin), value);
	};

	/**
	 * Read a value from a channel
	 *
	 * @param {number}   channel The channel to read from
	 * @param {function} cb      Callback which receives the channel's boolean value
	 */
	self.read = self.input = function (channel) {
		var pin = raspberryPi.getPinForChannel(channel, currentMode);

		if(!exportedInputPins[pin]) {
			return process.nextTick(function () {
				throw new Error('Pin ' + pin + ' (Channel ' + channel + ') has not been exported');
			});
		}

		return Q.nfcall(fs.readFile, raspberryPi.getPinGpioValuePath(pin), 'utf-8')
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
			pinsToUnexport = Object.keys(exportedOutputPins)
				.concat(Object.keys(exportedInputPins));

		return pinsToUnexport
			.reduce(function (chain, pin) {
				return chain
					.then(function(){ return { pin: pin }; })
					.then(unexportPin);
			}, exec(commandText, {}))
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

		currentMode = self.MODE_RPI;

		return null;
	};

	// Init
	EventEmitter.call(self);
	self.reset();
}
util.inherits(Gpio, EventEmitter);

module.exports = new Gpio();
