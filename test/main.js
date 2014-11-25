var assert = require('assert');
var fs     = require('fs');
var mocha  = require('mocha');
var sinon  = require('sinon');
var gpio   = require('../rpi-gpio.js');

var PATH = '/sys/class/gpio';

function getCpuInfo(revision) {
    revision = revision || '0002';
    return 'Processor   : ARMv6-compatible processor rev 7 (v6l)\nBogoMIPS    : 697.95\nFeatures    : swp half thumb fastmult vfp edsp java tls\nCPU implementer : 0x41\nCPU architecture: 7\nCPU variant : 0x0\nCPU part    : 0xb76\nCPU revision    : 7\n\n\nHardware    : BCM2708\nRevision    : ' + revision + '\nSerial   : 000000009a5d9c22';
}

describe('rpi-gpio', function() {

    before(function() {
        sinon.stub(fs, 'writeFile').yieldsAsync();
        sinon.stub(fs, 'exists').yieldsAsync(false);
        sinon.stub(fs, 'watchFile').yieldsAsync({ mtime: 2000 }, { mtime: 1000 });
        sinon.stub(fs, 'readFile')
            .withArgs('/proc/cpuinfo').yieldsAsync(null, getCpuInfo());
        sinon.spy(fs, 'unwatchFile');
    });

    beforeEach(function() {
        gpio.reset();
        gpio.setMode(gpio.MODE_BCM);
        gpio.version = 1;

        fs.writeFile.reset();
        fs.exists.reset();
        fs.watchFile.reset();
        fs.readFile.reset();
        fs.unwatchFile.reset();
    });

    describe('setMode()', function() {
        context('to RPI mode', function() {
            var listener;

            beforeEach(function() {
                listener = sinon.spy();
                gpio.on('modeChange', listener);

                gpio.setMode(gpio.MODE_RPI);
            });

            it('should emit a modeChange event and pass the mode callback', function() {
                sinon.assert.calledOnce(listener);
                sinon.assert.calledWith(listener, gpio.MODE_RPI);
            });
        });

        context('to BCM mode', function() {
            var listener;

            beforeEach(function() {
                listener = sinon.spy();
                gpio.on('modeChange', listener);

                gpio.setMode(gpio.MODE_BCM);
            });

            it('should emit a modeChange event and pass the mode callback', function() {
                sinon.assert.calledOnce(listener);
                sinon.assert.calledWith(listener, gpio.MODE_BCM);
            });
        });

        context('with an invalid mode', function() {
            var invalidModeSet;

            beforeEach(function() {
                invalidModeSet = function() {
                    gpio.setMode('invalid');
                };
            });

            it('should throw an error', function() {
                assert.throws(invalidModeSet, Error);
            });
        });
    });

    describe('setPollFrequency()', function() {
        context('when poll frequency is set to 1000', function() {
            beforeEach(function() {
                gpio.setPollFrequency(1000);
            });

            context('and a channel is set up', function() {
                beforeEach(function(done) {
                    gpio.setup(7, null, done);
                });

                it('should set up a file watcher with the specified poll frequency', function() {
                    var args = fs.watchFile.lastCall.args;
                    assert.deepEqual(args[1], { persistent: true, interval: 1000 });
                });
            });
        });
    });

    describe('setup()', function() {
        context('when given an invalid channel', function() {
            var callback;

            beforeEach(function(done) {
                callback = sinon.spy(onSetupComplete);
                function onSetupComplete() {
                    done();
                }

                gpio.setup(null, null, callback);
            });

            it('should run the callback with an error', function() {
                sinon.assert.calledOnce(callback);
                assert.ok(callback.getCall(0).args[0]);
            });
        });

        context('when given a non-GPIO channel', function() {
            var callback;

            beforeEach(function(done) {
                callback = sinon.spy(onSetupComplete);
                function onSetupComplete() {
                    done();
                }

                gpio.setup(1, null, callback);
            });

            it('should run the callback with an error', function() {
                sinon.assert.calledOnce(callback);
                assert.ok(callback.getCall(0).args[0]);
            });
        });

        context('when given an invalid direction', function() {
            var callback;

            beforeEach(function(done) {
                callback = sinon.spy(onSetupComplete);
                function onSetupComplete() {
                    done();
                }

                gpio.setup(7, 'foo', callback);
            });

            it('should run the callback with an error', function() {
                sinon.assert.calledOnce(callback);
                assert.ok(callback.getCall(0).args[0]);
            });
        });

        context('when the channel is already exported', function() {
            beforeEach(function(done) {
                fs.exists.yieldsAsync(true);

                gpio.setup(7, null, done);
            });

            it('should first unexport the channel', function() {
                var args0 = fs.writeFile.getCall(0).args;
                assert.equal(args0[0], PATH + '/unexport');
                assert.equal(args0[1], '7');
            });


            it('should second export the channel', function() {
                var args1 = fs.writeFile.getCall(1).args;
                assert.equal(args1[0], PATH + '/export');
                assert.equal(args1[1], '7');
            });
        });

        context('when the channel is not already exported', function() {
            beforeEach(function() {
                fs.exists.yieldsAsync(false);
            });

            context('and minimum arguments are specified', function() {
                var onSetup;
                var listener;

                beforeEach(function(done) {
                    listener = sinon.spy();
                    gpio.on('export', listener);

                    onSetup = sinon.spy(done);
                    gpio.setup(7, null, onSetup);
                });

                it('should export the channel', function() {
                    sinon.assert.called(fs.writeFile);

                    var args0 = fs.writeFile.getCall(0).args;
                    assert.equal(args0[0], PATH + '/export');
                    assert.equal(args0[1], '7');
                });

                it('should run the setup callback', function() {
                    sinon.assert.calledOnce(onSetup);
                });

                it('should emit an export event', function() {
                    // The emitted channel is the same format as given
                    sinon.assert.calledWith(listener, 7);
                });

                it('should set the channel direction to out by default', function() {
                    var args1 = fs.writeFile.getCall(1).args;
                    assert.equal(args1[0], PATH + '/gpio7/direction');
                    assert.equal(args1[1], 'out');
                });

                it('should set up a file watcher for the value', function() {
                    var args = fs.watchFile.lastCall.args;
                    assert.equal(args[0], PATH + '/gpio7/value');
                });
            });

            context('and direction is specified inwards', function() {
                beforeEach(function(done) {
                    gpio.setup(7, gpio.DIR_IN, done);
                });

                it('should set the channel direction', function() {
                    var args = fs.writeFile.lastCall.args;
                    assert.equal(args[0], PATH + '/gpio7/direction');
                    assert.equal(args[1], 'in');
                });
            });

            context('and direction is specified outwards', function() {
                beforeEach(function(done) {
                    gpio.setup(7, gpio.DIR_OUT, done);
                });

                it('should set the channel direction', function() {
                    var args = fs.writeFile.lastCall.args;
                    assert.equal(args[0], PATH + '/gpio7/direction');
                    assert.equal(args[1], 'out');
                });
            });

            context('and callback is specified', function() {
                var callback;

                beforeEach(function(done) {
                    callback = sinon.spy(done);
                    gpio.setup(7, callback);
                });

                it('should execute the callback when direction is missing', function() {
                    sinon.assert.called(callback);
                });
            });

        });

    });

    describe('write()', function() {
        context('when pin 7 has been setup for output', function() {
            var onSetup;

            beforeEach(function(done) {
                onSetup = sinon.spy(done);
                gpio.setup(7, gpio.DIR_OUT, onSetup);
            });

            context('and pin 7 is written to with boolean true', function() {
                beforeEach(function(done) {
                    gpio.write(7, true, done);
                });

                it('should write the value to the file system', function() {
                    var args = fs.writeFile.lastCall.args;
                    assert.equal(args[0], PATH + '/gpio7/value');
                    assert.equal(args[1], '1');

                    sinon.assert.called(onSetup);
                });
            });

            context('when given number 1', function() {
                beforeEach(function() {
                    gpio.write(7, 1);
                });

                it('should normalise to string "1"', function() {
                    var args = fs.writeFile.lastCall.args;
                    assert.equal(args[1], '1');
                });
            });

            context('when given string "1"', function() {
                beforeEach(function() {
                    gpio.write(7, 1);
                });

                it('should normalise to string "1"', function() {
                    var args = fs.writeFile.lastCall.args;
                    assert.equal(args[1], '1');
                });
            });

            context('when given boolean false', function() {
                beforeEach(function() {
                    gpio.write(7, false);
                });

                it('should normalise to string "0"', function() {
                    var args = fs.writeFile.lastCall.args;
                    assert.equal(args[1], '0');
                });
            });

            context('when given number 0', function() {
                beforeEach(function() {
                    gpio.write(7, 0);
                });

                it('should normalise to string "0"', function() {
                    var args = fs.writeFile.lastCall.args;
                    assert.equal(args[1], '0');
                });
            });

            context('when given string "0"', function() {
                beforeEach(function() {
                    gpio.write(7, '0');
                });

                it('should normalise to string "0"', function() {
                    var args = fs.writeFile.lastCall.args;
                    assert.equal(args[1], '0');
                });
            });

            context('and pin 3 is written to', function() {
                var onWrite;

                beforeEach(function(done) {
                    function write() {
                        done();
                    }
                    onWrite = sinon.spy(write);
                    gpio.write(3, true, onWrite);
                });

                it('should run the callback with an error', function() {
                    sinon.assert.calledOnce(onWrite);
                    assert.ok(onWrite.getCall(0).args[0]);
                });
            });
        });

        context('when pin 7 has been setup for input', function() {
            var onSetup;
            var onWrite;

            beforeEach(function(done) {
                onSetup = sinon.spy(done);
                gpio.setup(7, gpio.DIR_IN, onSetup);
            });

            context('and pin 7 is written to with boolean true', function() {
                beforeEach(function(done) {
                    var callback = function() {
                        done();
                    }
                    onWrite = sinon.spy(callback);
                    gpio.write(7, true, onWrite);
                });

                it('should run the callback with an error', function() {
                    sinon.assert.calledOnce(onWrite);
                    assert.ok(onWrite.getCall(0).args[0]);
                });
            });
        });

    });

    describe('read()', function() {

        context('when pin 7 is setup for input', function() {
            beforeEach(function(done) {
                gpio.setup(7, gpio.DIR_IN, done);
            });

            context('and pin 7 is on', function() {
                beforeEach(function() {
                    fs.readFile.yieldsAsync(null, '1');
                });

                context('and pin 7 is read', function() {
                    var callback;

                    beforeEach(function(done) {
                        callback = sinon.spy(done);
                        gpio.read(7, callback);
                    });

                    it('should run the callback with a value boolean true', function() {
                        var args = fs.readFile.lastCall.args;
                        assert.equal(args[0], PATH + '/gpio7/value');
                        sinon.assert.calledWith(callback, null, true);
                    });

                });
            });

            context('and pin 7 is off', function() {
                beforeEach(function() {
                    fs.readFile.yieldsAsync(null, '0');
                });

                context('and pin 7 is read', function() {
                    var callback;

                    beforeEach(function(done) {
                        callback = sinon.spy(done);
                        gpio.read(7, callback);
                    });

                    it('should run the callback with a value boolean false', function() {
                        var args = fs.readFile.lastCall.args;
                        assert.equal(args[0], PATH + '/gpio7/value');
                        sinon.assert.calledWith(callback, null, false);
                    });

                });
            });

            context('and pin 3 is read', function() {
                var callback;

                beforeEach(function(done) {
                    function onRead() {
                        done();
                    }
                    callback = sinon.spy(onRead);
                    gpio.read(3, callback);
                });

                it('should run the callback with an error', function() {
                    sinon.assert.calledOnce(callback);
                    assert.ok(callback.getCall(0).args[0]);
                });
            });
        });
    });

    describe('destroy', function() {
        context('when pins 7, 8 and 10 have been exported', function() {
            var unexportPath = PATH + '/unexport';

            beforeEach(function(done) {
                var i = 3;
                [7, 8, 10].forEach(function(pin) {
                    gpio.setup(pin, gpio.DIR_IN, function() {
                        if (--i === 0) {
                            onSetupComplete();
                        }
                    });
                });

                function onSetupComplete() {
                    fs.writeFile.reset();
                    gpio.destroy(done);
                }
            });

            it('should unexport pin 7', function() {
                sinon.assert.calledWith(fs.writeFile, unexportPath, '7');
            });

            it('should unexport pin 8', function() {
                sinon.assert.calledWith(fs.writeFile, unexportPath, '8');
            });

            it('should unexport pin 10', function() {
                sinon.assert.calledWith(fs.writeFile, unexportPath, '10');
            });

            it('should unwatch pin 7', function() {
                sinon.assert.calledWith(fs.unwatchFile, PATH + '/gpio7/value');
            });

            it('should unwatch pin 8', function() {
                sinon.assert.calledWith(fs.unwatchFile, PATH + '/gpio8/value');
            });

            it('should unwatch pin 10', function() {
                sinon.assert.calledWith(fs.unwatchFile, PATH + '/gpio10/value');
            });

        });
    });

    describe('pin value change', function() {

        context('when a pin is set up', function() {
            var listener;

            beforeEach(function(done) {
                // Remove previous stub so that we can control when watchFile triggers
                fs.watchFile.restore();
                sinon.stub(fs, 'watchFile');

                listener = sinon.spy();
                gpio.on('change', listener);

                gpio.setup(7, gpio.DIR_IN, done);
            });

            context('and its voltage changes from low to high', function() {
                beforeEach(function(done) {
                    fs.readFile.yieldsAsync(null, '1');

                    gpio.on('change', function() {
                        done();
                    });

                    // Trigger voltage change
                    var cb = fs.watchFile.lastCall.args[2];
                    cb({ mtime: 2000 }, { mtime: 1000 });
                });

                it('should emit a change event', function() {
                    sinon.assert.calledWith(listener, 7, true);
                });

            });
        });

        context('when a pin is set up with no callback', function() {
            var listener;

            beforeEach(function() {
                // Remove previous stub so that we can control when watchFile triggers
                fs.watchFile.restore();
                sinon.stub(fs, 'watchFile');

                gpio.setup(7, gpio.DIR_IN);
            });

            it('should not error', function() {
                assert.ok(true);
            });

        });

    });

    describe('handles pin translation', function() {

        context('when in RPI mode', function() {
            beforeEach(function() {
                gpio.setMode(gpio.MODE_RPI);
            });

            var revisionMap = {
                '0002': 'v1',
                '0003': 'v1',
                '0004': 'v2',
                '0005': 'v2',
                '0006': 'v2',
                '0007': 'v2',
                '0008': 'v2',
                '0009': 'v2',
                '000d': 'v2',
                '000e': 'v2',
                '000f': 'v2',
                // Over-volted hardware
                '10000003': 'v1',
                '10000004': 'v2',
                '1000000f': 'v2'
            };

            var map = {
                v1: {
                    // RPI to BCM
                    '3':  '0',
                    '5':  '1',
                    '7':  '4',
                    '8':  '14',
                    '10': '15',
                    '11': '17',
                    '12': '18',
                    '13': '21',
                    '15': '22',
                    '16': '23',
                    '18': '24',
                    '19': '10',
                    '21': '9',
                    '22': '25',
                    '23': '11',
                    '24': '8',
                    '26': '7'
                },
                v2: {
                    // RPI to BCM
                    '3':  '2',
                    '5':  '3',
                    '7':  '4',
                    '8':  '14',
                    '10': '15',
                    '11': '17',
                    '12': '18',
                    '13': '27',
                    '15': '22',
                    '16': '23',
                    '18': '24',
                    '19': '10',
                    '21': '9',
                    '22': '25',
                    '23': '11',
                    '24': '8',
                    '26': '7',
                    '29': '5',
                    '31': '6',
                    '32': '12',
                    '33': '13',
                    '35': '19',
                    '36': '16',
                    '37': '26',
                    '38': '20',
                    '40': '21'
                }
            };

            Object.keys(revisionMap).forEach(function(revision) {
                var revisionSchema = revisionMap[revision];
                var pinMap = map[revisionSchema];

                context('and hardware revision is: ' + revision, function() {
                    beforeEach(function() {
                        fs.readFile.withArgs('/proc/cpuinfo').yieldsAsync(null, getCpuInfo(revision));
                    });

                    Object.keys(pinMap).forEach(function(rpiPin) {
                        var bcmPin = pinMap[rpiPin];

                        context('writing to RPI pin ' + rpiPin, function() {
                            beforeEach(function(done) {
                                gpio.setup(rpiPin, gpio.DIR_IN, done);
                            });

                            it('should write to pin ' + bcmPin + ' (BCM)', function() {
                                assert.equal(fs.writeFile.getCall(0).args[1], bcmPin);
                            });
                        });
                    });
                });

            });

        });

        describe('when in BCM mode', function() {
            beforeEach(function() {
                gpio.setMode(gpio.MODE_BCM);
            });

            var bcmPins = [
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

            bcmPins.forEach(function(bcmPin) {
                bcmPin += '';

                context('writing to BCM pin ' + bcmPin, function() {
                    beforeEach(function(done) {
                        gpio.setup(bcmPin, gpio.DIR_IN, done);
                    });

                    it('should write to the same pin ' + bcmPin + ' (BCM)', function() {
                        assert.equal(fs.writeFile.getCall(0).args[1], bcmPin);
                    });
                });
            });
        });
    });

});
