const fs           = require('fs');
const util         = require('util');
const EventEmitter = require('events').EventEmitter;
const debug        = require('debug')('rpi-gpio');
const Epoll        = require('epoll').Epoll;

const PATH = '/sys/class/gpio';
const PINS = {
  v1: {
    // 1: 3.3v
    // 2: 5v
    '3':  0,
    // 4: 5v
    '5':  1,
    // 6: ground
    '7':  4,
    '8':  14,
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
    '26': 7,
  },
  v2: {
    // 1: 3.3v
    // 2: 5v
    '3':  2,
    // 4: 5v
    '5':  3,
    // 6: ground
    '7':  4,
    '8':  14,
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
    '40': 21,
  },
};

const DIR_IN   = 'in';
const DIR_OUT  = 'out';
const DIR_LOW  = 'low';
const DIR_HIGH = 'high';

const MODE_RPI = 'mode_rpi';
const MODE_BCM = 'mode_bcm';

const EDGE_NONE    = 'none';
const EDGE_RISING  = 'rising';
const EDGE_FALLING = 'falling';
const EDGE_BOTH    = 'both';

function Gpio() {
  let currentPins;
  let currentValidBcmPins;
  let exportedInputPins = {};
  let exportedOutputPins = {};
  let getPinForCurrentMode = getPinRpi;
  let pollers = {};

  this.DIR_IN   = DIR_IN;
  this.DIR_OUT  = DIR_OUT;
  this.DIR_LOW  = DIR_LOW;
  this.DIR_HIGH = DIR_HIGH;

  this.MODE_RPI = MODE_RPI;
  this.MODE_BCM = MODE_BCM;

  this.EDGE_NONE    = EDGE_NONE;
  this.EDGE_RISING  = EDGE_RISING;
  this.EDGE_FALLING = EDGE_FALLING;
  this.EDGE_BOTH    = EDGE_BOTH;

  /**
     * Set pin reference mode. Defaults to 'mode_rpi'.
     *
     * @param {string} mode Pin reference mode, 'mode_rpi' or 'mode_bcm'
     */
  this.setMode = (mode) => {
    if (mode === this.MODE_RPI) {
      getPinForCurrentMode = getPinRpi;
    } else if (mode === this.MODE_BCM) {
      getPinForCurrentMode = getPinBcm;
    } else {
      throw new Error('Cannot set invalid mode');
    }
  };

  /**
     * Setup a channel for use as an input or output
     *
     * @param {number}   channel   Reference to the pin in the current mode's schema
     * @param {string}   direction The pin direction, either 'in' or 'out'
     * @param edge       edge Informs the GPIO chip if it needs to generate interrupts. Either 'none', 'rising', 'falling' or 'both'. Defaults to 'none'
     */
  this.setup = async (channel, direction, edge) => {
    direction = direction || this.DIR_OUT;
    edge = edge || this.EDGE_NONE;

    channel = parseInt(channel);

    if (typeof channel !== 'number') {
      throw new Error('Channel must be a number');
    }

    if (direction !== this.DIR_IN &&
            direction !== this.DIR_OUT &&
            direction !== this.DIR_LOW &&
            direction !== this.DIR_HIGH
    ) {
      throw new Error('Cannot set invalid direction');
    }

    if ([
      this.EDGE_NONE,
      this.EDGE_RISING,
      this.EDGE_FALLING,
      this.EDGE_BOTH,
    ].indexOf(edge) == -1) {
      throw new Error('Cannot set invalid edge');
    }

    await setRaspberryVersion();

    const pinForSetup = getPinForCurrentMode(channel);
    if (!pinForSetup) {
      throw new Error(
        'Channel ' + channel + ' does not map to a GPIO pin',
      );
    }
    debug('set up pin %d', pinForSetup);

    const pinIsExported = await isExported(pinForSetup);
    if (pinIsExported) {
      await unexportPin(pinForSetup);
    }

    await exportPin(pinForSetup);

    await retry(() => {
      return setEdge(pinForSetup, edge);
    });

    if (direction === DIR_IN) {
      exportedInputPins[pinForSetup] = true;
    } else {
      exportedOutputPins[pinForSetup] = true;
    }

    await retry(() => {
      return setDirection(pinForSetup, direction);
    });

    await listen(channel, async (readChannel) => {
      try {
        const value = await this.read(readChannel);
        debug(
          'emitting change on channel %s with value %s',
          readChannel,
          value,
        );
        this.emit('change', readChannel, value);
      } catch (err) {
        debug(
          'Error reading channel value after change, %d',
          readChannel,
        );
      }
    });
  };

  /**
     * Write a value to a channel
     *
     * @param {number}   channel The channel to write to
     * @param {boolean}  value   If true, turns the channel on, else turns off
     */
  this.write = this.output = async (channel, value) => {
    const pin = getPinForCurrentMode(channel);

    if (!exportedOutputPins[pin]) {
      throw new Error('Pin has not been exported for write');
    }

    value = (!!value && value !== '0') ? '1' : '0';

    debug('writing pin %d with value %s', pin, value);
    util.promisify(fs.writeFile)(PATH + '/gpio' + pin + '/value', value);
  };

  /**
     * Read a value from a channel
     *
     * @param {number}   channel The channel to read from
     */
  this.read = this.input = async (channel) => {
    const pin = getPinForCurrentMode(channel);

    if (!exportedInputPins[pin] && !exportedOutputPins[pin]) {
      throw new Error('Pin has not been exported');
    }

    let data = await util.promisify(fs.readFile)(PATH + '/gpio' + pin + '/value', 'utf-8');
    data = (data + '').trim() || '0';
    debug('read pin %s with value %s', pin, data);
    return data === '1';
  };

  /**
     * Unexport any pins setup by this module
     */
  this.destroy = async () => {
    const tasks = Object.keys(exportedOutputPins)
      .concat(Object.keys(exportedInputPins))
      .map((pin) => {
        return new Promise((resolve, reject) => {
          removeListener(pin, pollers);
          unexportPin(pin)
            .then(resolve)
            .catch(reject);
        });
      });

    await Promise.all(tasks);
  };

  /**
     * Reset the state of the module
     */
  this.reset = () => {
    exportedOutputPins = {};
    exportedInputPins = {};
    this.removeAllListeners();

    currentPins = undefined;
    currentValidBcmPins = undefined;
    getPinForCurrentMode = getPinRpi;
    pollers = {};
  };

  // Init
  EventEmitter.call(this);
  this.reset();


  // Private functions requiring access to state
  async function setRaspberryVersion() {
    if (currentPins) {
      return;
    }

    const data = await util.promisify(fs.readFile)('/proc/cpuinfo', 'utf8');

    // Match the last 4 digits of the number following "Revision:"
    const match = data.match(/Revision\s*:\s*[0-9a-f]*([0-9a-f]{4})/);

    if (!match) {
      throw new Error('Unable to match Revision in /proc/cpuinfo: ' + data);
    }

    const revisionNumber = parseInt(match[1], 16);
    const pinVersion = (revisionNumber < 4) ? 'v1' : 'v2';

    debug(
      'seen hardware revision %d; using pin mode %s',
      revisionNumber,
      pinVersion,
    );

    // Create a list of valid BCM pins for this Raspberry Pi version.
    // This will be used to validate channel numbers in getPinBcm
    currentValidBcmPins = [];
    Object.keys(PINS[pinVersion]).forEach(
      (pin) => {
        // Lookup the BCM pin for the RPI pin and add it to the list
        currentValidBcmPins.push(PINS[pinVersion][pin]);
      },
    );

    currentPins = PINS[pinVersion];
  }

  function getPinRpi(channel) {
    return currentPins[channel] + '';
  }

  function getPinBcm(channel) {
    channel = parseInt(channel, 10);
    return currentValidBcmPins.indexOf(channel) !== -1 ? (channel + '') : null;
  }

  /**
     * Listen for interrupts on a channel
     *
     * @param {number}      channel The channel to watch
     * @param {function}    cb Callback which receives the channel's err
     */
  async function listen(channel, onChange) {
    const pin = getPinForCurrentMode(channel);

    if (!exportedInputPins[pin] && !exportedOutputPins[pin]) {
      throw new Error('Channel %d has not been exported', channel);
    }

    debug('listen for pin %d', pin);
    const poller = new Epoll((err, innerfd) => {
      if (err) throw err;
      clearInterrupt(innerfd)
        .then(() => {
          onChange(channel);
        });
    });

    const fd = await util.promisify(fs.open)(PATH + '/gpio' + pin + '/value', 'r+');
    clearInterrupt(fd);
    poller.add(fd, Epoll.EPOLLPRI);
    // Append ready-to-use remove function
    pollers[pin] = () => {
      poller.remove(fd).close();
    };
  }
}
util.inherits(Gpio, EventEmitter);

