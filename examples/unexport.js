const gpio = require('../rpi-gpio');

gpio.on('export', function(channel) {
  console.log('Channel set: ' + channel);
});

function timeout(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  await Promise.all([
    gpio.setup(7, gpio.DIR_OUT),
    gpio.setup(15, gpio.DIR_OUT),
    gpio.setup(16, gpio.DIR_OUT),
  ]);

  await timeout(2000);

  await gpio.destroy();
  console.log('All pins unexported');
}

main();
