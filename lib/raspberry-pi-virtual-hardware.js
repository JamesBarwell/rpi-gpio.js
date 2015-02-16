/*jslint node: true, white: true */
var fs = require('fs'),
	Q = require('q'),
	exec = Q.denodeify(require('child_process').exec),
	Epoll = require('epoll').Epoll,
	gpiodebug = require('debug')('gpio-manager'),
	gpiopindebug = require('debug')('gpio-pin'),
	gpiorpidebug = require('debug')('raspberry-pi-hardware');

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

module.exports = new RaspberryPiVirtualHardware();