async function setEdge(pin, edge) {
  debug('set edge %s on pin %d', edge.toUpperCase(), pin);
  await util.promisify(fs.writeFile)(PATH + '/gpio' + pin + '/edge', edge);
}

async function setDirection(pin, direction) {
  debug('set direction %s on pin %d', direction.toUpperCase(), pin);
  await util.promisify(fs.writeFile)(PATH + '/gpio' + pin + '/direction', direction);
}

async function exportPin(pin) {
  debug('export pin %d', pin);
  util.promisify(fs.writeFile)(PATH + '/export', pin);
}

async function unexportPin(pin) {
  debug('unexport pin %d', pin);
  util.promisify(fs.writeFile)(PATH + '/unexport', pin);
}

async function isExported(pin) {
  try {
    await util.promisify(fs.access)(PATH + '/gpio' + pin);
    return true;
  } catch (err) {
    return false;
  }
}

function removeListener(pin, pollers) {
  if (!pollers[pin]) {
    return;
  }
  debug('remove listener for pin %d', pin);
  pollers[pin]();
  delete pollers[pin];
}

async function clearInterrupt(fd) {
  return util.promisify(fs.read)(fd, Buffer.alloc(1), 0, 1, 0);
}

function timeout(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function retry(func) {
  let i = 0;
  let succeeded = false;
  while (i++ < 100 && !succeeded) {
    try {
      await func(),
      succeeded = true;
    } catch(err) {
      await timeout(10);
    }
  }
}

const GPIO = new Gpio();

function callbackify(func) {
  return function() {
    const args = [].slice.call(arguments);
    const callback = args.pop();

    func.apply(GPIO, args)
      .then((result) => {
        callback(null, result);
      })
      .catch((err) => {
        callback(err);
      });
  }
}

// Promise interface - deprecated, kept for backwards compatibility
GPIO.promise = GPIO;

// Callback interface - deprecated, kept for backwards compatibility
GPIO.callback = {
  DIR_IN: DIR_IN,
  DIR_OUT: DIR_OUT,
  DIR_LOW: DIR_LOW,
  DIR_HIGH: DIR_HIGH,

  MODE_RPI: MODE_RPI,
  MODE_BCM: MODE_BCM,

  EDGE_NONE: EDGE_NONE,
  EDGE_RISING: EDGE_RISING,
  EDGE_FALLING: EDGE_FALLING,
  EDGE_BOTH: EDGE_BOTH,

  setup: callbackify(GPIO.setup),
  write: callbackify(GPIO.write),
  read: callbackify(GPIO.read),
  destroy: callbackify(GPIO.destroy),
};

module.exports = GPIO;
