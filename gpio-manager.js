/*jslint node: true, white: true */
var Q = require('q'),
	exec = Q.denodeify(require('child_process').exec),
	RaspberryPiVirtualHardware = require('./lib/raspberry-pi-virtual-hardware.js'),
	GpioPin = require('./lib/gpio-pin.js'),
	debug = require('debug')('gpio:manager');



function GpioManager(raspberryPiHardware) {
	var self = this,
		raspberryPi = raspberryPiHardware || RaspberryPiVirtualHardware,
		currentMode,
		exportedPins = {};

	// Private functions

	function resolvePinAddress(config) {
		var pin = raspberryPi.getPinForChannel(config.channel, currentMode);

		if(!pin) {
			throw new Error('Channel ' + config.channel + ' does not map to a GPIO pin');
		}

		debug('Resolved channel %d to  pin %d', config.channel, pin);
		config.pin = pin;

		return config;
	}

	function resolvePinFilePath(config) {
		var filepath = raspberryPi.getPinGpioValuePath(config.pin);
		config.pinFilePath = filepath;

		return config;
	}

	function createGpioPinMapping(config) {
		if(!!exportedPins[config.pin]) {
			throw new Error('The pin %d, channel %d, has already been assigned!', config.pin, config.channel);
		}
		debug('Creating GPIO pin mapping for pin %d, channel %d.', config.pin, config.channel);
		return new GpioPin(config)
			.then(function(gpioPin){
				gpioPin.legacyOnChange = function(e, c) {
					return self.legacyOnChangeEvent(e, c);
				};

				exportedPins[config.pin] = gpioPin;

				return exportedPins[config.pin];
			});
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
		debug('Changing current mode to %s.', mode);
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
	self.write = self.output = function (config) {
		debug('Attempting to write to channel %d a value of %s', config.channel, config.value);
		var pin = raspberryPi.getPinForChannel(config.channel, currentMode),
			gpioPin = exportedPins[pin];

		if(!gpioPin) {
			throw new Error('Could not find exported GPIO pin %d, channel %d.', pin, config.channel);
		}

		return gpioPin.write(config.value);
	};

	/**
	 * Read a value from a channel
	 */
	self.read = self.input = function (config) {
		debug('Attempting to read from channel %d', config.channel);

		var pin = raspberryPi.getPinForChannel(config.channel, currentMode),
			gpioPin = exportedPins[pin];

		if(!gpioPin) {
			throw new Error('Could not find exported GPIO pin %d, channel %d.', pin, config.channel);
		}

		return gpioPin.read();
	};

	/**
	 * Unexport any pins setup by this module
	 */
	self.destroy = function (data) {
		debug('Cleaning up GPIO');

		var commandText = 'gpio unexportall',
			pinsToUnexport = Object.keys(exportedPins)
				.map(function(pin){
					var gpioPin = exportedPins[pin];

					return gpioPin.destroy().then(function(){
						exportedPins[pin] = null;
						delete exportedPins[pin];
					});
				});

		return Q.all(pinsToUnexport)
			.then(function(){
				debug('Running "unexportall" as a final cleanup');
				return exec(commandText, {});
			})
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

	// LEGACY

	self.on = function(e, cb) {
		if(e !== 'change') {
			throw new Error('The event type "' + e + '" is no longer supported.');
		}

		debug('Assigned new onchange event handler');
		self.legacyOnChangeEvent = cb;
	};


	self.legacyOnChangeEvent = function(channel, value) {
		debug('Legacy On Change event fired for channel %s with a value of %s.', channel, value);
		return;
	};


	// Init
	return self.reset();
}

module.exports = new GpioManager();
