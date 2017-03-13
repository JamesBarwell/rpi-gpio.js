var assert = require('assert');
var fs = require('fs');
var mocha = require('mocha');
var sinon = require('sinon');

var sandbox;

// Store current listeners
var listeners = [];

// Stub epoll module
epoll = {};
require('epoll').Epoll = function (callback) {
    callback(null, 'fakeFd2');

    var listener = {
        add:    sandbox.spy(),
        remove: sandbox.stub().returnsThis(),
        close:  sandbox.stub()
    };
    listeners.push(listener);
    return listener
};

// Only load module after Epoll is stubbed
var gpio = require('../rpi-gpio.js');

var PATH = '/sys/class/gpio';

function getCpuInfo(revision) {
    revision = revision || '0002';
    return 'Processor   : ARMv6-compatible processor rev 7 (v6l)\nBogoMIPS    : 697.95\nFeatures    : swp half thumb fastmult vfp edsp java tls\nCPU implementer : 0x41\nCPU architecture: 7\nCPU variant : 0x0\nCPU part    : 0xb76\nCPU revision    : 7\n\n\nHardware    : BCM2708\nRevision    : ' + revision + '\nSerial   : 000000009a5d9c22';
}

describe('rpi-gpio', function () {

    beforeEach(function () {
        sandbox = sinon.sandbox.create();

        sandbox.stub(fs, 'writeFile').yieldsAsync();
        sandbox.stub(fs, 'exists').yieldsAsync(false);
        sandbox.stub(fs, 'openSync').returns('fakeFd');
        sandbox.stub(fs, 'readSync');
        sandbox.stub(fs, 'readFile')
            .withArgs('/proc/cpuinfo').yieldsAsync(null, getCpuInfo());

        gpio.reset();
        gpio.setMode(gpio.MODE_BCM);
        gpio.setResolveWithObject(false);
        gpio.version = 1;
    });

    afterEach(function () {
        sandbox.restore();
        listeners = []
    });

    describe('simulation', function () {
        context('when given a valid object', function () {
            context('with channel: 7, value: 1, type: true', function () {
                var onsetup;
                beforeEach(function () {
                    return onsetup = gpio.setup({
                        'channel': 7,
                        'value':   1,
                        'type':    true
                    });
                });

                it('should return an object', function () {
                    return onsetup.then(function (result) {
                        assert(typeof result == 'object');
                    });
                });
                context('and write() the result', function () {

                    beforeEach(function () {
                        return onsetup.then(function (result) {
                            return gpio.write(result);
                        })
                    });
                    it('should write the result from setup to file system', function () {
                        return onsetup.then(function () {
                            var args = fs.writeFile.lastCall.args;
                            assert.equal(args[0], PATH + '/gpio7/value');
                            assert.equal(args[1], '1');
                        })
                    });
                })
            });
        });
    });

    describe('setResolveWithObject()', function () {
        context('with an invalid mode', function () {
            var invalidModeSet;

            beforeEach(function () {
                invalidModeSet = function () {
                    gpio.setResolveWithObject('invalid');
                };
            });

            it('should return false', function () {
                invalidModeSet();
                assert(gpio.getResolveWithObject() == false);
            });
        });

        context('with an true mode', function () {
            var invalidModeSet;

            beforeEach(function () {
                invalidModeSet = function () {
                    return gpio.setResolveWithObject(true);
                };
            });

            it('should return true', function () {
                invalidModeSet();
                assert(gpio.getResolveWithObject() == true);
            });
        });
    });

    describe('setup()', function () {
        context('when given an empty object', function () {
            it('should run the callback with a specific error', function () {
                return gpio.setup({}).catch(function (err) {
                    assert.throws(function () {
                        throw new Error(err)
                    }, /Channel must be a number/);
                })
            });
        });

        context('when given an object with', function () {
            context('channel equal to null', function () {
                it('should run the callback with an error "Channel must be a number"', function () {
                    return gpio.setup({'channel': null}).catch(function (err) {
                        assert.throws(function () {
                            throw new Error(err)
                        }, /Channel must be a number/);
                    })
                });
            });

            context('channel equal to true', function () {
                it('should run the callback with an error "Channel must be a number"', function () {
                    return gpio.setup({'channel': true}).catch(function (err) {
                        assert.throws(function () {
                            throw new Error(err)
                        }, /Channel must be a number/);
                    })
                });
            });

            context('channel equal to NaN', function () {
                it('should run the callback with an error "Channel must be a number"', function () {
                    return gpio.setup({'channel': NaN}).catch(function (err) {
                        assert.throws(function () {
                            throw new Error(err)
                        }, /Channel must be a number/);
                    })
                });
            });

            context('channel equal to "hello"', function () {
                it('should run the callback with an error "Channel must be a number"', function () {
                    return gpio.setup({'channel': 'hello'}).catch(function (err) {
                        assert.throws(function () {
                            throw new Error(err)
                        }, /Channel must be a number/);
                    })
                });
            });

            context('channel and direction are null', function () {
                it('should run the callback with a specific error', function () {
                    return gpio.setup({'channel': null, 'direction': null}).catch(function (err) {
                        assert.throws(function () {
                            throw new Error(err)
                        }, /Channel must be a number/);
                    })
                });
            });

            context('channel 7', function () {
                context('direction DIR_IN', function () {
                    context('type null', function () {


                        it('should run successfully and return an object', function () {
                            return gpio.setup({
                                'channel':   7,
                                'direction': gpio.DIR_IN,
                                'edge':      gpio.EDGE_FALLING,
                                'type':      null
                            })
                                .catch(function (err) {
                                    assert.throws(function () {
                                        throw new Error(err)
                                    }, /Cannot set invalid resolve mode true or false/);
                                })
                        });
                    });
                });
            });

            context('channel 7', function () {
                context('direction null', function () {
                    it('should run the callback with a specific error', function () {
                        return gpio.setup({'channel': 7, 'direction': null}).catch(function (err) {
                            assert.throws(function () {
                                throw new Error(err)
                            }, /Cannot set invalid direction/);
                        })
                    });
                });
                context('direction 0', function () {
                    it('should run the callback with a specific error', function () {
                        return gpio.setup({'channel': 7, 'direction': 0}).catch(function (err) {
                            assert.throws(function () {
                                throw new Error(err)
                            }, /Cannot set invalid direction/);
                        })
                    });
                });

                context('direction NaN', function () {
                    it('should run the callback with a specific error', function () {
                        return gpio.setup({'channel': 7, 'direction': NaN}).catch(function (err) {
                            assert.throws(function () {
                                throw new Error(err)
                            }, /Cannot set invalid direction/);
                        })
                    });
                });
                context('direction -1', function () {
                    it('should run the callback with a specific error', function () {
                        return gpio.setup({'channel': 7, 'direction': -1}).catch(function (err) {
                            assert.throws(function () {
                                throw new Error(err)
                            }, /Cannot set invalid direction/);
                        })
                    });
                });

                context('direction out', function () {
                    var onsetup;

                    beforeEach(function () {
                        return onsetup = gpio.setup({'channel': 7, 'direction': gpio.DIR_OUT});
                    });

                    it('should run successfully and return 7', function () {
                        return onsetup.then(function (result) {
                            assert.ok(result === 7)
                        })
                    });
                });
            });
        });


        describe('when set to return a object', function () {
            beforeEach(function () {
                gpio.setResolveWithObject(true);
            });

            context('given a partial object and passing params to setup', function () {
                context('a object with channel 7', function () {
                    context('function param direction out', function () {
                        var promise;

                        beforeEach(function () {
                            return promise = gpio.setup({'channel': 7}, gpio.DIR_OUT);
                        });

                        it('should run successfully and return an object', function () {
                            return promise.then(function (result) {
                                assert(typeof result == 'object');
                            })
                        });

                        it('should return an object with channel value', function () {
                            return promise.then(function (result) {
                                assert.equal(result['channel'], 7);
                            })
                        });

                        it('should return an object with direction out', function () {
                            return promise.then(function (result) {
                                assert.equal(result['direction'], gpio.DIR_OUT);
                            })
                        });

                        it('should return an object with edge none', function () {
                            return promise.then(function (result) {
                                assert.equal(result['edge'], gpio.EDGE_NONE);
                            })
                        })
                    })
                });

                context('a object with channel 7', function () {
                    context(' function param direction DIR_OUT, EDGE_BOTH both', function () {

                        var setup;

                        beforeEach(function () {
                            return setup = gpio.setup({'channel': 7}, gpio.DIR_OUT, gpio.EDGE_BOTH);
                        });

                        it('should run successfully and return an object', function () {
                            return setup.then(function (result) {
                                assert(typeof result == 'object');
                            })
                        });

                        it('should return an object with channel 7', function () {
                            return setup.then(function (result) {
                                assert.equal(result['channel'], 7);
                            })
                        });

                        it('should return an object with direction DIR_OUT', function () {
                            return setup.then(function (result) {
                                assert.equal(result['direction'], gpio.DIR_OUT);
                            })
                        });

                        it('should return an object with edge EDGE_BOTH', function () {
                            return setup.then(function (result) {
                                assert.equal(result['edge'], gpio.EDGE_BOTH);
                            })
                        })
                    })
                });

                context('a object with channel 7', function () {
                    context('direction DIR_IN and edge EDGE_FALLING', function () {
                        context('along with function param direction DIR_OUT and edge EDGE_BOTH', function () {

                            var setup;

                            beforeEach(function () {
                                return setup = gpio.setup({
                                    'channel':   7,
                                    'direction': gpio.DIR_IN,
                                    'edge':      gpio.EDGE_FALLING
                                }, gpio.DIR_OUT, gpio.EDGE_BOTH);
                            });

                            it('should run successfully and return an object', function () {
                                return setup.then(function (result) {
                                    assert(typeof result == 'object');
                                })
                            });

                            it('should return an object with channel 7', function () {
                                return setup.then(function (result) {
                                    assert.equal(result['channel'], 7);
                                })
                            });

                            it('should return an object with direction DIR_IN', function () {
                                return setup.then(function (result) {
                                    assert.equal(result['direction'], gpio.DIR_IN);
                                })
                            });

                            it('should return an object with edge EDGE_FALLING', function () {
                                return setup.then(function (result) {
                                    assert.equal(result['edge'], gpio.EDGE_FALLING);
                                })
                            })
                        })
                    })
                })
            });


            context('and given a object with', function () {
                context('a channel and type false', function () {
                    var testPromise;

                    beforeEach(function () {
                        return testPromise = gpio.setup({
                            'channel': 7,
                            'type':    false
                        });
                    });

                    it('should return with 7', function () {
                        return testPromise.then(function (result) {
                            assert(result === 7)
                        })
                    });
                });
            })
        })
    });

    describe('write() with objects', function () {
        context('when pin 7 has been setup for output', function () {
            var testPromise;

            beforeEach(function () {
                gpio.setResolveWithObject(true);
                return testPromise = gpio.setup({'channel': 7, 'direction': gpio.DIR_OUT});
            });

            context('and pin 7 is written to with boolean true', function () {
                beforeEach(function () {
                    return testPromise.then(function (value) {
                        value['value'] = true;
                        return gpio.write(value)
                    })
                });

                it('should write the value to the file system', function () {
                    return testPromise.then(function () {
                        var args = fs.writeFile.lastCall.args;
                        assert.equal(args[0], PATH + '/gpio7/value');
                        assert.equal(args[1], '1');
                    });
                });
            });

            context('when given number 1', function () {
                beforeEach(function () {
                    return testPromise.then(function (value) {
                        value['value'] = 1;
                        return gpio.write(value)
                    })
                });

                it('should normalise to string "1"', function () {
                    var args = fs.writeFile.lastCall.args;
                    assert.equal(args[1], '1');
                });
            });

            context('when given string "1"', function () {
                beforeEach(function () {
                    return testPromise.then(function (value) {
                        value['value'] = '1';
                        return gpio.write(value)
                    })
                });

                it('should normalise to string "1"', function () {
                    var args = fs.writeFile.lastCall.args;
                    assert.equal(args[1], '1');
                });
            });

            context('when given boolean false', function () {
                beforeEach(function () {
                    return testPromise.then(function (value) {
                        value['value'] = false;
                        return gpio.write(value)
                    })
                });

                it('should normalise to string "0"', function () {
                    var args = fs.writeFile.lastCall.args;
                    assert.equal(args[1], '0');
                });
            });

            context('when given number 0', function () {
                beforeEach(function () {
                    return testPromise.then(function (value) {
                        value['value'] = 0;
                        return gpio.write(value)
                    })
                });

                it('should normalise to string "0"', function () {
                    var args = fs.writeFile.lastCall.args;
                    assert.equal(args[1], '0');
                });
            });

            context('when given string "0"', function () {
                beforeEach(function () {
                    return testPromise.then(function (value) {
                        value['value'] = '0';
                        return gpio.write(value)
                    })
                });

                it('should normalise to string "0"', function () {
                    var args = fs.writeFile.lastCall.args;
                    assert.equal(args[1], '0');
                });
            });

            context('and pin 3 is written to', function () {

                it('should run the callback with an error', function () {
                    return testPromise.then(function (value) {
                        value['value'] = true;
                        value['channel'] = 3;
                        return gpio.write(value).catch(function (err) {
                            assert.ok(err);
                        })
                    })
                });
            });
        });

        context('when pin 7 has been setup for input', function () {
            var testPromise;

            beforeEach(function () {
                gpio.setResolveWithObject(true);
                return testPromise = gpio.setup({'channel': 7, 'direction': gpio.DIR_IN});
            });

            context('and pin 7 is written to with boolean true', function () {

                it('should run the callback with an error', function () {
                    return testPromise.then(function (value) {
                        value['value'] = true;
                        return gpio.write(value).catch(function (error) {
                            assert.ok(error);
                        })
                    })
                });
            });
        });
    });

    describe('read()', function () {
        context('when pin 7 is setup for input', function () {
            context('and passed an object', function () {
                var onsetup;
                beforeEach(function () {
                    gpio.setResolveWithObject(true);
                    return onsetup = gpio.setup({'channel': 7, 'direction': gpio.DIR_IN, 'type': true});
                });

                context('and pin 7 is on', function () {
                    beforeEach(function () {
                        fs.readFile.yieldsAsync(null, '1');
                    });

                    context('and pin 7 is read', function () {
                        var onread;
                        beforeEach(function (done) {
                            onread = onsetup.then(function (value) {
                                return gpio.read(value)
                            });

                            done();
                        });

                        it('should run the callback with boolean true', function () {
                            return onread.then(function (value) {
                                var args = fs.readFile.lastCall.args;
                                assert.equal(args[0], PATH + '/gpio7/value');
                                assert(value['value'] === true);
                            })
                        });
                    });
                });

                context('and pin 7 is off', function () {
                    var onread;
                    beforeEach(function () {
                        fs.readFile.yieldsAsync(null, '0');
                    });

                    context('and pin 7 is read', function () {
                        beforeEach(function () {
                            return onread = onsetup.then(function (value) {
                                return gpio.read(value);
                            })
                        });

                        it('should run the callback with boolean false', function () {
                            return onread.then(function (value) {
                                var args = fs.readFile.lastCall.args;
                                assert.equal(args[0], PATH + '/gpio7/value');
                                assert(value['value'] === false);
                            });
                        });

                    });
                });

                context('and pin 3 is read', function () {
                    var onread;
                    beforeEach(function (done) {
                        onread = onsetup.then(function () {
                            return gpio.read({'channel': 3});
                        });
                        done();
                    });

                    it('should run the callback with an error', function () {
                        return onread
                            .catch(function (err) {
                                assert.throws(function () {
                                    throw new Error(err)
                                }, /Pin has not been exported/);
                            })
                    });
                });
            })
        });

        context('when pin 7 is setup for output', function () {
            var onsetup;
            beforeEach(function () {
                gpio.setResolveWithObject(true);
                return onsetup = gpio.setup({'channel': 7, 'direction': gpio.DIR_OUT});
            });

            context('and pin 7 is on', function () {
                beforeEach(function () {
                    fs.readFile.yieldsAsync(null, '1');
                });

                context('and pin 7 is read', function () {
                    var onread;
                    beforeEach(function () {
                        return onread = onsetup.then(function (value) {
                            return gpio.read(value);
                        });
                    });

                    it('should run the callback with a value boolean true', function () {
                        return onread.then(function (value) {
                            var args = fs.readFile.lastCall.args;
                            assert.equal(args[0], PATH + '/gpio7/value');
                            assert.ok(value['value']);
                        })
                    });
                });
            });
        });
    });
});