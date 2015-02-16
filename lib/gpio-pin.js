/*jslint node: true, white: true */
var fs = require('fs'),
	Q = require('q'),
	exec = Q.denodeify(require('child_process').exec),
	Epoll = require('epoll').Epoll,
	gpiopindebug = require('debug')('gpio-pin');

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

	// INITIALIZE!

	gpiopindebug('Exporting pin %d', options.pin);

	promiseChain = exec(exportCommand, {});

	// If this is an input, we need to set the edge value
	// so that we can get proper readings
	if(isInput) {
		promiseChain = promiseChain.then(function(){
			return exec(edgeCommand, {});
		});
	}

	promiseChain
		.then(createPoller)
		.then(function() {
			gpiopindebug('Finished creating GPIO Pin mapping to pin %d, channel %s', options.pin, options.channel);
		});
}

module.exports = GpioPin;