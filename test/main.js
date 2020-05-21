const assert = require('assert');
const fs = require('fs');
const sinon = require('sinon');

let sandbox;

// Store current listeners
let listeners = [];

// Stub epoll module
global.epoll = {};
require('epoll').Epoll = function (callback) {
  callback(null, 'fakeFd2');

  const listener = {
    add: sandbox.spy(),
    remove: sandbox.stub().returnsThis(),
    close: sandbox.stub(),
  };
  listeners.push(listener);
  return listener;
};

// Only load module after Epoll is stubbed
const gpio = require('../rpi-gpio.js');
const gpioCallback = gpio.callback;

const PATH = '/sys/class/gpio';

function getCpuInfo(revision) {
  revision = revision || '0002';
  return 'Processor   : ARMv6-compatible processor rev 7 (v6l)\nBogoMIPS    : 697.95\nFeatures    : swp half thumb fastmult vfp edsp java tls\nCPU implementer : 0x41\nCPU architecture: 7\nCPU variant : 0x0\nCPU part    : 0xb76\nCPU revision    : 7\n\n\nHardware    : BCM2708\nRevision    : ' + revision + '\nSerial   : 000000009a5d9c22';
}

describe('rpi-gpio', () => {

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    sandbox.stub(fs, 'writeFile').yieldsAsync();
    sandbox.stub(fs, 'exists').yieldsAsync(false);
    sandbox.stub(fs, 'open').yieldsAsync(null, 'fakeFd');
    sandbox.stub(fs, 'read');
    sandbox.stub(fs, 'readFile')
      .withArgs('/proc/cpuinfo').yieldsAsync(null, getCpuInfo());

    gpio.reset();
    gpio.setMode(gpio.MODE_BCM);
    gpio.version = 1;
  });

  afterEach(() => {
    sandbox.restore();
    listeners = [];
  });

  describe('setMode()', () => {
    context('with an invalid mode', () => {
      let invalidModeSet;

      beforeEach(() => {
        invalidModeSet = () => {
          gpio.setMode('invalid');
        };
      });

      it('should throw an error', () => {
        assert.throws(invalidModeSet, Error);
      });
    });
  });

  describe('setup()', () => {
    context('when given an invalid channel', () => {
      let callback;

      beforeEach(async () => {
        callback = sandbox.spy();
        try {
          return await gpio.setup(null, null)
        } catch (err) {
          callback(err);
        }
      });

      it('should run the callback with an error', () => {
        sinon.assert.calledOnce(callback);
        assert.ok(callback.getCall(0).args[0]);
      });
    });

    context('when given a non-GPIO channel', () => {
      let callback;

      beforeEach(() => {
        callback = sandbox.spy();
        return gpio.setup(2, null)
          .catch(callback);
      });

      it('should run the callback with an error', () => {
        sinon.assert.calledOnce(callback);
        assert.ok(callback.getCall(0).args[0]);
      });
    });

    context('when given an invalid direction', () => {
      let callback;

      beforeEach(() => {
        callback = sandbox.spy();
        return gpio.setup(7, 'foo')
          .catch(callback);
      });

      it('should run the callback with an error', () => {
        sinon.assert.calledOnce(callback);
        assert.ok(callback.getCall(0).args[0]);
      });
    });

    context('when given an invalid edge', () => {
      let callback;

      beforeEach(() => {
        callback = sandbox.spy();
        return gpio.setup(7, gpio.DIR_IN, 'foo')
          .catch(callback);
      });

      it('should run the callback with an error', () => {
        sinon.assert.calledOnce(callback);
        assert.ok(callback.getCall(0).args[0]);
      });
    });

    context('when the channel is already exported', () => {
      beforeEach(() => {
        fs.exists.yieldsAsync(true);

        return gpio.setup(7, null);
      });

      it('should first unexport the channel', () => {
        const args0 = fs.writeFile.getCall(0).args;
        assert.equal(args0[0], PATH + '/unexport');
        assert.equal(args0[1], '7');
      });


      it('should second export the channel', () => {
        const args1 = fs.writeFile.getCall(1).args;
        assert.equal(args1[0], PATH + '/export');
        assert.equal(args1[1], '7');
      });
    });

    context('when the channel is not already exported', () => {
      beforeEach(() => {
        fs.exists.yieldsAsync(false);
      });

      context('and minimum arguments are specified', () => {
        let onSetup;

        beforeEach(() => {
          onSetup = sandbox.spy();
          return gpio.setup(7, null)
            .then(onSetup);
        });

        it('should export the channel', () => {
          sinon.assert.called(fs.writeFile);

          const args0 = fs.writeFile.getCall(0).args;
          assert.equal(args0[0], PATH + '/export');
          assert.equal(args0[1], '7');
        });

        it('should run the setup callback', () => {
          sinon.assert.calledOnce(onSetup);
        });

        it('should set the channel edge to none by default', () => {
          sinon.assert.called(fs.writeFile);

          const args1 = fs.writeFile.getCall(1).args;
          assert.equal(args1[0], PATH + '/gpio7/edge');
          assert.equal(args1[1], 'none');
        });

        it('should set the channel direction to out by default', () => {
          sinon.assert.called(fs.writeFile);

          const args2 = fs.writeFile.getCall(2).args;
          assert.equal(args2[0], PATH + '/gpio7/direction');
          assert.equal(args2[1], 'out');
        });

        it('should set up a listener', () => {
          assert.equal(listeners.length, 1);

          const listener = listeners[0];
          sinon.assert.calledWith(listener.add, 'fakeFd');
        });

        it('should clear the interupt twice', () => {
          sinon.assert.calledTwice(fs.read);
        });
      });

      context('and direction is specified inwards', () => {
        beforeEach(() => {
          return gpio.setup(7, gpio.DIR_IN);
        });

        it('should set the channel direction', () => {
          const args = fs.writeFile.lastCall.args;
          assert.equal(args[0], PATH + '/gpio7/direction');
          assert.equal(args[1], 'in');
        });
      });

      context('and direction is specified outwards', () => {
        beforeEach(() => {
          return gpio.setup(7, gpio.DIR_OUT);
        });

        it('should set the channel direction', () => {
          const args = fs.writeFile.lastCall.args;
          assert.equal(args[0], PATH + '/gpio7/direction');
          assert.equal(args[1], 'out');
        });
      });

      context('and direction is specified low-ward', () => {
        beforeEach(() => {
          return gpio.setup(7, gpio.DIR_LOW);
        });

        it('should set the channel direction', () => {
          const args = fs.writeFile.lastCall.args;
          assert.equal(args[0], PATH + '/gpio7/direction');
          assert.equal(args[1], 'low');
        });
      });

      context('and direction is specified high-ward', () => {
        beforeEach(() => {
          return gpio.setup(7, gpio.DIR_HIGH);
        });

        it ('should set the channel direction', () => {
          const args = fs.writeFile.lastCall.args;
          assert.equal(args[0], PATH + '/gpio7/direction');
          assert.equal(args[1], 'high');
        });
      });

      const edge_modes = ['none', 'rising', 'falling', 'both'];
      edge_modes.forEach((edge_mode) => {
        const edgeConstant = 'EDGE_' + edge_mode.toUpperCase();
        context('and the edge is specified as ' + edge_mode, () => {
          beforeEach(() => {
            return gpio.setup(7, gpio.DIR_OUT, gpio[edgeConstant]);
          });

          it('should set the channel edge to ' + edge_mode, () => {
            sinon.assert.called(fs.writeFile);

            const args1 = fs.writeFile.getCall(1).args;
            assert.equal(args1[0], PATH + '/gpio7/edge');
            assert.equal(args1[1], edge_mode);
          });
        });
      });

      context('and the edge fails to set first time', () => {
        it('should try and set the edge again');
      });

      context('and callback is specified', () => {
        let callback;

        beforeEach(() => {
          callback = sandbox.spy();
          return gpio.setup(7)
            .then(callback);
        });

        it('should execute the callback when direction is missing', () => {
          sinon.assert.called(callback);
        });
      });

    });

  });

  describe('write()', () => {
    context('when pin 7 has been setup for output', () => {
      let onSetup;

      beforeEach(() => {
        onSetup = sandbox.spy();
        return gpio.setup(7, gpio.DIR_OUT)
          .then(onSetup);
      });

      context('and pin 7 is written to with boolean true', () => {
        beforeEach(() => {
          return gpio.write(7, true);
        });

        it('should write the value to the file system', () => {
          const args = fs.writeFile.lastCall.args;
          assert.equal(args[0], PATH + '/gpio7/value');
          assert.equal(args[1], '1');

          sinon.assert.called(onSetup);
        });
      });

      context('when given number 1', () => {
        beforeEach(() => {
          return gpio.write(7, 1);
        });

        it('should normalise to string "1"', () => {
          const args = fs.writeFile.lastCall.args;
          assert.equal(args[1], '1');
        });
      });

      context('when given string "1"', () => {
        beforeEach(() => {
          return gpio.write(7, 1);
        });

        it('should normalise to string "1"', () => {
          const args = fs.writeFile.lastCall.args;
          assert.equal(args[1], '1');
        });
      });

      context('when given boolean false', () => {
        beforeEach(() => {
          return gpio.write(7, false);
        });

        it('should normalise to string "0"', () => {
          const args = fs.writeFile.lastCall.args;
          assert.equal(args[1], '0');
        });
      });

      context('when given number 0', () => {
        beforeEach(() => {
          return gpio.write(7, 0);
        });

        it('should normalise to string "0"', () => {
          const args = fs.writeFile.lastCall.args;
          assert.equal(args[1], '0');
        });
      });

      context('when given string "0"', () => {
        beforeEach(() => {
          return gpio.write(7, '0');
        });

        it('should normalise to string "0"', () => {
          const args = fs.writeFile.lastCall.args;
          assert.equal(args[1], '0');
        });
      });

      context('and pin 3 is written to', () => {
        let onWrite;

        beforeEach(() => {
          onWrite = sandbox.spy();
          return gpio.write(3, true)
            .catch(onWrite);
        });

        it('should run the callback with an error', () => {
          sinon.assert.calledOnce(onWrite);
          assert.ok(onWrite.getCall(0).args[0]);
        });
      });
    });

    context('when pin 7 has been setup for input', () => {
      let onSetup;
      let onWrite;

      beforeEach(() => {
        onSetup = sandbox.spy();
        return gpio.setup(7, gpio.DIR_IN)
          .then(onSetup);
      });

      context('and pin 7 is written to with boolean true', () => {
        beforeEach(() => {
          onWrite = sandbox.spy();
          return gpio.write(7, true)
            .catch(onWrite);
        });

        it('should run the callback with an error', () => {
          sinon.assert.calledOnce(onWrite);
          assert.ok(onWrite.getCall(0).args[0]);
        });
      });
    });

  });

  describe('read()', () => {

    context('when pin 7 is setup for input', () => {
      beforeEach(() => {
        return gpio.setup(7, gpio.DIR_IN);
      });

      context('and pin 7 is on', () => {
        beforeEach(() => {
          fs.readFile.yieldsAsync(null, '1');
        });

        context('and pin 7 is read', () => {
          let callback;

          beforeEach(() => {
            callback = sandbox.spy();
            return gpio.read(7)
              .then(callback);
          });

          it('should run the callback with a value boolean true', () => {
            const args = fs.readFile.lastCall.args;
            assert.equal(args[0], PATH + '/gpio7/value');
            sinon.assert.calledWith(callback, true);
          });
        });
      });

      context('and pin 7 is off', () => {
        beforeEach(() => {
          fs.readFile.yieldsAsync(null, '0');
        });

        context('and pin 7 is read', () => {
          let callback;

          beforeEach(() => {
            callback = sandbox.spy();
            return gpio.read(7)
              .then(callback);
          });

          it('should run the callback with a value boolean false', () => {
            const args = fs.readFile.lastCall.args;
            assert.equal(args[0], PATH + '/gpio7/value');
            sinon.assert.calledWith(callback, false);
          });

        });
      });

      context('and pin 3 is read', () => {
        let callback;

        beforeEach(() => {
          callback = sandbox.spy();
          return gpio.read(3)
            .catch(callback);
        });

        it('should run the callback with an error', () => {
          sinon.assert.calledOnce(callback);
          assert.ok(callback.getCall(0).args[0]);
        });
      });
    });

    context('when pin 7 is setup for output', () => {
      beforeEach(() => {
        return gpio.setup(7, gpio.DIR_OUT);
      });

      context('and pin 7 is on', () => {
        beforeEach(() => {
          fs.readFile.yieldsAsync(null, '1');
        });

        context('and pin 7 is read', () => {
          let callback;

          beforeEach(() => {
            callback = sandbox.spy();
            return gpio.read(7)
              .then(callback);
          });

          it('should run the callback with a value boolean true', () => {
            const args = fs.readFile.lastCall.args;
            assert.equal(args[0], PATH + '/gpio7/value');
            sinon.assert.calledWith(callback, true);
          });

        });
      });
    });

  });

  describe('destroy', () => {
    context('when pins 7, 8 and 10 have been exported', () => {
      const unexportPath = PATH + '/unexport';

      beforeEach(() => {
        const setupTasks = [7, 8, 10].map((pin) => {
          return gpio.setup(pin, gpio.DIR_IN);
        });
        return Promise.all(setupTasks);
      });

      it('should have created 3 listeners', () => {
        assert.equal(listeners.length, 3);
      });

      context('and destroy() is run', () => {

        beforeEach(() => {
          return gpio.destroy();
        });

        it('should unexport pin 7', () => {
          sinon.assert.calledWith(fs.writeFile, unexportPath, '7');
        });

        it('should unexport pin 8', () => {
          sinon.assert.calledWith(fs.writeFile, unexportPath, '8');
        });

        it('should unexport pin 10', () => {
          sinon.assert.calledWith(fs.writeFile, unexportPath, '10');
        });

        it('should unwatch pin 7', () => {
          const listener = listeners[0];
          sinon.assert.calledOnce(listener.remove);
          sinon.assert.calledWith(listener.remove, 'fakeFd');
          sinon.assert.calledOnce(listener.close);
        });

        it('should unwatch pin 8', () => {
          const listener = listeners[1];
          sinon.assert.calledOnce(listener.remove);
          sinon.assert.calledWith(listener.remove, 'fakeFd');
          sinon.assert.calledOnce(listener.close);
        });

        it('should unwatch pin 9', () => {
          const listener = listeners[2];
          sinon.assert.calledOnce(listener.remove);
          sinon.assert.calledWith(listener.remove, 'fakeFd');
          sinon.assert.calledOnce(listener.close);
        });

      });

    });
  });

  describe('pin value change', () => {

    context('when a pin is set up', () => {
      let listener;

      beforeEach(() => {
        // Remove previous stub so that we can control when watchFile triggers

        listener = sandbox.spy();
        gpio.on('change', listener);

        return gpio.setup(7, gpio.DIR_IN);
      });

      context('and its voltage changes from low to high', () => {
        beforeEach(() => {
          // this is erroring out due to watchFile not working as expected. Please fix
        });

      });
    });

    context('when a pin is set up with no callback', () => {
      beforeEach(() => {
        // Remove previous stub so that we can control when watchFile triggers
        return gpio.setup(7, gpio.DIR_IN);
      });

      it('should not error', () => {
        assert.ok(true);
      });

    });

  });

  describe('handles pin translation', () => {

    context('when in RPI mode', () => {
      beforeEach(() => {
        gpio.setMode(gpio.MODE_RPI);
      });

      const revisionMap = {
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
        '1000000f': 'v2',
      };

      const map = {
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
          '26': '7',
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
          '40': '21',
        },
      };

      Object.keys(revisionMap).forEach((revision) => {
        const  revisionSchema = revisionMap[revision];
        const  pinMap = map[revisionSchema];

        context('and hardware revision is: ' + revision, () => {
          beforeEach(() => {
            fs.readFile.withArgs('/proc/cpuinfo').yieldsAsync(null, getCpuInfo(revision));
          });

          Object.keys(pinMap).forEach((rpiPin) => {
            const bcmPin = pinMap[rpiPin];

            context('writing to RPI pin ' + rpiPin, () => {
              beforeEach(() => {
                return gpio.setup(rpiPin, gpio.DIR_IN);
              });

              it('should write to pin ' + bcmPin + ' (BCM)', () => {
                assert.equal(fs.writeFile.getCall(0).args[1], bcmPin);
              });
            });
          });
        });

      });

    });

    describe('when in BCM mode', () => {
      beforeEach(() => {
        gpio.setMode(gpio.MODE_BCM);
      });

      const revisionMap = {
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
        '1000000f': 'v2',
      };

      const map = {
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
          '26': '7',
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
          '40': '21',
        },
      };

      const invalidBcmPinsByVersion = {
        v1: [2, 3, 5, 6, 12, 13, 16, 19, 20],
        v2: [0, 1],
      };

      Object.keys(revisionMap).forEach((revision) => {
        const revisionSchema = revisionMap[revision];
        const pinMap = map[revisionSchema];
        const invalidBcmPins = invalidBcmPinsByVersion[revisionSchema];

        context('and hardware revision is: ' + revision, () => {
          beforeEach(() => {
            fs.readFile.withArgs('/proc/cpuinfo').yieldsAsync(null, getCpuInfo(revision));
          });

          Object.keys(pinMap).forEach((rpiPin) => {
            const bcmPin = pinMap[rpiPin];

            context('writing to BCM pin ' + bcmPin, () => {
              beforeEach(() => {
                return gpio.setup(bcmPin, gpio.DIR_IN);
              });

              it('should write to the same pin ' + bcmPin + ' (BCM)', () => {
                assert.equal(fs.writeFile.getCall(0).args[1], bcmPin);
              });
            });
          });

          invalidBcmPins.forEach((bcmPin) => {
            context('writing to invalid BCM pin ' + bcmPin, () => {
              let callback;

              beforeEach(() => {
                callback = sandbox.spy();
                return gpio.setup(bcmPin, gpio.DIR_IN)
                  .catch(callback);
              });

              it('should run the callback with an error', () => {
                sinon.assert.calledOnce(callback);
                assert.ok(callback.getCall(0).args[0]);
              });
            });
          });
        });
      });
    });
  });

  describe('promise', () => {
    describe('setup()', () => {
      context('when given an invalid channel', () => {
        let callback;

        beforeEach((done) => {
          callback = sandbox.spy(onSetupComplete);
          function onSetupComplete() {
            done();
          }

          gpio.setup(null, null).catch(callback);
        });

        it('should run the callback with an error', () => {
          sinon.assert.calledOnce(callback);
          assert.ok(callback.getCall(0).args[0]);
        });
      });

      context('when given a valid channel', () => {
        let callback;

        beforeEach((done) => {
          callback = sandbox.spy(onSetupComplete);
          function onSetupComplete() {
            done();
          }

          gpio.setup(7).then(callback);
        });

        it('should run the callback successfully', () => {
          sinon.assert.calledOnce(callback);
        });
      });

      context('when CPU revision is invalid', () => {
        let catchCallback;

        beforeEach((done) => {
          catchCallback = sandbox.spy(onSetupComplete);
          fs.readFile.withArgs('/proc/cpuinfo').yieldsAsync(null, getCpuInfo('A Bad Revision'));
          function onSetupComplete() {
            done();
          }

          gpio.setup(7).catch(catchCallback);
        });

        it('should catch the error successfully', () => {
          sinon.assert.calledOnce(catchCallback);
        });
      });
    });
  });

  describe('write()', () => {
    context('when pin 7 has been setup for output', () => {
      let onSetup;

      beforeEach((done) => {
        onSetup = sandbox.spy(done);
        gpio.setup(7, gpio.DIR_OUT).then(onSetup);
      });

      context('and pin 7 is written to with boolean true', () => {
        beforeEach((done) => {
          gpio.write(7, true).then(done);
        });

        it('should write the value to the file system', () => {
          const args = fs.writeFile.lastCall.args;
          assert.equal(args[0], PATH + '/gpio7/value');
          assert.equal(args[1], '1');

          sinon.assert.called(onSetup);
        });
      });
    });
  });

  describe('read()', () => {
    context('when pin 7 is setup for input', () => {
      beforeEach(() => {
        return gpio.setup(7, gpio.DIR_IN);
      });

      context('and pin 7 is on', () => {
        beforeEach(() => {
          fs.readFile.yieldsAsync(null, '1');
        });

        context('and pin 7 is read', () => {
          let promise;

          beforeEach(() => {
            promise = gpio.read(7);
          });

          it('should run the callback with a value boolean true', () => {
            const args = fs.readFile.lastCall.args;
            assert.equal(args[0], PATH + '/gpio7/value');
            promise.then((result) => {
              assert.ok(result);
            });
          });
        });
      });
    });
  });

  describe('destroy', () => {
    context('when pins 7, 8 and 10 have been exported', () => {
      const unexportPath = PATH + '/unexport';

      beforeEach((done) => {
        let i = 3;
        [7, 8, 10].forEach((pin) => {
          gpio.setup(pin, gpio.DIR_IN).then(() => {
            if (--i === 0) {
              done();
            }
          });
        });
      });

      it('should have created 3 listeners', () => {
        assert.equal(listeners.length, 3);
      });

      context('and destroy() is run', () => {

        beforeEach((done) => {
          gpio.destroy().then(done);
        });

        it('should unexport pin 7', () => {
          sinon.assert.calledWith(fs.writeFile, unexportPath, '7');
        });

        it('should unexport pin 8', () => {
          sinon.assert.calledWith(fs.writeFile, unexportPath, '8');
        });

        it('should unexport pin 10', () => {
          sinon.assert.calledWith(fs.writeFile, unexportPath, '10');
        });

        it('should unwatch pin 7', () => {
          const listener = listeners[0];
          sinon.assert.calledOnce(listener.remove);
          sinon.assert.calledWith(listener.remove, 'fakeFd');
          sinon.assert.calledOnce(listener.close);
        });

        it('should unwatch pin 8', () => {
          const listener = listeners[1];
          sinon.assert.calledOnce(listener.remove);
          sinon.assert.calledWith(listener.remove, 'fakeFd');
          sinon.assert.calledOnce(listener.close);
        });

        it('should unwatch pin 9', () => {
          const listener = listeners[2];
          sinon.assert.calledOnce(listener.remove);
          sinon.assert.calledWith(listener.remove, 'fakeFd');
          sinon.assert.calledOnce(listener.close);
        });

      });

    });
  });

  describe('callback API (legacy)', () => {
    describe('write()', () => {
      context('when pin 7 has been setup for output', () => {
        beforeEach((done) => {
          gpioCallback.setup(7, gpio.DIR_OUT, done)
        });

        context('and pin 7 is written to with boolean true', () => {
          beforeEach((done) => {
            gpioCallback.write(7, true, done);
          });

          it('should write the value to the file system', () => {
            const args = fs.writeFile.lastCall.args;
            assert.equal(args[0], PATH + '/gpio7/value');
            assert.equal(args[1], '1');
          });
        });
      });
    });

    describe('read()', () => {
      context('when pin 7 is setup for input', () => {
        beforeEach((done) => {
          gpioCallback.setup(7, gpio.DIR_IN, done);
        });

        context('and pin 7 is on', () => {
          beforeEach(() => {
            fs.readFile.yieldsAsync(null, '1');
          });

          context('and pin 7 is read', () => {
            let callback;

            beforeEach((done) => {
              callback = sandbox.spy(done);
              gpioCallback.read(7, callback)
            });

            it('should run the callback with a value boolean true', () => {
              const args = fs.readFile.lastCall.args;
              assert.equal(args[0], PATH + '/gpio7/value');
              sinon.assert.calledWith(callback, null, true);
            });
          });
        });
      });
    });
  });
});
