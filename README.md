rpi-gpio.js
==========

Control Raspberry Pi GPIO pins with io.js / node.js

[![Build Status](https://travis-ci.org/JamesBarwell/rpi-gpio.js.svg?branch=master)](https://travis-ci.org/JamesBarwell/rpi-gpio.js)
[![NPM version](https://badge.fury.io/js/rpi-gpio.svg)](http://badge.fury.io/js/rpi-gpio)

## Setup
See this guide on how to get [node.js running on Raspberry Pi](https://learn.adafruit.com/node-embedded-development/installing-node-dot-js).

This module can then be installed with npm:
```
npm install rpi-gpio
```

### Dependency

If you are having trouble installing this module make sure you are running gcc/g++ `-v 4.8` or higher. [Here](https://github.com/fivdi/onoff/wiki/Node.js-v4-and-native-addons) is an installation guide.

## Usage
Firstly, make make sure you are running your application as root or with sudo, else the Raspberry Pi will not let you output to the GPIO.

Before you can read or write, you must use setup() to open a channel, and must specify whether it will be used for input or output. Having done this, you can then read in the state of the channel or write a value to it using read() or write().

All of the functions relating to the pin state within this module now support **Promises** - for example reading the value of a channel - either provide a callback or chain the read with `.then` reference [Promisejs API](https://www.promisejs.org/api/). This module inherits the standard [EventEmitter](http://nodejs.org/api/events.html), so you may use its functions to listen to events.

Please note that there are two different and confusing ways to reference a channel; either using the Raspberry Pi or the BCM/SoC naming schema (sadly, neither of which match the physical pins!). This module supports both schemas, with Raspberry Pi being the default. Please see [this page](http://elinux.org/RPi_Low-level_peripherals) for more details.

##### Updates 3/13/2017
Support for objects as the first parameter in the following methods `setup`, `write`, `read`.
Object will overwrite method parameters and callback inside the object is not used.


##### Updates 3/9/2017
**Callbacks are optional for `setup`, `write`, `read`, `destroy`. Checkout the additional examples using promises**
* Note: If the callback parameter is not a function, it simply returns the promise without any changes. If the callback is a function, it is called and undefined is returned. Reference: [Promise.prototype.nodeify](https://www.promisejs.org/api/)

## API

### Methods

#### setup(channel [, direction, edge, type], callback)
Sets up a channel for read or write. Must be done before the channel can be used.
* channel: Reference to the pin in the current mode's schema.
* direction: The pin direction, pass either DIR_IN for read mode or DIR_OUT for write mode. Defaults to DIR_OUT.
* edge: Interrupt generating GPIO chip setting, pass in EDGE_NONE for no interrupts, EDGE_RISING for interrupts on rising values, EDGE_FALLING for interrupts on falling values or EDGE_BOTH for all interrupts.
Defaults to EDGE_NONE.
* type: Boolean if true, will callback with an object, else channel number
* callback: Provides Error as the first argument if an error occurred.

#### read(channel [, type], callback)
Reads the value of a channel.
* channel: Reference to the pin in the current mode's schema.
* type: Boolean if true, will callback with an object containing a 'value' key, else read result
* callback: Provides Error as the first argument if an error occurred, otherwise the pin value boolean as the second argument.

#### write(channel, value [, type, callback])
Writes the value of a channel.
* channel: Reference to the pin in the current mode's schema.
* value: Boolean value to specify whether the channel will turn on or off.
* type: Boolean if true, will callback with an object, else channel number
* callback: Provides Error as the first argument if an error occurred.

#### setMode(mode)
Sets the channel addressing schema.
* mode: Specify either Raspberry Pi or SoC/BCM pin schemas, by passing MODE_RPI or MODE_BCM. Defaults to MODE_RPI.

#### setResolveWithObject(boolean)
Sets the result type.
* boolean: if true, will results will return an object, else channel number / read value

#### getResolveWithObject()
Returns the current global result type.

#### input()
Alias of read().

#### output()
Alias of write().

#### destroy()
Tears down any previously set up channels.

#### reset()
Tears down the module state - used for testing.

### Events
See Node [EventEmitter](http://nodejs.org/api/events.html) for documentation on listening to events.

#### change
Emitted when the value of a channel changed
* channel
* value

## Examples

### Setup and read the value of a pin
```js
var gpio = require('rpi-gpio');

gpio.setup(7, gpio.DIR_IN, readInput);

function readInput() {
    gpio.read(7, function(err, value) {
        console.log('The value is ' + value);
    });
}
```

```js
var gpio = require('rpi-gpio');

gpio.setup(7, gpio.DIR_IN)
    .then(function () {
        return gpio.read(7)
    })
    .then(function (value) {
        console.log('The value is ' + value);
    },function(error){
        /* do something with the error */
    });
```

### Setup and write to a pin
```js
var gpio = require('rpi-gpio');

gpio.setup(7, gpio.DIR_OUT, write);

function write() {
    gpio.write(7, true, function(err) {
        if (err) throw err;
        console.log('Written to pin');
    });
}
```

```js
var gpio = require('rpi-gpio');

gpio.setup(7, gpio.DIR_OUT)
    .then(function () {
        return gpio.write(7, true)
    })
    .then(function () {
        console.log('Written to pin');
    });
```

### Listen for changes on a pin
```js
var gpio = require('rpi-gpio');

gpio.on('change', function(channel, value) {
	console.log('Channel ' + channel + ' value is now ' + value);
});
gpio.setup(7, gpio.DIR_IN, gpio.EDGE_BOTH);
```

### Unexport pins opened by the module when finished
```js
var gpio = require('../rpi-gpio');

gpio.on('export', function(channel) {
    console.log('Channel set: ' + channel);
});

gpio.setup(7, gpio.DIR_OUT);
gpio.setup(15, gpio.DIR_OUT);
gpio.setup(16, gpio.DIR_OUT, pause);

function pause() {
    setTimeout(closePins, 2000);
}

function closePins() {
    gpio.destroy(function() {
        console.log('All pins unexported');
    });
}
```


### Voltage cycling a pin
This example shows how to set up a channel for output mode. After it is set up, it executes a callback which in turn calls another, causing the voltage to alternate up and down three times.
```js
var gpio = require('rpi-gpio');

var pin   = 7;
var delay = 2000;
var count = 0;
var max   = 3;

gpio.setup(pin, gpio.DIR_OUT, on);

function on() {
    if (count >= max) {
        gpio.destroy(function() {
            console.log('Closed pins, now exit');
        });
        return;
    }

    setTimeout(function() {
        gpio.write(pin, 1, off);
        count += 1;
    }, delay);
}

function off() {
    setTimeout(function() {
        gpio.write(pin, 0, on);
    }, delay);
}
```

### Using flow control modules
Due to the asynchronous nature of this module, using an asynchronous flow control module can help to simplify development. This example uses [async.js](https://github.com/caolan/async) to turn pins on and off in series.
```js
var gpio = require('rpi-gpio');
var async = require('async');

async.parallel([
    function(callback) {
        gpio.setup(7, gpio.DIR_OUT, callback)
    },
    function(callback) {
        gpio.setup(15, gpio.DIR_OUT, callback)
    },
    function(callback) {
        gpio.setup(16, gpio.DIR_OUT, callback)
    },
], function(err, results) {
    console.log('Pins set up');
    write();
});

function write() {
    async.series([
        function(callback) {
            delayedWrite(7, true, callback);
        },
        function(callback) {
            delayedWrite(15, true, callback);
        },
        function(callback) {
            delayedWrite(16, true, callback);
        },
        function(callback) {
            delayedWrite(7, false, callback);
        },
        function(callback) {
            delayedWrite(15, false, callback);
        },
        function(callback) {
            delayedWrite(16, false, callback);
        },
    ], function(err, results) {
        console.log('Writes complete, pause then unexport pins');
        setTimeout(function() {
            gpio.destroy(function() {
                console.log('Closed pins, now exit');
            });
        }, 500);
    });
};

function delayedWrite(pin, value, callback) {
    setTimeout(function() {
        gpio.write(pin, value, callback);
    }, 500);
}
```

### Using flow control modules 2
Using promises can further help to simplify development. This example uses [promise.js](https://www.promisejs.org/) to turn pins on and off. 
```js
var gpio = require('rpi-gpio');

Promise.all([
    gpio.setup(7, gpio.DIR_OUT),
    gpio.setup(15, gpio.DIR_OUT),
    gpio.setup(16, gpio.DIR_OUT)])
    .then(function () {
        return delayedWrite(7, true)
    })
    .then(function () {
        return delayedWrite(15, true)
    })
    .then(function () {
        return delayedWrite(16, true)
    })
    .then(function () {
        return delayedWrite(7, false)
    })
    .then(function () {
        return delayedWrite(15, false)
    })
    .then(function () {
        return delayedWrite(16, false)
    })

function delayedWrite(pin, value) {
    return new Promise(function (resolve, reject) {
        setTimeout(function () {
            return gpio.write(pin, value).then(resolve, reject);
            /* this would also work*/
            // return gpio.write(pin, value, resolve)
        }, 500);
    });
}
```
### *But Wait There's More!!!*
Add actions when you want and maintain the order!
```js
var gpio = require('rpi-gpio');

var awesome = Promise.all([
    gpio.setup(7, gpio.DIR_OUT),
    gpio.setup(15, gpio.DIR_OUT),
    gpio.setup(16, gpio.DIR_OUT)])
    .then(function () {
        return delayedWrite(7, true)
            .then(function () {
                return delayedWrite(16, true)
            })
    });

awesome
    .then(function () {
        return delayedWrite(15, true)
    })
    .then(function () {
        return delayedWrite(7, false)
    })
    .then(function () {
        return delayedWrite(15, false)
    })
    .then(function () {
        return delayedWrite(16, false)
    });

function delayedWrite(pin, value) {
    return new Promise(function (resolve, reject) {
        setTimeout(function () {
            return gpio.write(pin, value).then(resolve, reject);
            /* this would also work*/
            // return gpio.write(pin, value, resolve)
        }, 500);
    });
}
```

### Hold that Result
Consider the situation, the state of pin 15 returns before adding the next `.then`.
The promise will hold the result until it used. 
```js
var awesome = Promise.all([
    gpio.setup(7, gpio.DIR_OUT),
    gpio.setup(15, gpio.DIR_OUT),
    gpio.setup(16, gpio.DIR_OUT)])
    .then(function () {
        return delayedWrite(7, true)
            .then(function () {
                return delayedWrite(16, true)
            }).then(function () {
                return gpio.read(15)
            })
    });

awesome
    .then(function (result) {
        if (!result)
            return delayedWrite(15, true)
    })
    .then(function () {
        return delayedWrite(7, false)
    })
    .then(function () {
        return delayedWrite(15, false)
    })
    .then(function () {
        return delayedWrite(16, false)
    });

function delayedWrite(pin, value) {
    return new Promise(function (resolve, reject) {
        setTimeout(function () {
            return gpio.write(pin, value).then(resolve, reject);
            /* this would also work*/
            // return gpio.write(pin, value, resolve)
        }, 500);
    });
}
```
## Contributing
Contributions are appreciated, both in the form of bug reports and pull requests.

Due to the nature of this project it can be quite time-consuming to test against real hardware, so the automated test suite is all the more important. I will not accept any pull requests that cause the build to fail, and probably will not accept any that do not have corresponding test coverage.

You can run the tests with npm:
```
npm test
```
and create a coverage report with:
```
npm run coverage
```
There is also an integration test that you can run on Raspberry Pi hardware, having connected two GPIO pins across a resistor. The command to run the test will provide further instructions on how to set up the hardware:
```
npm run int
```

The tests use [mochajs](http://mochajs.org) as the test framework, and [Sinon.JS](http://sinonjs.org) to stub and mock out file system calls.
