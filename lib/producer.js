/* eslint-disable */

import {
  Worker,
  parentPort,
  isMainThread,
  workerData,
  receiveMessageOnPort,
  MessageChannel,
} from "worker_threads";
import url from "url";
import EventEmitter from "events";
import stream from "stream";

if (!isMainThread) {
  //   parentPort.on("message", () => {});

  const maxPacketsToSendWithoutAck = workerData.maxPacketsToSendWithoutAck;

  let producerStream = undefined;
  let destroyed = false;

  let packetsSentWithoutAck = 0;

  const maybePauseOrResumeStream = () => {
    const streamIsPaused = producerStream && producerStream.isPaused();
    const packetsCanBeSent = packetsSentWithoutAck < maxPacketsToSendWithoutAck;

    // console.log("streamIsPaused =", streamIsPaused);
    // console.log("packetsCanBesent =", packetsCanBeSent);

    if (packetsCanBeSent && streamIsPaused) {
      producerStream.resume();
      workerData.imporovedParentPort.unref();
    } else if (!packetsCanBeSent && !streamIsPaused) {
      producerStream.pause();
      workerData.imporovedParentPort.ref();
    }
  };

  const processMessageFromMainThread = ({ message }) => {
    if (message.type === "ack") {
      packetsSentWithoutAck -= message.numberOfPacketsReceived;

      maybePauseOrResumeStream();
    } else if (message.type === "destroy") {
      console.log("got destroy message");
      if (producerStream) {
        producerStream.destroy();
      }

      destroyed = true;
    }
  };

  workerData.imporovedParentPort.on("message", (msg) => {
    processMessageFromMainThread({ message: msg });
  });
  workerData.imporovedParentPort.unref();

  const drainAndProcessMessagesFromMainThread = () => {
    let hasMore = true;

    while (hasMore) {
      const received = receiveMessageOnPort(workerData.imporovedParentPort);
      if (received) {
        processMessageFromMainThread({ message: received.message });
      }

      hasMore = Boolean(received);
    }
  };

  //   const terminateWithError = ({ error }) => {
  //     // throwing inside nextTick raises an
  //     // uncaught exception, which results in an
  //     // error event on the worker
  //     process.nextTick(() => {
  //       throw error;
  //     });
  //   };

  import(workerData.scriptPath).then((module) => {
    if (destroyed) {
      return;
    }

    const factory = module.default;
    producerStream = factory(workerData.producerData);

    producerStream.on("data", (data) => {
      workerData.imporovedParentPort.postMessage({
        type: "data",
        data,
      });
      packetsSentWithoutAck += 1;

      drainAndProcessMessagesFromMainThread();
      maybePauseOrResumeStream();
    });
    producerStream.once("end", () => {
      parentPort.close();
    });
    producerStream.once("error", (err) => {
      throw err;
    });
    producerStream.resume();
  });
}

const create = ({ filename, producerData }) => {
  const scriptPath = url.fileURLToPath(filename);

  const { port1, port2 } = new MessageChannel();

  const worker = new Worker(new url.URL(import.meta.url), {
    workerData: {
      scriptPath,
      producerData,
      imporovedParentPort: port2,
      maxPacketsToSendWithoutAck: 100,
    },
    transferList: [port2],
  });

  let takesMore = true;
  let workerExited = false;
  let workerExitCode = undefined;

  let queued = [];

  const nextFromProducer = () => {
    if (queued.length > 0) {
      const msg = queued[0];
      queued = queued.slice(1);
      return msg;
    } else {
      const received = receiveMessageOnPort(port1);
      return received?.message;
    }
  };

  let numberOfPacketsReceivedWithoutAck = 0;
  let numberOfPacketsProcessedInThisTurn = 0;

  const maybeProcessNext = () => {
    if (!takesMore) {
      return undefined;
    }

    const msg = nextFromProducer();
    if (msg) {
      numberOfPacketsReceivedWithoutAck += 1;
      numberOfPacketsProcessedInThisTurn += 1;

      if (numberOfPacketsReceivedWithoutAck >= 20) {
        port1.postMessage({
          type: "ack",
          numberOfPacketsReceived: numberOfPacketsReceivedWithoutAck,
        });
        numberOfPacketsReceivedWithoutAck = 0;
      }

      takesMore = readable.push(msg.data);

      if (numberOfPacketsProcessedInThisTurn < 20) {
        return maybeProcessNext();
      } else {
        numberOfPacketsProcessedInThisTurn = 0;
      }
    } else if (workerExited) {
      readable.push(null);
    }
  };

  const read = () => {
    takesMore = true;
    maybeProcessNext();
  };

  const destroy = (err, callback) => {
    console.log("destroying worker!");
    if (!workerExited) {
      port1.postMessage({
        type: "destroy",
      });

      const terminateTimeout = setTimeout(() => {
        console.log("terminating worker!");
        worker.terminate();
      }, 5000);

      worker.once("exit", () => {
        clearTimeout(terminateTimeout);
        callback();
      });
    }
  };

  const readable = new stream.Readable({
    read,
    destroy,
    objectMode: true,
  });

  port1.on("message", (msg) => {
    queued = [...queued, msg];
    return maybeProcessNext();
  });
  //   worker.once("messageerror", (err) => {
  //     // TODO: implement
  //   });
  worker.once("exit", (exitCode) => {
    workerExited = true;
    workerExitCode = exitCode;
    maybeProcessNext();
  });
  worker.once("error", (err) => {
    console.error("worker error", err);
    readable.destroy(err);
  });

  return readable;
};

export default {
  create,
};
