const gpio = require('../rpi-gpio');

const pin = 7;
const loopCount = 3;

function timeout(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  await gpio.setup(pin, gpio.DIR_OUT);

  let count = 0;
  let currentState = 0;

  while (count < loopCount) {
    const nextState = !currentState;
    console.log('Set pin: ', nextState);
    await gpio.write(pin, nextState);

    count++;
    currentState = nextState;

    await timeout(2000);
  }

  await gpio.destroy();
  console.log('Closed writePins, now exit');
}

main();
