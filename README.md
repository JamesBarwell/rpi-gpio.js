rpi-gpio.js
==========

Control Raspberry Pi GPIO pins with node.js

[![Build Status](https://travis-ci.org/JamesBarwell/rpi-gpio.js.svg?branch=master)](https://travis-ci.org/JamesBarwell/rpi-gpio.js)
[![NPM version](https://badge.fury.io/js/rpi-gpio.svg)](http://badge.fury.io/js/rpi-gpio)

## Supported hardware

* Raspberry Pi 1 Model A
* Raspberry Pi 1 Model A+
* Raspberry Pi 1 Model B
* Raspberry Pi 1 Model B+
* Raspberry Pi 2 Model B
* Raspberry Pi 3 Model B
* Raspberry Pi 4 Model B
* Raspberry Pi Zero
* Raspberry Pi Zero W

## Supported node versions

Please use 3.x unless you need to run with an old version of node. Older versions are not supported.

| node version | rpi-gpio 1.x | rpi-gpio 2.x + | rpi-gpio 3.x + |
| ------------ | ------------ | -------------- | -------------- |
| 0.10         | Yes          | No             | No             |
| 0.12         | Yes          | No             | No             |
| 4            | Yes          | Yes            | No             |
| 6            | Yes          | Yes            | No             |
| 8            | Yes          | Yes            | Yes            |
| 10           | No           | Yes            | Yes            |
| 12           | No           | Yes            | Yes            |
| 14           | No           | Yes            | Yes            |

## Upgrading to 3.x

Please read if you are already using this module in your project, else please skip to the next section.

This project has long supported a traditional callback or "error-first" API (i.e. same as the node library), and an additional Promises API layer. From 3.x onwards, the Promises API will be the primary way of interacting with the module. The callback API will be available but deprecated.

Previously, the callback API was available by calling methods directly on the module, and the Promises API was available on a nested object:
```
var gpio = require('rpi-gpio');

// callback style
gpio.setup(7, function(err) { });

// promises style
await gpio.promise.setup(7);
```

From 3.x, this is reversed. The Promises API is available directly on the module, and the callback API is available as a compatibility layer:
```
var gpio = require('rpi-gpio');

// promises style
await gpio.setup(7);

// callback style
gpio.callback.setup(7, function(err) { });
```

The callback style is supported in version 3.x, but will probably be dropped in a future major version.

## Setup and install

See this guide on how to get [node.js running on Raspberry Pi](http://thisdavej.com/beginners-guide-to-installing-node-js-on-a-raspberry-pi/#install-node).

This module can then be installed with npm:
```
npm install rpi-gpio
```

### Dependency
Please note that this module has a dependency on [epoll](https://github.com/fivdi/epoll) and that currently it is only possible to build and develop the module on Linux systems.

If you are having trouble installing this module make sure you are running gcc/g++ `-v 4.8` or higher. [Here](https://github.com/fivdi/onoff/wiki/Node.js-v4-and-native-addons) is an installation guide.

### Typescript

If you wish to use this module with Typescript, install the definitions from Definitely Typed:
```
npm install --save @types/rpi-gpio
```

Please note that this is not a Typescript project and the definitions are independently maintained by the community. Thanks to Roaders for providing these.

## Usage
Before you can read or write, you must use `setup()` to open a channel, and must specify whether it will be used for input or output. Having done this, you can then read in the state of the channel or write a value to it using `read()` or `write()`.

All of the functions relating to the pin state within this module are asynchronous and rely on Promises. So for example, in reading the value of a channel, you need to either use `await` or `.then()` on the object returned. In addition, this module inherits the standard [EventEmitter](http://nodejs.org/api/events.html), so you may use the standard callback bindings to listen to pin change events.

Please see the Examples for more information.

### Pin naming
Please be aware that there are multiple ways of referring to the pins on the Raspberry Pi. The simplest and default way to use the module is refer to them by physical position, using the diagrams on [this page](http://elinux.org/RPi_Low-level_peripherals). So holding the Raspberry Pi such that the GPIO header runs down the upper-right side of the board, if you wished to address GPIO4 (which is in column 1 and row 4), you would setup pin 7. If you wish instead to refer to the pins by their GPIO names (known as BCM naming), you can use the `setMode` command described in the API documentation below.

### Running without sudo
This module will work without use of the `sudo` command, as long as the user running the node process belongs to the `gpio` group. You can check the current user's groups by running the command `groups`, or `groups <user>` for another user. If you are not already a member of the `gpio` group, you can add yourself or another user by running `sudo adduser <user> gpio`.


## API

The default API uses Promises, to make asynchronous interaction easier.

### Methods

#### setup(channel [, direction, edge])
Sets up a channel for read or write. Must be done before the channel can be used.
* channel: Reference to the pin in the current mode's schema.
* direction: The pin direction, pass either DIR_IN for read mode or DIR_OUT for write mode. You can also pass DIR_LOW or DIR_HIGH to use the write mode and specify an initial state of 'off' or 'on' respectively. Defaults to DIR_OUT.
* edge: Interrupt generating GPIO chip setting, pass in EDGE_NONE for no interrupts, EDGE_RISING for interrupts on rising values, EDGE_FALLING for interrupts on falling values or EDGE_BOTH for all interrupts.
Defaults to EDGE_NONE.

#### read(channel, callback)
Reads the value of a channel.
* channel: Reference to the pin in the current mode's schema.
* Returns: pin value, as a boolean.

#### write(channel, value)
Writes the value of a channel.
* channel: Reference to the pin in the current mode's schema.
* value: Boolean value to specify whether the channel will turn on or off.

#### setMode(mode)
Sets the channel addressing schema.
* mode: Specify either Raspberry Pi or SoC/BCM pin schemas, by passing MODE_RPI or MODE_BCM. Defaults to MODE_RPI.

#### input()
Alias of read().

#### output()
Alias of write().

#### destroy()
Tears down any previously set up channels. Should be run when your program stops, or needs to reset the state of the pins.

#### reset()
Tears down the module state - used for internal testing.

### Events
See Node [EventEmitter](http://nodejs.org/api/events.html) for documentation on listening to events.

#### change
Emitted when the value of a channel changed
* channel
* value

## API (callback, error-first)

This API is depreacted, and is provided for compatibility reasons. New projects should not use it, and old projects should plan to switch to the Promises API.

This was the old interface in versions 1.x and 2.x. It is identical to the Promises API, but an extra callback argument must be passed in at the end of each function. This API is the same as the node library, i.e. the callback will always receive either an error as its first argument, or the successful result as its second argument. If using this API, it is important to check for an error after each command, else your code will continue to run and will likely fail in hard to understand ways.

The Callback interface is available in the `callback` namespace, e.g.:

```js
var gpioc = require('rpi-gpio').callback;

gpioc.setup(7, gpiop.DIR_OUT, (err) => {
  if (err) throw err;
  gpioc.write(7, true, (err) => {
    if (err) throw err;
  })
});
```

## Examples

See the `examples` directory included in this project.

Please note that all examples are intended to be directly runnable from the code repository, so they always require the module in at the top using `var gpio = require(../rpi-gpio)`. In reality, you will want to include the module using `var gpio = require('rpi-gpio')`

## Contributing
Contributions are always appreciated, whether that's in the form of bug reports, pull requests or helping to diagnose bugs and help other users on the issues page.

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

You can check run the linting with:
```
npm run lint
npm run lint-fix
```

The tests use [mochajs](http://mochajs.org) as the test framework, and [Sinon.JS](http://sinonjs.org) to stub and mock out file system calls.
