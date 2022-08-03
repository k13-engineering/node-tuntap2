/* global describe */
/* global it */

import producerFactory from "../lib/producer.js";
import { workerData, isMainThread } from "worker_threads";
import stream, { Stream } from "stream";
import assert from "assert";

const waitForProducerEnd = ({ producer }) => {
  return new Promise((resolve, reject) => {
    producer.once("end", () => {
      resolve();
    });
    producer.once("error", (err) => {
      reject(err);
    });
    producer.resume();
  });
};

const consumeAll = ({ producer }) => {
  return new Promise((resolve, reject) => {
    let packetsReceived = [];

    producer.on("data", (data) => {
      packetsReceived = [...packetsReceived, data];
    });
    producer.once("end", () => {
      resolve({ packetsReceived });
    });
    producer.once("error", (err) => {
      reject(err);
    });
    producer.resume();
  });
};

if (isMainThread) {
  describe("producer", function () {
    this.timeout(20000);

    it("should produce/consume data correctly", () => {
      const packetToSend = "Hello, World!";
      const howManyTimesToSend = 50;

      const producer = producerFactory.create({
        filename: import.meta.url,
        producerData: {
          packetToSend,
          howManyTimesToSend,
        },
      });

      return consumeAll({ producer }).then(({ packetsReceived }) => {
        assert.strictEqual(packetsReceived.length, howManyTimesToSend);
        packetsReceived.forEach((packet) => {
          assert.deepEqual(packet, packetToSend);
        });
      });
    });
  });
}

export default ({
  packetToSend = "Hello, World!",
  howManyTimesToSend = 10,
  errorToThrowOnInit = undefined,
  errorToThrowInRead = undefined,
  errorToThrowInTick = undefined,
}) => {
  let packetsLeft = howManyTimesToSend;

  if (errorToThrowOnInit) {
    throw errorToThrowOnInit;
  }

  if (errorToThrowInTick) {
    process.nextTick(() => {
      throw errorToThrowInTick;
    });
  }

  let readable;

  const read = () => {
    if (errorToThrowInRead) {
      throw errorToThrowInRead;
    }

    if (packetsLeft > 0) {
      readable.push(packetToSend);
      packetsLeft -= 1;
    } else {
      readable.push(null);
    }
  };

  readable = new stream.Readable({
    read,
    objectMode: true,
  });
  return readable;
};
